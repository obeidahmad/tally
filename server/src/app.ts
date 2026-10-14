import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { burnTime, currentSession, endSession, hashPassword, requireAuth, startSession, toUser, USER_COLS, verifyPassword } from './auth';
import { bankCallback } from './banks';
import { createRates, ECB_URL } from './rates';
import { dataRouter } from './data';
import { recurringRouter } from './recurring';
import type { Db } from './db';
import { errorHandler, fieldError, HttpError, notFound, parse, requireJson } from './http';
import * as s from './schemas';

export type AppOptions = { db: Db; cookieSecure?: boolean; webDist?: string; ratesUrl?: string; bankUrl?: string; publicUrl?: string; now?: () => number };

export function createApp({ db, cookieSecure = false, webDist = path.join(__dirname, '..', '..', 'web', 'dist'), ratesUrl = process.env.TALLY_RATES_URL ?? ECB_URL, bankUrl = process.env.TALLY_ENABLEBANKING_URL ?? 'https://api.enablebanking.com', publicUrl = process.env.TALLY_PUBLIC_URL, now = Date.now }: AppOptions) {
  const rates = createRates(db, ratesUrl, now);
  const bank = { url: bankUrl.replace(/\/+$/, ''), publicUrl, now };
  const app = express();
  // Tally is normally reached over plain HTTP: no upgrade-insecure-requests, and HSTS only when HTTPS is declared.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } },
      strictTransportSecurity: cookieSecure,
    }),
  );

  const api = express.Router();
  const json = express.json();
  // A statement can be 5,000,000 characters: its routes get a bigger limit, and only after sign-in.
  api.use(requireJson, (req, res, next) => (req.path.startsWith('/imports') ? next() : json(req, res, next)), cookieParser());

  const userById = (id: number) => toUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id));
  const needsSetup = () => !db.prepare('SELECT 1 FROM users').get();
  const usernameTaken = () => new HttpError(409, 'conflict', 'That username is taken.', { username: 'That username is taken.' });

  async function addUser(b: ReturnType<typeof s.newAccount.parse>, isOwner: boolean) {
    const hash = await hashPassword(b.password);
    return db.transaction(() => {
      // Re-checked inside the transaction so two simultaneous set-ups cannot both win.
      if (isOwner && !needsSetup()) throw new HttpError(409, 'conflict', 'Set-up was already done.');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) throw usernameTaken();
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (username, display_name, password_hash, is_owner, base_currency) VALUES (?, ?, ?, ?, ?)')
        .run(b.username, b.displayName, hash, isOwner ? 1 : 0, b.baseCurrency);
      return userById(Number(lastInsertRowid));
    })();
  }

  api.get('/health', (_req, res) => { res.json({ ok: true }); });

  api.get('/auth/state', (req, res) => {
    res.json({ needsSetup: needsSetup(), user: currentSession(db, req.cookies?.tally_session)?.user ?? null });
  });

  api.post('/auth/setup', async (req, res) => {
    if (!needsSetup()) throw new HttpError(409, 'conflict', 'Set-up was already done.');
    const user = await addUser(parse(s.newAccount, req.body), true);
    startSession(db, res, user.id, cookieSecure);
    res.status(201).json({ user });
  });

  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.')),
  });
  api.post('/auth/login', loginLimit, async (req, res) => {
    const b = parse(s.login, req.body);
    const row = db.prepare('SELECT id, password_hash AS hash FROM users WHERE username = ?').get(b.username) as
      | { id: number; hash: string }
      | undefined;
    const ok = row ? await verifyPassword(b.password, row.hash) : (await burnTime(b.password), false);
    if (!row || !ok) throw new HttpError(401, 'invalid_credentials', "That username and password don't match.");
    startSession(db, res, row.id, cookieSecure);
    res.json({ user: userById(row.id) });
  });

  // The bank sends the browser back here; the state, not a cookie, says whose it is.
  api.get('/banks/callback', bankCallback(db, bank));

  // Everything below needs a session.
  api.use(requireAuth(db));

  api.post('/auth/logout', (req, res) => {
    endSession(db, res, req.sessionHash);
    res.status(204).end();
  });

  api.post('/me/password', async (req, res) => {
    const b = parse(s.changePassword, req.body);
    const { hash } = db.prepare('SELECT password_hash AS hash FROM users WHERE id = ?').get(req.user.id) as { hash: string };
    if (!(await verifyPassword(b.currentPassword, hash))) throw fieldError('currentPassword', 'That is not your current password.');
    const next = await hashPassword(b.newPassword);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(next, req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    })();
    res.status(204).end();
  });

  const ownerOnly: express.RequestHandler = (req, _res, next) =>
    next(req.user.isOwner ? undefined : new HttpError(403, 'forbidden', 'Only the owner can do that.'));
  api.get('/users', ownerOnly, (_req, res) => {
    res.json({ users: db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY id`).all().map(toUser) });
  });
  api.post('/users', ownerOnly, async (req, res) => {
    res.status(201).json({ user: await addUser(parse(s.newAccount, req.body), false) });
  });

  api.use('/imports', express.json({ limit: '25mb' }));
  api.use(dataRouter(db, rates, now, bank));
  api.use(recurringRouter(db, now));
  api.use(() => { throw notFound(); });
  app.use('/api', api);

  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  app.locals.rates = rates;
  return app;
}
