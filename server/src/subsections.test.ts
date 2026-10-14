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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-sub-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist') });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const ym = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const M1 = ym(2);
const M2 = ym(1);

async function owner() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username: 'owner', displayName: 'o', password: 'correct horse battery', baseCurrency: 'EUR' }).expect(201);
  return a;
}
// One section that receives all of the paycheck, and a pocket to put transactions in.
async function setup(a: Agent) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const other = (await post(a, '/api/sections', { name: 'Savings' })).section;
  const pay = (await post(a, '/api/sources', { name: 'Paycheck' })).source;
  await post(a, `/api/boxes/${pay.boxId}/steps`, { kind: 'percent', shares: [{ sectionId: sec.id, basisPoints: 10000 }] });
  const pocket = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  const tx = (body: object) => post(a, '/api/transactions', { kind: 'expense', amountMinor: 1, pocketId: pocket.id, subsectionId: null, payee: 'x', ...body });
  const earn = (month: string, amountMinor: number) => tx({ kind: 'income', sourceId: pay.id, amountMinor, date: `${month}-05`, payee: '' });
  const spend = (month: string, subsectionId: number, amountMinor: number) => tx({ subsectionId, amountMinor, date: `${month}-06` });
  const sub = async (body: object) => (await post(a, `/api/sections/${sec.id}/subsections`, body)).subsection;
  return { sec, other, earn, spend, sub };
}
const budgetOf = async (a: Agent, month: string, id: number) =>
  Object.fromEntries((await get(a, `/api/budget?month=${month}`)).sections.find((x: any) => x.id === id).subsections.map((x: any) => [x.name, x]));

