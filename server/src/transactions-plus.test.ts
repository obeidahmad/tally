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
const MONTH = new Date().toISOString().slice(0, 7);
const D = `${MONTH}-01`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-txplus-'));
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
const patch = async (a: Agent, url: string, body: object, status = 200) => (await json(a.patch(url)).send(body).expect(status)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const fields = (b: any) => b.error.fields;

async function owner() {
  const a = request.agent(app);
  await json(a.post('/api/auth/setup')).send(acct('sam')).expect(201);
  return a;
}
async function person(o: Agent, name: string) {
  await json(o.post('/api/users')).send(acct(name)).expect(201);
  const a = request.agent(app);
  await json(a.post('/api/auth/login')).send({ username: name, password: PW }).expect(200);
  return a;
}
async function seed(a: Agent) {
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const sub = async (name: string) => (await post(a, `/api/sections/${sec.id}/subsections`, { name, budgetMinor: 30000 })).subsection;
  const food = await sub('Food');
  const home = await sub('Home');
  const fun = await sub('Fun');
  const bank = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 })).pocket;
  const cash = (await post(a, '/api/pockets', { name: 'Cash', kind: 'cash', openingBalanceMinor: 0 })).pocket;
  const src = (await post(a, '/api/sources', { name: 'Job' })).source;
  return { sec, food, home, fun, bank, cash, src };
}
const exp = (pocketId: number, subsectionId: number | null, over: object = {}) =>
  ({ date: D, kind: 'expense', amountMinor: 1000, pocketId, subsectionId, payee: 'Shop', ...over });
const spent = async (a: Agent, id: number) => (await get(a, `/api/budget?month=${MONTH}`)).sections[0].subsections.find((x: any) => x.id === id).spentMinor;
const p = (n: number, sub: number) => ({ subsectionId: sub, amountMinor: n });

describe('search and filters', () => {
  it('combines every filter with AND and rejects bad values', async () => {
    const a = await owner();
    const s = await seed(a);
    const t1 = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { payee: 'Lidl', note: 'weekly SHOP', date: '2026-03-04', tags: ['Bulk'] }))).transaction;
    await post(a, '/api/transactions', exp(s.cash.id, s.home.id, { payee: 'Ikea', date: '2026-03-20' }));
    await post(a, '/api/transactions', { date: '2026-04-01', kind: 'income', amountMinor: 5000, subsectionId: null, pocketId: s.bank.id, sourceId: s.src.id });
    await post(a, '/api/transactions', { date: '2026-04-02', kind: 'transfer', amountMinor: 700, pocketId: s.bank.id, toPocketId: s.cash.id });
    const ids = async (qs: string) => (await get(a, `/api/transactions?${qs}`)).transactions.map((t: any) => t.id);
    expect(await ids('q=lidl')).toEqual([t1.id]);
    expect(await ids('q=SHOP')).toEqual([t1.id]); // the note, ignoring case
    expect(await ids('kind=expense')).toHaveLength(2);
    expect(await ids('kind=income')).toHaveLength(1);
    expect(await ids('kind=transfer')).toHaveLength(1);
    expect(await ids('from=2026-03-20&to=2026-04-01')).toHaveLength(2); // both ends inclusive
    expect(await ids(`pocketId=${s.cash.id}&kind=expense`)).toHaveLength(1);
    expect(await ids(`pocketId=${s.cash.id}&pocketId=${s.bank.id}`)).toHaveLength(4);
    expect(await ids(`subsectionId=${s.food.id}&subsectionId=${s.home.id}`)).toHaveLength(2);
    expect(await ids('tag=bulk')).toEqual([t1.id]);
    expect(await ids('tag=bulk&q=ikea')).toEqual([]);
    expect(await ids('month=2026-03&q=ikea')).toHaveLength(1);
    for (const [qs, f] of [['kind=x', 'kind'], ['from=nope&q=a', 'from'], ['to=2026-13-40&q=a', 'to'], ['subsectionId=a&q=a', 'subsectionId'], ['pocketId=-1&q=a', 'pocketId'], ['month=2026', 'month']] as const)
      expect(fields((await a.get(`/api/transactions?${qs}`).expect(400)).body)).toHaveProperty(f);
  });
  it('matches a split by any of its parts', async () => {
    const a = await owner();
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, null, { splits: [p(400, s.food.id), p(600, s.home.id)] }))).transaction;
    expect((await get(a, `/api/transactions?month=${MONTH}&subsectionId=${s.home.id}`)).transactions.map((x: any) => x.id)).toEqual([t.id]);
    expect((await get(a, `/api/transactions?month=${MONTH}&subsectionId=${s.fun.id}`)).transactions).toEqual([]);
  });
});

