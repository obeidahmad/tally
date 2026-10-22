import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';

const FIXTURE = path.join(__dirname, '..', 'test', 'rates.xml'); // 1 EUR = 1.0860 USD on 2026-10-13
const T0 = new Date(2026, 9, 14, 12).getTime(); // 2026-10-14, local
let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-hold-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: FIXTURE, now: () => T0 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const PW = 'correct horse battery';
const json = (r: request.Test) => r.set('Content-Type', 'application/json');
async function person() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send({ username: 'owner', displayName: 'o', password: PW, baseCurrency: 'EUR' }).expect(201);
  return a;
}
async function second(owner: Agent) {
  const b = request.agent(app);
  await json(owner.post('/api/users')).send({ username: 'second', displayName: 'p', password: PW, baseCurrency: 'EUR' }).expect(201);
  await json(b.post('/api/auth/login')).send({ username: 'second', password: PW }).expect(200);
  return b;
}
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const fields = async (r: request.Test, status = 400) => {
  const res = await r;
  expect(res.status).toBe(status);
  return res.body.error.fields ?? res.body.error;
};

// Car has 6,000.00 available in October 2026; Bank is the oldest pocket, so the home pocket.
async function world(a: Agent) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const car = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Car', keep: 'none', budgetMinor: 600000 })).subsection;
  const other = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Other', keep: 'none', budgetMinor: 0 })).subsection;
  const job = (await post(a, '/api/sources', { name: 'Job' })).source;
  await post(a, `/api/boxes/${job.boxId}/steps`, { kind: 'amount', sectionId: sec.id, amountMinor: 600000 });
  const bank = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  const fund = (await post(a, '/api/pockets', { name: 'Fund', kind: 'fund', openingBalanceMinor: 0 })).pocket;
  const broker = (await post(a, '/api/pockets', { name: 'Broker', kind: 'broker', currency: 'USD', openingBalanceMinor: 210000 })).pocket;
  await post(a, '/api/transactions', { date: '2026-10-02', kind: 'income', amountMinor: 600000, pocketId: bank.id, subsectionId: null, sourceId: job.id });
  return { sec, car, other, job, bank, fund, broker };
}
describe('holdings', () => {
  it("counts a holding's worth in another currency", async () => {
    const a = await person();
    const { car, broker } = await world(a);
    const { holding } = await post(a, '/api/holdings', { name: 'ETF', pocketId: broker.id, subsectionId: car.id, paidMinor: 210000 });
    expect(holding).toMatchObject({ paidMinor: 210000, worthMinor: 210000, worthCurrency: 'USD', worthDate: '2026-10-14', soldDate: null });
    await json(a.patch(`/api/holdings/${holding.id}`)).send({ worthMinor: 231000 }).expect(200);

    const p = (await get(a, '/api/pockets')).pockets.find((x: any) => x.id === broker.id);
    expect(p).toMatchObject({ balanceMinor: 0, valueMinor: 231000, baseValueMinor: 212707 });
    expect(p.baseBalanceMinor).toBeUndefined();
    const nw = await get(a, '/api/networth');
    expect(nw.totalMinor).toBe(600000 + 212707);
    expect(nw.byCurrency).toEqual([
      { currency: 'EUR', amountMinor: 600000, baseMinor: 600000, rate: null },
      { currency: 'USD', amountMinor: 231000, baseMinor: 212707, rate: '0.9208' },
    ]);
  });
});