describe('a subsection budget', () => {
  it('shares what the fixed amounts leave, rounded down, and the cents join the rest', async () => {
    const a = await owner();
    const t = await setup(a);
    await t.earn(M1, 100001);
    await t.sub({ name: 'A', budgetMinor: 6000 });
    await t.sub({ name: 'B', budgetKind: 'percent', budgetBasisPoints: 6000 });
    await t.sub({ name: 'C', budgetKind: 'percent', budgetBasisPoints: 4000 });
    const b = await get(a, `/api/budget?month=${M1}`);
    const subs = b.sections[0].subsections;
    expect(subs.map((x: any) => [x.name, x.budgetMinor, x.budgetBasisPoints])).toEqual([['A', 6000, null], ['B', 56400, 6000], ['C', 37600, 4000]]);
    expect(b.sections[0].restMinor).toBe(1);
  });

  it('gives percentages 0 when the fixed amounts claim everything', async () => {
    const a = await owner();
    const t = await setup(a);
    await t.earn(M1, 5000);
    await t.sub({ name: 'A', budgetMinor: 8000 });
    await t.sub({ name: 'B', budgetKind: 'percent', budgetBasisPoints: 5000 });
    const subs = await budgetOf(a, M1, t.sec.id);
    expect(subs.B.budgetMinor).toBe(0);
    expect(subs.A.budgetMinor).toBe(8000);
  });

  it('clears the fields that stop applying when a patch switches budgetKind or keep', async () => {
    const a = await owner();
    const t = await setup(a);
    const x = await t.sub({ name: 'X', budgetMinor: 1000, keep: 'cap', capMinor: 500 });
    expect(x).toMatchObject({ kind: 'spending', budgetKind: 'amount', budgetMinor: 1000, budgetBasisPoints: null, keep: 'cap', capMinor: 500 });
    const p = (await json(a.patch(`/api/subsections/${x.id}`)).send({ budgetKind: 'percent', budgetBasisPoints: 2500, keep: 'all' }).expect(200)).body.subsection;
    expect(p).toMatchObject({ budgetKind: 'percent', budgetMinor: null, budgetBasisPoints: 2500, keep: 'all', capMinor: null });
    const back = (await json(a.patch(`/api/subsections/${x.id}`)).send({ budgetKind: 'amount', budgetMinor: 70 }).expect(200)).body.subsection;
    expect(back).toMatchObject({ budgetKind: 'amount', budgetMinor: 70, budgetBasisPoints: null });
    const goal = (await json(a.patch(`/api/subsections/${x.id}`)).send({ kind: 'goal', capMinor: 9000 }).expect(200)).body.subsection;
    expect(goal).toMatchObject({ kind: 'goal', keep: 'cap', capMinor: 9000 });
  });

  it('accepts the old body and defaults the new fields', async () => {
    const a = await owner();
    const t = await setup(a);
    expect(await t.sub({ name: 'Old', budgetMinor: 123 })).toMatchObject({
      kind: 'spending', budgetKind: 'amount', budgetMinor: 123, budgetBasisPoints: null, keep: 'all', capMinor: null, position: 1,
    });
  });

  it('keeps positions 1 to n when adding at a position and moving', async () => {
    const a = await owner();
    const t = await setup(a);
    const one = await t.sub({ name: 'one', budgetMinor: 0 });
    const two = await t.sub({ name: 'two', budgetMinor: 0 });
    const three = await t.sub({ name: 'three', budgetMinor: 0, position: 1 });
    const order = async () => (await get(a, '/api/sections')).sections[0].subsections.map((x: any) => [x.name, x.position]);
    expect(await order()).toEqual([['three', 1], ['one', 2], ['two', 3]]);
    await json(a.patch(`/api/subsections/${three.id}`)).send({ position: 3 }).expect(200);
    expect(await order()).toEqual([['one', 1], ['two', 2], ['three', 3]]);
    await json(a.patch(`/api/subsections/${two.id}`)).send({ name: 'deux' }).expect(200); // no position: stays
    await json(a.patch(`/api/subsections/${two.id}`)).send({ position: 1 }).expect(200);
    expect(await order()).toEqual([['deux', 1], ['one', 2], ['three', 3]]);
    expect(one.id).toBeGreaterThan(0);
  });

  it('refuses every bad field with its sentence', async () => {
    const a = await owner();
    const t = await setup(a);
    await t.sub({ name: 'P', budgetKind: 'percent', budgetBasisPoints: 6000 });
    const AMT = 'Enter an amount, 0 or more.';
    const PCT = 'Enter a percentage above 0 and up to 100.';
    const cases: [object, string, string][] = [
      [{ kind: 'x' }, 'kind', 'Choose a kind.'],
      [{ budgetKind: 'x' }, 'budgetKind', 'Choose how the budget is set.'],
      [{ budgetMinor: -1 }, 'budgetMinor', AMT],
      [{ budgetMinor: 1.5 }, 'budgetMinor', AMT],
      [{ budgetMinor: 10 ** 13 + 1 }, 'budgetMinor', AMT],
      [{ budgetMinor: undefined }, 'budgetMinor', AMT],
      [{ budgetKind: 'percent', budgetBasisPoints: 0 }, 'budgetBasisPoints', PCT],
      [{ budgetKind: 'percent', budgetBasisPoints: 10001 }, 'budgetBasisPoints', PCT],
      [{ budgetKind: 'percent', budgetBasisPoints: 1.5 }, 'budgetBasisPoints', PCT],
      [{ budgetKind: 'percent', budgetBasisPoints: 4001 }, 'budgetBasisPoints', 'The percentages in one section can add up to at most 100.'],
      [{ keep: 'x' }, 'keep', 'Choose what it keeps.'],
      [{ kind: 'goal', keep: 'all', capMinor: 5 }, 'keep', 'Choose what it keeps.'],
      [{ keep: 'cap', capMinor: -1 }, 'capMinor', AMT],
      [{ keep: 'cap' }, 'capMinor', AMT],
      [{ kind: 'goal', capMinor: 0 }, 'capMinor', 'Enter a target above zero.'],
      [{ kind: 'goal' }, 'capMinor', 'Enter a target above zero.'],
      [{ position: 0 }, 'position', 'Choose a position.'],
      [{ position: 3 }, 'position', 'Choose a position.'],
      [{ position: 1.5 }, 'position', 'Choose a position.'],
      [{ position: 'a' }, 'position', 'Choose a position.'],
    ];
    for (const [over, field, message] of cases) {
      const r = await json(a.post(`/api/sections/${t.sec.id}/subsections`)).send({ name: 'N', budgetMinor: 0, ...over });
      expect([r.status, r.body.error?.code, r.body.error?.fields]).toEqual([400, 'validation', { [field]: message }]);
    }
    // 4000 more is exactly 100 and fine; editing a percentage does not count itself twice
    const q = await t.sub({ name: 'Q', budgetKind: 'percent', budgetBasisPoints: 4000 });
    await json(a.patch(`/api/subsections/${q.id}`)).send({ budgetBasisPoints: 4000 }).expect(200);
    const r = await json(a.patch(`/api/subsections/${q.id}`)).send({ budgetBasisPoints: 4001 });
    expect(r.status).toBe(400);
  });
});

