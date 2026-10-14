import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const FIXTURE = path.join(__dirname, '..', 'test', 'rates.xml');
const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14, local
const HOUR = 3600_000;
let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let file: string;
type Agent = ReturnType<typeof request.agent>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-cur-'));
  db = openDb(path.join(dir, 'tally.db'));
  file = path.join(dir, 'rates.xml');
  fs.copyFileSync(FIXTURE, file);
  clock = T0;
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: file, now: () => clock });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const PW = 'correct horse battery';
const json = (r: request.Test) => r.set('Content-Type', 'application/json');
async function owner(baseCurrency = 'EUR') {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username: 'owner', displayName: 'o', password: PW, baseCurrency }).expect(201);
  return a;
}
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const bad = async (r: request.Test, status: number) => {
  const res = await r;
  expect(res.status).toBe(status);
  return res.body.error;
};
const pocket = async (a: Agent, name: string, currency?: string, openingBalanceMinor = 0) =>
  (await post(a, '/api/pockets', { name, kind: 'bank', openingBalanceMinor, ...(currency && { currency }) })).pocket;

async function world() {
  const a = await owner();
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const food = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 30000 })).subsection;
  const job = (await post(a, '/api/sources', { name: 'Job' })).source;
  const eur = await pocket(a, 'Bank', undefined, 100000);
  const usd = await pocket(a, 'Revolut USD', 'USD', 50000);
  return { a, sec, food, job, eur, usd };
}
const expense = (pocketId: number, subsectionId: number, over: object = {}) =>
  ({ date: '2026-10-13', kind: 'expense', amountMinor: 1086, pocketId, subsectionId, payee: 'Shop', ...over });
const transfer = (pocketId: number, toPocketId: number, over: object = {}) =>
  ({ date: '2026-10-13', kind: 'transfer', amountMinor: 8500, pocketId, toPocketId, ...over });
const rateOfUsd = async (a: Agent) => (await get(a, '/api/rates')).currencies.at(-1).rate;

describe('reference rates', () => {
  it('answers the rate of the base currency in every offered currency, with the date it comes from', async () => {
    const a = await owner();
    const r = await get(a, '/api/rates');
    expect(r).toEqual({
      date: '2026-10-13', base: 'EUR',
      currencies: [{ currency: 'EUR', rate: '1.0000' }, { currency: 'CHF', rate: '2.0000' }, { currency: 'GBP', rate: '0.8650' }, { currency: 'USD', rate: '1.0860' }],
    });
  });

  it('puts a base currency that is not the euro first, and works through the euro', async () => {
    const a = await owner('USD');
    const r = await get(a, '/api/rates');
    expect(r.currencies.map((c: any) => c.currency)).toEqual(['USD', 'CHF', 'EUR', 'GBP']);
    expect(r.currencies.find((c: any) => c.currency === 'EUR').rate).toBe('0.9208');
    expect(r.currencies.find((c: any) => c.currency === 'GBP').rate).toBe('0.7965');
  });

  it('falls back to the latest date before, else the earliest after', async () => {
    const a = await owner();
    const before = await get(a, '/api/rates?date=2026-10-10');
    expect(before.date).toBe('2026-10-09');
    expect(before.currencies.at(-1)).toEqual({ currency: 'USD', rate: '1.1000' });
    expect((await get(a, '/api/rates?date=2026-09-01')).date).toBe('2026-10-09');
    expect((await get(a, '/api/rates?date=2027-01-01')).date).toBe('2026-10-13');
    expect((await bad(a.get('/api/rates?date=nope'), 400)).fields).toHaveProperty('date');
  });

  it('keeps its rates when a read fails, and retries at most every 10 minutes', async () => {
    const a = await owner();
    expect(await rateOfUsd(a)).toBe('1.0860');
    clock += 7 * HOUR;
    fs.writeFileSync(file, 'not rates');
    expect(await rateOfUsd(a)).toBe('1.0860');
    fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8').replace('1.0860', '1.2000'));
    clock += 5 * 60_000;
    expect(await rateOfUsd(a)).toBe('1.0860');
    clock += 6 * 60_000;
    expect(await rateOfUsd(a)).toBe('1.2000');
  });

  it('does not read again within 6 hours', async () => {
    const a = await owner();
    expect(await rateOfUsd(a)).toBe('1.0860');
    fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8').replace('1.0860', '1.2000'));
    clock += 5 * HOUR;
    expect(await rateOfUsd(a)).toBe('1.0860');
  });

  it('converts to the nearest cent, halves away from zero', async () => {
    const { a, food } = await world();
    const chf = await pocket(a, 'Swiss', 'CHF', -5);
    expect(chf.baseBalanceMinor).toBe(-3); // -2.5
    expect((await post(a, '/api/transactions', expense(chf.id, food.id, { amountMinor: 5 }))).transaction.baseAmountMinor).toBe(3); // 2.5
    expect((await post(a, '/api/transactions', expense(chf.id, food.id, { amountMinor: 4 }))).transaction.baseAmountMinor).toBe(2);
    expect((await post(a, '/api/transactions', expense(chf.id, food.id, { amountMinor: 1086 }))).transaction.baseAmountMinor).toBe(543);
  });

  it('answers 409 no_rate when a needed rate is missing', async () => {
    const { a, food, usd } = await world();
    db.prepare("DELETE FROM rates WHERE currency = 'USD'").run();
    const e = await bad(json(a.post('/api/transactions')).send(expense(usd.id, food.id)), 409);
    expect(e).toMatchObject({ code: 'no_rate', message: 'There is no exchange rate for USD yet.' });
  });
});

