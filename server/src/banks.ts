import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from './db';
import { HttpError, fieldError, notFound, parse } from './http';
import { decrypt, encrypt } from './secrets';

export type BankConfig = { url: string; publicUrl?: string; now: () => number };
type Rule = { subsectionId: number | null; sourceId: number | null };
// What a sync needs from the statement import in data.ts.
export type SyncDeps = {
  isClosed: (uid: number, month: string) => boolean;
  rulesOf: (uid: number) => any[];
  ruleFor: (rules: any[], kind: string, payee: string) => Rule | undefined;
  baseOf: (user: { baseCurrency: string }, t: { amountMinor: number; currency: string; date: string }) => number;
};

const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const registration = z.object({
  applicationId: z.string({ error: 'Enter the application ID from Enable Banking.' }).trim().regex(UUID, 'Enter the application ID from Enable Banking.'),
  privateKey: z.string({ error: "Paste the private key file's contents." }).refine((k) => {
    try { return crypto.createPrivateKey(k).asymmetricKeyType === 'rsa'; } catch { return false; }
  }, "Paste the private key file's contents."),
});
const country = z.string().regex(/^[A-Z]{2}$/, 'Choose a country.');
const connectBody = z.object({ name: z.string({ error: 'Choose a bank.' }).trim().min(1, 'Choose a bank.').max(200, 'Choose a bank.'), country });

const b64 = (x: object | Buffer) => (x instanceof Buffer ? x : Buffer.from(JSON.stringify(x))).toString('base64url');
export function makeJwt(applicationId: string, privateKey: string, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const head = `${b64({ typ: 'JWT', alg: 'RS256', kid: applicationId })}.${b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 })}`;
  return `${head}.${b64(crypto.sign('RSA-SHA256', Buffer.from(head), privateKey))}`;
}