describe('splits', () => {
  it('counts each part in its own subsection', async () => {
    const a = await owner();
    const s = await seed(a);
    const parts = [p(333, s.food.id), p(333, s.home.id), p(334, s.fun.id)];
    const t = (await post(a, '/api/transactions', exp(s.bank.id, null, { amountMinor: 1000, splits: parts }))).transaction;
    expect(t).toMatchObject({ subsectionId: null, splits: parts, tags: [], attachments: [] });
    expect([await spent(a, s.food.id), await spent(a, s.home.id), await spent(a, s.fun.id)]).toEqual([333, 333, 334]);
    expect(db.prepare('SELECT SUM(base_amount_minor) AS v FROM transaction_splits').get()).toEqual({ v: 1000 });
    expect((await get(a, `/api/budget?month=${MONTH}`)).unsortedCount).toBe(0);
    expect((await get(a, '/api/reports?months=3')).spending.at(-1).totalMinor).toBe(1000);
    // the pocket loses the whole amount
    expect((await get(a, '/api/pockets')).pockets.find((x: any) => x.id === s.bank.id).balanceMinor).toBe(99000);
  });
  it('shares the base amount by largest remainder', async () => {
    const a = await owner();
    const s = await seed(a);
    db.prepare("INSERT INTO rates (date, currency, per_euro) VALUES ('2000-01-01', 'USD', '1.1')").run();
    const usd = (await post(a, '/api/pockets', { name: 'Dollars', kind: 'bank', currency: 'USD', openingBalanceMinor: 0 })).pocket;
    const t = (await post(a, '/api/transactions', exp(usd.id, null, { amountMinor: 777, splits: [p(111, s.food.id), p(222, s.home.id), p(444, s.fun.id)] }))).transaction;
    const sum = db.prepare('SELECT SUM(base_amount_minor) AS v FROM transaction_splits WHERE transaction_id = ?').get(t.id) as any;
    expect(t.baseAmountMinor).toBeGreaterThan(0);
    expect(sum.v).toBe(t.baseAmountMinor);
  });
  it('enforces 2 to 20 parts, the sum rule and transfers', async () => {
    const a = await owner();
    const s = await seed(a);
    const bad = async (body: object, msg: string) => expect(fields((await json(a.post('/api/transactions')).send(body).expect(400)).body).splits).toBe(msg);
    await bad(exp(s.bank.id, null, { splits: [p(400, s.food.id), p(500, s.food.id)] }), 'The parts add up to 9.00; the transaction is 10.00.');
    await bad(exp(s.bank.id, null, { splits: [p(1000, s.food.id)] }), 'Split into 2 to 20 parts.');
    await bad(exp(s.bank.id, null, { amountMinor: 21, splits: Array.from({ length: 21 }, () => p(1, s.food.id)) }), 'Split into 2 to 20 parts.');
    await bad(exp(s.bank.id, null, { splits: [p(1000, s.food.id), p(0, s.food.id)] }), 'Enter an amount above zero in every part.');
    await bad(exp(s.bank.id, null, { splits: [p(500, s.food.id), p(500, 9999)] }), 'Choose a subsection for every part.');
    await bad({ date: D, kind: 'transfer', amountMinor: 1000, pocketId: s.bank.id, toPocketId: s.cash.id, splits: [p(500, s.food.id), p(500, s.food.id)] }, 'A transfer cannot be split.');
    await post(a, '/api/transactions', exp(s.bank.id, null, { amountMinor: 1000, splits: Array.from({ length: 20 }, () => p(50, s.food.id)) }));
    const b = await person(a, 'kim');
    const theirs = await seed(b);
    await bad(exp(s.bank.id, null, { splits: [p(500, s.food.id), p(500, theirs.food.id)] }), 'Choose a subsection for every part.');
  });
  it('splits income, edits, unsplits and needs new parts after an amount change', async () => {
    const a = await owner();
    const s = await seed(a);
    const inc = (await post(a, '/api/transactions', { date: D, kind: 'income', amountMinor: 900, pocketId: s.bank.id, sourceId: s.src.id, splits: [p(400, s.food.id), p(500, s.home.id)] })).transaction;
    expect(inc.splits).toHaveLength(2);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, null, { splits: [p(400, s.food.id), p(600, s.home.id)] }))).transaction;
    expect(fields(await patch(a, `/api/transactions/${t.id}`, { amountMinor: 2000 }, 400)).splits).toBe('The parts add up to 10.00; the transaction is 20.00.');
    const ok = (await patch(a, `/api/transactions/${t.id}`, { amountMinor: 2000, splits: [p(1500, s.food.id), p(500, s.fun.id)] })).transaction;
    expect(ok.splits).toHaveLength(2);
    expect([await spent(a, s.food.id), await spent(a, s.home.id), await spent(a, s.fun.id)]).toEqual([1500, 0, 500]);
    expect(fields(await patch(a, `/api/transactions/${t.id}`, { splits: null }, 400)).subsectionId).toBeTruthy();
    const un = (await patch(a, `/api/transactions/${t.id}`, { splits: null, subsectionId: s.home.id })).transaction;
    expect(un).toMatchObject({ splits: null, subsectionId: s.home.id });
    expect(db.prepare('SELECT COUNT(*) AS n FROM transaction_splits WHERE transaction_id = ?').get(t.id)).toEqual({ n: 0 });
    expect(await spent(a, s.home.id)).toBe(2000);
    const sp = (await patch(a, `/api/transactions/${t.id}`, { splits: [p(1, s.food.id), p(1999, s.home.id)] })).transaction;
    expect(sp.subsectionId).toBeNull();
    const tr = (await post(a, '/api/transactions', { date: D, kind: 'transfer', amountMinor: 100, pocketId: s.bank.id, toPocketId: s.cash.id })).transaction;
    expect(fields(await patch(a, `/api/transactions/${tr.id}`, { splits: [p(50, s.food.id), p(50, s.home.id)] }, 400)).splits).toBe('A transfer cannot be split.');
  });
  it('refuses splitting in a closed month and keeps subsections in use', async () => {
    const a = await owner();
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { date: '2025-01-10' }))).transaction;
    db.prepare("INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (1, '2025-01', '{}', '{}')").run();
    const r = await patch(a, `/api/transactions/${t.id}`, { splits: [p(500, s.food.id), p(500, s.home.id)] }, 409);
    expect(r.error.code).toBe('closed');
    expect((await patch(a, `/api/transactions/${t.id}`, { tags: ['late'] })).transaction.tags).toEqual(['late']);
    await post(a, '/api/transactions', exp(s.bank.id, null, { splits: [p(500, s.fun.id), p(500, s.home.id)] }));
    await json(a.delete(`/api/subsections/${s.fun.id}`)).expect(409);
    await json(a.delete(`/api/sections/${s.sec.id}`)).expect(409);
  });
  it('counts a split imported expense as sorted and a split once in recurring', async () => {
    const a = await owner();
    const s = await seed(a);
    db.prepare("INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, payee, source) VALUES (1, ?, 'expense', 1000, 1000, ?, 'Bank thing', 'import')").run(D, s.bank.id);
    expect((await get(a, `/api/budget?month=${MONTH}`)).unsortedCount).toBe(1);
    const id = (await get(a, '/api/transactions?unsorted=1')).transactions[0].id;
    await patch(a, `/api/transactions/${id}`, { splits: [p(600, s.food.id), p(400, s.home.id)] });
    expect((await get(a, `/api/budget?month=${MONTH}`)).unsortedCount).toBe(0);
    expect((await get(a, '/api/transactions?unsorted=1')).transactions).toEqual([]);
    const now = new Date();
    const back = (m: number) => new Date(Date.UTC(now.getFullYear(), now.getMonth() - m, 5)).toISOString().slice(0, 10);
    for (const m of [3, 2, 1])
      await post(a, '/api/transactions', exp(s.bank.id, null, { date: back(m), payee: 'Gym', amountMinor: 3000, splits: [p(1000, s.food.id), p(2000, s.home.id)] }));
    const rec = await get(a, '/api/recurring');
    expect(rec.items.find((x: any) => x.payee === 'Gym')).toMatchObject({ amountMinor: 3000, subsectionId: s.home.id });
  });
});

