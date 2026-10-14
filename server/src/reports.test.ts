import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const FIXTURE = path.join(__dirname, '..', 'test', 'rates.xml'); // 1 EUR = 1.0860 USD on 2026-10-13, 1.1000 on 10-09 and before
const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14, local
let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-reports-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: FIXTURE, now: () => T0 });
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
const CSV = `Datum;Beschreibung;Betrag;Referenz
05.10.2026;LIDL Berlin;-12,50;card
06.10.2026;Employer;"1.500,00";salary
`;
const MAP = { date: 0, dateFormat: 'DD.MM.YYYY', amount: 2, payee: 1, note: 3, decimal: ',' };

async function fixture(a: Agent) {
  const needs = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const fun = (await post(a, '/api/sections', { name: 'Fun' })).section;
  const food = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Food', budgetMinor: 50000 })).subsection;
  const games = (await post(a, `/api/sections/${fun.id}/subsections`, { name: 'Games', budgetMinor: 50000 })).subsection;
  const job = (await post(a, '/api/sources', { name: 'Job' })).source;
  const bank = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 })).pocket;
  const broker = (await post(a, '/api/pockets', { name: 'Broker', kind: 'broker', currency: 'USD', openingBalanceMinor: 110000 })).pocket;
  const tx = (date: string, kind: string, amountMinor: number, extra: object) => post(a, '/api/transactions', { date, kind, amountMinor, payee: 'x', ...extra });
  await tx('2026-08-10', 'income', 300000, { pocketId: bank.id, subsectionId: null, sourceId: job.id });
  await tx('2026-08-12', 'expense', 20000, { pocketId: bank.id, subsectionId: food.id });
  await tx('2026-09-05', 'expense', 5500, { pocketId: broker.id, subsectionId: games.id }); // 5,000 EUR
  await tx('2026-09-06', 'transfer', 10000, { pocketId: bank.id, toPocketId: broker.id, toAmountMinor: 11000, subsectionId: food.id });
  await tx('2026-09-20', 'expense', 3000, { pocketId: bank.id, subsectionId: food.id });
  await tx('2026-10-02', 'income', 50000, { pocketId: bank.id, subsectionId: null, sourceId: job.id });
  await json(a.post('/api/imports')).send({ pocketId: bank.id, text: CSV, mapping: MAP }).expect(201);
  await post(a, '/api/holdings', { name: 'ETF', pocketId: broker.id, subsectionId: games.id, paidMinor: 50000 });
  return { needs, fun, bank, broker };
}

describe('reports', () => {
  it('reports spending, cash flow and net worth by month', async () => {
    const a = await owner();
    const { needs, fun, bank, broker } = await fixture(a);
    const r = await get(a, '/api/reports?months=3');
    expect(r.currency).toBe('EUR');
    expect(r.months).toEqual(['2026-08', '2026-09', '2026-10']);
    const sec = (n: number, f: number) => [{ sectionId: needs.id, minor: n }, { sectionId: fun.id, minor: f }];
    // The transfer and the unsorted import change no spending or cash flow figure.
    expect(r.spending).toEqual([
      { month: '2026-08', bySection: sec(20000, 0), totalMinor: 20000 },
      { month: '2026-09', bySection: sec(3000, 5000), totalMinor: 8000 },
      { month: '2026-10', bySection: sec(0, 0), totalMinor: 0 },
    ]);
    expect(r.cashflow).toEqual([
      { month: '2026-08', incomeMinor: 300000, spendingMinor: 20000 },
      { month: '2026-09', incomeMinor: 0, spendingMinor: 8000 },
      { month: '2026-10', incomeMinor: 50000, spendingMinor: 0 },
    ]);
    // Past months: USD at the rate of the day (1.1000, the earliest stored); the held ETF is not subtracted.
    expect(r.networth.map((x: any) => x.minor).slice(0, 2)).toEqual([380000 + 100000, 367000 + 105000]);
    // This month: today's values, unsorted imports included, as /api/networth.
    const nw = await get(a, '/api/networth');
    expect(r.networth[2].minor).toBe(nw.totalMinor);
    expect((await get(a, '/api/pockets')).pockets.find((p: any) => p.id === bank.id).balanceMinor).toBe(367000 + 50000 + 150000 - 1250);
    expect(broker.id).toBeGreaterThan(0);
    expect(r.missingRates).toEqual([]);
  });

  it('lists a currency with no rate and leaves it out of the month', async () => {
    const a = await owner();
    await fixture(a);
    db.prepare("INSERT INTO pockets (user_id, name, kind, emoji, currency, opening_balance_minor) VALUES (1, 'Odd', 'bank', 'x', 'XYZ', 1000)").run();
    const r = await get(a, '/api/reports?months=3');
    expect(r.missingRates).toEqual(['XYZ']);
    expect(r.networth[0].minor).toBe(480000);
  });

  it('takes 3, 6, 12 or 24 months, 12 by default', async () => {
    const a = await owner();
    expect((await get(a, '/api/reports')).months).toHaveLength(12);
    expect((await get(a, '/api/reports')).months.at(-1)).toBe('2026-10');
    expect((await get(a, '/api/reports?months=24')).months[0]).toBe('2024-11');
    for (const m of ['0', '5', '12.0', '', 'x', '-3'])
      expect((await a.get(`/api/reports?months=${m}`).expect(400)).body.error.fields).toEqual({ months: 'Choose 3, 6, 12 or 24 months.' });
  });

  it('shows one person nothing of another', async () => {
    const a = await owner();
    await fixture(a);
    await json(a.post('/api/users')).send({ username: 'second', displayName: 'p', password: PW, baseCurrency: 'EUR' }).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'second', password: PW }).expect(200);
    const r = await get(b, '/api/reports?months=3');
    expect(r.spending.map((x: any) => [x.bySection, x.totalMinor])).toEqual([[[], 0], [[], 0], [[], 0]]);
    expect(r.cashflow.every((x: any) => x.incomeMinor === 0 && x.spendingMinor === 0)).toBe(true);
    expect(r.networth.map((x: any) => x.minor)).toEqual([0, 0, 0]);
  });

  it('needs a signed-in person', async () => {
    await request(app).get('/api/reports').expect(401);
  });
});