describe('pockets', () => {
  it('defaults to the base currency and checks the currency', async () => {
    const a = await owner();
    expect((await pocket(a, 'Bank')).currency).toBe('EUR');
    expect(await pocket(a, 'Dollars', 'USD')).toMatchObject({ currency: 'USD', balanceMinor: 0, baseBalanceMinor: 0 });
    for (const currency of ['JPY', 'XXX', 'usd', 5]) {
      const e = await bad(json(a.post('/api/pockets')).send({ name: 'x', kind: 'bank', openingBalanceMinor: 0, currency }), 400);
      expect(e.fields).toEqual({ currency: 'Choose a currency.' });
    }
  });

  it("shows the balance in its own currency and in the base currency at today's rate", async () => {
    const { a, usd } = await world();
    expect(usd).toMatchObject({ balanceMinor: 50000, baseBalanceMinor: 46041 });
    expect((await get(a, '/api/pockets')).pockets.map((p: any) => p.baseBalanceMinor)).toEqual([100000, 46041]);
  });

  it('has a null base balance with no rate', async () => {
    const { a, usd } = await world();
    db.prepare("DELETE FROM rates WHERE currency = 'USD'").run();
    expect((await get(a, '/api/pockets')).pockets[1]).toMatchObject({ id: usd.id, balanceMinor: 50000, baseBalanceMinor: null });
  });

  it('changes currency only while it has no transaction', async () => {
    const { a, food, eur, usd } = await world();
    const patch = (id: number, body: object) => json(a.patch(`/api/pockets/${id}`)).send(body);
    expect((await patch(usd.id, { currency: 'GBP' }).expect(200)).body.pocket.currency).toBe('GBP');
    await post(a, '/api/transactions', expense(eur.id, food.id));
    const e = await bad(patch(eur.id, { currency: 'GBP' }), 400);
    expect(e.fields).toEqual({ currency: 'A pocket with transactions keeps its currency.' });
    await patch(eur.id, { name: 'Again', currency: 'EUR' }).expect(200);
    expect((await bad(patch(usd.id, { currency: 'JPY' }), 400)).fields).toEqual({ currency: 'Choose a currency.' });
  });

  it('counts a transfer as a transaction for the currency rule and for deleting', async () => {
    const { a, eur, usd } = await world();
    const flags = async () => (await get(a, '/api/pockets')).pockets.map((p: any) => p.hasTransactions);
    expect(await flags()).toEqual([false, false]);
    await post(a, '/api/transactions', transfer(eur.id, usd.id, { toAmountMinor: 9231 }));
    expect(await flags()).toEqual([true, true]);
    expect((await bad(json(a.patch(`/api/pockets/${usd.id}`)).send({ currency: 'GBP' }), 400)).fields.currency).toMatch(/keeps its currency/);
    expect((await bad(json(a.delete(`/api/pockets/${usd.id}`)), 409)).code).toBe('in_use');
  });
});