describe('tags', () => {
  it('limits, matches ignoring case, lists with counts and deletes', async () => {
    const a = await owner();
    const s = await seed(a);
    const t1 = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { tags: ['Trip', ' trip ', 'zeta', 'Alpha'] }))).transaction;
    expect(t1.tags).toEqual(['Alpha', 'Trip', 'zeta']);
    const t2 = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { tags: ['TRIP'] }))).transaction;
    expect(t2.tags).toEqual(['Trip']);
    const list = (await get(a, '/api/tags')).tags;
    expect(list.map((x: any) => [x.name, x.count])).toEqual([['Alpha', 1], ['Trip', 2], ['zeta', 1]]);
    const bad = async (tags: unknown, msg: string) => expect(fields(await patch(a, `/api/transactions/${t1.id}`, { tags }, 400)).tags).toBe(msg);
    await bad([''], 'A tag is 1 to 30 characters.');
    await bad(['   '], 'A tag is 1 to 30 characters.');
    await bad(['x'.repeat(31)], 'A tag is 1 to 30 characters.');
    await bad(Array.from({ length: 11 }, (_, i) => `t${i}`), 'Use at most 10 tags.');
    await patch(a, `/api/transactions/${t1.id}`, { tags: Array.from({ length: 10 }, (_, i) => `t${i}`) });
    await patch(a, `/api/transactions/${t1.id}`, { tags: [] });
    const trip = list.find((x: any) => x.name === 'Trip');
    await json(a.delete(`/api/tags/${trip.id}`)).expect(204);
    expect((await get(a, `/api/transactions?month=${MONTH}`)).transactions.every((x: any) => !x.tags.includes('Trip'))).toBe(true);
    await json(a.delete(`/api/tags/${trip.id}`)).expect(404);
  });
  it('is private to each person', async () => {
    const a = await owner();
    const s = await seed(a);
    await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { tags: ['mine'] }));
    const b = await person(a, 'kim');
    expect((await get(b, '/api/tags')).tags).toEqual([]);
    await json(b.delete(`/api/tags/${(await get(a, "/api/tags")).tags[0].id}`)).expect(404);
  });
});

