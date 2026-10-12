import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
const PW = 'correct horse battery';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-test-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist') });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const acct = (username: string) => ({ username, displayName: username, password: PW, baseCurrency: 'EUR' });

async function owner() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send(acct('owner')).expect(201);
  return a;
}
async function person(o: ReturnType<typeof request.agent>, username: string) {
  await json(o.post('/api/users')).send(acct(username)).expect(201);
  const a = request.agent(app);
  await json(a.post('/api/auth/login')).send({ username, password: PW }).expect(200);
  return a;
}
// A section with one subsection, and a pocket, for the given agent.
async function seed(a: ReturnType<typeof request.agent>) {
  const sec = (await json(a.post('/api/sections')).send({ name: 'Needs' })).body.section;
  const sub = (await json(a.post(`/api/sections/${sec.id}/subsections`)).send({ name: 'Food', budgetMinor: 30000 })).body.subsection;
  const pocket = (await json(a.post('/api/pockets')).send({ name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 })).body.pocket;
  return { sec, sub, pocket };
}
const tx = (pocketId: number, subsectionId: number | null, over: object = {}) => ({
  date: '2026-10-05', kind: subsectionId === null ? 'income' : 'expense', amountMinor: 1000, pocketId, subsectionId, payee: 'Shop', ...over,
});