describe('transactions in another currency', () => {
  it("stores the base amount at the date's rate and works it out again when date, amount or pocket changes", async () => {
    const { a, food, eur, usd } = await world();
    const t = (await post(a, '/api/transactions', expense(usd.id, food.id))).transaction;
    expect(t).toMatchObject({ amountMinor: 1086, baseAmountMinor: 1000, toPocketId: null, toAmountMinor: null });
    const patch = async (body: object) => (await json(a.patch(`/api/transactions/${t.id}`)).send(body).expect(200)).body.transaction;
    expect((await patch({ date: '2026-10-10' })).baseAmountMinor).toBe(987); // 1086 / 1.1000
    expect((await patch({ amountMinor: 2200 })).baseAmountMinor).toBe(2000);
    db.prepare("DELETE FROM rates WHERE currency = 'USD'").run();
    expect((await patch({ note: 'x' })).baseAmountMinor).toBe(2000); // nothing relevant changed
    expect((await patch({ pocketId: eur.id })).baseAmountMinor).toBe(2200);
  });

  it('counts at the base amount in the budget and the pipeline', async () => {
    const { a, food, job, usd } = await world();
    await post(a, '/api/transactions', expense(usd.id, food.id));
    await post(a, '/api/transactions', { date: '2026-10-13', kind: 'income', amountMinor: 2172, pocketId: usd.id, subsectionId: null, sourceId: job.id });
    const b = await get(a, '/api/budget?month=2026-10');
    expect(b.totals).toMatchObject({ spentMinor: 1000, incomeMinor: 2000 });
    expect(b.sections[0].subsections[0]).toMatchObject({ spentMinor: 1000 });
    expect((await get(a, '/api/pipeline?month=2026-10')).boxes[0].incomeMinor).toBe(2000);
    expect((await get(a, '/api/pockets')).pockets[1].balanceMinor).toBe(50000 - 1086 + 2172);
  });
});

