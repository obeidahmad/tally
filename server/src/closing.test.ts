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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-close-'));
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
async function person(o: Agent, username: string) {
  await json(o.post('/api/users')).send(acct(username)).expect(201);
  const a = request.agent(app);
  await json(a.post('/api/auth/login')).send({ username, password: PW }).expect(200);
  return a;
}

// "September" is the month before the current one, "October" the current one, so the tests pass in any month.
const ym = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const SEP = ym(1);
const OCT = ym(0);
const OLDER = ym(2);

const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const mkTx = (pocketId: number, over: object) => ({ date: `${SEP}-05`, kind: 'expense', amountMinor: 1000, pocketId, subsectionId: null, payee: 'Shop', ...over });
const income = (pocketId: number, sourceId: number, amountMinor: number, month = SEP) =>
  mkTx(pocketId, { kind: 'income', sourceId, amountMinor, date: `${month}-05`, payee: '' });

// The worked example of spec 09, up to the moment before September is closed.
async function example(a: Agent) {
  const needs = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const wants = (await post(a, '/api/sections', { name: 'Wants' })).section;
  const savings = (await post(a, '/api/sections', { name: 'Savings' })).section;
  const rent = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Rent', budgetMinor: 80000 })).subsection;
  const food = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Food', budgetMinor: 14999 })).subsection;
  const eat = (await post(a, `/api/sections/${wants.id}/subsections`, { name: 'Eating out', budgetMinor: 55000 })).subsection;
  const pay = (await post(a, '/api/sources', { name: 'Paycheck' })).source;
  const fund = (await post(a, '/api/sources', { name: 'Fund payout' })).source;
  const step = (await post(a, `/api/boxes/${pay.boxId}/steps`, {
    kind: 'percent',
    shares: [{ sectionId: needs.id, basisPoints: 5000 }, { sectionId: wants.id, basisPoints: 3000 }, { sectionId: savings.id, basisPoints: 2000 }],
  })).step;
  const pocket = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  const rule = (id: number, shares: object[], overspent = 'income') => json(a.put(`/api/sections/${id}/rest`)).send({ shares, overspent }).expect(200);
  await rule(needs.id, [{ sectionId: savings.id, basisPoints: 6000 }, { sectionId: null, basisPoints: 4000 }]);
  await rule(savings.id, [{ sectionId: savings.id, basisPoints: 10000 }]);
  await post(a, '/api/transactions', income(pocket.id, pay.id, 200000));
  await post(a, '/api/transactions', income(pocket.id, fund.id, 1240));
  await post(a, '/api/transactions', mkTx(pocket.id, { subsectionId: rent.id, amountMinor: 80000 }));
  await post(a, '/api/transactions', mkTx(pocket.id, { subsectionId: food.id, amountMinor: 10000 }));
  await post(a, '/api/transactions', mkTx(pocket.id, { subsectionId: eat.id, amountMinor: 70000 }));
  return { needs, wants, savings, rent, food, eat, pay, fund, step, pocket, rule };
}
const close = (a: Agent, month = SEP) => json(a.post(`/api/months/${month}/close`));
const reopen = (a: Agent, month = SEP) => json(a.post(`/api/months/${month}/reopen`));
const secOf = (b: any, id: number) => b.sections.find((x: any) => x.id === id);

