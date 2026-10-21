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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-share-'));
  db = openDb(path.join(dir, 'tally.db'));
  app = createApp({ db, webDist: path.join(dir, 'no-dist'), ratesUrl: 'http://127.0.0.1:9/none' });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = (r: request.Test) => r.set('Content-Type', 'application/json');
const acct = (username: string, baseCurrency = 'EUR') => ({ username, displayName: username[0]!.toUpperCase() + username.slice(1), password: PW, baseCurrency });
const post = async (a: Agent, url: string, body: object = {}, status = 201) => (await json(a.post(url)).send(body).expect(status)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;

async function people() {
  const sam = request.agent(app);
  await json(sam.post('/api/auth/setup')).send(acct('sam', 'USD')).expect(201);
  const mk = async (name: string) => {
    await json(sam.post('/api/users')).send(acct(name)).expect(201);
    const a = request.agent(app);
    await json(a.post('/api/auth/login')).send({ username: name, password: PW }).expect(200);
    return a;
  };
  return { sam, alex: await mk('alex'), kim: await mk('kim') };
}
const idOf = async (a: Agent) => (await get(a, '/api/me')).user.id as number;

async function shared() {
  const p = await people();
  const samId = await idOf(p.sam);
  await post(p.sam, '/api/sharing/members', { username: 'alex' });
  await post(p.alex, '/api/sharing/view', { ownerId: samId }, 200);
  return { ...p, samId, alexId: await idOf(p.alex) };
}

describe('sharing: adding, removing, leaving', () => {
  it('adds members with the contract errors, lists both sides, switches', async () => {
    const { sam, alex, kim } = await people();
    const samId = await idOf(sam);
    const bad = async (username: string, msg: string) =>
      expect((await json(sam.post('/api/sharing/members')).send({ username }).expect(400)).body.error.fields.username).toBe(msg);
    await bad('nobody', 'There is no account with this username.');
    await bad('sam', 'You cannot add yourself.');
    const { member } = await post(sam, '/api/sharing/members', { username: 'alex' });
    expect(member).toMatchObject({ displayName: 'Alex' });
    await bad('alex', 'This person is already a member.');
    expect(await get(sam, '/api/sharing')).toEqual({ members: [member], sharedWithMe: [], viewing: null });
    expect(await get(alex, '/api/sharing')).toEqual({ members: [], sharedWithMe: [{ ownerId: samId, displayName: 'Sam' }], viewing: null });
    expect(await get(kim, '/api/sharing')).toEqual({ members: [], sharedWithMe: [], viewing: null });
    const e = await json(kim.post('/api/sharing/view')).send({ ownerId: samId }).expect(400);
    expect(e.body.error.fields.ownerId).toBe('Choose a budget shared with you.');
    expect(await post(alex, '/api/sharing/view', { ownerId: samId }, 200)).toEqual({ viewing: samId });
    expect((await get(alex, '/api/me')).user.viewing).toEqual({ ownerId: samId, displayName: 'Sam', baseCurrency: 'USD' });
    expect((await get(alex, '/api/auth/state')).user.viewing.ownerId).toBe(samId);
    expect((await get(sam, '/api/me')).user.viewing).toBeNull();
  });

  it('removing stops the member at once; leaving does too', async () => {
    const { sam, alex, samId, alexId } = await shared();
    await post(sam, '/api/sections', { name: 'Needs' });
    expect((await get(alex, '/api/sections')).sections).toHaveLength(1);
    await json(sam.delete(`/api/sharing/members/${alexId}`)).expect(204);
    expect((await get(alex, '/api/sections')).sections).toHaveLength(0);
    expect((await get(alex, '/api/me')).user.viewing).toBeNull();
    expect((await get(alex, '/api/sharing')).viewing).toBeNull();
    await post(sam, '/api/sharing/members', { username: 'alex' });
    await post(alex, '/api/sharing/view', { ownerId: samId }, 200);
    await json(alex.delete(`/api/sharing/shared/${samId}`)).expect(204);
    expect((await get(alex, '/api/sections')).sections).toHaveLength(0);
    await json(alex.delete(`/api/sharing/shared/${samId}`)).expect(404);
    expect((await get(sam, '/api/sharing')).members).toEqual([]);
  });
});

describe('sharing: a member acts on the owner budget', () => {
  it('reads and writes through every route family; the owner sees it; a third person sees nothing', async () => {
    const { sam, alex, kim, samId, alexId } = await shared();
    const sec = (await post(alex, '/api/sections', { name: 'Needs' })).section;
    const sub = (await post(alex, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 5000 })).subsection;
    const pocket = (await post(alex, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 100000 })).pocket;
    const src = (await post(alex, '/api/sources', { name: 'Pay' })).source;
    await post(alex, `/api/boxes/${src.boxId}/steps`, { kind: 'amount', sectionId: sec.id, amountMinor: 20000 });
    const day = `${MONTH}-02`;
    const inc = (await post(alex, '/api/transactions', { date: day, kind: 'income', amountMinor: 50000, pocketId: pocket.id, subsectionId: null, sourceId: src.id, payee: 'Boss' })).transaction;
    expect(inc).toMatchObject({ createdBy: alexId, createdByName: 'Alex' });
    const exp = (await post(sam, '/api/transactions', { date: day, kind: 'expense', amountMinor: 1000, pocketId: pocket.id, subsectionId: sub.id, payee: 'Shop' })).transaction;
    expect(exp).toMatchObject({ createdBy: samId, createdByName: 'Sam' });
    const list = (await get(sam, `/api/transactions?month=${MONTH}`)).transactions;
    expect(list.map((t: any) => t.createdByName).sort()).toEqual(['Alex', 'Sam']);
    const pipe = await get(sam, `/api/pipeline?month=${MONTH}`);
    expect(pipe.currency).toBe('USD');
    expect(pipe.sections[0].receivedMinor).toBe(20000);
    expect((await get(alex, `/api/budget?month=${MONTH}`)).currency).toBe('USD');
    expect(await get(alex, '/api/months')).toEqual(await get(sam, '/api/months'));
    const mv = (await post(alex, '/api/moves', { month: MONTH, from: { subsectionId: sub.id }, to: { sectionId: sec.id }, amountMinor: 100, reason: 'x' })).move;
    expect((await get(sam, `/api/moves?month=${MONTH}`)).moves).toEqual([mv]);
    const h = (await post(alex, '/api/holdings', { name: 'ETF', pocketId: pocket.id, subsectionId: sub.id, paidMinor: 1000 })).holding;
    expect((await get(sam, '/api/holdings')).holdings.map((x: any) => x.id)).toEqual([h.id]);
    const rule = (await post(alex, '/api/rules', { match: 'lidl', subsectionId: sub.id })).rule;
    expect((await get(sam, '/api/rules')).rules).toEqual([rule]);
    const csv = `Date,Amount,Payee\n${day},-12.50,LIDL Berlin\n`;
    const map = { date: 0, amount: 1, payee: 2, dateFormat: 'YYYY-MM-DD', decimal: '.' };
    expect((await post(alex, '/api/imports', { pocketId: pocket.id, text: csv, mapping: map })).added).toBe(1);
    const imported = (await get(sam, `/api/transactions?month=${MONTH}`)).transactions.find((t: any) => t.source === 'import');
    expect(imported).toMatchObject({ createdBy: alexId, subsectionId: sub.id });
    const rep = await get(alex, '/api/reports');
    expect(rep.currency).toBe('USD');
    expect(rep.spending.at(-1).totalMinor).toBeGreaterThan(0);
    expect((await get(alex, '/api/networth')).currency).toBe('USD');
    await get(alex, '/api/recurring');
    await json(alex.delete(`/api/moves/${mv.id}`)).expect(204);
    expect((await get(sam, `/api/moves?month=${MONTH}`)).moves).toEqual([]);
    // Alex's own budget is empty; Kim, with no share, sees nothing and cannot switch.
    await post(alex, '/api/sharing/view', { ownerId: null }, 200);
    for (const [a, url] of [[alex, '/api/sections'], [alex, '/api/pockets'], [alex, '/api/holdings'], [alex, '/api/rules'], [kim, '/api/sections'], [kim, '/api/pockets'], [kim, '/api/sources']] as const)
      expect(Object.values(await get(a, url))[0]).toEqual([]);
    expect((await get(kim, `/api/transactions?month=${MONTH}`)).transactions).toEqual([]);
    await json(kim.delete(`/api/transactions/${inc.id}`)).expect(404);
    await json(kim.post('/api/sharing/view')).send({ ownerId: samId }).expect(400);
  });

  it('uses the owner base currency', async () => {
    const { sam, alex } = await shared();
    const p = (await post(alex, '/api/pockets', { name: 'Cash', kind: 'cash', openingBalanceMinor: 0 })).pocket;
    expect(p.currency).toBe('USD');
    expect((await get(sam, '/api/pockets')).pockets[0].currency).toBe('USD');
    expect((await get(alex, '/api/rates')).base).toBe('USD');
  });
});

