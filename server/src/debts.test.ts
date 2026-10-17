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
type Agent = ReturnType<typeof request.agent>;
const PW = 'correct horse battery';
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay(new Date());
const MONTH = TODAY.slice(0, 7);
const ago = (days: number) => localDay(new Date(Date.now() - days * 86400000));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-debts-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: 'http://127.0.0.1:9/none' });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const acct = (username: string) => ({ username, displayName: username, password: PW, baseCurrency: 'EUR' });
const post = async (a: Agent, url: string, body: object = {}, status = 201) => (await json(a.post(url)).send(body).expect(status)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const fields = (b: any) => b.error.fields;
async function owner() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send(acct('sam')).expect(201);
  return a;
}
const pocket = async (a: Agent, body: object) => (await post(a, '/api/pockets', body)).pocket;
const pockets = async (a: Agent) => (await get(a, '/api/pockets')).pockets as any[];
const balanceOf = async (a: Agent, id: number) => (await pockets(a)).find((p) => p.id === id).balanceMinor as number;
async function budget(a: Agent) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const food = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 30000 })).subsection;
  const src = (await post(a, '/api/sources', { name: 'Job' })).source;
  return { sec, food, src };
}
const spend = (pocketId: number, subsectionId: number, over: object = {}) =>
  ({ date: TODAY, kind: 'expense', amountMinor: 1000, pocketId, subsectionId, payee: 'Shop', ...over });

describe('the migration', () => {
  it('keeps every pocket and every reference', () => {
    const file = path.join(dir, 'old.db');
    const old = new Database(file);
    old.pragma('foreign_keys = ON');
    old.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    const names = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((f) => f < '016').sort();
    for (const n of names) {
      old.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
      old.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
    }
    old.exec(`
      INSERT INTO users (id, username, display_name, password_hash, is_owner, base_currency) VALUES (1, 'a', 'A', 'x', 1, 'EUR');
      INSERT INTO pockets (id, user_id, name, kind, currency, opening_balance_minor, emoji, synced_balance_minor, synced_at) VALUES
        (1, 1, 'Bank', 'bank', 'EUR', 500, 'b', 900, 'now'), (2, 1, 'Broker', 'broker', 'EUR', 0, 'k', NULL, NULL);
      UPDATE users SET home_pocket_id = 1;
      INSERT INTO sections (id, user_id, name, color_slot, position) VALUES (1, 1, 'S', 1, 1);
      INSERT INTO subsections (id, user_id, section_id, name, budget_minor, position) VALUES (1, 1, 1, 'F', 0, 1);
      INSERT INTO transactions (id, user_id, date, kind, amount_minor, base_amount_minor, pocket_id, subsection_id, payee) VALUES (1, 1, '2026-01-01', 'expense', 5, 5, 1, 1, 'x');
      INSERT INTO holdings (user_id, name, pocket_id, subsection_id, paid_minor, worth_minor, worth_currency, worth_date) VALUES (1, 'H', 2, 1, 1, 1, 'EUR', '2026-01-01');
      INSERT INTO broker_connections (user_id, pocket_id, subsection_id, environment, currency, key_enc, key_end) VALUES (1, 2, 1, 'live', 'EUR', 'k', 'e');
      INSERT INTO bank_connections (id, user_id, bank, country, session_id, valid_until) VALUES (1, 1, 'B', 'FI', 's', '2030-01-01');
      INSERT INTO bank_accounts (connection_id, uid, name, iban, currency, pocket_id) VALUES (1, 'u', 'n', 'i', 'EUR', 1);`);
    old.close();
    const upgraded = openDb(file);
    expect(upgraded.prepare('SELECT id, name, kind, opening_balance_minor AS o, emoji, synced_balance_minor AS sb, synced_at AS sa, reconciled_at AS r FROM pockets ORDER BY id').all())
      .toEqual([{ id: 1, name: 'Bank', kind: 'bank', o: 500, emoji: 'b', sb: 900, sa: 'now', r: null }, { id: 2, name: 'Broker', kind: 'broker', o: 0, emoji: 'k', sb: null, sa: null, r: null }]);
    expect(upgraded.prepare('SELECT home_pocket_id AS h FROM users').get()).toEqual({ h: 1 });
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM broker_connections').get()).toEqual({ n: 1 });
    expect(upgraded.prepare('SELECT pocket_id AS p FROM bank_accounts').get()).toEqual({ p: 1 });
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM holdings').get()).toEqual({ n: 1 });
    expect(upgraded.prepare('SELECT COUNT(*) AS n FROM transactions').get()).toEqual({ n: 1 });
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    expect(upgraded.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => upgraded.prepare("UPDATE pockets SET kind = 'loan' WHERE id = 1").run()).not.toThrow();
    expect(() => upgraded.prepare("UPDATE pockets SET kind = 'nope' WHERE id = 1").run()).toThrow();
    upgraded.close();
  });
});

