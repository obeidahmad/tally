import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';
import { stepDate } from './recurring';

let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;
const PW = 'correct horse battery';
let sub = 0;
const NOW = new Date(2026, 9, 14, 12).getTime();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-rec-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), now: () => NOW });
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
  const p = (await json(a.post('/api/pockets')).send({ name: 'Bank', kind: 'bank', openingBalanceMinor: 0 }).expect(201)).body.pocket;
  const sec = (await json(a.post('/api/sections')).send({ name: 'Needs' }).expect(201)).body.section;
  sub = (await json(a.post(`/api/sections/${sec.id}/subsections`)).send({ name: 'Bills', budgetMinor: 1000 }).expect(201)).body.subsection.id;
  return { a, pocket: p.id as number };
}
const day = (back: number) => {
  const d = new Date(NOW - back * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Pays `payee` on each day-offset (days before today) with the given amount(s).
async function pay(a: Agent, pocketId: number, payee: string, backs: number[], amounts: number | number[] = 1299) {
  for (const [i, back] of backs.entries())
    await json(a.post('/api/transactions')).send({
      date: day(back), kind: 'expense', amountMinor: Array.isArray(amounts) ? amounts[i] : amounts, pocketId, subsectionId: sub, payee,
    }).expect(201);
}
const list = async (a: Agent) => (await a.get('/api/recurring').expect(200)).body;

describe('detection', () => {
  it('finds a monthly payee, keys by payee, and gives next date and totals', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'NETFLIX.COM 4471', [90]);
    await pay(a, pocket, 'Netflix.com', [60, 30]);
    const b = await list(a);
    expect(b.items).toHaveLength(1);
    expect(b.items[0]).toMatchObject({
      key: 'netflixcom', payee: 'Netflix.com', cadence: 'monthly', amountMinor: 1299, lastDate: day(30), nextDate: day(0), count: 3, subsectionId: sub, monthlyMinor: 1299,
    });
    expect(b.monthlyMinor).toBe(1299);
    expect(b.dismissed).toEqual([]);
  });
  it('finds a weekly payee (x52/12)', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Gym', [21, 14, 7], 1000);
    await pay(a, pocket, 'Domain', [30, 0], 1200); // two monthly only
    const b = await list(a);
    expect(b.items.map((x: any) => x.key)).toEqual(['gym']);
    expect(b.items[0]).toMatchObject({ cadence: 'weekly', nextDate: day(0), monthlyMinor: 4333 });
    expect(b.monthlyMinor).toBe(4333);
  });
  it('finds a yearly payee from two payments, but not from one', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Annual', [380, 10], 12000);
    await pay(a, pocket, 'Single', [10], 12000);
    const b = await list(a);
    expect(b.items.map((x: any) => x.key)).toEqual(['annual']);
    expect(b.items[0]).toMatchObject({ cadence: 'yearly', count: 2, nextDate: '2027-10-04', monthlyMinor: 1000 });
  });
  it('does not detect two weekly or monthly payments', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Two', [30, 0]);
    expect((await list(a)).items).toEqual([]);
  });
  it('does not detect a gap outside the bands, an amount outside 15%, two payments, or mixed gaps', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Edge', [70, 35, 0]); // 35 and 35: inside the band
    await pay(a, pocket, 'Wide', [100, 63, 27]); // 37, 36: outside
    await pay(a, pocket, 'Amount', [60, 30, 0], [1000, 1000, 1600]); // a 60% rise: not a subscription
    await pay(a, pocket, 'Two', [30, 0]);
    await pay(a, pocket, 'Mixed', [37, 30, 0]); // 7 then 30
    const keys = (await list(a)).items.map((x: any) => x.key);
    expect(keys).toEqual(['edge'])
  });
  it('keeps the earlier payments within 15% of their median and counts the latest amount', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Power', [90, 60, 30, 0], [10000, 11000, 10500, 11400]);
    await pay(a, pocket, 'Wild', [90, 60, 30, 0], [10000, 13000, 10000, 10000]);
    const items = (await list(a)).items;
    expect(items.map((x: any) => x.key)).toEqual(['power']);
    expect(items[0]).toMatchObject({ amountMinor: 11400, monthlyMinor: 11400 });
  });
  it('detects a rise of 20% and a drop of 15%, not a rise of 60% or a drop of 16%', async () => {
    const { a, pocket } = await owner();
    for (const [name, last] of [['Up', 1200], ['Down', 850], ['Toohigh', 1600], ['Toolow', 840]] as const)
      await pay(a, pocket, name, [60, 30, 0], [1000, 1000, last]);
    expect((await list(a)).items.map((x: any) => x.key).sort()).toEqual(['down', 'up']);
  });
  it('ignores empty keys and expenses older than 800 days', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, '1234 56', [60, 30, 0]);
    await pay(a, pocket, 'Old', [860, 830, 800]);
    expect((await list(a)).items).toEqual([]);
  });
});