describe('set-up and sessions', () => {
  it('reports needsSetup, sets up once, then returns the owner', async () => {
    expect((await request(app).get('/api/auth/state')).body).toEqual({ needsSetup: true, user: null });
    const a = await owner();
    const st = (await a.get('/api/auth/state')).body;
    expect(st.needsSetup).toBe(false);
    expect(st.user).toMatchObject({ username: 'owner', isOwner: true, baseCurrency: 'EUR' });
    const again = await json(request(app).post('/api/auth/setup')).send(acct('other'));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('signs in with a safe cookie, rejects bad passwords, and signs out', async () => {
    await owner();
    const bad = await json(request(app).post('/api/auth/login')).send({ username: 'owner', password: 'wrong wrong wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_credentials');
    const ghost = await json(request(app).post('/api/auth/login')).send({ username: 'ghost', password: 'wrong wrong wrong' });
    expect(ghost.body).toEqual(bad.body);

    const a = request.agent(app);
    const ok = await json(a.post('/api/auth/login')).send({ username: 'OWNER', password: PW });
    expect(ok.status).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/tally_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/);
    await a.get('/api/pockets').expect(200);
    await json(a.post('/api/auth/logout')).expect(204);
    const after = await a.get('/api/pockets');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('unauthenticated');
  });

  it('marks the cookie Secure when asked', async () => {
    const secure = createApp({ db, cookieSecure: true, webDist: path.join(dir, 'x') });
    const r = await json(request(secure).post('/api/auth/setup')).send(acct('owner'));
    expect(String(r.headers['set-cookie'])).toMatch(/Secure/);
  });

  it('stores no plain password or session token', async () => {
    const r = await json(request(app).post('/api/auth/setup')).send(acct('owner'));
    const token = /tally_session=([^;]+)/.exec(String(r.headers['set-cookie']))![1];
    const dump = JSON.stringify([db.prepare('SELECT * FROM users').all(), db.prepare('SELECT * FROM sessions').all()]);
    expect(dump).not.toContain(PW);
    expect(dump).not.toContain(token);
    const hash = (db.prepare('SELECT password_hash h FROM users').get() as { h: string }).h;
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]+$/);
  });

  it('rejects expired sessions and deletes them', async () => {
    const a = await owner();
    db.prepare('UPDATE sessions SET expires_at = 1').run();
    expect((await a.get('/api/pockets')).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) c FROM sessions').pluck().get()).toBe(0);
  });

  it('does not count successful sign-ins against the limit', async () => {
    await owner();
    for (let i = 0; i < 12; i++) await json(request(app).post('/api/auth/login')).send({ username: 'owner', password: PW }).expect(200);
    await json(request(app).post('/api/auth/login')).send({ username: 'owner', password: 'wrong wrong wrong' }).expect(401);
  });

  it('rate-limits sign-in after 10 failed attempts', async () => {
    await owner();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await json(request(app).post('/api/auth/login')).send({ username: 'owner', password: 'wrong wrong wrong' });
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it('protects every route but the four open ones', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    for (const [m, p] of [['get', '/api/users'], ['get', '/api/sections'], ['get', '/api/budget?month=2026-10'], ['post', '/api/me/password']] as const) {
      const r = await json(request(app)[m](p));
      expect(r.status).toBe(401);
    }
  });
});

describe('security headers', () => {
  it('leaves out upgrade-insecure-requests and sends HSTS only with cookieSecure', async () => {
    const plain = await request(app).get('/api/health');
    expect(plain.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(plain.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);
    expect(plain.headers['strict-transport-security']).toBeUndefined();
    const secure = createApp({ db, cookieSecure: true, webDist: path.join(dir, 'x') });
    const s = await request(secure).get('/api/health');
    expect(s.headers['strict-transport-security']).toMatch(/max-age/);
    expect(s.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);
  });
});

describe('content type', () => {
  it('rejects changing requests that are not JSON, and bad JSON', async () => {
    const a = await owner();
    const plain = await a.post('/api/pockets').set('Content-Type', 'text/plain').send('{"name":"x"}');
    expect(plain.status).toBe(400);
    expect(plain.body.error.code).toBe('validation');
    expect((await a.post('/api/pockets').send('name=x')).status).toBe(400);
    expect((await request(app).post('/api/auth/login').type('form').send({ username: 'a' })).status).toBe(400);
    const bad = await a.post('/api/pockets').set('Content-Type', 'application/json').send('{nope');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation');
  });
});

describe('people', () => {
  it('lets the owner add people, refuses others, and lets the new person sign in and change password', async () => {
    const o = await owner();
    const bob = await person(o, 'bob');
    expect((await bob.get('/api/users')).status).toBe(403);
    expect((await bob.get('/api/users')).body.error.code).toBe('forbidden');
    expect((await json(bob.post('/api/users')).send(acct('eve'))).status).toBe(403);
    expect((await o.get('/api/users')).body.users.map((u: any) => u.username)).toEqual(['owner', 'bob']);

    const dup = await json(o.post('/api/users')).send(acct('BOB'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.username).toBeTruthy();

    // second session for bob, to see it end
    const bob2 = request.agent(app);
    await json(bob2.post('/api/auth/login')).send({ username: 'bob', password: PW });
    const wrong = await json(bob.post('/api/me/password')).send({ currentPassword: 'nope nope nope', newPassword: 'a brand new password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.currentPassword).toBeTruthy();
    await json(bob.post('/api/me/password')).send({ currentPassword: PW, newPassword: 'a brand new password' }).expect(204);
    await bob.get('/api/pockets').expect(200);
    await bob2.get('/api/pockets').expect(401);
    await json(request(app).post('/api/auth/login')).send({ username: 'bob', password: PW }).expect(401);
    await json(request(app).post('/api/auth/login')).send({ username: 'bob', password: 'a brand new password' }).expect(200);
  });

  it('validates account fields', async () => {
    const r = await json(request(app).post('/api/auth/setup')).send({ username: 'A!', displayName: ' ', password: 'short', baseCurrency: 'XXX1' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields).sort()).toEqual(['baseCurrency', 'displayName', 'password', 'username']);
  });
});

describe('isolation between people', () => {
  it('answers 404 for another person\'s rows and leaks nothing into lists', async () => {
    const o = await owner();
    const bob = await person(o, 'bob');
    const mine = await seed(o);
    const t = (await json(o.post('/api/transactions')).send(tx(mine.pocket.id, mine.sub.id))).body.transaction;
    expect(t.id).toBeGreaterThan(0);

    const attempts: [string, string, object?][] = [
      ['patch', `/api/pockets/${mine.pocket.id}`, { name: 'hacked' }],
      ['delete', `/api/pockets/${mine.pocket.id}`],
      ['patch', `/api/sections/${mine.sec.id}`, { name: 'hacked' }],
      ['delete', `/api/sections/${mine.sec.id}`],
      ['post', `/api/sections/${mine.sec.id}/subsections`, { name: 'x', budgetMinor: 1 }],
      ['patch', `/api/subsections/${mine.sub.id}`, { name: 'hacked' }],
      ['delete', `/api/subsections/${mine.sub.id}`],
      ['patch', `/api/transactions/${t.id}`, { payee: 'hacked' }],
      ['delete', `/api/transactions/${t.id}`],
    ];
    for (const [m, p, body] of attempts) {
      const r = await json((bob as any)[m](p)).send(body ?? {});
      expect([m, p, r.status, r.body.error?.code]).toEqual([m, p, 404, 'not_found']);
    }

    for (const p of ['pockets', 'sections']) expect((await bob.get(`/api/${p}`)).body[p]).toEqual([]);
    expect((await bob.get('/api/transactions?month=2026-10')).body.transactions).toEqual([]);
    expect((await bob.get(`/api/transactions?month=2026-10&pocketId=${mine.pocket.id}`)).body.transactions).toEqual([]);
    const budget = (await bob.get('/api/budget?month=2026-10')).body;
    expect(budget.sections).toEqual([]);
    expect(budget.totals).toEqual({ incomeMinor: 0, budgetedMinor: 0, spentMinor: 0, availableMinor: 0 });

    // cannot attach own transaction to someone else's pocket or subsection
    const bobSeed = await seed(bob);
    const a = await json(bob.post('/api/transactions')).send(tx(mine.pocket.id, bobSeed.sub.id));
    expect(a.status).toBe(400);
    expect(a.body.error.fields.pocketId).toBeTruthy();
    const b = await json(bob.post('/api/transactions')).send(tx(bobSeed.pocket.id, mine.sub.id));
    expect(b.status).toBe(400);
    expect(b.body.error.fields.subsectionId).toBeTruthy();
    const bt = (await json(bob.post('/api/transactions')).send(tx(bobSeed.pocket.id, bobSeed.sub.id))).body.transaction;
    const c = await json(bob.patch(`/api/transactions/${bt.id}`)).send({ pocketId: mine.pocket.id });
    expect(c.body.error.fields.pocketId).toBeTruthy();

    // the owner's data is untouched
    expect((await o.get('/api/pockets')).body.pockets[0]).toMatchObject({ name: 'Bank', balanceMinor: 99000 });
    expect((await o.get('/api/sections')).body.sections[0].subsections[0].name).toBe('Food');
    expect((await o.get('/api/transactions?month=2026-10')).body.transactions).toHaveLength(1);
  });
});

describe('money', () => {
  it('computes pocket balance as opening plus income minus expenses', async () => {
    const o = await owner();
    const { sub, pocket } = await seed(o);
    await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { amountMinor: 4820 })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { amountMinor: 200000, payee: 'Job' })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { amountMinor: 1, date: '2026-09-30' })).expect(201);
    expect((await o.get('/api/pockets')).body.pockets[0]).toMatchObject({
      openingBalanceMinor: 100000, balanceMinor: 100000 + 200000 - 4820 - 1, currency: 'EUR',
    });
    const p = (await json(o.patch(`/api/pockets/${pocket.id}`)).send({ openingBalanceMinor: -500 })).body.pocket;
    expect(p.balanceMinor).toBe(-500 + 200000 - 4821);
  });

  it('budget counts only the requested month', async () => {
    const o = await owner();
    const { sec, sub, pocket } = await seed(o);
    for (const [date, amountMinor] of [['2026-10-01', 1000], ['2026-10-31', 2000], ['2026-09-30', 4000], ['2026-11-01', 8000]] as const)
      await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { date, amountMinor })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { date: '2026-10-15', amountMinor: 50000 })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { date: '2026-09-15', amountMinor: 70000 })).expect(201);

    const b = (await o.get('/api/budget?month=2026-10')).body;
    expect(b).toMatchObject({ month: '2026-10', currency: 'EUR' });
    expect(b.totals).toEqual({ incomeMinor: 50000, budgetedMinor: 30000, spentMinor: 3000, availableMinor: 27000 });
    expect(b.sections[0]).toMatchObject({ id: sec.id, colorSlot: 1, budgetedMinor: 30000, spentMinor: 3000, availableMinor: 27000 });
    expect(b.sections[0].subsections[0]).toEqual({ id: sub.id, name: 'Food', budgetMinor: 30000, spentMinor: 3000, availableMinor: 27000 });
    expect((await o.get('/api/budget?month=2026-12')).body.totals.spentMinor).toBe(0);
    expect((await o.get('/api/budget?month=2026-13')).status).toBe(400);
    expect((await o.get('/api/budget')).status).toBe(400);
    const list = (await o.get('/api/transactions?month=2026-10')).body.transactions;
    expect(list.map((x: any) => x.date)).toEqual(['2026-10-31', '2026-10-15', '2026-10-01']);
  });

  it('rejects bad transactions with 400 validation', async () => {
    const o = await owner();
    const { sub, pocket } = await seed(o);
    const bad: [string, object][] = [
      ['expense without subsection', tx(pocket.id, null, { kind: 'expense' })],
      ['income with subsection', tx(pocket.id, sub.id, { kind: 'income' })],
      ['zero', tx(pocket.id, sub.id, { amountMinor: 0 })],
      ['negative', tx(pocket.id, sub.id, { amountMinor: -5 })],
      ['fraction', tx(pocket.id, sub.id, { amountMinor: 10.5 })],
      ['string', tx(pocket.id, sub.id, { amountMinor: '1000' })],
      ['too big', tx(pocket.id, sub.id, { amountMinor: 10 ** 13 + 1 })],
      ['bad date', tx(pocket.id, sub.id, { date: '2026-02-30' })],
      ['month 13', tx(pocket.id, sub.id, { date: '2026-13-05' })],
      ['day 45', tx(pocket.id, sub.id, { date: '2026-13-45' })],
      ['month 00', tx(pocket.id, sub.id, { date: '2026-00-10' })],
      ['empty payee', tx(pocket.id, sub.id, { payee: '   ' })],
      ['unknown pocket', tx(9999, sub.id)],
    ];
    for (const [label, body] of bad) {
      const r = await json(o.post('/api/transactions')).send(body);
      expect([label, r.status, r.body.error.code]).toEqual([label, 400, 'validation']);
    }
    expect((await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { amountMinor: 10 ** 13 }))).status).toBe(201);
    const t = (await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id))).body.transaction;
    expect(t.note).toBe('');
    for (const date of ['2026-13-45', '2026-00-10', '2026-02-30', '2026-10-45']) {
      const r = await json(o.patch(`/api/transactions/${t.id}`)).send({ date });
      expect([date, r.status, !!r.body.error.fields.date]).toEqual([date, 400, true]);
    }
    const sw = await json(o.patch(`/api/transactions/${t.id}`)).send({ kind: 'income' });
    expect(sw.body.error.fields.subsectionId).toBeTruthy();
    const ok = await json(o.patch(`/api/transactions/${t.id}`)).send({ kind: 'income', subsectionId: null });
    expect(ok.body.transaction).toMatchObject({ kind: 'income', subsectionId: null });
  });

  it('rejects non-integer money on pockets and budgets', async () => {
    const o = await owner();
    const { sec } = await seed(o);
    for (const v of [1.5, '5', -1, 10 ** 13 + 1, null]) {
      expect((await json(o.post(`/api/sections/${sec.id}/subsections`)).send({ name: 'x', budgetMinor: v })).status).toBe(400);
    }
    for (const v of [1.5, '5', 10 ** 13 + 1, -(10 ** 13) - 1]) {
      expect((await json(o.post('/api/pockets')).send({ name: 'x', kind: 'cash', openingBalanceMinor: v })).status).toBe(400);
    }
    expect((await json(o.post('/api/pockets')).send({ name: 'x', kind: 'cash', openingBalanceMinor: -(10 ** 13) })).status).toBe(201);
    expect((await json(o.post('/api/pockets')).send({ name: 'x', kind: 'wallet', openingBalanceMinor: 0 })).status).toBe(400);
  });
});