describe('pocket groups and debts', () => {
  it('groups every kind', async () => {
    const a = await owner();
    const kinds = ['bank', 'cash', 'fund', 'broker', 'credit', 'loan'];
    for (const kind of kinds) await pocket(a, { name: kind, kind, openingBalanceMinor: 100 });
    await pocket(a, { name: 'Home', kind: 'property', valueMinor: 100 });
    expect((await pockets(a)).map((p) => [p.kind, p.group])).toEqual([
      ['bank', 'cash'], ['cash', 'cash'], ['fund', 'investments'], ['broker', 'investments'], ['credit', 'debts'], ['loan', 'debts'], ['property', 'property'],
    ]);
  });
  it('stores an amount owed as negative and updates it', async () => {
    const a = await owner();
    const card = await pocket(a, { name: 'Card', kind: 'credit', openingBalanceMinor: 50000 });
    expect(card).toMatchObject({ openingBalanceMinor: -50000, balanceMinor: -50000, valueMinor: -50000, group: 'debts', reconciledAt: null });
    expect(db.prepare('SELECT opening_balance_minor AS o FROM pockets WHERE id = ?').get(card.id)).toEqual({ o: -50000 });
    const r = await json(a.patch(`/api/pockets/${card.id}`)).send({ openingBalanceMinor: 30000 }).expect(200);
    expect(r.body.pocket.openingBalanceMinor).toBe(-30000);
    // sending the stored negative back keeps it a debt
    const again = await json(a.patch(`/api/pockets/${card.id}`)).send({ name: 'Card 2' }).expect(200);
    expect(again.body.pocket.openingBalanceMinor).toBe(-30000);
    await json(a.post('/api/pockets')).send({ name: 'x', kind: 'loan', openingBalanceMinor: 1.5 }).expect(400);
    await json(a.post('/api/pockets')).send({ name: 'x', kind: 'bank' }).expect(400);
  });
  it('spends on a card and pays it with a transfer', async () => {
    const a = await owner();
    const b = await budget(a);
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 });
    const card = await pocket(a, { name: 'Card', kind: 'credit', openingBalanceMinor: 50000 });
    await post(a, '/api/transactions', spend(card.id, b.food.id, { amountMinor: 2500 }));
    expect(await balanceOf(a, card.id)).toBe(-52500);
    await post(a, '/api/transactions', { date: TODAY, kind: 'transfer', amountMinor: 52500, pocketId: bank.id, toPocketId: card.id });
    expect(await balanceOf(a, card.id)).toBe(0);
    expect(await balanceOf(a, bank.id)).toBe(47500);
    // net worth: only the bank is left
    expect(await get(a, '/api/networth')).toMatchObject({ totalMinor: 47500, assetsMinor: 47500, debtsMinor: 0 });
  });
});

