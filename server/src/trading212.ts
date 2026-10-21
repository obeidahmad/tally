import { Router } from 'express';
import { z } from 'zod';
import type { Db } from './db';
import { HttpError, fieldError, parse } from './http';
import type { Rates } from './rates';
import { decrypt, encrypt } from './secrets';

export type BrokerConfig = { url?: string; now: () => number; sleep: (ms: number) => Promise<void> };
export type BrokerDeps = {
  isClosed: (uid: number, month: string) => boolean;
  baseOf: (user: { baseCurrency: string }, t: { amountMinor: number; currency: string; date: string }) => number;
  today: () => string;
};

const DAY = 86400000;
const SOURCE = 'Trading212 dividends';
const body = z.object({
  pocketId: z.number({ error: 'Choose a broker pocket.' }).int('Choose a broker pocket.'),
  subsectionId: z.number({ error: 'Choose a subsection.' }).int('Choose a subsection.'),
  environment: z.enum(['live', 'demo'], { error: 'Choose live or demo.' }),
  apiKey: z.string({ error: 'Paste your Trading212 API key.' }).trim().min(10, 'Paste your Trading212 API key.').max(200, 'Paste your Trading212 API key.'),
  apiSecret: z.string().trim().max(200, 'The secret is too long.').optional(),
});

const REFUSED = 'Trading212 refused the key.';
const SILENT = 'Trading212 is not answering. Tally will try again.';
const fail = (m: string) => new HttpError(502, 'broker_error', m);
const exponentOf = (c: string) => new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits!;
// 12.345 -> 1235 by shifting the decimal point in the text, so float multiplication cannot drift.
const minor = (v: unknown, exp: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw fail(SILENT);
  return Math.round(String(n).includes('e') ? n * 10 ** exp : Number(`${n}e${exp}`));
};

