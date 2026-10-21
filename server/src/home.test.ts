import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14, local
let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-home-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), now: () => T0 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const PW = 'correct horse battery';
const json = (r: request.Test) => r.set('Content-Type', 'application/json');
async function owner() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username: 'owner', displayName: 'o', password: PW, baseCurrency: 'EUR' }).expect(201);
  return a;
}
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const day = (back: number) => {
  const d = new Date(T0 - back * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Two sections, a box of two sources paying 60/40, and a separate source whose rest is left over.
async function setup(a: Agent) {
  const needs = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const fun = (await post(a, '/api/sections', { name: 'Fun' })).section;
  const food = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Food', budgetMinor: 30000 })).subsection;
  const games = (await post(a, `/api/sections/${fun.id}/subsections`, { name: 'Games', budgetMinor: 10000 })).subsection;
  const job = (await post(a, '/api/sources', { name: 'Job' })).source;
  const side = (await post(a, '/api/sources', { name: 'Side', boxId: job.boxId })).source;
  const gift = (await post(a, '/api/sources', { name: 'Gift' })).source;
  await post(a, `/api/boxes/${job.boxId}/steps`, { kind: 'percent', shares: [{ sectionId: needs.id, basisPoints: 6000 }, { sectionId: fun.id, basisPoints: 4000 }] });
  await post(a, `/api/boxes/${gift.boxId}/steps`, { kind: 'amount', sectionId: fun.id, amountMinor: 2000 });
  const bank = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  const tx = (date: string, kind: string, amountMinor: number, extra: object, payee = 'x') =>
    post(a, '/api/transactions', { date, kind, amountMinor, payee, pocketId: bank.id, ...extra });
  return { needs, fun, food, games, job, side, gift, bank, tx };
}

describe('home', () => {
  it('gathers every card', async () => {
    const a = await owner();
    const { fun, food, games, job, side, tx } = await setup(a);
    await tx('2026-10-01', 'income', 40000, { subsectionId: null, sourceId: job.id });
    await tx('2026-10-02', 'income', 10000, { subsectionId: null, sourceId: side.id });
    await tx('2026-10-03', 'expense', 35000, { subsectionId: food.id }, 'Rent');
    await tx('2026-10-04', 'expense', 2000, { subsectionId: games.id }, 'Steam');
    const goal = (await post(a, `/api/sections/${fun.id}/subsections`, { name: 'Trip', kind: 'goal', capMinor: 5000, budgetMinor: 0 })).subsection;
    const home = await get(a, '/api/home');
    const budget = await get(a, '/api/budget?month=2026-10');
    expect(home.month).toBe('2026-10');
    expect(home.budget).toEqual({ budgetedMinor: budget.totals.budgetedMinor, spentMinor: 37000, leftMinor: budget.totals.availableMinor, overspent: [{ subsectionId: food.id, overMinor: 5000 }] });
    expect(home.cashflow).toEqual({ incomeMinor: 50000, spendingMinor: 37000 });
    expect(home.recent).toHaveLength(4);
    expect(home.recent[0].payee).toBe('Steam');
    expect(home.goals).toEqual([{ subsectionId: goal.id, savedMinor: 0, targetMinor: 5000, goalStatus: null }]);
    expect(home.needsSorting).toBe(0);
    expect(home.ageOfMoneyDays).toBeNull();
    expect(home.networth.series).toHaveLength(7);
    expect(home.networth.series[6]).toEqual({ month: '2026-10', minor: 50000 - 37000 });
    expect(home.networth.changeMinor).toBe(13000);
    expect(home.networth.minor).toBe(13000);
    expect(home.upcoming).toEqual([]);
  });

  it('lists the 3 largest overspent subsections', async () => {
    const a = await owner();
    const { needs, food, tx } = await setup(a);
    const subs = [food];
    for (const [i, over] of [100, 400, 300, 200].entries()) {
      const sb = i === 0 ? food : (await post(a, `/api/sections/${needs.id}/subsections`, { name: `S${i}`, budgetMinor: 0 })).subsection;
      subs.push(sb);
      await tx('2026-10-05', 'expense', over, { subsectionId: sb.id });
    }
    const home = await get(a, '/api/home');
    expect(home.budget.overspent.map((x: any) => x.overMinor)).toEqual([400, 300, 200]);
  });

  it('lists the bills expected in the next 14 days', async () => {
    const a = await owner();
    const { food, tx } = await setup(a);
    for (const d of ['2026-07-21', '2026-08-21', '2026-09-21']) await tx(d, 'expense', 1299, { subsectionId: food.id }, 'Netflix');
    const home = await get(a, '/api/home');
    expect(home.upcoming).toEqual([{ key: 'netflix', payee: 'Netflix', amountMinor: 1299, date: '2026-10-21' }]);
    await json(a.post('/api/recurring/netflix/dismiss')).expect(204);
    expect((await get(a, '/api/home')).upcoming).toEqual([]);
  });
});

describe('age of money', () => {
  const spend = async (a: Agent, f: Awaited<ReturnType<typeof setup>>, dates: string[], amount = 100) => {
    for (const d of dates) await f.tx(d, 'expense', amount, { subsectionId: f.food.id });
  };

  it('is null with fewer than 10 expenses', async () => {
    const a = await owner();
    const f = await setup(a);
    await f.tx(day(40), 'income', 100000, { subsectionId: null, sourceId: f.job.id });
    await spend(a, f, Array.from({ length: 9 }, () => day(10)));
    expect((await get(a, '/api/home')).ageOfMoneyDays).toBeNull();
  });

  it('spends the oldest money first, across pockets and opening balances, ignoring transfers and adjustments', async () => {
    const a = await owner();
    const f = await setup(a);
    const other = (await post(a, '/api/pockets', { name: 'Cash', kind: 'cash', openingBalanceMinor: 500 })).pocket;
    // The first transaction is 40 days ago, so the two opening balances are 41 days old: 500 in Cash (and 0 in Bank).
    await f.tx(day(40), 'income', 100000, { subsectionId: null, sourceId: f.job.id });
    await f.tx(day(35), 'transfer', 7000, { subsectionId: null, toPocketId: other.id, toAmountMinor: 7000 });
    // 5 expenses of 100 take the 500 from day 41; then 5 take from the 40-day-old income.
    await spend(a, f, Array.from({ length: 5 }, () => day(10)));
    await spend(a, f, Array.from({ length: 5 }, () => day(0)));
    const home = await get(a, '/api/home');
    // The last 10 expenses: 5 waited 31 days (41 - 10), 5 waited 40 days.
    expect(home.ageOfMoneyDays).toBe(Math.floor((5 * 100 * 31 + 5 * 100 * 40) / 1000));
  });

  it('is null when the money runs dry, and weights by amount', async () => {
    const a = await owner();
    const f = await setup(a);
    await f.tx(day(30), 'income', 1000, { subsectionId: null, sourceId: f.job.id });
    await spend(a, f, Array.from({ length: 10 }, () => day(10)), 100);
    expect((await get(a, '/api/home')).ageOfMoneyDays).toBe(20); // exactly 1000 for 10 x 100
    await spend(a, f, [day(5)], 1);
    expect((await get(a, '/api/home')).ageOfMoneyDays).toBeNull();
  });

  it('counts a split expense once', async () => {
    const a = await owner();
    const f = await setup(a);
    await f.tx(day(30), 'income', 100000, { subsectionId: null, sourceId: f.job.id });
    await spend(a, f, Array.from({ length: 9 }, () => day(10)));
    await post(a, '/api/transactions', {
      date: day(10), kind: 'expense', amountMinor: 200, payee: 's', pocketId: f.bank.id,
      splits: [{ subsectionId: f.food.id, amountMinor: 100 }, { subsectionId: f.games.id, amountMinor: 100 }],
    });
    expect((await get(a, '/api/home')).ageOfMoneyDays).toBe(20);
  });
});

describe('where the money went', () => {
  it('adds up for a single source and a merged box', async () => {
    const a = await owner();
    const { needs, fun, food, games, job, side, gift, tx } = await setup(a);
    await tx('2026-10-01', 'income', 40000, { subsectionId: null, sourceId: job.id });
    await tx('2026-10-02', 'income', 10000, { subsectionId: null, sourceId: side.id });
    await tx('2026-10-02', 'income', 5000, { subsectionId: null, sourceId: gift.id });
    await tx('2026-10-03', 'expense', 10000, { subsectionId: food.id });
    await tx('2026-10-04', 'expense', 2000, { subsectionId: games.id });
    const { nodes, links } = await get(a, '/api/reports/flow?month=2026-10');
    const label = (id: string) => nodes.find((n: any) => n.id === id).label;
    const out = (id: string) => links.filter((l: any) => l.from === id).reduce((n: number, l: any) => n + l.minor, 0);
    const into = (id: string) => links.filter((l: any) => l.to === id).reduce((n: number, l: any) => n + l.minor, 0);
    expect(links.every((l: any) => l.minor > 0)).toBe(true);
    const merged = nodes.find((n: any) => n.label === 'Job and Side');
    expect(merged.kind).toBe('source');
    expect(out(merged.id)).toBe(50000);
    expect(into(`section-${needs.id}`)).toBe(30000);
    expect(into(`section-${fun.id}`)).toBe(20000 + 2000);
    expect(label(`section-${needs.id}`)).toBe('Needs');
    expect(out(nodes.find((n: any) => n.label === 'Gift').id)).toBe(5000);
    // Gift's 5000: 2000 to Fun, 3000 left over.
    expect(links).toContainEqual({ from: expect.stringMatching(/^box-/), to: 'left-over', minor: 3000 });
    for (const sec of [needs, fun]) expect(out(`section-${sec.id}`)).toBe(into(`section-${sec.id}`));
    expect(links).toContainEqual({ from: `section-${needs.id}`, to: `subsection-${food.id}`, minor: 10000 });
    expect(links).toContainEqual({ from: `section-${needs.id}`, to: 'kept', minor: 20000 });
    expect(links).toContainEqual({ from: `section-${fun.id}`, to: 'kept', minor: 20000 });
  });

  it('balances every section across a close', async () => {
    const a = await owner();
    const { needs, fun, job, tx } = await setup(a);
    await json(a.put(`/api/sections/${fun.id}/rest`)).send({ shares: [{ sectionId: fun.id, basisPoints: 10000 }], overspent: 'income' }).expect(200);
    await tx('2026-09-01', 'income', 50000, { subsectionId: null, sourceId: job.id });
    await json(a.post('/api/months/2026-09/close')).expect(200);
    await tx('2026-10-01', 'income', 10000, { subsectionId: null, sourceId: job.id });
    const { nodes, links } = await get(a, '/api/reports/flow?month=2026-10');
    expect(nodes).toContainEqual({ id: 'carried', label: 'From last month', kind: 'other' });
    expect(links.some((l: any) => l.from === 'carried' && l.to === `section-${fun.id}`)).toBe(true);
    for (const sec of [needs, fun]) {
      const id = `section-${sec.id}`;
      const sum = (k: 'from' | 'to') => links.filter((l: any) => l[k] === id).reduce((n: number, l: any) => n + l.minor, 0);
      expect(sum('to')).toBe(sum('from'));
    }
  });

  it('answers 400 on a bad month and is empty for a quiet one', async () => {
    const a = await owner();
    await setup(a);
    const bad = await a.get('/api/reports/flow?month=2026-13').expect(400);
    expect(JSON.stringify(bad.body)).toContain('month');
    expect(await get(a, '/api/reports/flow?month=2020-01')).toEqual({ nodes: [], links: [] });
    expect((await get(a, '/api/reports/flow')).links).toEqual([]);
  });
});

describe('top payees', () => {
  it('groups by payee key, shows the latest spelling and counts only sorted expenses', async () => {
    const a = await owner();
    const { food, tx } = await setup(a);
    await tx('2026-10-01', 'expense', 500, { subsectionId: food.id }, 'Lidl 123');
    await tx('2026-10-05', 'expense', 700, { subsectionId: food.id }, 'LIDL Berlin');
    await tx('2026-10-05', 'expense', 700, { subsectionId: food.id }, 'lidl');
    await tx('2026-09-05', 'expense', 9000, { subsectionId: food.id }, 'Old');
    await tx('2026-10-06', 'expense', 100, { subsectionId: food.id }, 'Kiosk');
    const r = await get(a, '/api/reports?months=3');
    expect(r.payees).toEqual([
      { payee: 'Old', minor: 9000, count: 1 },
      { payee: 'lidl', minor: 1200, count: 2 },
      { payee: 'LIDL Berlin', minor: 700, count: 1 },
      { payee: 'Kiosk', minor: 100, count: 1 },
    ]);
    expect((await get(a, '/api/reports?months=3')).payees.length).toBeLessThanOrEqual(10);
  });
});

describe('isolation', () => {
  it('shows one person nothing of another', async () => {
    const a = await owner();
    const { food, tx } = await setup(a);
    await tx('2026-10-01', 'expense', 500, { subsectionId: food.id }, 'Lidl');
    await json(a.post('/api/users')).send({ username: 'second', displayName: 'p', password: PW, baseCurrency: 'EUR' }).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'second', password: PW }).expect(200);
    const home = await get(b, '/api/home');
    expect(home.recent).toEqual([]);
    expect(home.cashflow).toEqual({ incomeMinor: 0, spendingMinor: 0 });
    expect(home.goals).toEqual([]);
    expect(home.ageOfMoneyDays).toBeNull();
    expect(await get(b, '/api/reports/flow?month=2026-10')).toEqual({ nodes: [], links: [] });
    expect((await get(b, '/api/reports?months=3')).payees).toEqual([]);
  });
});
