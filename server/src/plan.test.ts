import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const FIXTURE = path.join(__dirname, '..', 'test', 'rates.xml');
const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14; 1 EUR = 1.0860 USD
const D = '2026-10-14';
let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-plan-'));
  db = openDb(path.join(dir, 'tally.db'));
  const file = path.join(dir, 'rates.xml');
  fs.copyFileSync(FIXTURE, file);
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: file, now: () => T0 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const fields = async (r: request.Test) => (await r.expect(400)).body.error.fields;
async function owner(username = 'owner') {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username, displayName: username, password: 'correct horse battery', baseCurrency: 'EUR' }).expect(201);
  return a;
}
const pocket = async (a: Agent, name: string, openingBalanceMinor = 0, over: object = {}) =>
  (await post(a, '/api/pockets', { name, kind: 'bank', openingBalanceMinor, ...over })).pocket;
// A section and its subsections in order; `kept` is the pocket each is kept in.
async function budget(a: Agent, subs: [string, number, number | null][]) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const out: Record<string, any> = {};
  for (const [name, budgetMinor, pocketId] of subs)
    out[name] = (await post(a, `/api/sections/${sec.id}/subsections`, { name, budgetMinor, pocketId })).subsection;
  return out;
}
const plan = (a: Agent) => get(a, '/api/plan');
const moves = (p: any) => p.transfers.map((t: any) => [t.fromPocketId, t.toPocketId, t.baseAmountMinor]);
let n = 0;
// Income into a pocket this month (or on `date`).
const earn = async (a: Agent, pocketId: number, amountMinor: number, date = D) => {
  const src = (await post(a, '/api/sources', { name: 'Job ' + ++n })).source;
  return post(a, '/api/transactions', { date, kind: 'income', amountMinor, pocketId, subsectionId: null, sourceId: src.id });
};

