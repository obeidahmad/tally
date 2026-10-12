import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { RequestHandler, Response } from 'express';
import type { Db } from './db';
import { HttpError } from './http';

const scrypt = promisify(crypto.scrypt) as (
  pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions,
) => Promise<Buffer>;

const N = 32768, R = 8, P = 1, KEYLEN = 64;
const opts = (n: number, r: number, p: number) => ({ N: n, r, p, maxmem: 256 * n * r });

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, opts(N, R, P));
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, n, r, p, salt, key] = stored.split('$');
  const want = Buffer.from(key, 'hex');
  const got = await scrypt(pw, Buffer.from(salt, 'hex'), want.length, opts(+n, +r, +p));
  return crypto.timingSafeEqual(got, want);
}

// Unknown usernames still pay for one scrypt so timing does not reveal them.
const dummy = hashPassword('not-a-real-password');
export async function burnTime(pw: string) {
  await verifyPassword(pw, await dummy);
}

export type User = { id: number; username: string; displayName: string; isOwner: boolean; baseCurrency: string };
export const USER_COLS = 'id, username, display_name AS displayName, is_owner AS isOwner, base_currency AS baseCurrency';
export const toUser = (row: any): User => ({ ...row, isOwner: !!row.isOwner });

declare global {
  namespace Express {
    interface Request {
      user: User;
      sessionHash: string;
    }
  }
}

const COOKIE = 'tally_session';
const DAY = 24 * 3600 * 1000;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function startSession(db: Db, res: Response, userId: number, secure: boolean) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token), userId, Date.now() + 30 * DAY,
  );
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 30 * DAY });
}

export function endSession(db: Db, res: Response, hash: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
  res.clearCookie(COOKIE, { path: '/' });
}

// Looks up the cookie's session; deletes it if expired. Returns null when there is none.
export function currentSession(db: Db, token: unknown): { user: User; hash: string } | null {
  if (typeof token !== 'string' || !token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(`SELECT s.expires_at AS exp, u.id, u.username, u.display_name AS displayName,
                     u.is_owner AS isOwner, u.base_currency AS baseCurrency
              FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
    .get(hash) as any;
  if (!row) return null;
  if (row.exp <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  const { exp, ...u } = row;
  return { user: toUser(u), hash };
}

export const requireAuth = (db: Db): RequestHandler => (req, _res, next) => {
  const s = currentSession(db, req.cookies?.[COOKIE]);
  if (!s) return next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
  req.user = s.user;
  req.sessionHash = s.hash;
  next();
};