describe('sharing: owner-only routes', () => {
  it('answer 403 owner_only for a member viewing, and work on their own budget', async () => {
    const { sam, alex } = await shared();
    const refused = [
      () => alex.get('/api/banks/registration'),
      () => json(alex.put('/api/banks/registration')).send({}),
      () => alex.get('/api/banks/connections'),
      () => alex.get('/api/brokers/trading212'),
      () => json(alex.put('/api/brokers/trading212')).send({}),
      () => json(alex.delete('/api/brokers/trading212')),
      () => json(alex.post('/api/sharing/members')).send({ username: 'kim' }),
      () => json(alex.delete('/api/sharing/members/1')),
    ];
    for (const r of refused) {
      const res = await r();
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({ code: 'owner_only', message: 'Only Sam can change this.' });
    }
    expect((await get(alex, '/api/me')).user.username).toBe('alex');
    await json(alex.post('/api/me/password')).send({ currentPassword: PW, newPassword: 'another long password' }).expect(204);
    await post(alex, '/api/sharing/view', { ownerId: null }, 200);
    await alex.get('/api/brokers/trading212').expect(200);
    await alex.get('/api/banks/connections').expect(200);
    await post(alex, '/api/sharing/members', { username: 'kim' });
    expect((await get(alex, '/api/sharing')).members.map((m: any) => m.displayName)).toEqual(['Kim']);
  });
});