describe('dismiss', () => {
  it('moves an item to dismissed, out of the total, and back', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Netflix', [60, 30, 0]);
    await pay(a, pocket, 'Gym', [14, 7, 0], 1000);
    await json(a.post('/api/recurring/netflix/dismiss')).expect(204);
    let b = await list(a);
    expect(b.items.map((x: any) => x.key)).toEqual(['gym']);
    expect(b.dismissed.map((x: any) => x.key)).toEqual(['netflix']);
    expect(b.monthlyMinor).toBe(b.items[0].monthlyMinor);
    await json(a.delete('/api/recurring/netflix/dismiss')).expect(204);
    b = await list(a);
    expect(b.items).toHaveLength(2);
    expect(b.dismissed).toEqual([]);
  });
  it('answers 404 for an unknown key', async () => {
    const { a } = await owner();
    await json(a.post('/api/recurring/nothing/dismiss')).expect(404);
    await json(a.delete('/api/recurring/nothing/dismiss')).expect(404);
  });
  it('is per person and needs a session', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Netflix', [60, 30, 0]);
    await json(a.post('/api/users')).send(acct('other')).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'other', password: PW }).expect(200);
    expect((await list(b)).items).toEqual([]);
    await json(b.post('/api/recurring/netflix/dismiss')).expect(404);
    await json(a.post('/api/recurring/netflix/dismiss')).expect(204);
    expect((await list(b)).dismissed).toEqual([]);
    await request(app).get('/api/recurring').expect(401);
  });
});