describe('selling', () => {
  async function held(a: Agent, over: object = {}) {
    const w = await world(a);
    const { holding } = await post(a, '/api/holdings', { name: 'ETF', pocketId: w.broker.id, subsectionId: w.car.id, paidMinor: 210000, ...over });
    return { ...w, holding };
  }

  it('records a profit as income from a source, and the holding moves to sold', async () => {
    const a = await person();
    const { holding, job, broker } = await held(a);
    await fields(json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 240000 }));
    expect(await fields(json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 240000 }))).toEqual({ sourceId: 'Choose a source.' });
    const r = (await json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 240000, sourceId: job.id }).expect(200)).body;
    expect(r.holding).toMatchObject({ id: holding.id, soldDate: '2026-10-10' });
    expect(r.transaction).toMatchObject({ date: '2026-10-10', kind: 'income', amountMinor: 30000, pocketId: broker.id, sourceId: job.id, subsectionId: null, payee: '', note: 'Sale of ETF' });
    // The cost is back in cash plus the profit.
    expect((await get(a, '/api/pockets')).pockets.find((x: any) => x.id === broker.id)).toMatchObject({ balanceMinor: 240000, valueMinor: 240000 });
    expect((await get(a, '/api/holdings')).holdings).toEqual([r.holding]);
    expect(await fields(json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 1 }), 409)).toMatchObject({ code: 'sold' });
    await fields(json(a.patch(`/api/holdings/${holding.id}`)).send({ name: 'x' }), 409);
    await json(a.delete(`/api/holdings/${holding.id}`)).expect(409);
  });

  it('records a loss as an expense in the subsection', async () => {
    const a = await person();
    const { holding, car, broker } = await held(a);
    const r = (await json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 200000 }).expect(200)).body;
    expect(r.transaction).toMatchObject({ kind: 'expense', amountMinor: 10000, pocketId: broker.id, subsectionId: car.id, payee: '', note: 'Sale of ETF', sourceId: null });
    expect((await get(a, '/api/budget?month=2026-10')).sections[0].subsections[0]).toMatchObject({ id: car.id, spentMinor: 9091 }); // 100.00 USD at 1.1000 (the rate of 2026-10-09)
    expect((await get(a, '/api/pockets')).pockets.find((x: any) => x.id === broker.id)).toMatchObject({ balanceMinor: 200000 });
  });

  it('records nothing when sold at cost', async () => {
    const a = await person();
    const { holding } = await held(a);
    const r = (await json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 210000 }).expect(200)).body;
    expect(r.transaction).toBeNull();
    expect(r.holding.soldDate).toBe('2026-10-10');
    expect((await get(a, '/api/transactions?month=2026-10')).transactions.filter((t: any) => t.note === 'Sale of ETF')).toEqual([]);
  });

  it('refuses a sale in a closed month and leaves the holding held', async () => {
    const a = await person();
    const { holding, job } = await held(a);
    const uid = db.prepare('SELECT id FROM users').pluck().get();
    db.prepare("INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (?, '2026-09', '{}', '{}')").run(uid);
    expect(await fields(json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-09-30', receivedMinor: 300000, sourceId: job.id }))).toEqual({ date: 'This date is in a closed month.' });
    expect((await get(a, '/api/holdings')).holdings[0].soldDate).toBeNull();
  });

  it('lists held holdings first, then sold ones, and deletes an unsold one', async () => {
    const a = await person();
    const { holding, broker, car } = await held(a);
    const { holding: second } = await post(a, '/api/holdings', { name: 'Bond', pocketId: broker.id, subsectionId: car.id, paidMinor: 0 });
    await json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 210000 }).expect(200);
    expect((await get(a, '/api/holdings')).holdings.map((h: any) => h.id)).toEqual([second.id, holding.id]);
    await json(a.delete(`/api/holdings/${second.id}`)).expect(204);
    await json(a.delete(`/api/holdings/${second.id}`)).expect(404);
  });
});

