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

export type User = { id: number; username: string; displayName: string; isOwner: boolean; baseCurrency: string; nextMonthPocketId: number | null };
export const USER_COLS = 'id, username, display_name AS displayName, is_owner AS isOwner, base_currency AS baseCurrency, home_pocket_id AS nextMonthPocketId';
export const toUser = (row: any): User => ({ ...row, isOwner: !!row.isOwner });

export type Viewing = { ownerId: number; displayName: string; baseCurrency: string };

// Resolves whose budget a request acts on, once. A viewing owner who no longer lists the person is dropped.
export function actingBudget(db: Db, me: User): { user: User; viewing: Viewing | null } {
  const v = db
    .prepare(`SELECT o.id AS ownerId, o.display_name AS displayName, o.base_currency AS baseCurrency, o.home_pocket_id AS nextMonthPocketId
              FROM users u JOIN budget_members m ON m.owner_id = u.viewing_owner_id AND m.member_id = u.id
              JOIN users o ON o.id = m.owner_id WHERE u.id = ?`)
    .get(me.id) as (Viewing & { nextMonthPocketId: number | null }) | undefined;
  if (!v) {
    db.prepare('UPDATE users SET viewing_owner_id = NULL WHERE id = ? AND viewing_owner_id IS NOT NULL').run(me.id);
    return { user: me, viewing: null };
  }
  const { nextMonthPocketId, ...viewing } = v;
  return { user: { ...me, id: v.ownerId, baseCurrency: v.baseCurrency, nextMonthPocketId }, viewing };
}

// Bank, Trading212 and sharing settings belong to the budget's owner.
export const ownerOnlyBudget: RequestHandler = (req, _res, next) =>
  next(req.viewing ? new HttpError(403, 'owner_only', `Only ${req.viewing.displayName} can change this.`) : undefined);

declare global {
  namespace Express {
    interface Request {
      /** The acting budget: id, base currency and next-month pocket are the budget owner's. Every data route reads this. */
      user: User;
      /** The signed-in person. Only /me, passwords, accounts and sharing use this. */
      me: User;
      viewing: Viewing | null;
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
                     u.is_owner AS isOwner, u.base_currency AS baseCurrency, u.home_pocket_id AS nextMonthPocketId
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
  req.me = s.user;
  ({ user: req.user, viewing: req.viewing } = actingBudget(db, s.user));
  req.sessionHash = s.hash;
  next();
};