describe('the plan', () => {
  it('works out the example, and has nothing left after the transfers are made', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC'), rev = await pocket(a, 'Revolut'), sav = await pocket(a, 'EUR savings');
    await earn(a, boc.id, 221375);
    const s = await budget(a, [['Rent share', 6000, boc.id], ['Phone', 4000, boc.id], ['Groceries', 40000, rev.id], ['Car', 166375, rev.id], ['Savings', 5000, sav.id]]);
    const p = await plan(a);
    expect(p).toEqual({
      currency: 'EUR',
      pockets: [
        { id: boc.id, shouldMinor: 10000, holdsMinor: 221375, subsections: [{ id: s['Rent share'].id, availableMinor: 6000 }, { id: s.Phone.id, availableMinor: 4000 }] },
        { id: rev.id, shouldMinor: 206375, holdsMinor: 0, subsections: [{ id: s.Groceries.id, availableMinor: 40000 }, { id: s.Car.id, availableMinor: 166375 }] },
        { id: sav.id, shouldMinor: 5000, holdsMinor: 0, subsections: [{ id: s.Savings.id, availableMinor: 5000 }] },
      ],
      transfers: [
        { fromPocketId: boc.id, toPocketId: rev.id, amountMinor: 206375, toAmountMinor: 206375, baseAmountMinor: 206375 },
        { fromPocketId: boc.id, toPocketId: sav.id, amountMinor: 5000, toAmountMinor: 5000, baseAmountMinor: 5000 },
      ],
      nextMonth: { pocketId: boc.id, amountMinor: 0 },
      unplacedSubsectionIds: [],
      shortMinor: 0,
    });
    for (const t of p.transfers) await post(a, '/api/transactions', { date: D, kind: 'transfer', amountMinor: t.amountMinor, pocketId: t.fromPocketId, toPocketId: t.toPocketId });
    expect(await plan(a)).toMatchObject({ transfers: [], shortMinor: 0 });
  });

  it('spending from the pocket a subsection is kept in makes no transfer; from another pocket it does', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 20000), rev = await pocket(a, 'Revolut', 20000);
    const s = await budget(a, [['Rent', 20000, boc.id], ['Groceries', 20000, rev.id]]);
    const spend = (pocketId: number, subsectionId: number) => post(a, '/api/transactions', { date: D, kind: 'expense', amountMinor: 5000, pocketId, subsectionId, payee: 'Shop' });
    await spend(rev.id, s.Groceries.id);
    expect((await plan(a)).transfers).toEqual([]);
    await spend(rev.id, s.Rent.id); // paid from the wrong pocket
    expect(moves(await plan(a))).toEqual([[boc.id, rev.id, 5000]]);
  });

  it('converts for a pocket in another currency', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 100000), usd = await pocket(a, 'Revolut USD', 0, { currency: 'USD' });
    await budget(a, [['Trip', 10000, usd.id]]);
    const p = await plan(a);
    expect(p.pockets[1]).toMatchObject({ id: usd.id, shouldMinor: 10860, holdsMinor: 0 });
    expect(p.transfers).toEqual([{ fromPocketId: boc.id, toPocketId: usd.id, amountMinor: 10000, toAmountMinor: 10860, baseAmountMinor: 10000 }]);
  });

  it('converts for a pocket in another currency with money to spare', async () => {
    const b = await owner();
    const usd2 = await pocket(b, 'USD', 108600, { currency: 'USD' }), eur = await pocket(b, 'EUR');
    await budget(b, [['Rent', 5000, eur.id]]);
    const q = await plan(b);
    expect(q.pockets[0]).toMatchObject({ id: usd2.id, shouldMinor: 103170, holdsMinor: 108600 });
    expect(q.transfers).toEqual([{ fromPocketId: usd2.id, toPocketId: eur.id, amountMinor: 5430, toAmountMinor: 5000, baseAmountMinor: 5000 }]);
  });

  it('lowers the pocket it is kept in by an overspent subsection', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 50000), rev = await pocket(a, 'Revolut');
    const s = await budget(a, [['Fun', 5000, rev.id]]);
    await post(a, '/api/transactions', { date: D, kind: 'expense', amountMinor: 8000, pocketId: boc.id, subsectionId: s.Fun.id, payee: 'Bar' });
    const p = await plan(a);
    expect(p.pockets[1]).toMatchObject({ shouldMinor: -3000, subsections: [{ id: s.Fun.id, availableMinor: -3000 }] });
    expect(p.nextMonth).toEqual({ pocketId: boc.id, amountMinor: 45000 });
    expect(moves(p)).toEqual([[rev.id, boc.id, 3000]]);
  });

  it('is not changed by buying a holding', async () => {
    const a = await owner();
    const fund = await pocket(a, 'Fund', 50000, { kind: 'fund' });
    const s = await budget(a, [['Car', 1000, fund.id]]);
    const before = await plan(a);
    await post(a, '/api/holdings', { name: 'ETF', pocketId: fund.id, subsectionId: s.Car.id, paidMinor: 20000 });
    expect(await plan(a)).toEqual(before);
    expect(before.pockets[0].holdsMinor).toBe(50000);
  });

  it('leaves the money of subsections with no pocket out of every pocket', async () => {
    const a = await owner();
    const loose = await pocket(a, 'Loose', 30000), other = await pocket(a, 'Other', 20000), rev = await pocket(a, 'Revolut');
    const s = await budget(a, [['Nowhere', 20000, null], ['Groceries', 40000, rev.id]]);
    const p = await plan(a);
    expect(p.unplacedSubsectionIds).toEqual([s.Nowhere.id]);
    expect(p.pockets.flatMap((x: any) => x.subsections.map((y: any) => y.id))).toEqual([s.Groceries.id]);
    expect(p.nextMonth).toEqual({ pocketId: loose.id, amountMinor: -10000 });
    expect(p.pockets[0].shouldMinor).toBe(-10000);
    expect(moves(p)).toEqual([[loose.id, rev.id, 40000]]);
    void other;
  });

  it('reports what stays short when the money is not in a plan pocket', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC'), rev = await pocket(a, 'Revolut'), card = await pocket(a, 'Card', 0, { kind: 'credit' });
    await earn(a, card.id, 30000);
    await budget(a, [['Groceries', 25000, rev.id]]);
    const p = await plan(a);
    expect(p.transfers).toEqual([]);
    expect(p.nextMonth).toEqual({ pocketId: boc.id, amountMinor: 5000 });
    expect(p.shortMinor).toBe(30000);
  });

  it('leaves out a transfer under 1.00 and a short under 1.00', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 99), rev = await pocket(a, 'Revolut');
    await budget(a, [['Groceries', 99, rev.id]]);
    expect(await plan(a)).toMatchObject({ transfers: [], shortMinor: 0 });
  });

  it('keeps a transfer of exactly 1.00', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 100), rev = await pocket(a, 'Revolut');
    await budget(a, [['Groceries', 100, rev.id]]);
    expect(moves(await plan(a))).toEqual([[boc.id, rev.id, 100]]);
  });

  it('takes the older pocket first on a tie', async () => {
    const a = await owner();
    const x = await pocket(a, 'X', 5000), y = await pocket(a, 'Y', 5000), z = await pocket(a, 'Z');
    await budget(a, [['One', 10000, z.id]]);
    expect(moves(await plan(a))).toEqual([[x.id, z.id, 5000], [y.id, z.id, 5000]]);
  });

  it('takes the older pocket first when two are equally short', async () => {
    const a = await owner();
    const x = await pocket(a, 'X', 5000), z = await pocket(a, 'Z'), w = await pocket(a, 'W');
    await budget(a, [['One', 3000, z.id], ['Two', 3000, w.id]]);
    expect(moves(await plan(a))).toEqual([[x.id, z.id, 3000], [x.id, w.id, 3000]]);
  });

  it("keeps next month's money in the default pocket or the chosen one", async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC'), rev = await pocket(a, 'Revolut', 500);
    await earn(a, boc.id, 100000);
    await budget(a, [['Food', 30000, rev.id]]);
    let p = await plan(a);
    expect(p.nextMonth).toEqual({ pocketId: boc.id, amountMinor: 70500 }); // income and opening balance, less what Food claims
    expect(moves(p)).toEqual([[boc.id, rev.id, 29500]]);
    expect(p.pockets[0].shouldMinor).toBe(70500);
    expect((await json(a.patch('/api/me')).send({ nextMonthPocketId: rev.id }).expect(200)).body.user.nextMonthPocketId).toBe(rev.id);
    p = await plan(a);
    expect(p.nextMonth.pocketId).toBe(rev.id);
    expect(p.pockets[1].shouldMinor).toBe(100500);
    expect(moves(p)).toEqual([[boc.id, rev.id, 100000]]);
  });

  it('counts two open months once each, and a closed month through its carry only', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC');
    await earn(a, boc.id, 10000, '2026-09-05');
    const s = await budget(a, [['Food', 3000, boc.id]]);
    const open = await plan(a);
    expect(open.pockets[0].subsections).toEqual([{ id: s.Food.id, availableMinor: 6000 }]);
    expect(open.nextMonth.amountMinor).toBe(4000);
    expect(open.pockets[0]).toMatchObject({ shouldMinor: 10000, holdsMinor: 10000 });
    await json(a.post('/api/months/2026-09/close')).send({}).expect(200);
    expect(await plan(a)).toEqual(open);
  });

  it('refuses a transfer that names a subsection, and the old where route is gone', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 1000), rev = await pocket(a, 'Revolut');
    const s = await budget(a, [['Food', 100, null]]);
    expect(await fields(json(a.post('/api/transactions')).send({ date: D, kind: 'transfer', amountMinor: 100, pocketId: boc.id, toPocketId: rev.id, subsectionId: s.Food.id })))
      .toEqual({ subsectionId: 'A transfer has no subsection.' });
    await a.get('/api/where').expect(404);
  });

  it('migration clears the subsection of existing transfers', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC', 1000), rev = await pocket(a, 'Revolut');
    const s = await budget(a, [['Food', 100, null]]);
    const t = (await post(a, '/api/transactions', { date: D, kind: 'transfer', amountMinor: 100, pocketId: boc.id, toPocketId: rev.id })).transaction;
    db.prepare('UPDATE transactions SET subsection_id = ? WHERE id = ?').run(s.Food.id, t.id);
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '018_kept_in.sql'), 'utf8').split('\n').filter((l) => l.startsWith('UPDATE')).join('\n'));
    expect(db.prepare('SELECT subsection_id AS s FROM transactions WHERE id = ?').get(t.id)).toEqual({ s: null });
  });
});