describe('closing a month: the worked example', () => {
  it('shows the five rows, closes, carries into October and merges with Paycheck', async () => {
    const o = await owner();
    const e = await example(o);
    const sep = await get(o, `/api/budget?month=${SEP}`);
    expect(sep.closed).toBe(false);
    expect(sep.sections.map((x: any) => [x.budgetedMinor, x.restMinor])).toEqual([[100000, 5001], [60000, -10000], [40000, 40000]]);
    expect(sep.totals.leftOverMinor).toBe(1240);

    expect((await get(o, '/api/months'))).toEqual({ lastClosed: null, toClose: SEP });
    const sum = await get(o, `/api/months/${SEP}/close`);
    expect(sum).toEqual({
      month: SEP, nextMonth: OCT, keptMinor: 4999, incomeMinor: -6760,
      rows: [
        { fromSectionId: e.needs.id, basisPoints: 6000, toSectionId: e.savings.id, amountMinor: 3001 },
        { fromSectionId: e.needs.id, basisPoints: 4000, toSectionId: null, amountMinor: 2000 },
        { fromSectionId: e.wants.id, basisPoints: 10000, toSectionId: null, amountMinor: -10000 },
        { fromSectionId: e.savings.id, basisPoints: 10000, toSectionId: e.savings.id, amountMinor: 40000 },
        { fromSectionId: null, basisPoints: 10000, toSectionId: null, amountMinor: 1240 },
      ],
    });
    // carried in total = income + leftovers carried in + carries into sections - spending
    expect(sum.keptMinor + 3001 + 40000 + sum.incomeMinor).toBe(201240 - 160000);

    expect((await close(o)).body).toEqual({ lastClosed: SEP, toClose: null });
    const bud = await get(o, `/api/budget?month=${OCT}`);
    const food = bud.sections[0].subsections.find((x: any) => x.id === e.food.id);
    expect(food).toMatchObject({ carriedMinor: 4999, availableMinor: 19998 });
    expect(secOf(bud, e.savings.id)).toMatchObject({ budgetedMinor: 43001, availableMinor: 43001 });
    expect(bud.totals).toMatchObject({ incomeMinor: -6760, leftOverMinor: -6760 });
    const pipe = await get(o, `/api/pipeline?month=${OCT}`);
    expect(secOf(pipe, e.savings.id)).toMatchObject({ receivedMinor: 43001, carriedMinor: 43001 });
    const left = pipe.boxes.flatMap((b: any) => b.sources.map((s: any) => ({ ...s, box: b }))).find((s: any) => s.isLeftovers);
    expect(left).toMatchObject({ name: "Last month's leftovers", incomeMinor: -6760 });
    expect(left.box).toMatchObject({ leftOverMinor: -6760, sources: [expect.objectContaining({ isLeftovers: true })], steps: [] });
    expect(pipe.leftOverMinor).toBe(-6760);

    // Moved into Paycheck's box, with October's paycheck: the pool is 1,932.40.
    await json(o.patch(`/api/sources/${left.id}`)).send({ boxId: e.pay.boxId }).expect(200);
    await post(o, '/api/transactions', income(e.pocket.id, e.pay.id, 200000, OCT));
    const b2 = await get(o, `/api/budget?month=${OCT}`);
    expect([e.needs, e.wants, e.savings].map((s) => secOf(b2, s.id).budgetedMinor)).toEqual([96620, 57972, 81649]);
    expect(b2.totals.leftOverMinor).toBe(0);
    expect(b2.totals.incomeMinor).toBe(200000 - 6760);

    // Reopening September takes every carry away.
    expect((await reopen(o)).body).toEqual({ lastClosed: null, toClose: SEP });
    const b3 = await get(o, `/api/budget?month=${OCT}`);
    expect(b3.sections[0].subsections.find((x: any) => x.id === e.food.id).carriedMinor).toBe(0);
    expect(secOf(b3, e.savings.id).budgetedMinor).toBe(40000);
    const p3 = await get(o, `/api/pipeline?month=${OCT}`);
    expect(p3.boxes.flatMap((b: any) => b.sources).find((s: any) => s.isLeftovers).incomeMinor).toBe(0);
    expect(secOf(p3, e.savings.id).carriedMinor).toBe(0);

    // Closing again gives the same carries, and never a second leftovers source.
    await close(o).expect(200);
    expect(await get(o, `/api/budget?month=${OCT}`)).toEqual(b2);
    expect((await get(o, '/api/sources')).sources.filter((x: any) => x.isLeftovers)).toHaveLength(1);
  });

  it('variant: Wants keeping its overspending in Wants', async () => {
    const o = await owner();
    const e = await example(o);
    await e.rule(e.wants.id, [{ sectionId: null, basisPoints: 10000 }], 'section');
    const sum = await get(o, `/api/months/${SEP}/close`);
    expect(sum.rows[2]).toEqual({ fromSectionId: e.wants.id, basisPoints: 10000, toSectionId: e.wants.id, amountMinor: -10000 });
    expect(sum.incomeMinor).toBe(3240);
    await close(o).expect(200);
    const pipe = await get(o, `/api/pipeline?month=${OCT}`);
    expect(secOf(pipe, e.wants.id)).toMatchObject({ carriedMinor: -10000, receivedMinor: -10000 });
    expect(pipe.boxes.flatMap((b: any) => b.sources).find((s: any) => s.isLeftovers).incomeMinor).toBe(3240);
  });

  it('keeps September exactly as it was when it closed', async () => {
    const o = await owner();
    const e = await example(o);
    await close(o).expect(200);
    const before = [await get(o, `/api/budget?month=${SEP}`), await get(o, `/api/pipeline?month=${SEP}`)];
    expect(before[0].closed).toBe(true);
    expect(before[1].closed).toBe(true);
    await json(o.patch(`/api/subsections/${e.food.id}`)).send({ budgetMinor: 1 }).expect(200);
    await json(o.put(`/api/steps/${e.step.id}`)).send({ kind: 'percent', shares: [{ sectionId: e.needs.id, basisPoints: 10000 }] }).expect(200);
    await e.rule(e.needs.id, [{ sectionId: null, basisPoints: 10000 }]);
    expect([await get(o, `/api/budget?month=${SEP}`), await get(o, `/api/pipeline?month=${SEP}`)]).toEqual(before);
    expect((await get(o, `/api/budget?month=${OCT}`)).sections[0].subsections[1].carriedMinor).toBe(4999);
  });

  it('gives the cent left by rounding to the first share', async () => {
    const o = await owner();
    const e = await example(o);
    const sum = await get(o, `/api/months/${SEP}/close`);
    // 50.01 at 60% is 30.006: 3000 rounded down, and the cent left goes first
    expect(sum.rows.slice(0, 2).map((x: any) => x.amountMinor)).toEqual([3001, 2000]);
    expect(e.needs.id).toBeGreaterThan(0);
  });
});