describe('bulk', () => {
  it('changes the subsection, tags and deletes, all or nothing', async () => {
    const a = await owner();
    const s = await seed(a);
    const mk = async (payee: string) => (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { payee }))).transaction;
    const [x, y, z] = [await mk('A'), await mk('B'), await mk('C')] as any[];
    expect(await post(a, '/api/transactions/bulk', { ids: [x.id, y.id], action: 'subsection', subsectionId: s.home.id }, 200)).toEqual({ count: 2 });
    expect(await spent(a, s.home.id)).toBe(2000);
    await post(a, '/api/transactions/bulk', { ids: [x.id, y.id, z.id], action: 'addTag', tag: 'Trip' }, 200);
    await post(a, '/api/transactions/bulk', { ids: [x.id, x.id], action: 'addTag', tag: 'trip' }, 200);
    expect((await get(a, '/api/tags')).tags).toEqual([expect.objectContaining({ name: 'Trip', count: 3 })]);
    await post(a, '/api/transactions/bulk', { ids: [x.id], action: 'removeTag', tag: 'TRIP' }, 200);
    expect((await get(a, '/api/transactions?tag=trip')).transactions).toHaveLength(2);
    const sp = (await post(a, '/api/transactions', exp(s.bank.id, null, { splits: [p(500, s.food.id), p(500, s.home.id)] }))).transaction;
    const r = await post(a, '/api/transactions/bulk', { ids: [x.id, y.id, sp.id], action: 'subsection', subsectionId: s.fun.id }, 400);
    expect(fields(r).ids).toContain('is split');
    expect(await spent(a, s.fun.id)).toBe(0);
    expect(await post(a, '/api/transactions/bulk', { ids: [x.id, y.id], action: 'delete' }, 200)).toEqual({ count: 2 });
    expect((await get(a, `/api/transactions?month=${MONTH}`)).transactions).toHaveLength(2);
  });
  it('refuses transfers, income, closed months, strangers and more than 500', async () => {
    const a = await owner();
    const s = await seed(a);
    const tr = (await post(a, '/api/transactions', { date: D, kind: 'transfer', amountMinor: 100, pocketId: s.bank.id, toPocketId: s.cash.id })).transaction;
    const inc = (await post(a, '/api/transactions', { date: D, kind: 'income', amountMinor: 100, subsectionId: null, pocketId: s.bank.id, sourceId: s.src.id })).transaction;
    const ok = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id))).transaction;
    const refused = async (body: object) => fields(await post(a, '/api/transactions/bulk', body, 400)).ids as string;
    expect(await refused({ ids: [ok.id, tr.id], action: 'subsection', subsectionId: s.home.id })).toContain('is a transfer');
    expect(await refused({ ids: [ok.id, inc.id], action: 'subsection', subsectionId: s.home.id })).toContain('income');
    expect(await refused({ ids: [ok.id, 99999], action: 'delete' })).toContain('99999');
    expect(await refused({ ids: Array.from({ length: 501 }, (_, i) => i + 1), action: 'delete' })).toContain('500');
    expect(await refused({ ids: [], action: 'delete' })).toBeTruthy();
    expect(fields(await post(a, '/api/transactions/bulk', { ids: [ok.id], action: 'nope' }, 400)).action).toBeTruthy();
    expect(fields(await post(a, '/api/transactions/bulk', { ids: [ok.id], action: 'addTag', tag: '' }, 400)).tags).toBeTruthy();
    const old = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id, { date: '2025-01-10', payee: 'Old' }))).transaction;
    db.prepare("INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (1, '2025-01', '{}', '{}')").run();
    expect(await refused({ ids: [ok.id, old.id], action: 'delete' })).toContain('"Old" on 2025-01-10 is in a closed month');
    expect(await refused({ ids: [old.id], action: 'subsection', subsectionId: s.home.id })).toContain('closed month');
    await post(a, '/api/transactions/bulk', { ids: [old.id], action: 'addTag', tag: 'ok' }, 200);
    const b = await person(a, 'kim');
    await json(b.post('/api/transactions/bulk')).send({ ids: [ok.id], action: 'delete' }).expect(400);
    expect((await get(a, `/api/transactions?month=${MONTH}`)).transactions.map((t: any) => t.id)).toContain(ok.id);
  });
});