describe('stepping', () => {
  it('keeps the day of the month, clamped, without drifting', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Rent', [106, 75, 44]); // Jun 30, Jul 31, Aug 31
    expect((await list(a)).items[0].nextDate).toBe('2026-09-30');
    const cal = async (m: string) => (await a.get('/api/recurring/calendar?month=' + m).expect(200)).body.days.flatMap((d: any) => d.items.map(() => d.date));
    expect(await cal('2026-10')).toEqual(['2026-10-31']);
    expect(await cal('2026-11')).toEqual(['2026-11-30']);
    expect(await cal('2026-12')).toEqual(['2026-12-31']);
  });
  it('steps weekly by 7 days and yearly by a calendar year', () => {
    expect(stepDate('2026-10-14', 'weekly', 3)).toBe('2026-11-04');
    expect(stepDate('2027-01-31', 'monthly', 1)).toBe('2027-02-28');
    expect(stepDate('2024-01-31', 'monthly', 1)).toBe('2024-02-29');
    expect(stepDate('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(stepDate('2024-02-29', 'yearly', 4)).toBe('2028-02-29');
  });
});

describe('status and price change', () => {
  const statusOf = async (a: Agent) => Object.fromEntries((await list(a)).items.map((x: any) => [x.key, x.status]));
  it('monthly: paid in the calendar month, due up to 7 days ahead, missed after 3 days late', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Thismonth', [73, 43, 13]); // Oct 1
    await pay(a, pocket, 'Lastmonth', [74, 44, 14]); // Sep 30, next Oct 30
    await pay(a, pocket, 'Late', [94, 64, 34]); // next Oct 10: 4 days ago
    await pay(a, pocket, 'Barely', [93, 63, 33]); // next Oct 11: 3 days ago
    await pay(a, pocket, 'Seven', [83, 53, 23]); // next Oct 21: in 7 days
    await pay(a, pocket, 'Eight', [82, 52, 22]); // next Oct 22
    expect(await statusOf(a)).toEqual({ thismonth: 'paid', lastmonth: 'upcoming', late: 'missed', barely: 'due', seven: 'due', eight: 'upcoming' });
  });
  it('weekly: the last 7 days; yearly: the last 30 days', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Wpaid', [20, 13, 6]);
    await pay(a, pocket, 'Wdue', [21, 14, 7]);
    await pay(a, pocket, 'Ypaid', [394, 29]);
    await pay(a, pocket, 'Yup', [395, 30]);
    expect(await statusOf(a)).toEqual({ wpaid: 'paid', wdue: 'due', ypaid: 'paid', yup: 'upcoming' });
  });
  it('reports a price change above 2% of the earlier median, with the latest date', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Flat', [60, 30, 0], [1000, 1000, 1020]);
    await pay(a, pocket, 'Rise', [60, 30, 0], [1000, 1000, 1021]);
    await pay(a, pocket, 'Netflix', [60, 30, 0], [1299, 1299, 1599]);
    const items = Object.fromEntries((await list(a)).items.map((x: any) => [x.key, x]));
    expect(items.flat.priceChange).toBeNull();
    expect(items.rise.priceChange).toEqual({ fromMinor: 1000, toMinor: 1021, date: day(0) });
    expect(items.netflix).toMatchObject({ amountMinor: 1599, monthlyMinor: 1599, priceChange: { fromMinor: 1299, toMinor: 1599, date: day(0) } });
  });
});

describe('calendar', () => {
  const cal = async (a: Agent, month: string) => (await a.get('/api/recurring/calendar?month=' + month).expect(200)).body;
  const items = (b: any) => b.days.flatMap((d: any) => d.items.map((i: any) => ({ date: d.date, ...i })));
  it('shows the actual payment this month and the expected one next month', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Netflix', [60, 30, 0]); // Aug 15, Sep 14, Oct 14; next Nov 13
    const oct = await cal(a, '2026-10');
    expect(oct.days).toHaveLength(31);
    expect(items(oct)).toEqual([{ date: '2026-10-14', key: 'netflix', payee: 'Netflix', amountMinor: 1299, subsectionId: sub, paid: true }]);
    expect(items(await cal(a, '2026-11'))).toEqual([{ date: '2026-11-14', key: 'netflix', payee: 'Netflix', amountMinor: 1299, subsectionId: sub, paid: false }]);
    expect(items(await cal(a, '2026-09')).map((i: any) => [i.date, i.paid])).toEqual([['2026-09-14', true]]); // a past month: actual only
    expect(items(await cal(a, '2026-12')).map((i: any) => i.date)).toEqual(['2026-12-14']); // the same day of each month
  });
  it('steps weekly bills on from the last payment', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Gym', [14, 7, 0]);
    const dates = items(await cal(a, '2026-10')).filter((i: any) => i.key === 'gym').map((i: any) => [i.date, i.paid]);
    expect(dates).toEqual([['2026-10-07', true], ['2026-10-14', true], ['2026-10-21', false], ['2026-10-28', false]]);
  });
  it('leaves out dismissed groups, rejects a bad month, is per person', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Netflix', [60, 30, 0]);
    await json(a.post('/api/recurring/netflix/dismiss')).expect(204);
    expect(items(await cal(a, '2026-10'))).toEqual([]);
    await json(a.delete('/api/recurring/netflix/dismiss')).expect(204);
    await a.get('/api/recurring/calendar?month=2026-13').expect(400);
    await a.get('/api/recurring/calendar').expect(400);
    await json(a.post('/api/users')).send(acct('other')).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'other', password: PW }).expect(200);
    expect(items(await cal(b, '2026-10'))).toEqual([]);
    await request(app).get('/api/recurring/calendar?month=2026-10').expect(401);
  });
});
