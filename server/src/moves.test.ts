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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-moves-'));
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
const ym = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const SEP = ym(1);
const OCT = ym(0);

const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const sub = (b: any, id: number) => b.sections.flatMap((x: any) => x.subsections).find((x: any) => x.id === id);
const sec = (b: any, id: number) => b.sections.find((x: any) => x.id === id);

// Needs gets 2,700.00 in `month`: Emergencies (goal, target 3,000.00) budgets 2,400.00, Car 300.00, so Needs' rest is 0.
async function setup(a: Agent, month = OCT) {
  const needs = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const wants = (await post(a, '/api/sections', { name: 'Wants' })).section;
  const emerg = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Emergencies', kind: 'goal', budgetMinor: 240000, capMinor: 300000 })).subsection;
  const car = (await post(a, `/api/sections/${needs.id}/subsections`, { name: 'Car', keep: 'none', budgetMinor: 30000 })).subsection;
  const pay = (await post(a, '/api/sources', { name: 'Paycheck' })).source;
  await post(a, `/api/boxes/${pay.boxId}/steps`, { kind: 'amount', sectionId: needs.id, amountMinor: 280000 });
  const pocket = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  await post(a, '/api/transactions', { date: `${month}-05`, kind: 'income', amountMinor: 280000, pocketId: pocket.id, subsectionId: null, sourceId: pay.id });
  return { needs, wants, emerg, car, pocket };
}
const mv = (a: Agent, body: object) => json(a.post('/api/moves')).send(body);
const body = (from: object, to: object, amountMinor: number, over: object = {}) => ({ month: OCT, from, to, amountMinor, reason: 'Tyres', ...over });

