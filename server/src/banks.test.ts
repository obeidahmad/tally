import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';
import { decrypt, encrypt } from './secrets';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const APP_ID = '3f2a9c1e-7b64-4d0a-9e55-1c2d3e4f5a6b';
const PW = 'correct horse battery';
const NOW = Date.now();
const day = (back: number) => new Date(NOW - back * 86400000).toISOString().slice(0, 10);

// A small fake Enable Banking. Each test sets `tx` (pages of transactions) and `balances`.
let fake: http.Server, fakeUrl: string;
let calls: { path: string; jwtError: string | null; body: any }[];
let pages: Record<string, any[]>, balances: any[], sessionValidUntil: string, accounts: any[], lastAuth: any;
function jwtError(auth: string | undefined): string | null {
  const [h, c, sig] = (auth ?? '').replace('Bearer ', '').split('.');
  if (!sig) return 'no jwt';
  const head = JSON.parse(Buffer.from(h!, 'base64url').toString()), claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url'))) return 'bad signature';
  if (head.typ !== 'JWT' || head.alg !== 'RS256' || head.kid !== APP_ID) return 'bad header';
  if (claims.iss !== 'enablebanking.com' || claims.aud !== 'api.enablebanking.com' || claims.exp !== claims.iat + 3600) return 'bad claims';
  return null;
}
beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ path: req.url!, jwtError: jwtError(req.headers.authorization), body });
      const send = (o: object) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      if (u.pathname === '/aspsps') return send({ aspsps: [{ name: 'Revolut', country: u.searchParams.get('country'), extra: 1 }] });
      if (u.pathname === '/auth') { lastAuth = body; return send({ url: `${fakeUrl}/bank?state=${body.state}` }); }
      if (u.pathname === '/sessions') {
        if (body.code !== 'good') { res.statusCode = 400; return send({}); }
        return send({ session_id: 's1', accounts, access: { valid_until: sessionValidUntil } });
      }
      if (u.pathname.endsWith('/balances')) return send({ balances });
      if (u.pathname.endsWith('/transactions')) {
        const key = u.searchParams.get('continuation_key') ?? '0';
        const list = pages[key] ?? [];
        return send({ transactions: list, continuation_key: key === '0' && pages['1'] ? '1' : undefined });
      }
      res.statusCode = 404; send({});
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as any).port}`;
});
afterAll(() => { fake.close(); });

let dir: string, db: Db, app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;
const json = (r: request.Test) => r.set('Content-Type', 'application/json');
beforeEach(() => {
  process.env.TALLY_SECRET = 'ab'.repeat(32);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-bank-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), bankUrl: fakeUrl, publicUrl: 'https://tally.example', now: () => NOW });
  calls = [];
  pages = {}; balances = [{ balance_type: 'CLBD', balance_amount: { currency: 'EUR', amount: '250.75' } }];
  sessionValidUntil = new Date(NOW + 180 * 86400000).toISOString();
  accounts = [{ uid: 'acc1', account_id: { iban: 'CY1' }, currency: 'EUR', name: 'Main' }, { uid: 'acc2', account_id: { iban: 'CY2' }, currency: 'USD', name: 'Dollars' }];
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function person(name = 'owner', a?: ReturnType<typeof createApp>) {
  const ag = request.agent(a ?? app);
  await json(ag.post(name === 'owner' ? '/api/auth/setup' : '/api/auth/login')).send(
    name === 'owner' ? { username: name, displayName: name, password: PW, baseCurrency: 'EUR' } : { username: name, password: PW }).expect(name === 'owner' ? 201 : 200);
  return ag;
}
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const register = (a: Agent) => json(a.put('/api/banks/registration')).send({ applicationId: APP_ID, privateKey: PEM });
async function connect(a: Agent, code = 'good') {
  const { url } = (await json(a.post('/api/banks/connect')).send({ name: 'Revolut', country: 'CY' }).expect(200)).body;
  const state = new URL(url).searchParams.get('state');
  return { state, res: await request(app).get(`/api/banks/callback?code=${code}&state=${state}`) };
}
const conns = async (a: Agent) => (await a.get('/api/banks/connections').expect(200)).body.connections;
const sync = (a: Agent, id: number) => json(a.post(`/api/banks/connections/${id}/sync`)).send({});
const tx = (ref: string, over: object = {}) => ({
  entry_reference: ref, status: 'BOOK', booking_date: day(2), transaction_amount: { currency: 'EUR', amount: '12.50' },
  credit_debit_indicator: 'DBIT', creditor: { name: 'LIDL Berlin' }, remittance_information: ['card payment'], ...over,
});

describe('secrets', () => {
  it('round-trips, and a created key file is reused', () => {
    expect(decrypt(encrypt('hello'))).toBe('hello');
    expect(encrypt('hello')).not.toBe(encrypt('hello'));
    delete process.env.TALLY_SECRET;
    process.env.TALLY_DATA_DIR = dir;
    try {
      const blob = encrypt('x');
      expect(fs.existsSync(path.join(dir, 'secret.key'))).toBe(true);
      expect(decrypt(blob)).toBe('x');
    } finally { delete process.env.TALLY_DATA_DIR; }
  });
});

describe('tampering', () => {
  it('fails to decrypt a changed ciphertext or tag', () => {
    const b = Buffer.from(encrypt('secret'), 'base64');
    for (const i of [12, 28]) {
      const x = Buffer.from(b);
      x[i]! ^= 1;
      expect(() => decrypt(x.toString('base64'))).toThrow();
    }
  });
});

describe('registration', () => {
  it('saves, is stored encrypted and never returned', async () => {
    const a = await person();
    expect((await a.get('/api/banks/registration').expect(200)).body).toEqual({ configured: false, publicUrl: 'https://tally.example' });
    await register(a).expect(204);
    const got = (await a.get('/api/banks/registration').expect(200)).body;
    expect(got).toEqual({ applicationId: APP_ID, configured: true, publicUrl: 'https://tally.example' });
    expect(JSON.stringify(got)).not.toContain('PRIVATE');
    const stored = (db.prepare('SELECT private_key_enc AS k FROM bank_registrations').get() as any).k;
    expect(stored).not.toContain('PRIVATE');
    expect(decrypt(stored)).toBe(PEM);
  });
  it('checks the application ID and the key', async () => {
    const a = await person();
    const bad = async (body: object, field: string, msg: string) => expect((await json(a.put('/api/banks/registration')).send(body).expect(400)).body.error.fields[field]).toBe(msg);
    await bad({ applicationId: 'nope', privateKey: PEM }, 'applicationId', 'Enter the application ID from Enable Banking.');
    await bad({ applicationId: APP_ID, privateKey: 'not a key' }, 'privateKey', "Paste the private key file's contents.");
    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    await bad({ applicationId: APP_ID, privateKey: ec }, 'privateKey', "Paste the private key file's contents.");
  });
  it('reports no public URL as null', async () => {
    const a2 = createApp({ db, webDist: path.join(dir, 'no-dist'), bankUrl: fakeUrl, now: () => NOW });
    const a = await person('owner', a2);
    expect((await a.get('/api/banks/registration').expect(200)).body).toEqual({ configured: false, publicUrl: null });
    await json(a.post('/api/banks/connect')).send({ name: 'Revolut', country: 'CY' }).expect(409);
  });
});

describe('connect and callback', () => {
  it('lists banks and signs every request', async () => {
    const a = await person();
    await a.get('/api/banks?country=CY').expect(409); // no registration yet
    await register(a);
    expect((await a.get('/api/banks?country=CY').expect(200)).body).toEqual({ banks: [{ name: 'Revolut', country: 'CY' }] });
    await a.get('/api/banks?country=cyprus').expect(400);
    await connect(a);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map((c) => c.jwtError)).toEqual(calls.map(() => null));
  });
  it('asks for 180 days and a callback URL, then stores the session', async () => {
    const a = await person();
    await register(a);
    const { res } = await connect(a);
    expect(lastAuth).toMatchObject({ aspsp: { name: 'Revolut', country: 'CY' }, redirect_url: 'https://tally.example/api/banks/callback', psu_type: 'personal' });
    expect(lastAuth.access.valid_until).toBe(new Date(NOW + 180 * 86400000).toISOString());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings?bank=connected');
    expect(await conns(a)).toEqual([{
      id: expect.any(Number), bank: 'Revolut', country: 'CY', validUntil: sessionValidUntil, syncedAt: null,
      accounts: [{ uid: 'acc1', name: 'Main', iban: 'CY1', currency: 'EUR', pocketId: null }, { uid: 'acc2', name: 'Dollars', iban: 'CY2', currency: 'USD', pocketId: null }],
    }]);
  });
  it('refuses an unknown or reused state and changes nothing', async () => {
    const a = await person();
    await register(a);
    await request(app).get('/api/banks/callback?code=good&state=nope').expect(400);
    const { state } = await connect(a);
    await request(app).get(`/api/banks/callback?code=good&state=${state}`).expect(400);
    expect(await conns(a)).toHaveLength(1);
  });
  it('sends the person back with failed when the bank refuses the code', async () => {
    const a = await person();
    await register(a);
    const { res } = await connect(a, 'bad');
    expect(res.headers.location).toBe('/settings?bank=failed');
    expect(await conns(a)).toEqual([]);
  });
});

// A person with a connection, a EUR pocket linked to acc1, a Food subsection with a rule.
async function linked() {
  const a = await person();
  await register(a);
  await connect(a);
  const pocket = (await post(a, '/api/pockets', { name: 'Revolut', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  await json(a.patch('/api/banks/accounts/acc1')).send({ pocketId: pocket.id }).expect(200);
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const food = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 50000 })).subsection;
  await post(a, '/api/rules', { match: 'lidl', subsectionId: food.id });
  const [c] = await conns(a);
  return { a, pocket, food, id: c.id as number };
}
const txs = async (a: Agent, q: string) => (await a.get(`/api/transactions?${q}`).expect(200)).body.transactions;
const month = day(2).slice(0, 7);

describe('accounts', () => {
  it('links only a pocket of the same currency, and can unlink', async () => {
    const { a, pocket } = await linked();
    const usd = (await post(a, '/api/pockets', { name: 'USD', kind: 'bank', openingBalanceMinor: 0, currency: 'USD' })).pocket;
    const err = await json(a.patch('/api/banks/accounts/acc1')).send({ pocketId: usd.id }).expect(400);
    expect(err.body.error.fields.pocketId).toBe('Choose a pocket in EUR.');
    await json(a.patch('/api/banks/accounts/acc2')).send({ pocketId: pocket.id }).expect(400); // wrong currency again
    await json(a.patch('/api/banks/accounts/acc1')).send({ pocketId: null }).expect(200);
    expect((await conns(a))[0].accounts[0].pocketId).toBeNull();
  });
});

describe('syncedAt and currency lock', () => {
  it('is the oldest sync of the linked accounts, null while one never synced', async () => {
    const { a, id } = await linked();
    const usd = (await post(a, '/api/pockets', { name: 'USD', kind: 'bank', openingBalanceMinor: 0, currency: 'USD' })).pocket;
    await json(a.patch('/api/banks/accounts/acc2')).send({ pocketId: usd.id }).expect(200);
    await sync(a, id).expect(200);
    expect((await conns(a))[0].syncedAt).toBe(new Date(NOW).toISOString());
    db.prepare("UPDATE bank_accounts SET last_sync_at = ? WHERE uid = 'acc1'").run(new Date(NOW - 5000).toISOString());
    expect((await conns(a))[0].syncedAt).toBe(new Date(NOW - 5000).toISOString());
    db.prepare("UPDATE bank_accounts SET last_sync_at = NULL WHERE uid = 'acc2'").run();
    expect((await conns(a))[0].syncedAt).toBeNull();
  });
  it('keeps the currency of a linked pocket', async () => {
    const { a, pocket } = await linked();
    const r = await json(a.patch(`/api/pockets/${pocket.id}`)).send({ currency: 'USD' }).expect(400);
    expect(r.body.error.fields.currency).toBe('A pocket linked to a bank account keeps its currency.');
  });
});

describe('sync', () => {
  it('imports with rules, follows continuation, skips duplicates and closed months, stores the balance', async () => {
    const { a, pocket, food, id } = await linked();
    pages['0'] = [tx('r1'), tx('r2', { creditor: { name: 'Mystery' }, transaction_amount: { currency: 'EUR', amount: '3.00' } }), tx('p', { status: 'PDNG' })];
    pages['1'] = [tx('r3', { credit_debit_indicator: 'CRDT', debtor: { name: 'Employer' }, transaction_amount: { currency: 'EUR', amount: '1500.00' } }),
      tx('r4', { creditor: undefined, remittance_information: ['Rent line one', 'two'], transaction_amount: { currency: 'EUR', amount: '1.05' } })];
    const first = (await sync(a, id).expect(200)).body;
    expect(first).toEqual({ added: 4, duplicates: 0, unsorted: 3 });
    expect(calls.filter((c) => c.path.includes('/transactions')).map((c) => c.path.includes('continuation_key'))).toEqual([false, true]);
    expect(calls.map((c) => c.jwtError).every((e) => e === null)).toBe(true);
    expect(calls.find((c) => c.path.includes('/transactions'))!.path).toContain('transaction_status=BOOK');
    const list = await txs(a, `month=${month}`);
    const lidl = list.find((t: any) => t.payee === 'LIDL Berlin');
    expect(lidl).toMatchObject({ kind: 'expense', amountMinor: 1250, pocketId: pocket.id, subsectionId: food.id, source: 'bank' });
    expect(list.find((t: any) => t.payee === 'Employer')).toMatchObject({ kind: 'income', amountMinor: 150000, sourceId: null });
    expect(list.find((t: any) => t.payee === 'Rent line one')).toMatchObject({ kind: 'expense', amountMinor: 105 });
    expect(list).toHaveLength(4);
    const p = (await a.get('/api/pockets').expect(200)).body.pockets.find((x: any) => x.id === pocket.id);
    expect(p).toMatchObject({ syncedBalanceMinor: 25075, syncedAt: new Date(NOW).toISOString() });
    expect((await conns(a))[0].syncedAt).toBe(new Date(NOW).toISOString());
    // The window: first sync reads 90 days; the second, 7 days before the last sync (= 7 days ago).
    expect(decodeURIComponent(calls.find((c) => c.path.includes('/transactions'))!.path)).toContain(`date_from=${day(90)}`);
    calls.length = 0;
    expect((await sync(a, id).expect(200)).body).toEqual({ added: 0, duplicates: 4, unsorted: 0 });
    expect(decodeURIComponent(calls.find((c) => c.path.includes('/transactions'))!.path)).toContain(`date_from=${day(7)}`);
    // Closed months are skipped.
    await db.prepare('INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (1, ?, ?, ?)').run(month, '{}', '{}');
    pages = { '0': [tx('r9')] };
    expect((await sync(a, id).expect(200)).body).toEqual({ added: 0, duplicates: 0, unsorted: 0 });
  });
  it('shows a negative balance and unlinking or disconnecting clears the pocket', async () => {
    const { a, pocket, id } = await linked();
    balances = [{ balance_type: 'ITAV', balance_amount: { currency: 'EUR', amount: '9.99' } }, { balance_type: 'ITBD', balance_amount: { currency: 'EUR', amount: '-5.20' } }];
    await sync(a, id).expect(200);
    const sb = async () => (await a.get('/api/pockets')).body.pockets.find((x: any) => x.id === pocket.id).syncedBalanceMinor;
    expect(await sb()).toBe(-520);
    pages['0'] = [tx('k1')];
    await sync(a, id).expect(200);
    await a.delete(`/api/banks/connections/${id}`).set('Content-Type', 'application/json').expect(204);
    expect(await sb()).toBeNull();
    expect(await conns(a)).toEqual([]);
    expect(await txs(a, `month=${month}`)).toHaveLength(1); // imported transactions stay
  });
  it('refuses an ended connection', async () => {
    const { a, id } = await linked();
    db.prepare('UPDATE bank_connections SET valid_until = ?').run(new Date(NOW - 1000).toISOString());
    expect((await sync(a, id).expect(409)).body.error.message).toBe('Your connection to Revolut has ended.');
  });
  it('reconnecting keeps the pocket links and the id', async () => {
    const { a, pocket, id } = await linked();
    sessionValidUntil = new Date(NOW + 200 * 86400000).toISOString();
    accounts[0].uid = 'new-acc1';
    await connect(a);
    const cs = await conns(a);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ id, validUntil: sessionValidUntil });
    expect(cs[0].accounts[0]).toMatchObject({ uid: 'new-acc1', pocketId: pocket.id });
  });
});

describe('isolation', () => {
  it('keeps one person\'s connections and accounts from another', async () => {
    const { a, id } = await linked();
    await json(a.post('/api/users')).send({ username: 'second', displayName: 'S', password: PW, baseCurrency: 'EUR' }).expect(201);
    const b = await person('second');
    expect((await b.get('/api/banks/registration').expect(200)).body.configured).toBe(false);
    expect(await conns(b)).toEqual([]);
    await sync(b, id).expect(404);
    await b.delete(`/api/banks/connections/${id}`).set('Content-Type', 'application/json').expect(404);
    await json(b.patch('/api/banks/accounts/acc1')).send({ pocketId: null }).expect(404);
    // A state made for one person cannot be used to connect for another.
    await register(b);
    const { state } = await connect(b);
    expect(state).toBeTruthy();
    expect(await conns(a)).toHaveLength(1);
    expect(await conns(b)).toHaveLength(1);
  });
});