describe('receipts', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 1)]);
  const PDF = Buffer.from('%PDF-1.4\n%%EOF');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const attach = (a: Agent, id: number, body: Buffer, type: string, name = 'receipt.png') =>
    a.post(`/api/transactions/${id}/attachments`).set('Content-Type', type).set('X-Filename', encodeURIComponent(name)).send(body);
  const stored = () => (fs.existsSync(path.join(dir, 'attachments')) ? fs.readdirSync(path.join(dir, 'attachments')) : []);

  it('stores, checks bytes, serves with safe headers and deletes', async () => {
    const a = await owner();
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id))).transaction;
    const r = await attach(a, t.id, PNG, 'image/png', 'Lidl ün "x".png').expect(201);
    expect(r.body.attachment).toMatchObject({ name: 'Lidl ün "x".png', type: 'image/png', size: PNG.length });
    for (const [buf, type] of [[JPG, 'image/jpeg'], [WEBP, 'image/webp'], [PDF, 'application/pdf']] as const) await attach(a, t.id, buf, type).expect(201);
    const files = stored();
    expect(files).toHaveLength(4);
    expect(files.every((f) => /^[0-9a-f]{32}$/.test(f))).toBe(true);
    const got = await a.get(`/api/attachments/${r.body.attachment.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-disposition']).toBe("inline; filename*=UTF-8''Lidl%20%C3%BCn%20%22x%22.png");
    expect((got.body as Buffer).equals(PNG)).toBe(true);
    expect((await get(a, `/api/transactions?month=${MONTH}`)).transactions[0].attachments).toHaveLength(4);
    const sixth = await attach(a, t.id, PNG, 'image/png').expect(201);
    const seventh = await attach(a, t.id, PNG, 'image/png').expect(409);
    expect(seventh.body.error.message).toBe('A transaction can have at most 5 receipts.');
    await json(a.delete(`/api/attachments/${sixth.body.attachment.id}`)).expect(204);
    await json(a.delete(`/api/attachments/${r.body.attachment.id}`)).expect(204);
    expect(stored()).toHaveLength(3);
    await a.get(`/api/attachments/${r.body.attachment.id}`).expect(404);
    await json(a.delete(`/api/transactions/${t.id}`)).expect(204);
    expect(stored()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
  });
  it('removes files in a bulk delete too', async () => {
    const a = await owner();
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id))).transaction;
    await attach(a, t.id, PNG, 'image/png').expect(201);
    await post(a, '/api/transactions/bulk', { ids: [t.id], action: 'delete' }, 200);
    expect(stored()).toHaveLength(0);
  });
  it('refuses a wrong type, wrong bytes, an empty file and a big one', async () => {
    const a = await owner();
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id))).transaction;
    const msg = 'Attach a JPEG, PNG, WebP or PDF.';
    expect((await attach(a, t.id, PNG, 'text/html').expect(415)).body.error.message).toBe(msg);
    await attach(a, t.id, Buffer.from('<script>alert(1)</script>'), 'image/png').expect(415);
    await attach(a, t.id, PNG, 'application/pdf').expect(415);
    await attach(a, t.id, Buffer.alloc(0), 'image/png').expect(415);
    await json(a.post(`/api/transactions/${t.id}/attachments`)).send({}).expect(415);
    expect((await attach(a, t.id, Buffer.alloc(10 * 1024 * 1024 + 1, 1), 'image/png').expect(413)).body.error.message).toBe('A receipt can be at most 10 MB.');
    await attach(a, 99999, PNG, 'image/png').expect(404);
    expect(stored()).toHaveLength(0);
    const r = await a.post(`/api/transactions/${t.id}/attachments`).set('Content-Type', 'image/png').send(PNG).expect(201);
    expect(r.body.attachment.name).toBe('receipt');
    expect((await attach(a, t.id, PNG, 'image/png', '..\\..\\evil/x.png').expect(201)).body.attachment.name).toBe('x.png');
  });
  it('is reachable by the owner and a sharer, not a stranger', async () => {
    const a = await owner();
    const alex = await person(a, 'alex');
    const kim = await person(a, 'kim');
    const s = await seed(a);
    const t = (await post(a, '/api/transactions', exp(s.bank.id, s.food.id))).transaction;
    const att = (await attach(a, t.id, PNG, 'image/png').expect(201)).body.attachment;
    await kim.get(`/api/attachments/${att.id}`).expect(404);
    await attach(kim, t.id, PNG, 'image/png').expect(404);
    await json(kim.delete(`/api/attachments/${att.id}`)).expect(404);
    await post(a, '/api/sharing/members', { username: 'alex' });
    await post(alex, '/api/sharing/view', { ownerId: (await get(a, '/api/me')).user.id }, 200);
    await alex.get(`/api/attachments/${att.id}`).expect(200);
  });
});