describe('transfers', () => {
  it('moves money between pockets of one currency and changes no budget figure', async () => {
    const { a, eur } = await world();
    const bank2 = await pocket(a, 'Savings', 'EUR', 0);
    const before = await get(a, '/api/budget?month=2026-10');
    const t = (await post(a, '/api/transactions', transfer(eur.id, bank2.id, { note: 'rainy day' }))).transaction;
    expect(t).toMatchObject({
      kind: 'transfer', amountMinor: 8500, baseAmountMinor: 8500, pocketId: eur.id, toPocketId: bank2.id, toAmountMinor: 8500,
      subsectionId: null, sourceId: null, payee: '', note: 'rainy day', source: 'manual',
    });
    const [p1, , p2] = (await get(a, '/api/pockets')).pockets;
    expect([p1.balanceMinor, p2.balanceMinor]).toEqual([100000 - 8500, 8500]);
    expect(await get(a, '/api/budget?month=2026-10')).toEqual(before);
    expect((await get(a, '/api/pipeline?month=2026-10')).leftOverMinor).toBe(0);
  });

  it('converts across two currencies at the amount that arrived and moves both balances', async () => {
    const { a, food, eur, usd } = await world();
    const t = (await post(a, '/api/transactions', transfer(eur.id, usd.id, { toAmountMinor: 9231, subsectionId: food.id }))).transaction;
    expect(t).toMatchObject({ amountMinor: 8500, toAmountMinor: 9231, baseAmountMinor: 8500, subsectionId: food.id });
    const back = (await post(a, '/api/transactions', transfer(usd.id, eur.id, { toAmountMinor: 1000, amountMinor: 1086 }))).transaction;
    expect(back.baseAmountMinor).toBe(1000);
    const [p1, p2] = (await get(a, '/api/pockets')).pockets;
    expect([p1.balanceMinor, p2.balanceMinor]).toEqual([100000 - 8500 + 1000, 50000 + 9231 - 1086]);
    const b = await get(a, '/api/budget?month=2026-10');
    expect(b.totals).toMatchObject({ spentMinor: 0, incomeMinor: 0 });
    expect(b.sections[0].subsections[0].spentMinor).toBe(0);
  });

  it('lists a transfer for either pocket and for the month', async () => {
    const { a, eur, usd } = await world();
    const other = await pocket(a, 'Other');
    const t = (await post(a, '/api/transactions', transfer(eur.id, usd.id, { toAmountMinor: 9231 }))).transaction;
    const ids = async (q: string) => (await get(a, `/api/transactions?month=2026-10${q}`)).transactions.map((x: any) => x.id);
    expect(await ids('')).toEqual([t.id]);
    expect(await ids(`&pocketId=${eur.id}`)).toEqual([t.id]);
    expect(await ids(`&pocketId=${usd.id}`)).toEqual([t.id]);
    expect(await ids(`&pocketId=${other.id}`)).toEqual([]);
  });

  it('edits a transfer and turns it into an expense without leftovers', async () => {
    const { a, food, eur, usd } = await world();
    const t = (await post(a, '/api/transactions', transfer(eur.id, usd.id, { toAmountMinor: 9231 }))).transaction;
    const patch = async (body: object) => (await json(a.patch(`/api/transactions/${t.id}`)).send(body).expect(200)).body.transaction;
    expect((await patch({ toAmountMinor: 9000 })).toAmountMinor).toBe(9000);
    expect(await patch({ kind: 'expense', subsectionId: food.id, payee: 'Shop' })).toMatchObject({ kind: 'expense', toPocketId: null, toAmountMinor: null, payee: 'Shop' });
  });

  it('checks every field', async () => {
    const { a, food, job, eur, usd } = await world();
    const fields = async (body: object) => (await bad(json(a.post('/api/transactions')).send(body), 400)).fields;
    const DIFFERENT = 'Choose a different pocket.';
    const ARRIVED = 'Enter the amount that arrived.';
    expect(await fields(transfer(eur.id, eur.id))).toEqual({ toPocketId: DIFFERENT });
    expect(await fields(transfer(eur.id, 0, { toPocketId: undefined }))).toEqual({ toPocketId: DIFFERENT });
    expect(await fields(transfer(eur.id, 99999))).toEqual({ toPocketId: DIFFERENT });
    await json(a.post('/api/users')).send({ username: 'bob', displayName: 'b', password: PW, baseCurrency: 'EUR' }).expect(201);
    const bob = request.agent(app);
    await json(bob.post('/api/auth/login')).send({ username: 'bob', password: PW }).expect(200);
    const theirs = await pocket(bob, 'Bob');
    expect(await fields(transfer(eur.id, theirs.id))).toEqual({ toPocketId: DIFFERENT });
    expect(await fields(transfer(theirs.id, eur.id))).toEqual({ pocketId: 'Choose a pocket.' });

    expect(await fields(transfer(eur.id, usd.id))).toEqual({ toAmountMinor: ARRIVED });
    for (const v of [0, -1, 1.5, 10 ** 13 + 1, '5'])
      expect(await fields(transfer(eur.id, usd.id, { toAmountMinor: v }))).toEqual({ toAmountMinor: ARRIVED });
    await post(a, '/api/transactions', transfer(eur.id, usd.id, { toAmountMinor: 10 ** 13 }));

    const bank2 = await pocket(a, 'Savings');
    expect(Object.keys(await fields(transfer(eur.id, bank2.id, { toAmountMinor: 8499 })))).toEqual(['toAmountMinor']);
    await post(a, '/api/transactions', transfer(eur.id, bank2.id, { toAmountMinor: 8500 }));
    await post(a, '/api/transactions', transfer(eur.id, bank2.id, { toAmountMinor: null, subsectionId: null }));
    expect(await fields(transfer(eur.id, bank2.id, { sourceId: job.id }))).toEqual({ sourceId: 'A transfer has no source.' });
    expect(await fields(transfer(eur.id, bank2.id, { subsectionId: 99999 }))).toEqual({ subsectionId: 'Choose a subsection.' });
    expect(await fields(transfer(eur.id, bank2.id, { amountMinor: 0 }))).toHaveProperty('amountMinor');
    expect((await post(a, '/api/transactions', transfer(eur.id, bank2.id, { payee: 'ignored', sourceId: null }))).transaction.payee).toBe('');

    // Expenses and income keep their rules.
    expect(await fields({ date: '2026-10-13', kind: 'expense', amountMinor: 1, pocketId: eur.id, payee: 'x' })).toEqual({ subsectionId: 'Choose a subsection.' });
    expect(await fields({ ...expense(eur.id, food.id), kind: 'income', sourceId: job.id })).toEqual({ subsectionId: 'Income has no subsection.' });
  });

  it('is locked in a closed month like every other transaction', async () => {
    const a = await owner();
    const ym = (back: number) => {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - back, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const from = await pocket(a, 'A', undefined, 100000);
    const to = await pocket(a, 'B');
    const locked = (await post(a, '/api/transactions', transfer(from.id, to.id, { date: `${ym(1)}-05` }))).transaction;
    expect((await get(a, '/api/months')).toClose).toBeNull(); // a transfer alone leaves nothing to close
    const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
    const food = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 1 })).subsection;
    await post(a, '/api/transactions', expense(from.id, food.id, { date: `${ym(1)}-04` }));
    expect((await get(a, '/api/months')).toClose).toBe(ym(1));
    await json(a.post(`/api/months/${ym(1)}/close`)).expect(200);
    const e = await bad(json(a.post('/api/transactions')).send(transfer(from.id, to.id, { date: `${ym(1)}-06` })), 400);
    expect(e.fields).toEqual({ date: 'This date is in a closed month.' });
    expect((await bad(json(a.patch(`/api/transactions/${locked.id}`)).send({ note: 'x' }), 409)).code).toBe('closed');
    expect((await bad(json(a.delete(`/api/transactions/${locked.id}`)), 409)).code).toBe('closed');
  });
});

