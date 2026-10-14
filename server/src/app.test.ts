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
  const src = (await json(a.post('/api/sources')).send({ name: 'Job' })).body.source;
  return { sec, sub, pocket, src };
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
    expect(budget.totals).toEqual({ incomeMinor: 0, budgetedMinor: 0, spentMinor: 0, availableMinor: 0, leftOverMinor: 0 });

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
    const { sub, pocket, src } = await seed(o);
    await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { amountMinor: 4820 })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { amountMinor: 200000, sourceId: src.id })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { amountMinor: 1, date: '2026-09-30' })).expect(201);
    expect((await o.get('/api/pockets')).body.pockets[0]).toMatchObject({
      openingBalanceMinor: 100000, balanceMinor: 100000 + 200000 - 4820 - 1, currency: 'EUR',
    });
    const p = (await json(o.patch(`/api/pockets/${pocket.id}`)).send({ openingBalanceMinor: -500 })).body.pocket;
    expect(p.balanceMinor).toBe(-500 + 200000 - 4821);
  });

  it('budget counts only the requested month', async () => {
    const o = await owner();
    const { sec, sub, pocket, src } = await seed(o);
    for (const [date, amountMinor] of [['2026-10-01', 1000], ['2026-10-31', 2000], ['2026-09-30', 4000], ['2026-11-01', 8000]] as const)
      await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { date, amountMinor })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { date: '2026-10-15', amountMinor: 50000, sourceId: src.id })).expect(201);
    await json(o.post('/api/transactions')).send(tx(pocket.id, null, { date: '2026-09-15', amountMinor: 70000, sourceId: src.id })).expect(201);

    const box = (await o.get('/api/sources')).body.sources[0].boxId;
    await json(o.post(`/api/boxes/${box}/steps`)).send({ kind: 'amount', sectionId: sec.id, amountMinor: 30000 }).expect(201);
    const b = (await o.get('/api/budget?month=2026-10')).body;
    expect(b).toMatchObject({ month: '2026-10', currency: 'EUR' });
    expect(b.totals).toEqual({ incomeMinor: 50000, budgetedMinor: 30000, spentMinor: 3000, availableMinor: 27000, leftOverMinor: 20000 });
    expect(b.sections[0]).toMatchObject({ id: sec.id, colorSlot: 1, budgetedMinor: 30000, spentMinor: 3000, availableMinor: 27000 });
    expect(b.sections[0].subsections[0]).toEqual({ id: sub.id, name: 'Food', budgetMinor: 30000, carriedMinor: 0, spentMinor: 3000, availableMinor: 27000 });
    expect((await o.get('/api/budget?month=2026-12')).body.totals.spentMinor).toBe(0);
    expect((await o.get('/api/budget?month=2026-13')).status).toBe(400);
    expect((await o.get('/api/budget')).status).toBe(400);
    const list = (await o.get('/api/transactions?month=2026-10')).body.transactions;
    expect(list.map((x: any) => x.date)).toEqual(['2026-10-31', '2026-10-15', '2026-10-01']);
  });

  it('rejects bad transactions with 400 validation', async () => {
    const o = await owner();
    const { sub, pocket, src } = await seed(o);
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
    const ok = await json(o.patch(`/api/transactions/${t.id}`)).send({ kind: 'income', subsectionId: null, sourceId: src.id });
    expect(ok.body.transaction).toMatchObject({ kind: 'income', subsectionId: null, sourceId: src.id, payee: '' });
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

describe('pipeline', () => {
  type Agent = ReturnType<typeof request.agent>;
  const mkSec = async (a: Agent, n: string) => (await json(a.post('/api/sections')).send({ name: n })).body.section;
  const mkSrc = async (a: Agent, body: object) => (await json(a.post('/api/sources')).send(body)).body.source;
  const addStep = (a: Agent, boxId: number, body: object) => json(a.post(`/api/boxes/${boxId}/steps`)).send(body);
  const pipe = async (a: Agent, month = '2026-10') => (await a.get(`/api/pipeline?month=${month}`)).body;
  const pocketOf = async (a: Agent) => (await json(a.post('/api/pockets')).send({ name: 'B', kind: 'bank', openingBalanceMinor: 0 })).body.pocket;
  const earn = async (a: Agent, pocketId: number, sourceId: number, amountMinor: number, date = '2026-10-01') =>
    json(a.post('/api/transactions')).send(tx(pocketId, null, { sourceId, amountMinor, date })).expect(201);
  const bad = async (r: request.Test, field: string, message?: string) => {
    const res = await r;
    expect([res.status, res.body.error?.code]).toEqual([400, 'validation']);
    expect(Object.keys(res.body.error.fields)).toEqual([field]);
    if (message) expect(res.body.error.fields[field]).toBe(message);
  };

  // The worked example of spec 06.
  async function example(a: Agent) {
    const secs = [];
    for (const n of ['Zakat', 'Family', 'Needs', 'Wants', 'Savings']) secs.push(await mkSec(a, n));
    const [zakat, family, needs, wants, savings] = secs;
    const pay = await mkSrc(a, { name: 'Paycheck' });
    const job = await mkSrc(a, { name: 'Second job', boxId: pay.boxId });
    const fund = await mkSrc(a, { name: 'Fund payout' });
    const p = await pocketOf(a);
    await earn(a, p.id, pay.id, 200000);
    await earn(a, p.id, job.id, 60000);
    await earn(a, p.id, fund.id, 1240);
    await earn(a, p.id, job.id, 60000, '2026-11-01');
    await earn(a, p.id, job.id, 30000, '2026-12-01');
    const s1 = (await addStep(a, pay.boxId, { kind: 'percent', shares: [{ sectionId: zakat.id, basisPoints: 250 }] }).expect(201)).body.step;
    const s2 = (await addStep(a, pay.boxId, { kind: 'amount', sectionId: family.id, amountMinor: 50000 }).expect(201)).body.step;
    const s3 = (await addStep(a, pay.boxId, {
      kind: 'percent',
      shares: [{ sectionId: needs.id, basisPoints: 5000 }, { sectionId: wants.id, basisPoints: 3000 }, { sectionId: savings.id, basisPoints: 2000 }],
    }).expect(201)).body.step;
    return { secs, pay, job, fund, s1, s2, s3, p };
  }
  const received = (b: any) => b.sections.map((x: any) => x.receivedMinor);

  it('creates, joins, renames, moves and deletes sources', async () => {
    const o = await owner();
    const a = await mkSrc(o, { name: 'Paycheck' });
    expect(a).toEqual({ id: expect.any(Number), name: 'Paycheck', boxId: expect.any(Number), isLeftovers: false });
    const b = await mkSrc(o, { name: 'Job', boxId: a.boxId });
    expect(b.boxId).toBe(a.boxId);
    const c = await mkSrc(o, { name: 'Fund' });
    expect(c.boxId).not.toBe(a.boxId);
    expect((await o.get('/api/sources')).body.sources.map((x: any) => x.name)).toEqual(['Paycheck', 'Job', 'Fund']);
    expect((await json(o.patch(`/api/sources/${c.id}`)).send({ name: 'Fund 2' })).body.source).toMatchObject({ name: 'Fund 2', boxId: c.boxId });
    expect((await json(o.patch(`/api/sources/${c.id}`)).send({ boxId: a.boxId })).body.source.boxId).toBe(a.boxId);
    const alone = (await json(o.patch(`/api/sources/${c.id}`)).send({ boxId: null })).body.source;
    expect(alone.boxId).not.toBe(a.boxId);
    await json(o.delete(`/api/sources/${c.id}`)).expect(204);
    expect((await json(o.delete(`/api/sources/${c.id}`))).status).toBe(404);
    expect((await o.get('/api/sources')).body.sources).toHaveLength(2);
  });

  it('validates sources on the field named', async () => {
    const o = await owner();
    const a = await mkSrc(o, { name: 'Paycheck' });
    for (const n of ['', '   ', undefined, 5, 'x'.repeat(61)])
      await bad(json(o.post('/api/sources')).send({ name: n }), 'name');
    await bad(json(o.post('/api/sources')).send({ name: '' }), 'name', 'Enter a name.');
    await bad(json(o.post('/api/sources')).send({ name: 'PAYCHECK' }), 'name', 'You already have a source with this name.');
    const other = await mkSrc(o, { name: 'Other' });
    await bad(json(o.patch(`/api/sources/${other.id}`)).send({ name: ' paycheck ' }), 'name', 'You already have a source with this name.');
    expect((await json(o.patch(`/api/sources/${a.id}`)).send({ name: 'PAYCHECK' })).status).toBe(200);
    for (const boxId of [9999, 'x', 1.5])
      await bad(json(o.post('/api/sources')).send({ name: 'N', boxId }), 'boxId', 'Choose a box.');
    await bad(json(o.patch(`/api/sources/${a.id}`)).send({ boxId: 9999 }), 'boxId', 'Choose a box.');
  });

  it('deletes a source only without transactions', async () => {
    const o = await owner();
    const a = await mkSrc(o, { name: 'Paycheck' });
    const p = await pocketOf(o);
    const t = (await earn(o, p.id, a.id, 1000)).body.transaction;
    expect(t).toMatchObject({ kind: 'income', sourceId: a.id, subsectionId: null, payee: '' });
    const r = await json(o.delete(`/api/sources/${a.id}`));
    expect([r.status, r.body.error.code]).toEqual([409, 'in_use']);
    await json(o.delete(`/api/transactions/${t.id}`)).expect(204);
    await json(o.delete(`/api/sources/${a.id}`)).expect(204);
  });

  it('checks income and expense sources', async () => {
    const o = await owner();
    const { sub, pocket, src } = await seed(o);
    const t = (body: object) => json(o.post('/api/transactions')).send(tx(pocket.id, null, body));
    for (const sourceId of [undefined, null, 9999, 'x'])
      await bad(t({ sourceId }), 'sourceId', 'Choose a source.');
    await bad(json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { sourceId: src.id })), 'sourceId');
    const e = (await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { sourceId: null }))).body.transaction;
    expect(e).toMatchObject({ kind: 'expense', sourceId: null, payee: 'Shop' });
    const ok = (await t({ sourceId: src.id, payee: 'ignored' })).body.transaction;
    expect(ok).toMatchObject({ sourceId: src.id, payee: '' });
    const noSub = await json(o.post('/api/transactions')).send(tx(pocket.id, sub.id, { payee: '' }));
    expect(noSub.body.error.fields.payee).toBe('Enter a payee.');
  });

  it('validates step bodies on the field named', async () => {
    const o = await owner();
    const sec = await mkSec(o, 'A');
    const sec2 = await mkSec(o, 'B');
    const src = await mkSrc(o, { name: 'S' });
    const post = (body: object) => addStep(o, src.boxId, body);
    for (const kind of [undefined, 'x', 5]) await bad(post({ kind, sectionId: sec.id, amountMinor: 1 }), 'kind', 'Choose what the step takes.');
    for (const v of [undefined, 0, -1, 1.5, '5', 10 ** 13 + 1])
      await bad(post({ kind: 'amount', sectionId: sec.id, amountMinor: v }), 'amountMinor', 'Enter an amount above zero.');
    expect((await post({ kind: 'amount', sectionId: sec.id, amountMinor: 10 ** 13 })).status).toBe(201);
    for (const v of [undefined, 9999, 'x']) await bad(post({ kind: 'amount', sectionId: v, amountMinor: 5 }), 'sectionId', 'Choose a section.');
    const share = (sectionId: number, basisPoints: unknown) => ({ sectionId, basisPoints });
    for (const shares of [undefined, [], 'x', Array.from({ length: 9 }, (_, i) => share(i + 1, 1))])
      await bad(post({ kind: 'percent', shares }), 'shares', 'Add at least one section.');
    for (const shares of [[share(sec.id, 10), share(sec.id, 10)], [share(9999, 10)], [share(0.5, 10)]])
      await bad(post({ kind: 'percent', shares }), 'shares', 'Choose a different section in every row.');
    for (const v of [0, 10001, 2.5, '5', undefined, -1])
      await bad(post({ kind: 'percent', shares: [share(sec.id, v)] }), 'shares', 'Enter a percentage above 0 and up to 100 in every row.');
    await bad(post({ kind: 'percent', shares: [share(sec.id, 6000), share(sec2.id, 4001)] }), 'shares', 'The percentages of one step can add up to at most 100.');
    expect((await post({ kind: 'percent', shares: [share(sec.id, 6000), share(sec2.id, 4000)] })).status).toBe(201);
    // two existing steps, so a third can sit at 1 to 3
    for (const position of [0, 4, 1.5, 'x'])
      await bad(post({ kind: 'amount', sectionId: sec.id, amountMinor: 5, position }), 'position', 'Choose a position.');
    // another box does not exist for this person
    expect((await addStep(o, 9999, { kind: 'amount', sectionId: sec.id, amountMinor: 5 })).status).toBe(404);
  });

  it('works out the worked example and its two smaller months', async () => {
    const o = await owner();
    const { secs, pay, job, fund, s1, s2, s3 } = await example(o);
    const b = await pipe(o);
    expect(b).toMatchObject({ month: '2026-10', currency: 'EUR', leftOverMinor: 1240 });
    expect(received(b)).toEqual([6500, 50000, 101750, 61050, 40700]);
    expect(b.sections.map((x: any) => x.id)).toEqual(secs.map((x: any) => x.id));
    expect(b.boxes).toHaveLength(2);
    expect(b.boxes[0]).toEqual({
      id: pay.boxId, incomeMinor: 260000, leftOverMinor: 0,
      sources: [{ id: pay.id, name: 'Paycheck', isLeftovers: false, incomeMinor: 200000 }, { id: job.id, name: 'Second job', isLeftovers: false, incomeMinor: 60000 }],
      steps: [
        { id: s1.id, position: 1, kind: 'percent', leftMinor: 253500, shares: [{ sectionId: secs[0].id, basisPoints: 250, takenMinor: 6500 }] },
        { id: s2.id, position: 2, kind: 'amount', sectionId: secs[1].id, amountMinor: 50000, takenMinor: 50000, leftMinor: 203500 },
        {
          id: s3.id, position: 3, kind: 'percent', leftMinor: 0,
          shares: [
            { sectionId: secs[2].id, basisPoints: 5000, takenMinor: 101750 },
            { sectionId: secs[3].id, basisPoints: 3000, takenMinor: 61050 },
            { sectionId: secs[4].id, basisPoints: 2000, takenMinor: 40700 },
          ],
        },
      ],
    });
    expect(b.boxes[1]).toMatchObject({ id: fund.boxId, incomeMinor: 1240, leftOverMinor: 1240, steps: [] });

    const nov = await pipe(o, '2026-11');
    expect(received(nov)).toEqual([1500, 50000, 4250, 2550, 1700]);
    expect(nov.leftOverMinor).toBe(0);
    const dec = await pipe(o, '2026-12');
    expect(received(dec)).toEqual([750, 29250, 0, 0, 0]);
    expect(dec.leftOverMinor).toBe(0);

    for (const [m, income] of [['2026-10', 261240], ['2026-11', 60000], ['2026-12', 30000]] as const) {
      const p = await pipe(o, m);
      const sum = received(p).reduce((x: number, y: number) => x + y, 0);
      expect(sum + p.leftOverMinor).toBe(income);
      const bg = (await o.get(`/api/budget?month=${m}`)).body;
      expect(bg.sections.map((x: any) => x.budgetedMinor)).toEqual(received(p));
      expect(bg.totals).toMatchObject({ incomeMinor: income, leftOverMinor: p.leftOverMinor });
    }
    expect((await o.get('/api/budget?month=2026-10')).body.sections[0]).not.toHaveProperty('budgetKind');
    expect((await o.get('/api/pipeline?month=2026-13')).status).toBe(400);
  });

  it('keeps boxes separate or merged, and stays exact past 2^53', async () => {
    const o = await owner();
    const sec = await mkSec(o, 'T');
    const a = await mkSrc(o, { name: 'A' });
    const c = await mkSrc(o, { name: 'C' });
    const p = await pocketOf(o);
    await earn(o, p.id, a.id, 10 ** 13);
    await earn(o, p.id, c.id, 500);
    await addStep(o, a.boxId, { kind: 'percent', shares: [{ sectionId: sec.id, basisPoints: 9999 }] }).expect(201);
    let b = await pipe(o);
    expect(b.sections[0].receivedMinor).toBe(Number((10n ** 13n * 9999n) / 10000n));
    expect(b.leftOverMinor).toBe(10 ** 13 - b.sections[0].receivedMinor + 500);
    // merging C into A puts its money through the step too
    await json(o.patch(`/api/sources/${c.id}`)).send({ boxId: a.boxId }).expect(200);
    b = await pipe(o);
    expect(b.boxes).toHaveLength(1);
    expect(b.sections[0].receivedMinor).toBe(Number(((10n ** 13n + 500n) * 9999n) / 10000n));
  });

  it('adds, replaces, moves and deletes steps with positions 1 to n', async () => {
    const o = await owner();
    const [a, b, c] = [await mkSec(o, 'A'), await mkSec(o, 'B'), await mkSec(o, 'C')];
    const src = await mkSrc(o, { name: 'S' });
    const amt = (sec: any, n: number, position?: number) => ({ kind: 'amount', sectionId: sec.id, amountMinor: n, position });
    const order = async () => {
      const st = (await pipe(o)).boxes[0].steps;
      expect(st.map((x: any) => x.position)).toEqual(st.map((_: any, i: number) => i + 1));
      return st.map((x: any) => x.id);
    };
    const s1 = (await addStep(o, src.boxId, amt(a, 100)).expect(201)).body.step;
    const s2 = (await addStep(o, src.boxId, amt(b, 200)).expect(201)).body.step;
    expect(s1).toEqual({ id: s1.id, boxId: src.boxId, position: 1, kind: 'amount', sectionId: a.id, amountMinor: 100 });
    expect(s2.position).toBe(2);
    const s3 = (await addStep(o, src.boxId, amt(c, 300, 1)).expect(201)).body.step;
    expect(s3.position).toBe(1);
    expect(await order()).toEqual([s3.id, s1.id, s2.id]);
    // replace: kind may change, position stays unless given
    const rep = (await json(o.put(`/api/steps/${s1.id}`)).send({ kind: 'percent', shares: [{ sectionId: b.id, basisPoints: 100 }] }).expect(200)).body.step;
    expect(rep).toEqual({ id: s1.id, boxId: src.boxId, position: 2, kind: 'percent', shares: [{ sectionId: b.id, basisPoints: 100 }] });
    expect(await order()).toEqual([s3.id, s1.id, s2.id]);
    const back = (await json(o.put(`/api/steps/${s1.id}`)).send(amt(a, 150, 3)).expect(200)).body.step;
    expect(back).toMatchObject({ kind: 'amount', amountMinor: 150, position: 3 });
    expect(back).not.toHaveProperty('shares');
    expect(await order()).toEqual([s3.id, s2.id, s1.id]);
    await json(o.put(`/api/steps/${s1.id}`)).send(amt(a, 150, 1)).expect(200);
    expect(await order()).toEqual([s1.id, s3.id, s2.id]);
    await bad(json(o.put(`/api/steps/${s1.id}`)).send(amt(a, 150, 4)), 'position', 'Choose a position.');
    await json(o.delete(`/api/steps/${s3.id}`)).expect(204);
    expect(await order()).toEqual([s1.id, s2.id]);
    expect((await json(o.delete(`/api/steps/${s3.id}`))).status).toBe(404);
    expect((await json(o.put(`/api/steps/${s3.id}`)).send(amt(a, 1))).status).toBe(404);
    // an amount step takes what remains when the money runs short
    const p = await pocketOf(o);
    await earn(o, p.id, src.id, 120);
    expect(received(await pipe(o))).toEqual([120, 0, 0]);
  });

  it("deletes a box's steps with its last source, and guards sections used by steps", async () => {
    const o = await owner();
    const sec = await mkSec(o, 'A');
    const a = await mkSrc(o, { name: 'A' });
    const b = await mkSrc(o, { name: 'B', boxId: a.boxId });
    const step = (await addStep(o, a.boxId, { kind: 'percent', shares: [{ sectionId: sec.id, basisPoints: 100 }] }).expect(201)).body.step;
    const used = await json(o.delete(`/api/sections/${sec.id}`));
    expect([used.status, used.body.error.code]).toEqual([409, 'in_use']);
    expect(used.body.error.message).toBe('This section is used in the pipeline. Remove it from the steps and rest rules first.');
    const amt = (await addStep(o, a.boxId, { kind: 'amount', sectionId: (await mkSec(o, 'Z')).id, amountMinor: 5 }).expect(201)).body.step;
    // moving one of two sources keeps the steps
    const moved = (await json(o.patch(`/api/sources/${b.id}`)).send({ boxId: null }).expect(200)).body.source;
    expect((await pipe(o)).boxes.find((x: any) => x.id === a.boxId).steps).toHaveLength(2);
    // moving the last source of a box deletes the box's steps
    await json(o.patch(`/api/sources/${a.id}`)).send({ boxId: moved.boxId }).expect(200);
    expect((await json(o.put(`/api/steps/${step.id}`)).send({ kind: 'amount', sectionId: sec.id, amountMinor: 1 })).status).toBe(404);
    expect((await json(o.delete(`/api/steps/${amt.id}`))).status).toBe(404);
    await json(o.delete(`/api/sections/${sec.id}`)).expect(204);
    // deleting the last source does the same
    const c = await mkSrc(o, { name: 'C' });
    const s = (await addStep(o, c.boxId, { kind: 'amount', sectionId: (await mkSec(o, 'Y')).id, amountMinor: 5 }).expect(201)).body.step;
    await json(o.delete(`/api/sources/${c.id}`)).expect(204);
    expect((await json(o.delete(`/api/steps/${s.id}`))).status).toBe(404);
    expect((await addStep(o, c.boxId, { kind: 'amount', sectionId: sec.id, amountMinor: 5 })).status).toBe(404);
  });

  it('keeps sources, steps and the pipeline apart between people', async () => {
    const o = await owner();
    const bob = await person(o, 'bob');
    const { secs, pay, s1 } = await example(o);
    const mine = (await pipe(o)).boxes;
    const bs = await mkSec(bob, 'Bob');
    const bsrc = await mkSrc(bob, { name: 'Paycheck' }); // same name as the owner's is fine
    expect(bsrc.name).toBe('Paycheck');
    const attempts: [string, string, object?][] = [
      ['patch', `/api/sources/${pay.id}`, { name: 'x' }],
      ['delete', `/api/sources/${pay.id}`],
      ['put', `/api/steps/${s1.id}`, { kind: 'amount', sectionId: bs.id, amountMinor: 5 }],
      ['delete', `/api/steps/${s1.id}`],
      ['post', `/api/boxes/${pay.boxId}/steps`, { kind: 'amount', sectionId: bs.id, amountMinor: 5 }],
    ];
    for (const [m, p, body] of attempts) {
      const r = await json((bob as any)[m](p)).send(body ?? {});
      expect([m, p, r.status, r.body.error?.code]).toEqual([m, p, 404, 'not_found']);
    }
    await bad(json(bob.post('/api/sources')).send({ name: 'N', boxId: pay.boxId }), 'boxId', 'Choose a box.');
    await bad(json(bob.patch(`/api/sources/${bsrc.id}`)).send({ boxId: pay.boxId }), 'boxId', 'Choose a box.');
    await bad(addStep(bob, bsrc.boxId, { kind: 'amount', sectionId: secs[0].id, amountMinor: 5 }), 'sectionId', 'Choose a section.');
    await bad(addStep(bob, bsrc.boxId, { kind: 'percent', shares: [{ sectionId: secs[0].id, basisPoints: 5 }] }), 'shares');
    const p = await pocketOf(bob);
    await bad(json(bob.post('/api/transactions')).send(tx(p.id, null, { sourceId: pay.id })), 'sourceId', 'Choose a source.');
    expect((await bob.get('/api/sources')).body.sources).toEqual([bsrc]);
    const b = await pipe(bob);
    expect(b.boxes).toHaveLength(1);
    expect(b.boxes[0]).toMatchObject({ steps: [], incomeMinor: 0 });
    expect(b.sections).toEqual([{ id: bs.id, name: 'Bob', colorSlot: 1, receivedMinor: 0, carriedMinor: 0, rest: { shares: [{ sectionId: null, basisPoints: 10000 }], overspent: 'income' } }]);
    expect(b.leftOverMinor).toBe(0);
    expect((await pipe(o)).boxes).toEqual(mine);
  });

  it('opens a database from before the migration and gives its income a source named Income', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-old-'));
    try {
      const file = path.join(old, 'old.db');
      const raw = new Database(file);
      raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
      for (const n of ['001_init.sql', '002_pocket_emoji.sql', '003_section_budget.sql']) {
        raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
        raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
      }
      for (const id of [1, 2, 3])
        raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (?, ?, 'u', 'x', 'EUR')").run(id, `u${id}`);
      raw.prepare("INSERT INTO sections (user_id, name, color_slot, position, budget_kind, budget_minor) VALUES (1, 'S', 1, 1, 'fixed', 5)").run();
      for (const u of [1, 2]) {
        raw.prepare("INSERT INTO pockets (id, user_id, name, kind, currency, opening_balance_minor) VALUES (?, ?, 'P', 'bank', 'EUR', 0)").run(u, u);
        raw.prepare("INSERT INTO transactions (user_id, date, kind, amount_minor, pocket_id, payee) VALUES (?, '2026-10-01', 'income', 500, ?, 'Job')").run(u, u);
      }
      raw.close();
      const migrated = openDb(file);
      const srcs = migrated.prepare('SELECT user_id AS u, name, box_id AS b FROM sources ORDER BY id').all() as any[];
      const txs = migrated.prepare('SELECT user_id AS u, source_id AS s FROM transactions ORDER BY id').all();
      const cols = (migrated.prepare('PRAGMA table_info(sections)').all() as any[]).map((c) => c.name);
      migrated.close();
      expect(srcs.map((x) => [x.u, x.name])).toEqual([[1, 'Income'], [2, 'Income']]);
      expect(srcs[0].b).not.toBe(srcs[1].b);
      expect(txs).toEqual([{ u: 1, s: 1 }, { u: 2, s: 2 }]);
      expect(cols).toEqual(['id', 'user_id', 'name', 'color_slot', 'position', 'overspent']);
    } finally {
      fs.rmSync(old, { recursive: true, force: true });
    }
  });
});