describe('which months can be closed', () => {
  it('works out toClose with no transaction, the current month, an earlier month and after a close', async () => {
    const o = await owner();
    expect(await get(o, '/api/months')).toEqual({ lastClosed: null, toClose: null });
    const sec = (await post(o, '/api/sections', { name: 'A' })).section;
    const sub = (await post(o, `/api/sections/${sec.id}/subsections`, { name: 'S', budgetMinor: 100 })).subsection;
    const pocket = (await post(o, '/api/pockets', { name: 'B', kind: 'bank', openingBalanceMinor: 0 })).pocket;
    await post(o, '/api/transactions', mkTx(pocket.id, { subsectionId: sub.id, date: `${OCT}-02` }));
    expect(await get(o, '/api/months')).toEqual({ lastClosed: null, toClose: null });
    await post(o, '/api/transactions', mkTx(pocket.id, { subsectionId: sub.id, date: `${OLDER}-02` }));
    expect(await get(o, '/api/months')).toEqual({ lastClosed: null, toClose: OLDER });

    for (const [m, code] of [[SEP, 'not_closable'], [OCT, 'not_closable'], [ym(-1), 'not_closable']] as const) {
      for (const verb of ['get', 'post'] as const) {
        const r = await json(o[verb](`/api/months/${m}/close`));
        expect([r.status, r.body.error.code, r.body.error.message]).toEqual([409, code, 'This month cannot be closed now.']);
      }
    }
    expect((await reopen(o, OLDER)).body.error).toMatchObject({ code: 'not_reopenable', message: 'Only the last closed month can be reopened.' });
    expect((await close(o, OLDER)).body).toEqual({ lastClosed: OLDER, toClose: SEP });
    expect((await reopen(o, SEP)).status).toBe(409);
    expect((await close(o, SEP)).body).toEqual({ lastClosed: SEP, toClose: null });
    expect((await reopen(o, OLDER)).status).toBe(409);
    expect((await reopen(o, SEP)).body).toEqual({ lastClosed: OLDER, toClose: SEP });

    for (const bad of ['2026-13', 'x', '2026-1']) {
      const r = await json(o.post(`/api/months/${bad}/close`));
      expect([r.status, r.body.error.code, r.body.error.fields]).toEqual([400, 'validation', { month: 'Choose a month.' }]);
    }
  });

  it('locks the transactions of a closed month, and moving into it', async () => {
    const o = await owner();
    const e = await example(o);
    const inSep = (await get(o, `/api/transactions?month=${SEP}`)).transactions[0];
    const mine = (await post(o, '/api/transactions', mkTx(e.pocket.id, { subsectionId: e.food.id, date: `${OCT}-03` }))).transaction;
    await close(o).expect(200);
    const err = (r: any) => [r.status, r.body.error.code, r.body.error.fields, r.body.error.message];
    const closedDate = [400, 'validation', { date: 'This date is in a closed month.' }, 'Check the highlighted fields.'];
    const locked = [409, 'closed', undefined, 'This transaction is in a closed month. Reopen the month to change it.'];
    expect(err(await json(o.post('/api/transactions')).send(mkTx(e.pocket.id, { subsectionId: e.food.id })))).toEqual(closedDate);
    expect(err(await json(o.post('/api/transactions')).send(mkTx(e.pocket.id, { subsectionId: e.food.id, date: `${OLDER}-01` })))).toEqual(closedDate);
    expect(err(await json(o.patch(`/api/transactions/${mine.id}`)).send({ date: `${SEP}-30` }))).toEqual(closedDate);
    expect(err(await json(o.patch(`/api/transactions/${inSep.id}`)).send({ note: 'x' }))).toEqual(locked);
    expect(err(await json(o.patch(`/api/transactions/${inSep.id}`)).send({ date: `${OCT}-01` }))).toEqual(locked);
    expect(err(await json(o.delete(`/api/transactions/${inSep.id}`)))).toEqual(locked);
    await json(o.patch(`/api/transactions/${mine.id}`)).send({ note: 'ok' }).expect(200);
    await reopen(o).expect(200);
    await json(o.patch(`/api/transactions/${inSep.id}`)).send({ note: 'x' }).expect(200);
  });
});