describe('kept in', () => {
  it('accepts only the plan pockets, clears with null, and resets on a kind change', async () => {
    const a = await owner();
    const bank = await pocket(a, 'Bank'), card = await pocket(a, 'Card', 0, { kind: 'credit' });
    const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
    const url = `/api/sections/${sec.id}/subsections`;
    expect((await post(a, url, { name: 'A', budgetMinor: 1 })).subsection.pocketId).toBeNull();
    for (const bad of [card.id, 9999, 'x', 1.5]) expect(await fields(json(a.post(url)).send({ name: 'B', budgetMinor: 1, pocketId: bad }))).toEqual({ pocketId: 'Choose a pocket.' });
    const sub = (await post(a, url, { name: 'C', budgetMinor: 1, pocketId: bank.id })).subsection;
    expect(sub.pocketId).toBe(bank.id);
    expect(await fields(json(a.patch(`/api/subsections/${sub.id}`)).send({ pocketId: card.id }))).toEqual({ pocketId: 'Choose a pocket.' });
    expect((await json(a.patch(`/api/subsections/${sub.id}`)).send({ name: 'D' }).expect(200)).body.subsection.pocketId).toBe(bank.id);
    expect((await get(a, '/api/sections')).sections[0].subsections.at(-1).pocketId).toBe(bank.id);
    await json(a.patch(`/api/pockets/${bank.id}`)).send({ kind: 'cash' }).expect(200);
    expect((await get(a, '/api/sections')).sections[0].subsections.at(-1).pocketId).toBe(bank.id);
    await json(a.patch(`/api/pockets/${bank.id}`)).send({ kind: 'credit' }).expect(200);
    expect((await get(a, '/api/sections')).sections[0].subsections.at(-1).pocketId).toBeNull();
    const other = await pocket(a, 'Other');
    await json(a.patch(`/api/subsections/${sub.id}`)).send({ pocketId: other.id }).expect(200);
    expect((await json(a.patch(`/api/subsections/${sub.id}`)).send({ pocketId: null }).expect(200)).body.subsection.pocketId).toBeNull();
  });

  it('puts every dollar in a place: what pockets should hold adds up to what they hold', async () => {
    const a = await owner();
    const boc = await pocket(a, 'BOC'), rev = await pocket(a, 'Revolut');
    const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
    const sub = async (body: object) => (await post(a, `/api/sections/${sec.id}/subsections`, body)).subsection;
    const food = await sub({ name: 'Food', budgetMinor: 20000, pocketId: rev.id });
    const fun = await sub({ name: 'Fun', budgetMinor: 10000, keep: 'none', pocketId: boc.id });
    await sub({ name: 'Save', budgetMinor: 15000, keep: 'cap', capMinor: 5000, pocketId: boc.id });
    const spend = (date: string, pocketId: number, subsectionId: number, amountMinor: number) =>
      post(a, '/api/transactions', { date, kind: 'expense', amountMinor, pocketId, subsectionId, payee: 'Shop' });
    await earn(a, boc.id, 100000, '2026-09-05');
    await spend('2026-09-06', boc.id, food.id, 4000);
    await spend('2026-09-07', boc.id, fun.id, 2500);
    await json(a.post('/api/months/2026-09/close')).send({}).expect(200);
    await earn(a, boc.id, 50000);
    await spend(D, boc.id, fun.id, 3000);
    await spend(D, rev.id, food.id, 1000); // from a pocket that holds nothing yet
    await post(a, '/api/transactions', { date: D, kind: 'transfer', amountMinor: 10000, pocketId: boc.id, toPocketId: rev.id });
    await post(a, '/api/holdings', { name: 'ETF', pocketId: rev.id, subsectionId: food.id, paidMinor: 2000 });
    const p = await plan(a);
    const sum = (k: string) => p.pockets.reduce((x: number, y: any) => x + y[k], 0);
    expect(sum('shouldMinor')).toBe(sum('holdsMinor'));
    expect(sum('holdsMinor')).toBe(100000 + 50000 - 4000 - 2500 - 3000 - 1000); // income less spending, the rest only moved
    expect(p.unplacedSubsectionIds).toEqual([]);
  });

  it('accepts only a plan pocket as the next-month pocket, and resets it on a kind change', async () => {
    const a = await owner();
    const first = await pocket(a, 'First'), second = await pocket(a, 'Second'), card = await pocket(a, 'Card', 0, { kind: 'credit' });
    expect((await get(a, '/api/me')).user.nextMonthPocketId).toBeNull();
    for (const bad of [card.id, 9999, 'x', 1.5]) expect(await fields(json(a.patch('/api/me')).send({ nextMonthPocketId: bad }))).toEqual({ nextMonthPocketId: 'Choose a pocket.' });
    await json(a.patch('/api/me')).send({ nextMonthPocketId: second.id }).expect(200);
    expect((await get(a, '/api/auth/state')).user.nextMonthPocketId).toBe(second.id);
    expect((await plan(a)).nextMonth.pocketId).toBe(second.id);
    await json(a.patch(`/api/pockets/${second.id}`)).send({ kind: 'credit' }).expect(200);
    expect((await get(a, '/api/me')).user.nextMonthPocketId).toBeNull();
    expect((await plan(a)).nextMonth.pocketId).toBe(first.id);
    await json(a.patch('/api/me')).send({ nextMonthPocketId: first.id }).expect(200);
    expect((await json(a.patch('/api/me')).send({ nextMonthPocketId: null }).expect(200)).body.user.nextMonthPocketId).toBeNull();
    expect((await json(a.patch('/api/me')).send({ homePocketId: first.id }).expect(200)).body.user).not.toHaveProperty('homePocketId');
  });
});