export function trading212(db: Db, rates: Rates, cfg: BrokerConfig, deps: BrokerDeps) {
  const one = (sql: string, ...a: unknown[]): any => db.prepare(sql).get(...a);
  const all = (sql: string, ...a: unknown[]): any[] => db.prepare(sql).all(...a);
  const CONN = 'SELECT pocket_id AS pocketId, environment, subsection_id AS subsectionId, key_end AS keyEnd, synced_at AS syncedAt, error FROM broker_connections WHERE user_id = ?';

  // Trading212's limits: n calls per window. Waits (with the injected sleep) rather than failing.
  const calls = new Map<string, number[]>();
  async function gate(uid: number, name: string, n: number, windowMs: number) {
    const k = `${uid}:${name}`;
    const list = calls.get(k) ?? [];
    calls.set(k, list);
    for (;;) {
      const t = cfg.now();
      while (list.length && t - list[0]! >= windowMs) list.shift();
      if (list.length < n) break;
      await cfg.sleep(list[0]! + windowMs - t);
    }
    list.push(cfg.now());
  }

  const baseUrl = (env: string) => (cfg.url ?? `https://${env}.trading212.com/api/v0`).replace(/\/+$/, '');
  const auth = (key: string, secret: string | null) => (secret ? `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` : key);
  async function get(url: string, authorization: string): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(15000) });
    } catch { throw fail(SILENT); }
    if (res.status === 401 || res.status === 403) throw fail(REFUSED);
    if (res.status === 429) throw fail('Trading212 asked Tally to slow down. Tally will try again.');
    if (!res.ok) throw fail(SILENT);
    try { return await res.json(); } catch { throw fail(SILENT); }
  }

  // Frees a connection's holdings: they stay, as if typed by hand.
  const release = (uid: number) =>
    db.transaction(() => {
      const c = one('SELECT pocket_id AS p FROM broker_connections WHERE user_id = ?', uid);
      if (!c) return;
      db.prepare("UPDATE holdings SET source = 'manual', ticker = NULL WHERE user_id = ? AND source = 'trading212'").run(uid);
      db.prepare('UPDATE pockets SET synced_balance_minor = NULL, synced_at = NULL WHERE id = ?').run(c.p);
      db.prepare('DELETE FROM broker_connections WHERE user_id = ?').run(uid);
    })();

  type User = { id: number; baseCurrency: string };
  async function doSync(user: User) {
    const uid = user.id;
    const c = one('SELECT pocket_id AS pocketId, subsection_id AS subsectionId, environment, currency, key_enc AS keyEnc, secret_enc AS secretEnc, synced_at AS syncedAt, instruments_at AS instrumentsAt FROM broker_connections WHERE user_id = ?', uid);
    if (!c) throw new HttpError(409, 'not_configured', 'Connect Trading212 first.');
    await rates.ensure();
    const base = baseUrl(c.environment);
    const authz = auth(decrypt(c.keyEnc), c.secretEnc ? decrypt(c.secretEnc) : null);
    const cur: string = c.currency, exp = exponentOf(cur);
    const nowMs = cfg.now(), today = deps.today();
    try {
      // Everything is read before anything is saved.
      await gate(uid, 'cash', 1, 2000);
      const cash = await get(`${base}/equity/account/cash`, authz);
      await gate(uid, 'portfolio', 1, 5000);
      const portfolio = await get(`${base}/equity/portfolio`, authz);
      if (!Array.isArray(portfolio)) throw fail(SILENT);
      let instruments: any[] | null = null;
      if (!c.instrumentsAt || nowMs - Date.parse(c.instrumentsAt) > DAY) {
        instruments = await get(`${base}/equity/metadata/instruments`, authz);
        if (!Array.isArray(instruments)) throw fail(SILENT);
      }
      // First sync reads 90 days back; later ones overlap the last sync by a week (duplicates are skipped by reference).
      const cutoff = new Date(c.syncedAt ? Date.parse(c.syncedAt) - 7 * DAY : nowMs - 90 * DAY).toISOString().slice(0, 10);
      const recent = (x: any) => String(x.paidOn ?? '').slice(0, 10) >= cutoff;
      const divs: any[] = [];
      let next: string | null = `${base}/history/dividends?limit=50`;
      // shortcut: assumes newest first and stops after the first page with nothing recent; 50 pages at most.
      for (let i = 0; next && i < 50; i++) {
        await gate(uid, 'dividends', 6, 60000);
        const page = await get(next, authz);
        const items: any[] = Array.isArray(page?.items) ? page.items : [];
        divs.push(...items.filter(recent));
        const p = typeof page?.nextPagePath === 'string' ? page.nextPagePath : '';
        next = p && items.some(recent) ? new URL(p, base).href : null;
        // The key must never be sent to another host.
        if (next && new URL(next).origin !== new URL(base).origin) throw fail(SILENT);
      }

      const out = { holdings: 0, dividends: 0 };
      const stamp = new Date(nowMs).toISOString();
      db.transaction(() => {
        // A disconnect (or a switch of pocket or environment) that landed during the reads wins: write nothing.
        const now = one('SELECT pocket_id AS pocketId, environment FROM broker_connections WHERE user_id = ?', uid);
        if (now?.pocketId !== c.pocketId || now.environment !== c.environment) throw new HttpError(409, 'disconnected', 'Trading212 was disconnected.');
        if (instruments) {
          for (const x of instruments)
            if (x?.ticker) db.prepare('INSERT OR REPLACE INTO broker_instruments (user_id, ticker, name, currency) VALUES (?, ?, ?, ?)').run(uid, String(x.ticker), String(x.name ?? x.shortName ?? x.ticker), String(x.currencyCode ?? cur));
          db.prepare('UPDATE broker_connections SET instruments_at = ? WHERE user_id = ?').run(stamp, uid);
        }

        db.prepare('UPDATE pockets SET synced_balance_minor = ?, synced_at = ? WHERE id = ?').run(minor(cash?.free, exp), stamp, c.pocketId);

        const seen = new Set<string>();
        for (const p of portfolio) {
          const ticker = String(p.ticker);
          seen.add(ticker);
          const ins = one('SELECT name, currency FROM broker_instruments WHERE user_id = ? AND ticker = ?', uid, ticker);
          let wc: string = ins?.currency ?? cur, price = Number(p.currentPrice);
          if (wc === 'GBX' || wc === 'GBp') { wc = 'GBP'; price /= 100; } // quoted in pence
          const worth = minor(Number(p.quantity) * price, exponentOf(wc));
          const inAccount = rates.convert(worth, wc, cur, today);
          if (inAccount === null) throw new HttpError(409, 'no_rate', `There is no exchange rate for ${wc} yet.`);
          const paid = inAccount - minor(p.ppl ?? 0, exp) - minor(p.fxPpl ?? 0, exp);
          const h = one("SELECT id FROM holdings WHERE user_id = ? AND source = 'trading212' AND ticker = ? AND sold_date IS NULL", uid, ticker);
          if (h) db.prepare('UPDATE holdings SET paid_minor = ?, worth_minor = ?, worth_currency = ?, worth_date = ? WHERE id = ?').run(paid, worth, wc, today, h.id);
          else
            db.prepare("INSERT INTO holdings (user_id, name, pocket_id, subsection_id, paid_minor, worth_minor, worth_currency, worth_date, source, ticker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'trading212', ?)")
              .run(uid, (ins?.name ?? ticker).slice(0, 60), c.pocketId, c.subsectionId, paid, worth, wc, today, ticker);
          out.holdings++;
        }
        // Gone from the portfolio: sold, with no transaction (the money is in the synced cash).
        for (const h of all("SELECT id, ticker FROM holdings WHERE user_id = ? AND source = 'trading212' AND sold_date IS NULL", uid))
          if (!seen.has(h.ticker)) db.prepare('UPDATE holdings SET sold_date = ? WHERE id = ?').run(today, h.id);

        let sourceId: number | null = null;
        for (const d of divs) {
          const date = String(d.paidOn ?? '').slice(0, 10);
          const amountMinor = minor(d.amount, exp);
          if (!d.reference || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amountMinor <= 0 || deps.isClosed(uid, date.slice(0, 7))) continue;
          const ref = `t212:${d.reference}`;
          if (one('SELECT 1 FROM transactions WHERE pocket_id = ? AND bank_ref = ?', c.pocketId, ref)) continue;
          sourceId ??= one('SELECT id FROM sources WHERE user_id = ? AND name = ? COLLATE NOCASE', uid, SOURCE)?.id
            ?? Number(db.prepare('INSERT INTO sources (user_id, name, box_id) VALUES (?, ?, (SELECT COALESCE(MAX(box_id), 0) + 1 FROM sources))').run(uid, SOURCE).lastInsertRowid);
          db.prepare("INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, source_id, payee, source, bank_ref) VALUES (?, ?, 'income', ?, ?, ?, ?, ?, 'broker', ?)")
            .run(uid, date, amountMinor, deps.baseOf(user, { amountMinor, currency: cur, date }), c.pocketId, sourceId, String(d.ticker ?? '').slice(0, 120), ref);
          out.dividends++;
        }
        db.prepare('UPDATE broker_connections SET synced_at = ?, error = NULL WHERE user_id = ?').run(stamp, uid);
      })();
      return out;
    } catch (e) {
      if (e instanceof HttpError && e.code === 'broker_error') db.prepare('UPDATE broker_connections SET error = ? WHERE user_id = ?').run(e.message, uid);
      throw e;
    }
  }

  // One sync at a time per person: a second caller gets the running one.
  const running = new Map<number, ReturnType<typeof doSync>>();
  const sync = (user: User) => {
    let p = running.get(user.id);
    if (!p) running.set(user.id, (p = doSync(user).finally(() => running.delete(user.id))));
    return p;
  };

  // Called as the Pockets or Investments page loads: starts a sync in the background when the last one is over an hour old.
  const tried = new Map<number, number>();
  const maybeSync = (user: User) => {
    const c = one('SELECT synced_at AS s FROM broker_connections WHERE user_id = ?', user.id);
    const t = cfg.now();
    if (!c || (c.s && t - Date.parse(c.s) < 3600000) || t - (tried.get(user.id) ?? 0) < 300000) return;
    tried.set(user.id, t);
    sync(user).catch(() => {}); // the error is stored on the connection
  };

  const r = Router();
  r.put('/brokers/trading212', async (req, res) => {
    const uid = req.user.id;
    const b = parse(body, req.body);
    if (one("SELECT 1 FROM pockets WHERE id = ? AND user_id = ? AND kind = 'property'", b.pocketId, uid)) throw fieldError('pocketId', 'A property pocket holds a value, not transactions.');
    const pocket = one("SELECT currency FROM pockets WHERE id = ? AND user_id = ? AND kind = 'broker'", b.pocketId, uid);
    if (!pocket) throw fieldError('pocketId', 'Choose a broker pocket.');
    if (!one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', b.subsectionId, uid)) throw fieldError('subsectionId', 'Choose a subsection.');
    const secret = b.apiSecret || null;
    let info: any;
    try {
      info = await get(`${baseUrl(b.environment)}/equity/account/info`, auth(b.apiKey, secret));
    } catch (e) {
      if (e instanceof HttpError && e.message === REFUSED) throw fieldError('apiKey', 'Trading212 refused this key.');
      throw e;
    }
    const code = typeof info?.currencyCode === 'string' ? info.currencyCode : '';
    if (!/^[A-Z]{3}$/.test(code)) throw fail('Trading212 is not answering. Try again.');
    if (code !== pocket.currency) throw fieldError('pocketId', `This Trading212 account is in ${code}. Choose a pocket in ${code}.`);
    db.transaction(() => {
      const old = one('SELECT pocket_id AS p, environment AS e FROM broker_connections WHERE user_id = ?', uid);
      if (old && (old.p !== b.pocketId || old.e !== b.environment)) release(uid);
      db.prepare(`INSERT INTO broker_connections (user_id, pocket_id, subsection_id, environment, currency, key_enc, secret_enc, key_end)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (user_id) DO UPDATE SET pocket_id = excluded.pocket_id, subsection_id = excluded.subsection_id, environment = excluded.environment,
                    currency = excluded.currency, key_enc = excluded.key_enc, secret_enc = excluded.secret_enc, key_end = excluded.key_end, error = NULL`)
        .run(uid, b.pocketId, b.subsectionId, b.environment, code, encrypt(b.apiKey), secret && encrypt(secret), b.apiKey.slice(-4));
    })();
    res.json({ connection: one(CONN, uid) });
  });
  r.get('/brokers/trading212', (req, res) => { res.json({ connection: one(CONN, req.user.id) ?? null }); });
  r.delete('/brokers/trading212', (req, res) => {
    release(req.user.id);
    res.status(204).end();
  });
  r.post('/brokers/trading212/sync', async (req, res) => { res.json(await sync(req.user)); });

  return { router: r, maybeSync };
}