describe('deleting', () => {
  it('answers 409 in_use for pockets, subsections and sections with transactions, and allows them once empty', async () => {
    const o = await owner();
    const { sec, sub, pocket } = await seed(o);
    const t = (await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id))).body.transaction;
    for (const p of [`/api/pockets/${pocket.id}`, `/api/subsections/${sub.id}`, `/api/sections/${sec.id}`]) {
      const r = await json(o.delete(p));
      expect([p, r.status, r.body.error.code]).toEqual([p, 409, 'in_use']);
    }
    await json(o.delete(`/api/transactions/${t.id}`)).expect(204);
    await json(o.delete(`/api/pockets/${pocket.id}`)).expect(204);
    await json(o.delete(`/api/sections/${sec.id}`)).expect(204);
    expect((await o.get('/api/sections')).body.sections).toEqual([]);
    expect((await json(o.delete(`/api/subsections/${sub.id}`))).status).toBe(404);
  });
});

describe('sections', () => {
  it('assigns the lowest free colour slot, then 0, and keeps order', async () => {
    const o = await owner();
    const ids: number[] = [];
    for (let i = 0; i < 9; i++) ids.push((await json(o.post('/api/sections')).send({ name: `S${i}` })).body.section.id);
    let list = (await o.get('/api/sections')).body.sections;
    expect(list.map((s: any) => s.colorSlot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
    await json(o.delete(`/api/sections/${ids[2]}`)).expect(204);
    const added = (await json(o.post('/api/sections')).send({ name: 'New' })).body.section;
    expect(added.colorSlot).toBe(3);
    list = (await o.get('/api/sections')).body.sections;
    expect(list[list.length - 1].name).toBe('New');
    const r = await json(o.patch(`/api/sections/${ids[0]}`)).send({ name: 'Renamed' });
    expect(r.body.section).toMatchObject({ name: 'Renamed', colorSlot: 1 });
  });

  it('orders subsections and edits them', async () => {
    const o = await owner();
    const { sec } = await seed(o);
    await json(o.post(`/api/sections/${sec.id}/subsections`)).send({ name: 'Rent', budgetMinor: 0 }).expect(201);
    const subs = (await o.get('/api/sections')).body.sections[0].subsections;
    expect(subs.map((s: any) => [s.name, s.position])).toEqual([['Food', 1], ['Rent', 2]]);
    const r = await json(o.patch(`/api/subsections/${subs[1].id}`)).send({ budgetMinor: 123456 });
    expect(r.body.subsection).toMatchObject({ name: 'Rent', budgetMinor: 123456, sectionId: sec.id });
  });
});

describe('transaction wording', () => {
  it('says expense and income in its messages', async () => {
    const o = await owner();
    const { sub, pocket } = await seed(o);
    const bad = await json(o.post('/api/transactions')).send(tx(pocket.id, null, { kind: 'x' }));
    expect(bad.body.error.fields.kind).toBe('Choose expense or income.');
    const inc = await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { kind: 'income' }));
    expect(inc.body.error.fields.subsectionId).toBe('Income has no subsection.');
  });
});