const bankDown = () => new HttpError(502, 'bank_error', 'The bank service did not answer. Try again.');
// "-12.50" -> -1250 without floating point; null when it is not a plain decimal.
function toMinor(v: unknown, exponent: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = Number(m[2] + (m[3] ?? '').padEnd(exponent, '0').slice(0, exponent));
  return m[1] ? -n : n;
}
const exponentOf = (c: string) => new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits!;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function client(db: Db, cfg: BankConfig, uid: number) {
  const reg = db.prepare('SELECT application_id AS id, private_key_enc AS enc FROM bank_registrations WHERE user_id = ?').get(uid) as { id: string; enc: string } | undefined;
  if (!reg) throw new HttpError(409, 'not_configured', 'Enter your Enable Banking application ID and private key first.');
  const key = decrypt(reg.enc);
  return async (method: string, path: string, body?: object): Promise<any> => {
    let res: Response;
    try {
      res = await fetch(cfg.url + path, {
        method,
        headers: { Authorization: `Bearer ${makeJwt(reg.id, key, cfg.now())}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
      });
    } catch { throw bankDown(); }
    if (!res.ok) throw bankDown();
    return res.json();
  };
}

// The browser comes back from the bank on its own: the state names the person, no session cookie is needed.
export const bankCallback = (db: Db, cfg: BankConfig): RequestHandler => async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const row = db.prepare('SELECT user_id AS uid, bank, country FROM bank_states WHERE state = ?').get(state) as { uid: number; bank: string; country: string } | undefined;
  if (!row) throw new HttpError(400, 'validation', 'This bank link was not recognised or was already used.');
  db.prepare('DELETE FROM bank_states WHERE state = ?').run(state);
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new Error('no code');
    const s = await client(db, cfg, row.uid)('POST', '/sessions', { code });
    if (!Array.isArray(s.accounts) || !s.session_id || !s.access?.valid_until) throw new Error('bad session');
    db.transaction(() => {
      // Reconnecting the same bank replaces the session and keeps the pocket links (matched by IBAN).
      const old = db.prepare('SELECT id FROM bank_connections WHERE user_id = ? AND bank = ? AND country = ?').get(row.uid, row.bank, row.country) as { id: number } | undefined;
      const kept = old ? (db.prepare('SELECT iban, pocket_id AS pocketId, last_sync_at AS at FROM bank_accounts WHERE connection_id = ?').all(old.id) as { iban: string; pocketId: number | null; at: string | null }[]) : [];
      let id: number;
      if (old) {
        id = old.id;
        db.prepare('DELETE FROM bank_accounts WHERE connection_id = ?').run(id);
        db.prepare('UPDATE bank_connections SET session_id = ?, valid_until = ? WHERE id = ?').run(s.session_id, s.access.valid_until, id);
      } else {
        id = Number(db.prepare('INSERT INTO bank_connections (user_id, bank, country, session_id, valid_until) VALUES (?, ?, ?, ?, ?)').run(row.uid, row.bank, row.country, s.session_id, s.access.valid_until).lastInsertRowid);
      }
      const linked = new Set<number>();
      for (const a of s.accounts) {
        const iban = String(a.account_id?.iban ?? '');
        const k = iban ? kept.find((x) => x.iban === iban) : undefined;
        const pocketId = k?.pocketId && !linked.has(k.pocketId) ? k.pocketId : null;
        if (pocketId) linked.add(pocketId);
        db.prepare('INSERT INTO bank_accounts (connection_id, uid, name, iban, currency, pocket_id, last_sync_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, String(a.uid), String(a.name ?? iban), iban, String(a.currency), pocketId, k?.at ?? null);
      }
      // A pocket whose account is gone from the new session stops showing a bank balance.
      for (const k of kept) if (k.pocketId && !linked.has(k.pocketId)) db.prepare('UPDATE pockets SET synced_balance_minor = NULL, synced_at = NULL WHERE id = ?').run(k.pocketId);
    })();
    res.redirect('/settings?bank=connected');
  } catch {
    res.redirect('/settings?bank=failed');
  }
};

export function bankRouter(db: Db, cfg: BankConfig, deps: SyncDeps): Router {
  const r = Router();
  const one = (sql: string, ...args: unknown[]): any => db.prepare(sql).get(...args);
  const all = (sql: string, ...args: unknown[]): any[] => db.prepare(sql).all(...args);
  const connOf = (uid: number, id: string) => {
    const c = /^\d+$/.test(id) && one('SELECT id, bank, valid_until AS validUntil FROM bank_connections WHERE id = ? AND user_id = ?', Number(id), uid);
    if (!c) throw notFound();
    return c;
  };

  r.put('/banks/registration', (req, res) => {
    const b = parse(registration, req.body);
    db.prepare(`INSERT INTO bank_registrations (user_id, application_id, private_key_enc) VALUES (?, ?, ?)
                ON CONFLICT (user_id) DO UPDATE SET application_id = excluded.application_id, private_key_enc = excluded.private_key_enc`)
      .run(req.user.id, b.applicationId, encrypt(b.privateKey));
    res.status(204).end();
  });
  r.get('/banks/registration', (req, res) => {
    const row = one('SELECT application_id AS applicationId FROM bank_registrations WHERE user_id = ?', req.user.id);
    const publicUrl = cfg.publicUrl || null;
    res.json(row ? { applicationId: row.applicationId, configured: true, publicUrl } : { configured: false, publicUrl });
  });

  r.get('/banks', async (req, res) => {
    const c = parse(z.object({ country }), req.query).country;
    const out = await client(db, cfg, req.user.id)('GET', `/aspsps?country=${c}`);
    res.json({ banks: (out.aspsps ?? []).map((x: any) => ({ name: x.name, country: x.country })) });
  });

  r.post('/banks/connect', async (req, res) => {
    const b = parse(connectBody, req.body);
    if (!cfg.publicUrl) throw new HttpError(409, 'not_configured', "Set TALLY_PUBLIC_URL to this server's HTTPS address to connect a bank.");
    const call = client(db, cfg, req.user.id);
    const state = crypto.randomBytes(24).toString('base64url');
    const out = await call('POST', '/auth', {
      access: { valid_until: new Date(cfg.now() + 180 * DAY).toISOString() },
      aspsp: { name: b.name, country: b.country },
      state,
      redirect_url: `${cfg.publicUrl.replace(/\/+$/, '')}/api/banks/callback`,
      psu_type: 'personal',
    });
    if (typeof out.url !== 'string') throw bankDown();
    db.prepare('INSERT INTO bank_states (state, user_id, bank, country) VALUES (?, ?, ?, ?)').run(state, req.user.id, b.name, b.country);
    res.json({ url: out.url });
  });

  const ACCOUNT = 'SELECT a.uid, a.name, a.iban, a.currency, a.pocket_id AS pocketId FROM bank_accounts a';
  r.get('/banks/connections', (req, res) => {
    const connections = all(`SELECT id, bank, country, valid_until AS validUntil,
      (SELECT CASE WHEN COUNT(*) = 0 OR COUNT(last_sync_at) < COUNT(*) THEN NULL ELSE MIN(last_sync_at) END
        FROM bank_accounts WHERE connection_id = bank_connections.id AND pocket_id IS NOT NULL) AS syncedAt FROM bank_connections WHERE user_id = ? ORDER BY id`, req.user.id)
      .map((c) => ({ ...c, accounts: all(`${ACCOUNT} WHERE a.connection_id = ? ORDER BY a.id`, c.id) }));
    res.json({ connections });
  });

  r.patch('/banks/accounts/:uid', (req, res) => {
    const uid = req.user.id;
    const { pocketId } = parse(z.object({ pocketId: z.number({ error: 'Choose a pocket.' }).int('Choose a pocket.').nullable() }), req.body);
    const acc = one(`${ACCOUNT} JOIN bank_connections c ON c.id = a.connection_id WHERE a.uid = ? AND c.user_id = ?`, req.params.uid, uid);
    if (!acc) throw notFound();
    if (pocketId !== null) {
      const p = one('SELECT currency FROM pockets WHERE id = ? AND user_id = ?', pocketId, uid);
      if (!p || p.currency !== acc.currency) throw fieldError('pocketId', `Choose a pocket in ${acc.currency}.`);
      if (one('SELECT 1 FROM bank_accounts WHERE pocket_id = ? AND uid != ?', pocketId, acc.uid))
        throw fieldError('pocketId', 'That pocket is already linked to another account.');
    }
    if (pocketId !== acc.pocketId)
      db.transaction(() => {
        if (acc.pocketId !== null) db.prepare('UPDATE pockets SET synced_balance_minor = NULL, synced_at = NULL WHERE id = ?').run(acc.pocketId);
        // A new link starts fresh: the next sync reads the last 90 days.
        db.prepare('UPDATE bank_accounts SET pocket_id = ?, last_sync_at = NULL WHERE uid = ? AND connection_id IN (SELECT id FROM bank_connections WHERE user_id = ?)').run(pocketId, acc.uid, uid);
      })();
    res.json({ account: { ...acc, pocketId } });
  });

  r.post('/banks/connections/:id/sync', async (req, res) => {
    const user = req.user, uid = user.id;
    const conn = connOf(uid, req.params.id as string);
    if (Date.parse(conn.validUntil) <= cfg.now()) throw new HttpError(409, 'expired', `Your connection to ${conn.bank} has ended.`);
    const accounts = all('SELECT uid, currency, pocket_id AS pocketId, last_sync_at AS lastSyncAt FROM bank_accounts WHERE connection_id = ? AND pocket_id IS NOT NULL', conn.id);
    const call = client(db, cfg, uid);
    const nowMs = cfg.now();
    // Everything is read from the bank before anything is saved.
    const fetched: { a: any; txs: any[]; bal: any }[] = [];
    for (const a of accounts) {
      const since = Math.max(nowMs - 90 * DAY, a.lastSyncAt ? Date.parse(a.lastSyncAt) - 7 * DAY : 0);
      const txs: any[] = [];
      let key: string | undefined;
      do {
        const q = new URLSearchParams({ date_from: day(since), transaction_status: 'BOOK', ...(key && { continuation_key: key }) });
        const page = await call('GET', `/accounts/${encodeURIComponent(a.uid)}/transactions?${q}`);
        txs.push(...(page.transactions ?? []));
        key = page.continuation_key || undefined;
      } while (key);
      const bal: any[] = (await call('GET', `/accounts/${encodeURIComponent(a.uid)}/balances`)).balances ?? [];
      fetched.push({ a, txs, bal: ['CLBD', 'ITBD', 'XPCD', 'ITAV'].map((k) => bal.find((x) => x.balance_type === k)).find(Boolean) });
    }

    const rules = deps.rulesOf(uid);
    const stamp = new Date(nowMs).toISOString();
    const out = { added: 0, duplicates: 0, unsorted: 0 };
    db.transaction(() => {
      for (const { a, txs, bal } of fetched) {
        const exp = exponentOf(a.currency);
        for (const t of txs) {
          if (t.status && t.status !== 'BOOK') continue;
          const date = String(t.booking_date ?? t.value_date ?? t.transaction_date ?? '');
          const amount = Math.abs(toMinor(t.transaction_amount?.amount, exp) ?? 0);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !amount || deps.isClosed(uid, date.slice(0, 7))) continue;
          const kind = t.credit_debit_indicator === 'DBIT' ? 'expense' : 'income';
          const lines = ((t.remittance_information ?? []) as unknown[]).map((x) => String(x).trim()).filter(Boolean);
          const payee = String((kind === 'expense' ? t.creditor?.name : t.debtor?.name) || lines[0] || 'Bank transaction').trim().slice(0, 120);
          const ref = String(t.entry_reference ?? t.transaction_id ?? `${date}|${kind}|${amount}|${payee}`);
          if (one('SELECT 1 FROM transactions WHERE pocket_id = ? AND bank_ref = ?', a.pocketId, ref)) { out.duplicates++; continue; }
          const rule = deps.ruleFor(rules, kind, payee);
          db.prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, subsection_id, source_id, payee, note, source, bank_ref)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bank', ?)`)
            .run(uid, date, kind, amount, deps.baseOf(user, { amountMinor: amount, currency: a.currency, date }), a.pocketId,
              kind === 'expense' ? rule?.subsectionId ?? null : null, kind === 'income' ? rule?.sourceId ?? null : null, payee, lines.join(' ').slice(0, 500), ref);
          out.added++;
          if (!rule) out.unsorted++;
        }
        const balance = toMinor(bal?.balance_amount?.amount, exp);
        if (balance !== null) db.prepare('UPDATE pockets SET synced_balance_minor = ?, synced_at = ? WHERE id = ?').run(balance, stamp, a.pocketId);
        db.prepare('UPDATE bank_accounts SET last_sync_at = ? WHERE uid = ? AND connection_id = ?').run(stamp, a.uid, conn.id);
      }
    })();
    res.json(out);
  });

  r.delete('/banks/connections/:id', (req, res) => {
    const conn = connOf(req.user.id, req.params.id as string);
    db.transaction(() => {
      db.prepare('UPDATE pockets SET synced_balance_minor = NULL, synced_at = NULL WHERE id IN (SELECT pocket_id FROM bank_accounts WHERE connection_id = ?)').run(conn.id);
      db.prepare('DELETE FROM bank_connections WHERE id = ?').run(conn.id); // its accounts go with it
    })();
    res.status(204).end();
  });

  return r;
}