describe('property', () => {
  it('holds values, not transactions', async () => {
    const a = await owner();
    const b = await budget(a);
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 });
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 20000000 });
    expect(home).toMatchObject({ group: 'property', balanceMinor: 20000000, valueMinor: 20000000, openingBalanceMinor: 0, hasTransactions: false });
    const values = (await get(a, `/api/pockets/${home.id}/values`)).values;
    expect(values).toEqual([{ id: expect.any(Number), valueMinor: 20000000, date: TODAY }]);
    const msg = 'A property pocket holds a value, not transactions.';
    expect(fields((await json(a.post('/api/transactions')).send(spend(home.id, b.food.id)).expect(400)).body).pocketId).toBe(msg);
    expect(fields((await json(a.post('/api/transactions')).send({ date: TODAY, kind: 'transfer', amountMinor: 5, pocketId: bank.id, toPocketId: home.id }).expect(400)).body).toPocketId).toBe(msg);
    expect(fields((await json(a.post('/api/transactions')).send({ date: TODAY, kind: 'transfer', amountMinor: 5, pocketId: home.id, toPocketId: bank.id }).expect(400)).body).pocketId).toBe(msg);
    expect(fields((await json(a.post('/api/imports/preview')).send({ pocketId: home.id, text: 'a,b\n1,2' }).expect(400)).body).pocketId).toBe(msg);
    await json(a.post('/api/pockets')).send({ name: 'x', kind: 'property' }).expect(400);
    await json(a.post('/api/pockets')).send({ name: 'x', kind: 'property', valueMinor: -1 }).expect(400);
    // a pocket with transactions cannot become a property
    await post(a, '/api/transactions', spend(bank.id, b.food.id));
    await json(a.patch(`/api/pockets/${bank.id}`)).send({ kind: 'property' }).expect(400);
  });
  it('cannot be linked to a bank account or Trading212, or hold a holding', async () => {
    const a = await owner();
    const b = await budget(a);
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 1 });
    const msg = 'A property pocket holds a value, not transactions.';
    db.prepare("INSERT INTO bank_connections (id, user_id, bank, country, session_id, valid_until) VALUES (1, 1, 'B', 'FI', 's', '2999-01-01')").run();
    db.prepare("INSERT INTO bank_accounts (connection_id, uid, name, iban, currency) VALUES (1, 'acc1', 'n', 'i', 'EUR')").run();
    const bank = await json(a.patch('/api/banks/accounts/acc1')).send({ pocketId: home.id }).expect(400);
    expect(fields(bank.body).pocketId).toBe(msg);
    const t212 = await json(a.put('/api/brokers/trading212')).send({ pocketId: home.id, subsectionId: b.food.id, environment: 'live', apiKey: 'k'.repeat(12) }).expect(400);
    expect(fields(t212.body).pocketId).toBe(msg);
    const hold = await json(a.post('/api/holdings')).send({ name: 'H', pocketId: home.id, subsectionId: b.food.id, paidMinor: 1 }).expect(400);
    expect(fields(hold.body).pocketId).toBe(msg);
  });
  it('keeps one value per date and works out the balance on a day', async () => {
    const a = await owner();
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 100 });
    const add = (valueMinor: number, date: string, status = 201) => post(a, `/api/pockets/${home.id}/values`, { valueMinor, date }, status);
    await add(200, ago(40));
    await add(300, ago(10));
    await add(350, ago(10)); // replaces
    await add(999, '2999-01-01'); // in the future: not yet the balance
    expect((await get(a, `/api/pockets/${home.id}/values`)).values.map((v: any) => [v.date, v.valueMinor])).toEqual([['2999-01-01', 999], [TODAY, 100], [ago(10), 350], [ago(40), 200]]);
    expect(await balanceOf(a, home.id)).toBe(100);
    const first = (await get(a, `/api/pockets/${home.id}/values`)).values.find((v: any) => v.valueMinor === 100);
    await json(a.delete(`/api/pocket-values/${first.id}`)).expect(204);
    expect(await balanceOf(a, home.id)).toBe(350);
    await json(a.delete(`/api/pocket-values/${first.id}`)).expect(404);
    expect(fields((await json(a.post(`/api/pockets/${home.id}/values`)).send({ valueMinor: -1, date: TODAY }).expect(400)).body).valueMinor).toBeTruthy();
    expect(fields((await json(a.post(`/api/pockets/${home.id}/values`)).send({ valueMinor: 1, date: 'x' }).expect(400)).body).date).toBeTruthy();
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 });
    await json(a.post(`/api/pockets/${bank.id}/values`)).send({ valueMinor: 1, date: TODAY }).expect(400);
    await a.get(`/api/pockets/${bank.id}/values`).expect(400);
    await a.get('/api/pockets/9999/values').expect(404);
  });
  it('is gone with its pocket', async () => {
    const a = await owner();
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 100 });
    await json(a.delete(`/api/pockets/${home.id}`)).expect(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pocket_values').get()).toEqual({ n: 0 });
  });
});

