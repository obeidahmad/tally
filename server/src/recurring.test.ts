import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

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
    expect(b.items[0]).toMatchObject({ cadence: 'yearly', count: 2, nextDate: day(-360), monthlyMinor: 1000 });
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
    await pay(a, pocket, 'Amount', [60, 30, 0], [1000, 1000, 1200]);
    await pay(a, pocket, 'Two', [30, 0]);
    await pay(a, pocket, 'Mixed', [37, 30, 0]); // 7 then 30
    const keys = (await list(a)).items.map((x: any) => x.key);
    expect(keys).toEqual(['edge'])
  });
  it('allows amounts within 15% of the median and uses the median', async () => {
    const { a, pocket } = await owner();
    await pay(a, pocket, 'Power', [60, 30, 0], [10000, 11000, 11400]);
    const it = (await list(a)).items[0];
    expect(it.amountMinor).toBe(11000);
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