describe('closing with keep rules', () => {
  it('applies all, cap and none; the spec 09 variant: Food capped at 30.00', async () => {
    const a = await owner();
    const t = await setup(a);
    await json(a.put(`/api/sections/${t.sec.id}/rest`)).send({ shares: [{ sectionId: t.other.id, basisPoints: 6000 }, { sectionId: null, basisPoints: 4000 }], overspent: 'income' }).expect(200);
    await t.earn(M1, 100000);
    const rent = await t.sub({ name: 'Rent', budgetMinor: 80000 });
    const food = await t.sub({ name: 'Food', budgetMinor: 14999, keep: 'cap', capMinor: 3000 });
    await t.spend(M1, rent.id, 80000);
    await t.spend(M1, food.id, 10000);
    const sum = await get(a, `/api/months/${M1}/close`);
    expect(sum).toMatchObject({ keptMinor: 3000, incomeMinor: 2800 });
    expect(sum.rows.map((x: any) => [x.toSectionId, x.amountMinor])).toEqual([[t.other.id, 4200], [null, 2800]]);
    expect(sum.keptMinor + 4200 + sum.incomeMinor).toBe(100000 - 90000 - 0 + 0); // 10,000 left to carry
  });

  it('keeps all, or nothing, and puts the rest of the unspent money into the section rest', async () => {
    const a = await owner();
    const t = await setup(a);
    await t.earn(M1, 100000);
    const all = await t.sub({ name: 'All', budgetMinor: 10000 });
    const none = await t.sub({ name: 'None', budgetMinor: 10000, keep: 'none' });
    const cap = await t.sub({ name: 'Cap', budgetMinor: 10000, keep: 'cap', capMinor: 2500 });
    await t.spend(M1, all.id, 4000);
    await t.spend(M1, none.id, 4000);
    await t.spend(M1, cap.id, 4000);
    const sum = await get(a, `/api/months/${M1}/close`);
    expect(sum.keptMinor).toBe(6000 + 2500);
    // rest = 70000 unclaimed + 6000 (none) + 3500 (above the cap), all to next month's income by default
    expect(sum.incomeMinor).toBe(79500);
    await json(a.post(`/api/months/${M1}/close`)).expect(200);
    const next = await budgetOf(a, M2, t.sec.id);
    expect([next.All.carriedMinor, next.None.carriedMinor, next.Cap.carriedMinor]).toEqual([6000, 0, 2500]);
  });

  it('fills a goal month by month and caps it at its target', async () => {
    const a = await owner();
    const t = await setup(a);
    await t.earn(M1, 100000);
    await t.earn(M2, 100000);
    const goal = await t.sub({ name: 'Trip', kind: 'goal', budgetMinor: 100000, keep: 'cap', capMinor: 150000 });
    expect(goal).toMatchObject({ kind: 'goal', keep: 'cap', capMinor: 150000 });
    expect((await get(a, `/api/months/${M1}/close`)).keptMinor).toBe(100000);
    await json(a.post(`/api/months/${M1}/close`)).expect(200);
    expect((await budgetOf(a, M2, t.sec.id)).Trip).toMatchObject({ carriedMinor: 100000, availableMinor: 200000 });
    const s2 = await get(a, `/api/months/${M2}/close`);
    expect([s2.keptMinor, s2.incomeMinor]).toEqual([150000, 50000]);
    await json(a.post(`/api/months/${M2}/close`)).expect(200);
    // paying for it is an expense that brings it back down
    const cur = ym(0);
    expect((await budgetOf(a, cur, t.sec.id)).Trip.carriedMinor).toBe(150000);
  });
});

describe('a database from before the migration', () => {
  it('gives existing subsections the spending, amount, keep-all defaults', () => {
    const file = path.join(dir, 'old.db');
    const raw = new Database(file);
    raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    for (const n of fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort().filter((f) => f < '006')) {
      raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
      raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
    }
    raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (1, 'u', 'u', 'x', 'EUR')").run();
    raw.prepare("INSERT INTO sections (user_id, name, color_slot, position) VALUES (1, 'S', 1, 1)").run();
    raw.prepare("INSERT INTO subsections (user_id, section_id, name, budget_minor, position) VALUES (1, 1, 'Food', 4200, 1)").run();
    raw.close();
    const migrated = openDb(file);
    expect(migrated.prepare('SELECT kind, budget_kind AS bk, budget_minor AS b, budget_basis_points AS bp, keep, cap_minor AS c FROM subsections').all())
      .toEqual([{ kind: 'spending', bk: 'amount', b: 4200, bp: null, keep: 'all', c: null }]);
    migrated.close();
  });
});