describe('moving money', () => {
  it('the example: 200.00 from Emergencies to Car', async () => {
    const o = await owner();
    const e = await setup(o);
    const r = (await mv(o, body({ subsectionId: e.emerg.id }, { subsectionId: e.car.id }, 20000)).expect(201)).body.move;
    expect(r).toMatchObject({ month: OCT, from: { subsectionId: e.emerg.id }, to: { subsectionId: e.car.id }, amountMinor: 20000, reason: 'Tyres' });
    const b = await get(o, `/api/budget?month=${OCT}`);
    expect(sub(b, e.emerg.id)).toMatchObject({ availableMinor: 220000, movedMinor: -20000 });
    expect(sub(b, e.car.id)).toMatchObject({ availableMinor: 50000, movedMinor: 20000 });
    expect(sec(b, e.needs.id)).toMatchObject({ movedMinor: 0, availableMinor: 280000, restMinor: 10000 });
    expect(b.totals.availableMinor).toBe(280000);
    expect((await get(o, `/api/moves?month=${OCT}`)).moves).toEqual([r]);
    expect((await get(o, `/api/moves?month=${SEP}`)).moves).toEqual([]);
    await json(o.delete(`/api/moves/${r.id}`)).expect(204);
    const after = await get(o, `/api/budget?month=${OCT}`);
    expect(sub(after, e.emerg.id)).toMatchObject({ availableMinor: 240000, movedMinor: 0 });
    await json(o.delete(`/api/moves/${r.id}`)).expect(404);
  });

  it('moves from and to a section rest', async () => {
    const o = await owner();
    const e = await setup(o); // Needs' rest is 10000 (2,800 - 2,400 - 300)
    await mv(o, body({ sectionId: e.needs.id }, { sectionId: e.wants.id }, 4000)).expect(201);
    await mv(o, body({ sectionId: e.wants.id }, { subsectionId: e.car.id }, 1500)).expect(201);
    const b = await get(o, `/api/budget?month=${OCT}`);
    expect(sec(b, e.needs.id)).toMatchObject({ movedMinor: -4000, restMinor: 6000, availableMinor: 277500 });
    expect(sec(b, e.wants.id)).toMatchObject({ movedMinor: 2500, restMinor: 2500, availableMinor: 2500 });
    expect(sub(b, e.car.id)).toMatchObject({ movedMinor: 1500, availableMinor: 31500 });
    expect(b.totals.availableMinor).toBe(280000);
  });

  it('limits the amount to what the source has', async () => {
    const o = await owner();
    const e = await setup(o);
    const fail = async (b: object, field: string, msg: string) =>
      expect((await mv(o, b).expect(400)).body.error.fields[field]).toBe(msg);
    const from = { subsectionId: e.emerg.id }, to = { subsectionId: e.car.id };
    for (const bad of [0, -5, 1.5, '10', null, 10 ** 13 + 1]) await fail(body(from, to, bad as any), 'amountMinor', 'Enter an amount above zero.');
    await fail(body(from, to, 240001), 'amountMinor', 'Emergencies has only 2,400.00 to move.');
    await mv(o, body(from, to, 240000)).expect(201);
    await fail(body(from, to, 1), 'amountMinor', 'Emergencies has nothing to move.');
    await fail(body({ sectionId: e.wants.id }, to, 1), 'amountMinor', 'Wants has nothing to move.');
    expect((await get(o, `/api/moves?month=${OCT}`)).moves).toHaveLength(1);
  });

  it('checks every field', async () => {
    const o = await owner();
    const e = await setup(o);
    const from = { subsectionId: e.emerg.id }, to = { subsectionId: e.car.id };
    const fail = async (b: object, field: string, msg: string) =>
      expect((await mv(o, b).expect(400)).body.error.fields[field]).toBe(msg);
    for (const bad of [undefined, null, 'x', {}, { subsectionId: 999 }, { sectionId: 999 }, { subsectionId: e.car.id, sectionId: e.needs.id }, { subsectionId: '1' }]) {
      await fail(body(bad as any, to, 100), 'from', 'Choose where the money comes from.');
      await fail(body(from, bad as any, 100), 'to', 'Choose where the money goes.');
    }
    await fail(body(from, from, 100), 'to', 'Choose a different place.');
    await fail(body({ sectionId: e.needs.id }, { sectionId: e.needs.id }, 100), 'to', 'Choose a different place.');
    const noReason = 'Say why you are moving this money.';
    for (const bad of ['', '   ', undefined, 5]) await fail(body(from, to, 100, { reason: bad }), 'reason', noReason);
    await fail(body(from, to, 100, { reason: 'x'.repeat(201) }), 'reason', 'Use 200 characters or fewer.');
    await fail(body(from, to, 100, { month: '2026-13' }), 'month', 'Use a month like 2026-10.');
    expect((await mv(o, body(from, to, 100, { reason: '  ok  ' })).expect(201)).body.move.reason).toBe('ok');
    expect((await mv(o, body(from, to, 100, { reason: 'x'.repeat(200) })).expect(201)).body.move.reason).toHaveLength(200);
  });

  it('keeps what moves into the close: kept and rest', async () => {
    const o = await owner();
    const e = await setup(o, SEP);
    await mv(o, body({ subsectionId: e.emerg.id }, { subsectionId: e.car.id }, 20000, { month: SEP })).expect(201);
    // Emergencies keeps 2,200.00 (under its 3,000.00 target); Car keeps nothing, so 500.00 + Needs' rest 100.00 go to income.
    const sum = (await o.get(`/api/months/${SEP}/close`).expect(200)).body;
    expect(sum.keptMinor).toBe(220000);
    expect(sum.incomeMinor).toBe(60000);
    await json(o.post(`/api/months/${SEP}/close`)).expect(200);
    const oct = await get(o, `/api/budget?month=${OCT}`);
    expect(sub(oct, e.emerg.id).carriedMinor).toBe(220000);
    expect(sub(oct, e.car.id).carriedMinor).toBe(0);
    expect(oct.totals.incomeMinor).toBe(60000);
  });

  it('refuses changes in a closed month and keeps the moves listed', async () => {
    const o = await owner();
    const e = await setup(o, SEP);
    const m = (await mv(o, body({ subsectionId: e.emerg.id }, { subsectionId: e.car.id }, 100, { month: SEP })).expect(201)).body.move;
    await json(o.post(`/api/months/${SEP}/close`)).expect(200);
    const closed = { code: 'closed', message: 'This month is closed. Reopen it to change it.' };
    expect((await mv(o, body({ subsectionId: e.emerg.id }, { subsectionId: e.car.id }, 100, { month: SEP })).expect(409)).body.error).toEqual(closed);
    expect((await json(o.delete(`/api/moves/${m.id}`)).expect(409)).body.error).toEqual(closed);
    expect((await get(o, `/api/moves?month=${SEP}`)).moves).toEqual([m]);
    expect(sub(await get(o, `/api/budget?month=${SEP}`), e.car.id).movedMinor).toBe(100);
  });

  it('blocks deleting a subsection or section with a move', async () => {
    const o = await owner();
    const e = await setup(o);
    await mv(o, body({ subsectionId: e.emerg.id }, { sectionId: e.wants.id }, 100)).expect(201);
    expect((await json(o.delete(`/api/subsections/${e.emerg.id}`)).expect(409)).body.error).toMatchObject({ code: 'in_use', message: 'This subsection has money moved this month.' });
    expect((await json(o.delete(`/api/sections/${e.wants.id}`)).expect(409)).body.error).toMatchObject({ code: 'in_use', message: 'This section has money moved this month.' });
    expect((await json(o.delete(`/api/sections/${e.needs.id}`)).expect(409)).body.error.code).toBe('in_use');
    await json(o.delete(`/api/subsections/${e.car.id}`)).expect(204);
  });

  it('keeps people apart', async () => {
    const o = await owner();
    const e = await setup(o);
    const p = await person(o, 'other');
    const f = await setup(p);
    const m = (await mv(o, body({ subsectionId: e.emerg.id }, { subsectionId: e.car.id }, 100)).expect(201)).body.move;
    expect((await mv(p, body({ subsectionId: e.emerg.id }, { subsectionId: f.car.id }, 100)).expect(400)).body.error.fields.from).toBe('Choose where the money comes from.');
    expect((await mv(p, body({ subsectionId: f.emerg.id }, { sectionId: e.wants.id }, 100)).expect(400)).body.error.fields.to).toBe('Choose where the money goes.');
    expect((await get(p, `/api/moves?month=${OCT}`)).moves).toEqual([]);
    await json(p.delete(`/api/moves/${m.id}`)).expect(404);
    expect(sub(await get(p, `/api/budget?month=${OCT}`), f.emerg.id).movedMinor).toBe(0);
    await request(app).get(`/api/moves?month=${OCT}`).expect(401);
  });
});
