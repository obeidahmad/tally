import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const FIXTURE = path.join(__dirname, '..', 'test', 'rates.xml'); // 1 EUR = 1.0860 USD and 0.8650 GBP on 2026-10-13
const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14, local
const PW = 'correct horse battery';
const KEY = 'sk-live-abcdef123456';

// A fake Trading212. Each test sets what it answers; `status` forces a failing status per path.
let fake: http.Server, fakeUrl: string;
let seen: { path: string; auth: string | undefined }[];
let info: any, cash: any, portfolio: any[], instruments: any[], dividendPages: any[][], status: Record<string, number>, goodAuth: string[];
let nextOverride: string | null, onPortfolio: (() => Promise<void>) | null;
beforeAll(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    seen.push({ path: u.pathname, auth: req.headers.authorization });
    const send = (code: number, o: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (!goodAuth.includes(req.headers.authorization ?? '')) return send(401, {});
    const forced = status[u.pathname];
    if (forced) return send(forced, {});
    if (u.pathname === '/api/v0/equity/account/info') return send(200, info);
    if (u.pathname === '/api/v0/equity/account/cash') return send(200, cash);
    if (u.pathname === '/api/v0/equity/portfolio') { await onPortfolio?.(); return send(200, portfolio); }
    if (u.pathname === '/api/v0/equity/metadata/instruments') return send(200, instruments);
    if (u.pathname === '/api/v0/history/dividends') {
      const i = Number(u.searchParams.get('cursor') ?? 0);
      return send(200, { items: dividendPages[i] ?? [], nextPagePath: nextOverride ?? (dividendPages[i + 1] ? `/api/v0/history/dividends?cursor=${i + 1}` : null) });
    }
    send(404, {});
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as any).port}/api/v0`;
});
afterAll(() => { fake.close(); });

let dir: string, db: Db, app: ReturnType<typeof createApp>, clock: number, slept: number[];
type Agent = ReturnType<typeof request.agent>;
beforeEach(() => {
  process.env.TALLY_SECRET = 'cd'.repeat(32);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-t212-'));
  db = openDb(path.join(dir, 'tally.db'));
  clock = T0;
  slept = [];
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: FIXTURE, t212Url: fakeUrl, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  seen = [];
  goodAuth = [KEY];
  status = {};
  nextOverride = null;
  onPortfolio = null;
  info = { id: 1, currencyCode: 'EUR' };
  cash = { free: 123.45, total: 999 };
  portfolio = [
    { ticker: 'AAPL_US_EQ', quantity: 2, currentPrice: 150, ppl: 20, fxPpl: -1 },
    { ticker: 'SAP_EQ', quantity: 1.5, currentPrice: 100.1, ppl: 5.5 },
    { ticker: 'VOD_L_EQ', quantity: 3, currentPrice: 1000, ppl: 0 },
  ];
  instruments = [
    { ticker: 'AAPL_US_EQ', name: 'Apple', currencyCode: 'USD' },
    { ticker: 'SAP_EQ', name: 'SAP', currencyCode: 'EUR' },
    { ticker: 'VOD_L_EQ', name: 'Vodafone', currencyCode: 'GBX' },
  ];
  dividendPages = [[]];
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
async function person() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username: 'owner', displayName: 'owner', password: PW, baseCurrency: 'EUR' }).expect(201);
  return a;
}
async function world(a: Agent) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const sub = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Invest', keep: 'none', budgetMinor: 0 })).subsection;
  const pocket = (await post(a, '/api/pockets', { name: 'T212', kind: 'broker', openingBalanceMinor: 0 })).pocket;
  const usd = (await post(a, '/api/pockets', { name: 'T212 USD', kind: 'broker', currency: 'USD', openingBalanceMinor: 0 })).pocket;
  const bank = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  return { sub, pocket, usd, bank };
}
const save = (a: Agent, w: { sub: any; pocket: any }, over: object = {}) =>
  json(a.put('/api/brokers/trading212')).send({ pocketId: w.pocket.id, subsectionId: w.sub.id, environment: 'live', apiKey: KEY, ...over });
const sync = (a: Agent) => json(a.post('/api/brokers/trading212/sync')).send({});
const holdings = async (a: Agent) => (await a.get('/api/holdings').expect(200)).body.holdings as any[];
const fields = async (r: request.Test) => { const x = await r.expect(400); return x.body.error.fields; };
const connect = async () => { const a = await person(); const w = await world(a); await save(a, w).expect(200); return { a, w }; };

describe('saving', () => {
  it('checks the key and the currency, never returns the key and stores it encrypted', async () => {
    const a = await person();
    const w = await world(a);
    expect((await a.get('/api/brokers/trading212').expect(200)).body).toEqual({ connection: null });
    const res = await save(a, w).expect(200);
    expect(res.body).toEqual({ connection: { pocketId: w.pocket.id, environment: 'live', subsectionId: w.sub.id, keyEnd: '3456', syncedAt: null, error: null } });
    expect(JSON.stringify((await a.get('/api/brokers/trading212').expect(200)).body)).not.toContain(KEY);
    expect(seen.at(-1)).toEqual({ path: '/api/v0/equity/account/info', auth: KEY });
    const row = db.prepare('SELECT * FROM broker_connections').get() as any;
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(row.secret_enc).toBeNull();

    goodAuth = [`Basic ${Buffer.from(`${KEY}:shh`).toString('base64')}`];
    await save(a, w, { apiSecret: 'shh' }).expect(200);
    expect(seen.at(-1)!.auth).toBe(goodAuth[0]);
    expect(JSON.stringify(db.prepare('SELECT * FROM broker_connections').get())).not.toContain('shh');

    expect(await fields(save(a, w, { apiKey: 'refused-key-123' }))).toEqual({ apiKey: 'Trading212 refused this key.' });
    expect((await a.get('/api/brokers/trading212').expect(200)).body.connection.keyEnd).toBe('3456');
  });

  it('refuses bad input and a pocket in another currency', async () => {
    const a = await person();
    const w = await world(a);
    expect(await fields(save(a, w, { apiKey: 'short' }))).toEqual({ apiKey: 'Paste your Trading212 API key.' });
    expect(await fields(save(a, w, { apiKey: 'x'.repeat(201) }))).toEqual({ apiKey: 'Paste your Trading212 API key.' });
    expect(await fields(save(a, w, { pocketId: w.bank.id }))).toEqual({ pocketId: 'Choose a broker pocket.' });
    expect(await fields(save(a, w, { pocketId: 9999 }))).toEqual({ pocketId: 'Choose a broker pocket.' });
    expect(await fields(save(a, w, { subsectionId: 9999 }))).toEqual({ subsectionId: 'Choose a subsection.' });
    expect(await fields(save(a, w, { pocketId: w.usd.id }))).toEqual({ pocketId: 'This Trading212 account is in EUR. Choose a pocket in EUR.' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM broker_connections').get()).toEqual({ n: 0 });
    status['/api/v0/equity/account/info'] = 500;
    await save(a, w).expect(502);
  });

  it('keeps the pocket currency while linked', async () => {
    const { a, w } = await connect();
    expect(await fields(json(a.patch(`/api/pockets/${w.pocket.id}`)).send({ currency: 'USD' }))).toEqual({ currency: 'A pocket linked to Trading212 keeps its currency.' });
  });
});

describe('sync', () => {
  it('creates, updates and sells holdings with paid and worth in two currencies', async () => {
    const { a, w } = await connect();
    expect((await sync(a).expect(200)).body).toEqual({ holdings: 3, dividends: 0 });
    const hs = await holdings(a);
    const by = (n: string) => hs.find((h) => h.name === n);
    // 2 x 150.00 USD = 30000 -> 27624 EUR at 1.0860; paid = 27624 - 2000 + 100
    expect(by('Apple')).toMatchObject({ source: 'trading212', worthMinor: 30000, worthCurrency: 'USD', paidMinor: 25724, subsectionId: w.sub.id, pocketId: w.pocket.id, soldDate: null, worthDate: '2026-10-14' });
    expect(by('SAP')).toMatchObject({ worthMinor: 15015, worthCurrency: 'EUR', paidMinor: 14465 });
    // pence: 3 x 1000p = 30.00 GBP -> 3468 EUR at 0.8650
    expect(by('Vodafone')).toMatchObject({ worthMinor: 3000, worthCurrency: 'GBP', paidMinor: 3468 });
    const p = (await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id);
    expect(p).toMatchObject({ syncedBalanceMinor: 12345, syncedAt: new Date(T0).toISOString() });
    expect((await a.get('/api/brokers/trading212').expect(200)).body.connection).toMatchObject({ syncedAt: new Date(T0).toISOString(), error: null });

    // The person renames one and moves it; a later sync keeps that, updates the figures and sells what vanished.
    const sub2 = (await post(a, `/api/sections/${(db.prepare('SELECT section_id AS s FROM subsections').get() as any).s}/subsections`, { name: 'Other', keep: 'none', budgetMinor: 0 })).subsection;
    await json(a.patch(`/api/holdings/${by('Apple').id}`)).send({ name: 'My Apple', subsectionId: sub2.id }).expect(200);
    portfolio = [{ ticker: 'AAPL_US_EQ', quantity: 2, currentPrice: 160, ppl: 30, fxPpl: 0 }];
    cash = { free: 500 };
    const txBefore = (db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n;
    expect((await sync(a).expect(200)).body).toEqual({ holdings: 1, dividends: 0 });
    const after = await holdings(a);
    expect(after).toHaveLength(3);
    expect(after.find((h) => h.id === by('Apple').id)).toMatchObject({ name: 'My Apple', subsectionId: sub2.id, worthMinor: 32000, paidMinor: 29466 - 3000 });
    expect(after.find((h) => h.name === 'SAP')).toMatchObject({ soldDate: '2026-10-14' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n).toBe(txBefore);
    expect(seen.filter((x) => x.path.endsWith('/instruments'))).toHaveLength(1); // once a day
    expect((await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id).syncedBalanceMinor).toBe(50000);

    // Bought again later: a new holding.
    portfolio.push({ ticker: 'SAP_EQ', quantity: 1, currentPrice: 90, ppl: 0 });
    await sync(a).expect(200);
    expect((await holdings(a)).filter((h) => h.name === 'SAP')).toHaveLength(2);
  });

  it('records each dividend once, in its own source, skipping closed months', async () => {
    const { a, w } = await connect();
    dividendPages = [
      [{ reference: 'd1', ticker: 'AAPL_US_EQ', amount: 1.5, paidOn: '2026-10-01T00:00:00Z' }, { reference: 'd2', ticker: 'SAP_EQ', amount: 3, paidOn: '2026-09-20T00:00:00Z' }],
      [{ reference: 'd3', ticker: 'SAP_EQ', amount: 2, paidOn: '2026-08-10T00:00:00Z' }, { reference: 'd0', ticker: 'X', amount: 9, paidOn: '2025-01-01T00:00:00Z' }],
    ];
    db.prepare("INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (1, '2026-08', '{}', '{}')").run();
    expect((await sync(a).expect(200)).body).toEqual({ holdings: 3, dividends: 2 });
    const rows = db.prepare('SELECT t.date, t.amount_minor AS amountMinor, t.payee, t.source, t.kind, t.pocket_id AS pocketId, s.name AS src FROM transactions t JOIN sources s ON s.id = t.source_id ORDER BY t.date').all();
    expect(rows).toEqual([
      { date: '2026-09-20', amountMinor: 300, payee: 'SAP_EQ', source: 'broker', kind: 'income', pocketId: w.pocket.id, src: 'Trading212 dividends' },
      { date: '2026-10-01', amountMinor: 150, payee: 'AAPL_US_EQ', source: 'broker', kind: 'income', pocketId: w.pocket.id, src: 'Trading212 dividends' },
    ]);
    expect(await sync(a).then((r) => r.body)).toEqual({ holdings: 3, dividends: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sources WHERE name = 'Trading212 dividends'").get()).toEqual({ n: 1 });
  });

  it('waits for the limits instead of failing', async () => {
    const { a } = await connect();
    await sync(a).expect(200);
    expect(slept).toEqual([]);
    await sync(a).expect(200);
    expect(slept).toEqual([2000, 3000]); // cash 1 per 2 s, then portfolio 1 per 5 s

    slept.length = 0;
    clock += 600000;
    dividendPages = Array.from({ length: 8 }, (_, i) => [{ reference: `r${i}`, ticker: 'T', amount: 1, paidOn: '2026-10-10T00:00:00Z' }]);
    const r = await sync(a).expect(200);
    expect(r.body.dividends).toBe(8);
    expect(slept.filter((x) => x > 5000)).toEqual([60000]); // the 7th page waits for the minute window
    expect(slept.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(60000);
  });

  it('keeps everything and stores the error when Trading212 fails, then recovers', async () => {
    const { a, w } = await connect();
    await sync(a).expect(200);
    const before = JSON.stringify(await holdings(a));
    const pocket = (await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id);
    portfolio = [];
    cash = { free: 1 };
    const err = async () => (await a.get('/api/brokers/trading212').expect(200)).body.connection.error;
    for (const [code, msg] of [[401, 'Trading212 refused the key.'], [500, 'Trading212 is not answering. Tally will try again.'], [429, 'Trading212 asked Tally to slow down. Tally will try again.']] as const) {
      status['/api/v0/equity/portfolio'] = code;
      const res = await sync(a).expect(502);
      expect(res.body.error.message).toBe(msg);
      expect(await err()).toBe(msg);
      expect(JSON.stringify(await holdings(a))).toBe(before);
      expect((await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id).syncedBalanceMinor).toBe(pocket.syncedBalanceMinor);
    }
    status = {};
    await sync(a).expect(200);
    expect(await err()).toBeNull();
    expect((await holdings(a)).every((h) => h.soldDate)).toBe(true);
  });

  it('starts by itself when the Pockets page loads and the last sync is over an hour old', async () => {
    const { a } = await connect();
    await a.get('/api/pockets').expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.some((x) => x.path.endsWith('/portfolio'))).toBe(true);
    expect(await holdings(a)).toHaveLength(3);
    const n = seen.length;
    await a.get('/api/pockets').expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.length).toBe(n); // fresh
  });

  it('needs a connection', async () => {
    const a = await person();
    await sync(a).expect(409);
  });
});

describe('broker holdings by hand', () => {
  it('cannot change figures, sell or delete; name and subsection are free; disconnecting frees them', async () => {
    const { a, w } = await connect();
    await sync(a).expect(200);
    const h = (await holdings(a)).find((x) => x.name === 'SAP');
    const msg = "This holding's figures come from Trading212.";
    for (const f of [{ paidMinor: 1 }, { worthMinor: 1 }, { worthCurrency: 'USD' }]) expect(await fields(json(a.patch(`/api/holdings/${h.id}`)).send(f))).toEqual({ [Object.keys(f)[0]!]: msg });
    await json(a.patch(`/api/holdings/${h.id}`)).send({ name: 'Renamed', paidMinor: h.paidMinor }).expect(200);
    const sell = await json(a.post(`/api/holdings/${h.id}/sell`)).send({ date: '2026-10-14', receivedMinor: 1 }).expect(409);
    expect(sell.body.error).toMatchObject({ code: 'broker', message: msg });
    expect((await json(a.delete(`/api/holdings/${h.id}`)).expect(409)).body.error.code).toBe('broker');

    await json(a.delete('/api/brokers/trading212')).expect(204);
    expect((await a.get('/api/brokers/trading212').expect(200)).body).toEqual({ connection: null });
    const after = await holdings(a);
    expect(after).toHaveLength(3);
    expect(after.every((x) => x.source === 'manual')).toBe(true);
    await json(a.patch(`/api/holdings/${h.id}`)).send({ paidMinor: 5 }).expect(200);
    const p = (await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id);
    expect(p.syncedBalanceMinor).toBeNull();
  });
});

describe('isolation', () => {
  it('keeps each person to their own connection and pockets', async () => {
    const { a, w } = await connect();
    await sync(a).expect(200);
    await json(a.post('/api/users')).send({ username: 'second', displayName: 'p', password: PW, baseCurrency: 'EUR' }).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'second', password: PW }).expect(200);
    expect((await b.get('/api/brokers/trading212').expect(200)).body).toEqual({ connection: null });
    await sync(b).expect(409);
    expect(await holdings(b)).toEqual([]);
    const wb = await world(b);
    expect(await fields(save(b, { sub: w.sub, pocket: wb.pocket }))).toEqual({ subsectionId: 'Choose a subsection.' });
    expect(await fields(save(b, { sub: wb.sub, pocket: w.pocket }))).toEqual({ pocketId: 'Choose a broker pocket.' });
    await json(b.delete('/api/brokers/trading212')).expect(204);
    expect((await a.get('/api/brokers/trading212').expect(200)).body.connection).not.toBeNull();
    expect(await holdings(a)).toHaveLength(3);
  });
});

describe('value of a synced pocket', () => {
  it('uses the synced cash plus held worth, and keeps balanceMinor as Tally computes it', async () => {
    const { a, w } = await connect();
    const pockets = async () => (await a.get('/api/pockets').expect(200)).body.pockets;
    await json(a.patch(`/api/pockets/${w.bank.id}`)).send({ openingBalanceMinor: 1000 }).expect(200);
    // A bank-linked pocket is just a pocket with a synced balance (spec 17 sets it the same way).
    db.prepare("UPDATE pockets SET synced_balance_minor = 25075, synced_at = ? WHERE id = ?").run(new Date(T0).toISOString(), w.bank.id);
    let bank = (await pockets()).find((p: any) => p.id === w.bank.id);
    expect(bank).toMatchObject({ balanceMinor: 1000, syncedBalanceMinor: 25075, valueMinor: 25075, baseValueMinor: 25075 });

    await sync(a).expect(200); // cash 12345; worth 30000 USD (27624 EUR) + 15015 + 3000 GBP (3468 EUR)
    const t = (await pockets()).find((p: any) => p.id === w.pocket.id);
    expect(t.valueMinor).toBe(12345 + 27624 + 15015 + 3468);
    expect(t.balanceMinor).toBe(-(25724 + 14465 + 3468)); // Tally's own figure: nothing counted but what was paid
    expect((await a.get('/api/networth').expect(200)).body.byCurrency[0].amountMinor).toBe(25075 + t.valueMinor);
  });
});

describe('safety', () => {
  it('never follows a next page to another host', async () => {
    const { a } = await connect();
    dividendPages = [[{ reference: 'd1', ticker: 'T', amount: 1, paidOn: '2026-10-10T00:00:00Z' }]];
    for (const p of ['//evil.com/x', 'http://evil.com/x']) {
      nextOverride = p;
      const res = await sync(a).expect(502);
      expect(res.body.error.message).toBe('Trading212 is not answering. Tally will try again.');
    }
    // These stay on this host as plain relative paths, so they reach the fake (404) and fail the same way.
    for (const p of ['@evil.com/x', '.evil.com']) {
      nextOverride = p;
      seen = [];
      await sync(a).expect(502);
      expect(seen.every((x) => x.auth === KEY)).toBe(true);
    }
    expect(await holdings(a)).toEqual([]);
  });

  it('writes nothing when the connection is removed while a sync waits for Trading212', async () => {
    const { a, w } = await connect();
    onPortfolio = async () => { onPortfolio = null; await json(a.delete('/api/brokers/trading212')).expect(204); };
    await sync(a).expect(409);
    expect(await holdings(a)).toEqual([]);
    expect((await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === w.pocket.id).syncedBalanceMinor).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM transactions').get()).toEqual({ n: 0 });
  });
});