describe('holding fields', () => {
  it('checks every field', async () => {
    const a = await person();
    const { car, broker } = await world(a);
    const ok = { name: 'ETF', pocketId: broker.id, subsectionId: car.id, paidMinor: 100 };
    const add = (over: object) => fields(json(a.post('/api/holdings')).send({ ...ok, ...over }));
    expect(await add({ name: '  ' })).toEqual({ name: 'Enter a name.' });
    expect(await add({ name: 'x'.repeat(61) })).toEqual({ name: 'Use 60 characters or fewer.' });
    expect(await add({ pocketId: 9999 })).toEqual({ pocketId: 'Choose a pocket.' });
    expect(await add({ pocketId: 'a' })).toEqual({ pocketId: 'Choose a pocket.' });
    expect(await add({ subsectionId: 9999 })).toEqual({ subsectionId: 'Choose a subsection.' });
    for (const paidMinor of [-1, 1.5, 10 ** 13 + 1, '5', undefined]) expect(await add({ paidMinor })).toEqual({ paidMinor: 'Enter an amount, 0 or more.' });
    for (const worthMinor of [-1, 1.5, 10 ** 13 + 1]) expect(await add({ worthMinor })).toEqual({ worthMinor: 'Enter an amount, 0 or more.' });
    for (const worthCurrency of ['JPY', 'XXX', 5]) expect(await add({ worthCurrency })).toEqual({ worthCurrency: 'Choose a currency.' });
    await post(a, '/api/holdings', { ...ok, paidMinor: 0, worthMinor: 10 ** 13, worthCurrency: 'GBP' });

    const { holding } = await post(a, '/api/holdings', ok);
    const edit = (over: object) => fields(json(a.patch(`/api/holdings/${holding.id}`)).send(over));
    expect(await edit({ name: '' })).toEqual({ name: 'Enter a name.' });
    expect(await edit({ subsectionId: 9999 })).toEqual({ subsectionId: 'Choose a subsection.' });
    expect(await edit({ paidMinor: -5 })).toEqual({ paidMinor: 'Enter an amount, 0 or more.' });
    expect(await edit({ worthCurrency: 'XXX' })).toEqual({ worthCurrency: 'Choose a currency.' });

    const sell = (over: object) => fields(json(a.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 100, ...over }));
    expect(await sell({ date: '2026-02-30' })).toEqual({ date: 'Enter a real date.' });
    expect(await sell({ date: undefined })).toEqual({ date: 'Enter a date.' });
    for (const receivedMinor of [-1, 1.5, 10 ** 13 + 1, undefined]) expect(await sell({ receivedMinor })).toEqual({ receivedMinor: 'Enter an amount, 0 or more.' });
    expect(await sell({ receivedMinor: 200, sourceId: 9999 })).toEqual({ sourceId: 'Choose a source.' });
    await a.get('/api/holdings/x').expect(404);
    await json(a.delete('/api/holdings/9999')).expect(404);
  });

  it('sets the worth date only when the worth changes, and keeps the pocket', async () => {
    const a = await person();
    const { car, other, broker, bank } = await world(a);
    const { holding } = await post(a, '/api/holdings', { name: 'ETF', pocketId: broker.id, subsectionId: car.id, paidMinor: 100 });
    db.prepare("UPDATE holdings SET worth_date = '2026-09-01'").run();
    const renamed = (await json(a.patch(`/api/holdings/${holding.id}`)).send({ name: 'Fund', subsectionId: other.id, pocketId: bank.id }).expect(200)).body.holding;
    expect(renamed).toMatchObject({ name: 'Fund', subsectionId: other.id, pocketId: broker.id, worthDate: '2026-09-01' });
    const worth = (await json(a.patch(`/api/holdings/${holding.id}`)).send({ worthCurrency: 'EUR' }).expect(200)).body.holding;
    expect(worth).toMatchObject({ worthCurrency: 'EUR', worthMinor: 100, worthDate: '2026-10-14' });
  });

  it('keeps pockets and subsections with holdings from being deleted', async () => {
    const a = await person();
    const { car, sec, broker } = await world(a);
    await post(a, '/api/holdings', { name: 'ETF', pocketId: broker.id, subsectionId: car.id, paidMinor: 100 });
    await json(a.delete(`/api/pockets/${broker.id}`)).expect(409);
    await json(a.delete(`/api/subsections/${car.id}`)).expect(409);
    await json(a.delete(`/api/sections/${sec.id}`)).expect(409);
    await json(a.patch(`/api/pockets/${broker.id}`)).send({ name: 'Broker', kind: 'broker', currency: 'EUR', openingBalanceMinor: 210000 }).expect(400);
  });
});

describe('isolation', () => {
  it("keeps one person's holdings from another", async () => {
    const a = await person();
    const { car, broker, bank } = await world(a);
    const { holding } = await post(a, '/api/holdings', { name: 'ETF', pocketId: broker.id, subsectionId: car.id, paidMinor: 100 });
    const b = await second(a);
    const mine = await world(b);
    expect((await get(b, '/api/holdings')).holdings).toEqual([]);
    for (const m of ['patch', 'delete'] as const) await json(b[m](`/api/holdings/${holding.id}`)).send({ name: 'x' }).expect(404);
    await json(b.post(`/api/holdings/${holding.id}/sell`)).send({ date: '2026-10-10', receivedMinor: 1 }).expect(404);
    await fields(json(b.post('/api/holdings')).send({ name: 'x', pocketId: broker.id, subsectionId: mine.car.id, paidMinor: 1 }));
    await fields(json(b.post('/api/holdings')).send({ name: 'x', pocketId: mine.broker.id, subsectionId: car.id, paidMinor: 1 }));
    expect((await get(a, '/api/holdings')).holdings).toHaveLength(1);
  });
});