describe('pocket emoji', () => {
  const cp = (c: number) => String.fromCodePoint(c);
  const make = (a: ReturnType<typeof request.agent>, body: object) =>
    json(a.post('/api/pockets')).send({ name: 'P', kind: 'bank', openingBalanceMinor: 0, ...body });

  it('defaults by kind and keeps a listed emoji', async () => {
    const o = await owner();
    const defaults = { bank: 0x1f3e6, cash: 0x1f4b5, fund: 0x1f331, broker: 0x1f4c8 };
    for (const [kind, c] of Object.entries(defaults)) expect((await make(o, { kind })).body.pocket.emoji).toBe(cp(c));
    const r = await make(o, { emoji: cp(0x2764) });
    expect(r.status).toBe(201);
    expect(r.body.pocket.emoji).toBe(cp(0x2764));
    expect((await o.get('/api/pockets')).body.pockets.at(-1).emoji).toBe(cp(0x2764));
  });

  it('refuses unlisted, empty and selector-suffixed emoji on emoji', async () => {
    const o = await owner();
    const id = (await make(o, {})).body.pocket.id;
    for (const emoji of ['x', '', cp(0x1f3e6) + cp(0xfe0f), cp(0x2764) + cp(0xfe0f)]) {
      for (const r of [await make(o, { emoji }), await json(o.patch(`/api/pockets/${id}`)).send({ emoji })]) {
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe('validation');
        expect(Object.keys(r.body.error.fields)).toEqual(['emoji']);
      }
    }
  });

  it('changes with PATCH and survives other patches', async () => {
    const o = await owner();
    const id = (await make(o, {})).body.pocket.id;
    expect((await json(o.patch(`/api/pockets/${id}`)).send({ emoji: cp(0x1f437) })).body.pocket.emoji).toBe(cp(0x1f437));
    expect((await json(o.patch(`/api/pockets/${id}`)).send({ name: 'Q' })).body.pocket.emoji).toBe(cp(0x1f437));
  });

  it('gives pockets from before the migration the default for their kind', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-old-'));
    try {
      const file = path.join(old, 'tally.db');
      const raw = new Database(file);
      raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
      raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8'));
      raw.prepare("INSERT INTO migrations (name) VALUES ('001_init.sql')").run();
      raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (1, 'u', 'u', 'x', 'EUR')").run();
      for (const kind of ['bank', 'cash', 'fund', 'broker'])
        raw.prepare("INSERT INTO pockets (user_id, name, kind, currency, opening_balance_minor) VALUES (1, ?, ?, 'EUR', 0)").run(kind, kind);
      raw.close();
      const migrated = openDb(file);
      const rows = migrated.prepare('SELECT kind, emoji FROM pockets ORDER BY id').all();
      migrated.close();
      expect(rows).toEqual([
        { kind: 'bank', emoji: cp(0x1f3e6) }, { kind: 'cash', emoji: cp(0x1f4b5) },
        { kind: 'fund', emoji: cp(0x1f331) }, { kind: 'broker', emoji: cp(0x1f4c8) },
      ]);
    } finally {
      fs.rmSync(old, { recursive: true, force: true });
    }
  });
});