describe('rules of sources, rest rules and deleting', () => {
  it('keeps the leftovers source apart', async () => {
    const o = await owner();
    const e = await example(o);
    const field = (r: any) => [r.status, r.body.error.code, r.body.error.fields];
    const reserved = [400, 'validation', { name: 'This name is kept for money carried from last month.' }];
    expect(field(await json(o.post('/api/sources')).send({ name: "LAST month's Leftovers" }))).toEqual(reserved);
    expect(field(await json(o.patch(`/api/sources/${e.fund.id}`)).send({ name: "last month's leftovers" }))).toEqual(reserved);
    await close(o).expect(200);
    const left = (await get(o, '/api/sources')).sources.find((x: any) => x.isLeftovers);
    expect(left).toMatchObject({ name: "Last month's leftovers", isLeftovers: true });
    expect(field(await json(o.patch(`/api/sources/${left.id}`)).send({ name: 'Other' }))).toEqual([400, 'validation', { name: 'This source keeps its name.' }]);
    const del = await json(o.delete(`/api/sources/${left.id}`));
    expect([del.status, del.body.error.code, del.body.error.message]).toEqual([409, 'in_use', 'This source carries money between months.']);
    expect((await json(o.patch(`/api/sources/${left.id}`)).send({ boxId: e.fund.boxId }).expect(200)).body.source.boxId).toBe(e.fund.boxId);
    expect(field(await json(o.post('/api/transactions')).send(income(e.pocket.id, left.id, 100, OCT)))).toEqual([400, 'validation', { sourceId: 'Choose a source.' }]);
  });

  it('checks every field of a rest rule', async () => {
    const o = await owner();
    const a = (await post(o, '/api/sections', { name: 'A' })).section;
    const b = (await post(o, '/api/sections', { name: 'B' })).section;
    const put = (body: object, id = a.id) => json(o.put(`/api/sections/${id}/rest`)).send(body);
    const bad = async (body: object, field: string, message: string) => {
      const r = await put(body);
      expect([r.status, r.body.error.code, r.body.error.fields]).toEqual([400, 'validation', { [field]: message }]);
    };
    const s = (sectionId: number | null, basisPoints: number) => ({ sectionId, basisPoints });
    const overspent = 'income';
    const add = 'Add at least one destination.';
    const diff = 'Choose a different destination in every row.';
    const pct = 'Enter a percentage above 0 and up to 100 in every row.';
    await bad({ shares: [], overspent }, 'shares', add);
    await bad({ overspent }, 'shares', add);
    await bad({ shares: Array.from({ length: 9 }, (_, i) => s(i, 1000)), overspent }, 'shares', add);
    await bad({ shares: [s(null, 5000), s(null, 5000)], overspent }, 'shares', diff);
    await bad({ shares: [s(b.id, 5000), s(b.id, 5000)], overspent }, 'shares', diff);
    await bad({ shares: [s(99999, 10000)], overspent }, 'shares', diff);
    await bad({ shares: [s(null, 0), s(b.id, 10000)], overspent }, 'shares', pct);
    await bad({ shares: [s(null, 10001)], overspent }, 'shares', pct);
    await bad({ shares: [s(null, 2.5), s(b.id, 9000)], overspent }, 'shares', pct);
    await bad({ shares: [s(null, 5000), s(b.id, 4000)], overspent }, 'shares', 'The percentages must add up to 100.');
    await bad({ shares: [s(null, 10000)], overspent: 'other' }, 'overspent', 'Choose where an overspent rest goes.');
    await bad({ shares: [s(null, 10000)] }, 'overspent', 'Choose where an overspent rest goes.');
    const ok = await put({ shares: [s(b.id, 2500), s(null, 7500)], overspent: 'section' });
    expect(ok.status).toBe(200);
    expect(ok.body.section.rest).toEqual({ shares: [s(b.id, 2500), s(null, 7500)], overspent: 'section' });
    expect((await get(o, '/api/sections')).sections[0].rest).toEqual(ok.body.section.rest);
    expect((await get(o, '/api/sections')).sections[1].rest).toEqual({ shares: [s(null, 10000)], overspent: 'income' });
    expect((await put({ shares: [s(null, 10000)], overspent }, 99999)).status).toBe(404);
  });

  it('answers the three delete cases', async () => {
    const o = await owner();
    const a = (await post(o, '/api/sections', { name: 'A' })).section;
    const b = (await post(o, '/api/sections', { name: 'B' })).section;
    const sub = (await post(o, `/api/sections/${b.id}/subsections`, { name: 'S', budgetMinor: 10000 })).subsection;
    const pocket = (await post(o, '/api/pockets', { name: 'P', kind: 'bank', openingBalanceMinor: 0 })).pocket;
    const src = (await post(o, '/api/sources', { name: 'Job' })).source;
    await post(o, '/api/transactions', income(pocket.id, src.id, 5000));
    const del = async (url: string) => {
      const r = await json(o.delete(url));
      return [r.status, r.body.error?.code, r.body.error?.message];
    };
    await json(o.put(`/api/sections/${a.id}/rest`)).send({ shares: [{ sectionId: b.id, basisPoints: 10000 }], overspent: 'income' }).expect(200);
    expect(await del(`/api/sections/${b.id}`)).toEqual([409, 'in_use', 'This section is used in the pipeline. Remove it from the steps and rest rules first.']);
    await json(o.put(`/api/sections/${a.id}/rest`)).send({ shares: [{ sectionId: a.id, basisPoints: 10000 }], overspent: 'income' }).expect(200);
    await close(o).expect(200);
    expect(await del(`/api/subsections/${sub.id}`)).toEqual([409, 'in_use', 'This subsection has money carried between months.']);
    expect(await del(`/api/sections/${b.id}`)).toEqual([409, 'in_use', 'This section has money carried between months.']);
    await reopen(o).expect(200);
    // a section deletes with its own rule, even one pointing at itself
    expect(await del(`/api/sections/${a.id}`)).toEqual([204, undefined, undefined]);
    await json(o.delete(`/api/subsections/${sub.id}`)).expect(204);
    await json(o.delete(`/api/sections/${b.id}`)).expect(204);
  });

  it('keeps months, rest rules and carries apart between people', async () => {
    const o = await owner();
    const bob = await person(o, 'bob');
    const e = await example(o);
    const bs = (await post(bob, '/api/sections', { name: 'Bob' })).section;
    await close(o).expect(200);
    expect(await get(bob, '/api/months')).toEqual({ lastClosed: null, toClose: null });
    expect((await close(bob)).status).toBe(409);
    expect((await reopen(bob)).status).toBe(409);
    expect((await json(bob.put(`/api/sections/${e.needs.id}/rest`)).send({ shares: [{ sectionId: null, basisPoints: 10000 }], overspent: 'income' })).status).toBe(404);
    const bad = await json(bob.put(`/api/sections/${bs.id}/rest`)).send({ shares: [{ sectionId: e.savings.id, basisPoints: 10000 }], overspent: 'income' });
    expect([bad.status, bad.body.error.fields]).toEqual([400, { shares: 'Choose a different destination in every row.' }]);
    const bb = await get(bob, `/api/budget?month=${OCT}`);
    expect(bb).toMatchObject({ closed: false, totals: { incomeMinor: 0, leftOverMinor: 0 }, sections: [{ id: bs.id, budgetedMinor: 0 }] });
    expect((await get(bob, '/api/sources')).sources).toEqual([]);
    expect((await get(bob, `/api/budget?month=${SEP}`)).closed).toBe(false);
    expect((await get(o, `/api/budget?month=${SEP}`)).closed).toBe(true);
  });
});

describe('a database from before the migration', () => {
  it('gives every section the default rule and keeps its sources', () => {
    const file = path.join(dir, 'old.db');
    const raw = new Database(file);
    raw.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    for (const n of ['001_init.sql', '002_pocket_emoji.sql', '003_section_budget.sql', '004_pipeline.sql']) {
      raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', n), 'utf8'));
      raw.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
    }
    raw.prepare("INSERT INTO users (id, username, display_name, password_hash, base_currency) VALUES (1, 'u', 'u', 'x', 'EUR')").run();
    raw.prepare("INSERT INTO sections (user_id, name, color_slot, position) VALUES (1, 'S', 1, 1)").run();
    raw.prepare("INSERT INTO sources (user_id, name, box_id) VALUES (1, 'Job', 1)").run();
    raw.close();
    const migrated = openDb(file);
    expect(migrated.prepare('SELECT overspent FROM sections').all()).toEqual([{ overspent: 'income' }]);
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM rest_shares').get()).toEqual({ n: 0 });
    expect(migrated.prepare('SELECT is_leftovers AS l FROM sources').all()).toEqual([{ l: 0 }]);
    migrated.close();
  });
});