describe('net worth', () => {
  it('sums assets minus debts, now and over time', async () => {
    const a = await owner();
    await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 });
    await pocket(a, { name: 'Card', kind: 'credit', openingBalanceMinor: 30000 });
    await pocket(a, { name: 'Loan', kind: 'loan', openingBalanceMinor: 20000 });
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 500000 });
    await post(a, `/api/pockets/${home.id}/values`, { valueMinor: 400000, date: ago(100) });
    const nw = await get(a, '/api/networth');
    expect(nw).toMatchObject({ assetsMinor: 600000, debtsMinor: 50000, totalMinor: 550000 });
    expect(nw.assetsMinor - nw.debtsMinor).toBe(nw.totalMinor);
    const rep = await get(a, '/api/reports?months=6');
    expect(rep.networth.at(-1).minor).toBe(550000);
    // a month-end before today's value: the older value counts (100 days ago was in an earlier month)
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const m = localDay(old).slice(0, 7);
    const prev = rep.networth.find((x: any) => x.month === m);
    if (prev && m !== MONTH) {
      const nextMonthStart = new Date(old.getFullYear(), old.getMonth() + 1, 1);
      const monthEnd = localDay(new Date(nextMonthStart.getTime() - 86400000));
      expect(prev.minor).toBe(monthEnd >= ago(100) ? 100000 - 50000 + 400000 : 100000 - 50000);
    }
  });
});