describe('errors', () => {
  it('uses the error shape for unknown routes and bad ids', async () => {
    const o = await owner();
    expect((await o.get('/api/nothing')).body.error.code).toBe('not_found');
    for (const id of ['abc', '0x10', '1e1', '-1', '1.0']) expect((await json(o.patch(`/api/pockets/${id}`)).send({})).status).toBe(404);
    const v = await json(o.post('/api/sections')).send({ name: '' });
    expect(v.body.error).toEqual({ code: 'validation', message: 'Check the highlighted fields.', fields: { name: 'Enter a name.' } });
  });
});

describe('section budgets', () => {
  type Agent = ReturnType<typeof request.agent>;
  const mk = async (a: Agent, body: object) => (await json(a.post('/api/sections')).send(body)).body.section;
  const sub = (a: Agent, sid: number, budgetMinor: number) =>
    json(a.post(`/api/sections/${sid}/subsections`)).send({ name: 'S', budgetMinor }).expect(201);
  const income = async (a: Agent, amountMinor: number) => {
    const p = (await json(a.post('/api/pockets')).send({ name: 'B', kind: 'bank', openingBalanceMinor: 0 })).body.pocket;
    await json(a.post('/api/transactions')).send(tx(p.id, null, { amountMinor, date: '2026-10-01' })).expect(201);
  };
  const budget = async (a: Agent) => (await a.get('/api/budget?month=2026-10')).body;
  const bad = async (r: request.Test, field: string, message?: string) => {
    const res = await r;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    expect(Object.keys(res.body.error.fields)).toEqual([field]);
    if (message) expect(res.body.error.fields[field]).toBe(message);
  };

  it('defaults to subsections, stores each kind, and nulls the field that does not belong', async () => {
    const o = await owner();
    expect(await mk(o, { name: 'A' })).toMatchObject({ budgetKind: 'subsections', budgetMinor: null, budgetBasisPoints: null });
    const f = await mk(o, { name: 'F', budgetKind: 'fixed', budgetMinor: 90000, budgetBasisPoints: 5 });
    expect(f).toMatchObject({ budgetKind: 'fixed', budgetMinor: 90000, budgetBasisPoints: null });
    const p = await mk(o, { name: 'P', budgetKind: 'percent', budgetBasisPoints: 250, budgetMinor: 7 });
    expect(p).toMatchObject({ budgetKind: 'percent', budgetMinor: null, budgetBasisPoints: 250 });
    const sw = (await json(o.patch(`/api/sections/${f.id}`)).send({ budgetKind: 'percent', budgetBasisPoints: 5000 })).body.section;
    expect(sw).toMatchObject({ budgetKind: 'percent', budgetMinor: null, budgetBasisPoints: 5000 });
    const back = (await json(o.patch(`/api/sections/${f.id}`)).send({ budgetKind: 'subsections' })).body.section;
    expect(back).toMatchObject({ budgetKind: 'subsections', budgetMinor: null, budgetBasisPoints: null });
    const list = (await o.get('/api/sections')).body.sections;
    expect(list.map((x: any) => x.budgetKind)).toEqual(['subsections', 'subsections', 'percent']);
  });

  it('validates each rule on its field', async () => {
    const o = await owner();
    const post = (b: object) => json(o.post('/api/sections')).send({ name: 'X', ...b });
    await bad(post({ budgetKind: 'nope' }), 'budgetKind', 'Choose how the budget is set.');
    for (const m of [undefined, null, -1, 1.5, 10 ** 13 + 1, '5'])
      await bad(post({ budgetKind: 'fixed', budgetMinor: m }), 'budgetMinor', 'Enter a budget of zero or more.');
    expect((await post({ budgetKind: 'fixed', budgetMinor: 0 })).status).toBe(201);
    for (const b of [undefined, null, 0, 10001, 2.5, -5])
      await bad(post({ budgetKind: 'percent', budgetBasisPoints: b }), 'budgetBasisPoints', 'Enter a percentage above 0 and up to 100.');
    expect((await post({ budgetKind: 'percent', budgetBasisPoints: 10000 })).status).toBe(201);
  });

  it('keeps percentages at or under 100%, on POST and PATCH, per person', async () => {
    const o = await owner();
    const other = await person(o, 'two');
    await mk(other, { name: 'O', budgetKind: 'percent', budgetBasisPoints: 9000 });
    const a = await mk(o, { name: 'A', budgetKind: 'percent', budgetBasisPoints: 6000 });
    await bad(
      json(o.post('/api/sections')).send({ name: 'B', budgetKind: 'percent', budgetBasisPoints: 4001 }),
      'budgetBasisPoints',
      'Your sections would take more than 100% of income. Other sections already take 60%.',
    );
    const b = await mk(o, { name: 'B', budgetKind: 'percent', budgetBasisPoints: 4000 });
    await bad(json(o.patch(`/api/sections/${b.id}`)).send({ budgetBasisPoints: 4001 }), 'budgetBasisPoints');
    // Changing a section does not count it against itself.
    expect((await json(o.patch(`/api/sections/${a.id}`)).send({ budgetBasisPoints: 6000, name: 'A2' })).body.section.name).toBe('A2');
    const c = await mk(o, { name: 'C' });
    const r = await json(o.patch(`/api/sections/${c.id}`)).send({ budgetKind: 'percent', budgetBasisPoints: 1225 });
    expect(r.body.error.fields.budgetBasisPoints).toMatch(/already take 100%\.$/);
  });

  it('computes the worked example and its notes', async () => {
    const o = await owner();
    await income(o, 240000);
    const home = await mk(o, { name: 'Home', budgetKind: 'fixed', budgetMinor: 90000 });
    await sub(o, home.id, 80000);
    await sub(o, home.id, 13000);
    const needs = await mk(o, { name: 'Needs', budgetKind: 'percent', budgetBasisPoints: 5000 });
    await sub(o, needs.id, 30000);
    await mk(o, { name: 'Zakat', budgetKind: 'percent', budgetBasisPoints: 250 });
    const fun = await mk(o, { name: 'Fun' });
    await sub(o, fun.id, 15000);
    const b = await budget(o);
    expect(b.sections.map((s: any) => [s.budgetedMinor, s.restMinor])).toEqual([[90000, -3000], [75000, 45000], [3750, 3750], [15000, 0]]);
    expect(b.sections[0]).toMatchObject({ budgetKind: 'fixed', budgetMinor: 90000, budgetBasisPoints: null, availableMinor: 90000 });
    expect(b.totals.budgetedMinor).toBe(183750);
    expect(b.totals.availableMinor).toBe(183750);
    const empty = (await o.get('/api/budget?month=2026-11')).body;
    expect(empty.sections.map((s: any) => s.budgetedMinor)).toEqual([90000, 0, 0, 15000]);
  });

  it('rounds shares down, and stays exact past 2^53', async () => {
    const o = await owner();
    await income(o, 100001);
    const s = await mk(o, { name: 'T', budgetKind: 'percent', budgetBasisPoints: 3333 });
    expect((await budget(o)).sections[0].budgetedMinor).toBe(33330);
    await income(o, 10 ** 13 - 100001);
    await json(o.patch(`/api/sections/${s.id}`)).send({ budgetBasisPoints: 9999 });
    // 10^13 x 9999 is above 2^53, so a float product would be inexact.
    expect((await budget(o)).sections[0].budgetedMinor).toBe(Number((10n ** 13n * 9999n) / 10000n));
  });

  it("ignores another person's sections", async () => {
    const o = await owner();
    await income(o, 100000);
    await mk(o, { name: 'P', budgetKind: 'percent', budgetBasisPoints: 5000 });
    const before = await budget(o);
    const t = await person(o, 'two');
    await mk(t, { name: 'F', budgetKind: 'fixed', budgetMinor: 99999 });
    await mk(t, { name: 'P', budgetKind: 'percent', budgetBasisPoints: 10000 });
    expect(await budget(o)).toEqual(before);
    expect((await json(o.post('/api/sections')).send({ name: 'Q', budgetKind: 'percent', budgetBasisPoints: 5000 })).status).toBe(201);
  });

  it('opens a database from before the migration with every section on subsections', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-old-'));
    try {
      const file = path.join(old, 'old.db');
      const raw = new Database(file);
      raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
      for (const n of ['001_init.sql', '002_pocket_emoji.sql']) {
        raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
        raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
      }
      raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (1, 'u', 'u', 'x', 'EUR')").run();
      raw.prepare("INSERT INTO sections (user_id, name, color_slot, position) VALUES (1, 'S', 1, 1)").run();
      raw.close();
      const migrated = openDb(file);
      const row = migrated.prepare('SELECT budget_kind AS k, budget_minor AS m, budget_basis_points AS b FROM sections').get();
      migrated.close();
      expect(row).toEqual({ k: 'subsections', m: null, b: null });
    } finally {
      fs.rmSync(old, { recursive: true, force: true });
    }
  });
});