describe('isolation and sharing', () => {
  it("keeps one person's plan and pockets from another, and lets a sharer read it", async () => {
    const sam = await owner('sam');
    const boc = await pocket(sam, 'BOC', 1000), rev = await pocket(sam, 'Revolut');
    await budget(sam, [['Food', 500, rev.id]]);
    await json(sam.post('/api/users')).send({ username: 'kim', displayName: 'Kim', password: 'correct horse battery', baseCurrency: 'EUR' }).expect(201);
    const kim = request.agent(app);
    await json(kim.post('/api/auth/login')).send({ username: 'kim', password: 'correct horse battery' }).expect(200);
    expect(await plan(kim)).toEqual({ currency: 'EUR', pockets: [], transfers: [], nextMonth: { pocketId: null, amountMinor: 0 }, unplacedSubsectionIds: [], shortMinor: 0 });
    const sec = (await post(kim, '/api/sections', { name: 'Needs' })).section;
    expect(await fields(json(kim.post(`/api/sections/${sec.id}/subsections`)).send({ name: 'X', budgetMinor: 1, pocketId: boc.id }))).toEqual({ pocketId: 'Choose a pocket.' });

    const samId = (await get(sam, '/api/me')).user.id;
    await json(sam.post('/api/users')).send({ username: 'alex', displayName: 'Alex', password: 'correct horse battery', baseCurrency: 'EUR' }).expect(201);
    const alex = request.agent(app);
    await json(alex.post('/api/auth/login')).send({ username: 'alex', password: 'correct horse battery' }).expect(200);
    expect((await plan(alex)).pockets).toEqual([]);
    await post(sam, '/api/sharing/members', { username: 'alex' });
    await json(alex.post('/api/sharing/view')).send({ ownerId: samId }).expect(200);
    expect(moves(await plan(alex))).toEqual([[boc.id, rev.id, 500]]);
  });
});