describe('reconcile', () => {
  it('adds an adjustment up and down, and nothing when equal', async () => {
    const a = await owner();
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 10000 });
    const up = await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 12500, date: TODAY }, 200);
    expect(up.reconciledAt).toBe(TODAY);
    expect(up.adjustment).toMatchObject({ kind: 'income', amountMinor: 2500, payee: 'Balance adjustment', subsectionId: null, sourceId: null, source: 'adjustment', date: TODAY, pocketId: bank.id });
    expect(await balanceOf(a, bank.id)).toBe(12500);
    const down = await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 12000, date: TODAY }, 200);
    expect(down.adjustment).toMatchObject({ kind: 'expense', amountMinor: 500 });
    expect(await balanceOf(a, bank.id)).toBe(12000);
    const same = await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 12000, date: TODAY }, 200);
    expect(same).toEqual({ adjustment: null, reconciledAt: TODAY });
    expect((await pockets(a)).find((p) => p.id === bank.id)).toMatchObject({ reconciledAt: TODAY, reconciledBalanceMinor: 12000 });
    // deleting an adjustment undoes it
    await json(a.delete(`/api/transactions/${down.adjustment.id}`)).expect(204);
    expect(await balanceOf(a, bank.id)).toBe(12500);
  });
  it('works at the end of an earlier day and on a debt', async () => {
    const a = await owner();
    const b = await budget(a);
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 1000 });
    await post(a, '/api/transactions', spend(bank.id, b.food.id, { date: ago(5), amountMinor: 100 }));
    await post(a, '/api/transactions', spend(bank.id, b.food.id, { date: ago(1), amountMinor: 200 }));
    const r = await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 950, date: ago(3) }, 200);
    expect(r.adjustment).toMatchObject({ kind: 'income', amountMinor: 50, date: ago(3) });
    expect(await balanceOf(a, bank.id)).toBe(750);
    const card = await pocket(a, { name: 'Card', kind: 'credit', openingBalanceMinor: 500 });
    const c = await post(a, `/api/pockets/${card.id}/reconcile`, { balanceMinor: -700, date: TODAY }, 200);
    expect(c.adjustment).toMatchObject({ kind: 'expense', amountMinor: 200 });
    expect(await balanceOf(a, card.id)).toBe(-700);
  });
  it('is refused for property, a synced pocket, the future and a closed month', async () => {
    const a = await owner();
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 1 });
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 });
    const bad = async (id: number, body: object) => fields((await json(a.post(`/api/pockets/${id}/reconcile`)).send(body).expect(400)).body);
    expect((await bad(home.id, { balanceMinor: 1, date: TODAY })).pocketId).toBe('A property pocket has no balance to reconcile.');
    expect((await bad(bank.id, { balanceMinor: 1, date: '2999-01-01' })).date).toBeTruthy();
    expect((await bad(bank.id, { balanceMinor: 1.5, date: TODAY })).balanceMinor).toBeTruthy();
    expect((await bad(bank.id, { balanceMinor: 1, date: 'x' })).date).toBeTruthy();
    db.prepare("INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (1, ?, '{}', '{}')").run(ago(60).slice(0, 7));
    expect((await bad(bank.id, { balanceMinor: 1, date: ago(60) })).date).toBe('This date is in a closed month.');
    db.prepare('UPDATE pockets SET synced_balance_minor = 5, synced_at = ? WHERE id = ?').run('now', bank.id);
    expect((await bad(bank.id, { balanceMinor: 1, date: TODAY })).pocketId).toBe("This pocket's balance comes from its connection.");
    await json(a.post('/api/pockets/9999/reconcile')).send({ balanceMinor: 1, date: TODAY }).expect(404);
  });
  it('counts in balances and net worth only', async () => {
    const a = await owner();
    const b = await budget(a);
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 });
    const before = {
      budget: await get(a, `/api/budget?month=${MONTH}`),
      pipeline: await get(a, `/api/pipeline?month=${MONTH}`),
      reports: await get(a, '/api/reports?months=3'),
      where: await get(a, `/api/where?month=${MONTH}`),
    };
    const up = await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 7000, date: TODAY }, 200);
    await post(a, `/api/pockets/${bank.id}/reconcile`, { balanceMinor: 6000, date: ago(0) }, 200);
    expect(await balanceOf(a, bank.id)).toBe(6000);
    expect(await get(a, `/api/budget?month=${MONTH}`)).toEqual(before.budget);
    expect(await get(a, `/api/pipeline?month=${MONTH}`)).toEqual(before.pipeline);
    expect(await get(a, `/api/where?month=${MONTH}`)).toEqual(before.where);
    const rep = await get(a, '/api/reports?months=3');
    expect(rep.spending).toEqual(before.reports.spending);
    expect(rep.cashflow).toEqual(before.reports.cashflow);
    expect(rep.networth.at(-1).minor).toBe(6000);
    expect((await get(a, '/api/networth')).totalMinor).toBe(6000);
    expect((await get(a, '/api/transactions?unsorted=1')).transactions).toEqual([]);
    // a month with an adjustment still closes: it asks for no sorting
    expect(up.adjustment.source).toBe('adjustment');
    // recurring: three monthly adjustments are not a payment
    const rb = await pocket(a, { name: 'Other', kind: 'bank', openingBalanceMinor: 0 });
    for (const m of [3, 2, 1]) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      await post(a, `/api/pockets/${rb.id}/reconcile`, { balanceMinor: 100 * (4 - m) * -1, date: localDay(d) }, 200);
    }
    expect((await get(a, '/api/recurring')).items).toEqual([]);
    // never given a subsection
    const adj = up.adjustment;
    const r = await json(a.patch(`/api/transactions/${adj.id}`)).send({ ...adj, subsectionId: b.food.id }).expect(400);
    expect(fields(r.body).subsectionId).toBe('An adjustment has no subsection.');
    await json(a.patch(`/api/transactions/${adj.id}`)).send({ amountMinor: 5 }).expect(400);
    expect((await json(a.patch(`/api/transactions/${adj.id}`)).send({ note: 'checked' }).expect(200)).body.transaction.note).toBe('checked');
    const bulk = await json(a.post('/api/transactions/bulk')).send({ ids: [adj.id], action: 'subsection', subsectionId: b.food.id }).expect(400);
    expect(fields(bulk.body).ids).toContain('adjustment');
  });
});

describe('isolation', () => {
  it('keeps values and reconciling to their owner', async () => {
    const a = await owner();
    await json(a.post('/api/users')).send(acct('kim')).expect(201);
    const k = request.agent(app);
    await json(k.post('/api/auth/login')).send({ username: 'kim', password: PW }).expect(200);
    const home = await pocket(a, { name: 'Home', kind: 'property', valueMinor: 10 });
    const bank = await pocket(a, { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 });
    const value = (await get(a, `/api/pockets/${home.id}/values`)).values[0];
    await k.get(`/api/pockets/${home.id}/values`).expect(404);
    await json(k.post(`/api/pockets/${home.id}/values`)).send({ valueMinor: 1, date: TODAY }).expect(404);
    await json(k.delete(`/api/pocket-values/${value.id}`)).expect(404);
    await json(k.post(`/api/pockets/${bank.id}/reconcile`)).send({ balanceMinor: 1, date: TODAY }).expect(404);
    expect(await get(k, '/api/networth')).toMatchObject({ totalMinor: 0, assetsMinor: 0, debtsMinor: 0 });
  });
});