describe('net worth', () => {
  it("sums the pockets per currency, base first, at today's rate", async () => {
    const { a } = await world();
    await pocket(a, 'Pounds', 'GBP', 87000);
    await post(a, '/api/pockets', { name: 'Other EUR', kind: 'cash', openingBalanceMinor: 5 });
    expect(await get(a, '/api/networth')).toEqual({
      currency: 'EUR', totalMinor: 100005 + 100578 + 46041,
      byCurrency: [
        { currency: 'EUR', amountMinor: 100005, baseMinor: 100005, rate: null },
        { currency: 'GBP', amountMinor: 87000, baseMinor: 100578, rate: '1.1561' },
        { currency: 'USD', amountMinor: 50000, baseMinor: 46041, rate: '0.9208' },
      ],
      missingRates: [],
    });
  });

  it('lists a currency without a rate and leaves it out of the total', async () => {
    const { a } = await world();
    db.prepare("DELETE FROM rates WHERE currency = 'USD'").run();
    expect(await get(a, '/api/networth')).toEqual({
      currency: 'EUR', totalMinor: 100000,
      byCurrency: [
        { currency: 'EUR', amountMinor: 100000, baseMinor: 100000, rate: null },
        { currency: 'USD', amountMinor: 50000, baseMinor: null, rate: null },
      ],
      missingRates: ['USD'],
    });
  });
});

describe('migration 006', () => {
  it('gives existing transactions a base amount equal to their amount', () => {
    const old = path.join(dir, 'old.db');
    const raw = new Database(old);
    raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    for (const n of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort().filter((n) => n < '006')) {
      raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
      raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
    }
    raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (1, 'u', 'u', 'x', 'EUR')").run();
    raw.prepare("INSERT INTO pockets (id, user_id, name, kind, currency, opening_balance_minor) VALUES (1, 1, 'P', 'bank', 'EUR', 0)").run();
    raw.prepare("INSERT INTO transactions (user_id, date, kind, amount_minor, pocket_id, payee) VALUES (1, '2026-10-01', 'expense', 777, 1, 'x')").run();
    raw.close();
    const migrated = openDb(old);
    const row = migrated.prepare('SELECT amount_minor a, base_amount_minor b, to_pocket_id t FROM transactions').get();
    migrated.close();
    expect(row).toEqual({ a: 777, b: 777, t: null });
  });
});
