import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb, type Db } from './db';
import { readAmount, readCsv, readDate } from './csv';

let dir: string;
let db: Db;
let app: ReturnType<typeof createApp>;
type Agent = ReturnType<typeof request.agent>;
const PW = 'correct horse battery';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-import-'));
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
const post = async (a: Agent, url: string, body: object = {}) => (await json(a.post(url)).send(body).expect(201)).body;
const get = async (a: Agent, url: string) => (await a.get(url).expect(200)).body;
const bad = async (r: request.Test, field: string, message: string, status = 400) => {
  const res = await r.expect(status);
  expect(res.body.error.fields[field]).toBe(message);
};

const ym = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const SEP = ym(1);
const OCT = ym(0);

// A person with a pocket, a Food subsection and a Pay source.
async function setup(a: Agent) {
  const pocket = (await post(a, '/api/pockets', { name: 'Bank', kind: 'bank', openingBalanceMinor: 0 })).pocket;
  const sec = (await post(a, '/api/sections', { name: 'Needs' })).section;
  const food = (await post(a, `/api/sections/${sec.id}/subsections`, { name: 'Food', budgetMinor: 50000 })).subsection;
  const pay = (await post(a, '/api/sources', { name: 'Pay' })).source;
  return { pocket, food, pay };
}
const SEMI = `Datum;Beschreibung;Betrag;Referenz
05.${OCT.slice(5)}.${OCT.slice(0, 4)};LIDL Berlin;-12,50;card
06.${OCT.slice(5)}.${OCT.slice(0, 4)};Employer;"1.500,00";salary
`;
const MAP = { date: 0, dateFormat: 'DD.MM.YYYY', amount: 2, payee: 1, note: 3, decimal: ',' };
const imp = (a: Agent, pocketId: number, text: string, mapping: object = MAP) => json(a.post('/api/imports')).send({ pocketId, text, mapping });
const prev = (a: Agent, pocketId: number, text: string) => json(a.post('/api/imports/preview')).send({ pocketId, text });
const list = async (a: Agent, q: string) => (await get(a, `/api/transactions?${q}`)).transactions;
const ISO = { date: 0, dateFormat: 'YYYY-MM-DD', amount: 2, payee: 1, decimal: '.' };

describe('csv reader', () => {
  it('reads commas, semicolons and tabs, quotes and newlines in quotes', () => {
    expect(readCsv('a,b\n1,2')).toEqual({ delimiter: ',', headers: ['a', 'b'], rows: [['1', '2']] });
    expect(readCsv('a;b;c\r\n1;2;3\r\n')?.delimiter).toBe(';');
    expect(readCsv('a\tb\n1\t2')?.delimiter).toBe('\t');
    expect(readCsv('a;b\n"x;y";"line1\nline2 ""q"""')?.rows).toEqual([['x;y', 'line1\nline2 "q"']]);
    expect(readCsv('﻿a,b\n1,2')?.headers).toEqual(['a', 'b']);
  });
  it('refuses what is not a statement', () => {
    for (const t of ['', 'justone\nrow', 'a,b\n1', 'a,b\n"open,1']) expect(readCsv(t)).toBeNull();
  });
  it('reads each date format and both decimal marks', () => {
    expect(readDate('2026-03-04', 'YYYY-MM-DD')).toBe('2026-03-04');
    expect(readDate('04/03/2026', 'DD/MM/YYYY')).toBe('2026-03-04');
    expect(readDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04');
    expect(readDate('04.03.2026', 'DD.MM.YYYY')).toBe('2026-03-04');
    expect(readDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(readDate('04.03.26', 'DD.MM.YYYY')).toBeNull();
    expect(readAmount('-1,234.50', '.', 2)).toBe(-123450);
    expect(readAmount('1.234,5', ',', 2)).toBe(123450);
    expect(readAmount('12', '.', 0)).toBe(12);
    expect(readAmount('12.5', '.', 0)).toBeNull();
    expect(readAmount('x', '.', 2)).toBeNull();
  });
});

describe('preview', () => {
  it('answers delimiter, headers, five rows and a guess', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const body = SEMI.split('\n')[1]!;
    const many = SEMI + (body + '\n').repeat(6);
    const res = (await prev(a, pocket.id, many).expect(200)).body;
    expect(res.delimiter).toBe(';');
    expect(res.headers).toEqual(['Datum', 'Beschreibung', 'Betrag', 'Referenz']);
    expect(res.rows.length).toBe(5);
    expect(res.guess).toEqual({ date: 0, dateFormat: 'DD.MM.YYYY', amount: 2, debit: null, credit: null, payee: 1, note: 3, decimal: ',' });
  });
  it('guesses english headers, debit and credit, and the decimal mark', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const g = (await prev(a, pocket.id, 'Date,Description,Debit,Credit,Reference\n2026-01-05,Shop,"12,50",,x\n').expect(200)).body.guess;
    expect(g).toEqual({ date: 0, dateFormat: 'YYYY-MM-DD', amount: null, debit: 2, credit: 3, payee: 1, note: 4, decimal: ',' });
    const h = (await prev(a, pocket.id, 'Date,Amount,Payee\n13/01/2026,-4.20,Shop\n').expect(200)).body.guess;
    expect(h).toMatchObject({ amount: 1, payee: 2, dateFormat: 'DD/MM/YYYY', decimal: '.' });
  });
  it('checks the fields', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    await bad(prev(a, pocket.id, 'x'.repeat(5_000_001)), 'text', 'The file is too large.');
    await bad(prev(a, pocket.id, 'no csv here'), 'text', 'This file does not look like a CSV statement.');
    await bad(prev(a, pocket.id, 'a,b\n1,2,3'), 'text', 'This file does not look like a CSV statement.');
    await bad(prev(a, 999, SEMI), 'pocketId', 'Choose a pocket.');
  });
});

describe('import', () => {
  it('adds rows as imported transactions that need sorting', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const r = (await imp(a, pocket.id, SEMI).expect(201)).body;
    expect(r).toEqual({ added: 2, duplicates: 0, closed: 0, unsorted: 2 });
    const t = await list(a, `month=${OCT}`);
    expect(t.map((x: any) => [x.kind, x.amountMinor, x.payee, x.note, x.source, x.subsectionId, x.sourceId])).toEqual([
      ['income', 150000, 'Employer', 'salary', 'import', null, null],
      ['expense', 1250, 'LIDL Berlin', 'card', 'import', null, null],
    ]);
    expect((await get(a, '/api/pockets')).pockets[0].balanceMinor).toBe(150000 - 1250);
  });
  it('reads the debit and credit columns and skips zero', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const csv = `d,p,out,in\n${OCT}-02,A,"1,50",\n${OCT}-03,B,,"2,00"\n${OCT}-04,C,0,0\n`;
    const m = { date: 0, dateFormat: 'YYYY-MM-DD', debit: 2, credit: 3, payee: 1, decimal: ',' };
    expect((await imp(a, pocket.id, csv, m).expect(201)).body).toMatchObject({ added: 2 });
    const t = await list(a, `month=${OCT}`);
    expect(t.map((x: any) => [x.kind, x.amountMinor])).toEqual([['income', 200], ['expense', 150]]);
  });
  it('stops everything on a bad row, naming it', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const csv = `d;p;a\n${OCT}-02;A;-1.00\n${OCT}-03;B;oops\n`;
    await bad(imp(a, pocket.id, csv, ISO), 'mapping', 'Row 3 has a date or amount this mapping cannot read.');
    expect(await list(a, `month=${OCT}`)).toEqual([]);
    await bad(imp(a, pocket.id, csv, { ...ISO, dateFormat: 'DD/MM/YYYY' }), 'mapping', 'Row 2 has a date or amount this mapping cannot read.');
  });
  it('checks the mapping shape', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const m = { date: 0, dateFormat: 'DD.MM.YYYY', payee: 1, decimal: ',' };
    await bad(imp(a, pocket.id, SEMI, m), 'mapping', 'Choose the columns of this file.');
    await bad(imp(a, pocket.id, SEMI, { ...m, amount: 2, debit: 2, credit: 3 }), 'mapping', 'Choose the columns of this file.');
    await bad(imp(a, pocket.id, SEMI, { ...m, amount: 9 }), 'mapping', 'Choose the columns of this file.');
    await bad(imp(a, pocket.id, SEMI, null as any), 'mapping', 'Choose the columns of this file.');
  });
  it('skips duplicates against the pocket and within the file, as many as already there', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    const csv = (n: number) => 'd;p;a\n' + `${OCT}-02;Shop;-5.00\n`.repeat(n);
    expect((await imp(a, pocket.id, csv(2), ISO).expect(201)).body).toMatchObject({ added: 2, duplicates: 0 });
    expect((await imp(a, pocket.id, csv(2), ISO).expect(201)).body).toMatchObject({ added: 0, duplicates: 2 });
    expect((await imp(a, pocket.id, csv(3), ISO).expect(201)).body).toMatchObject({ added: 1, duplicates: 2 });
    // A hand-entered one counts too.
    await post(a, '/api/transactions', { date: `${OCT}-09`, kind: 'expense', amountMinor: 700, pocketId: pocket.id, subsectionId: food.id, payee: 'Cafe' });
    const other = `d;p;a\n${OCT}-09;Cafe;-7.00\n`;
    expect((await imp(a, pocket.id, other, ISO).expect(201)).body).toMatchObject({ added: 0, duplicates: 1 });
    const p2 = (await post(a, '/api/pockets', { name: 'Other', kind: 'bank', openingBalanceMinor: 0 })).pocket;
    expect((await imp(a, p2.id, other, ISO).expect(201)).body).toMatchObject({ added: 1, duplicates: 0 });
  });
  it('skips rows in a closed month', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    await post(a, '/api/transactions', { date: `${SEP}-02`, kind: 'expense', amountMinor: 100, pocketId: pocket.id, subsectionId: food.id, payee: 'x' });
    await json(a.post(`/api/months/${SEP}/close`)).expect(200);
    const csv = `d;p;a\n${SEP}-03;Old;-1.00\n${OCT}-03;New;-2.00\n`;
    expect((await imp(a, pocket.id, csv, ISO).expect(201)).body).toEqual({ added: 1, duplicates: 0, closed: 1, unsorted: 1 });
  });
});

describe('rules', () => {
  it('checks the fields', async () => {
    const a = await owner();
    const { food, pay } = await setup(a);
    const p = (b: object) => json(a.post('/api/rules')).send(b);
    await bad(p({ match: '  ', subsectionId: food.id }), 'match', 'Enter the text to look for.');
    await bad(p({ match: 'x'.repeat(61), subsectionId: food.id }), 'match', 'Use 60 characters or fewer.');
    await bad(p({ match: 'x' }), 'subsectionId', 'Choose a subsection or a source.');
    await bad(p({ match: 'x', subsectionId: food.id, sourceId: pay.id }), 'sourceId', 'Choose a subsection or a source.');
    await bad(p({ match: 'x', subsectionId: 999 }), 'subsectionId', 'Choose a subsection or a source.');
    await bad(p({ match: 'x', sourceId: 999 }), 'sourceId', 'Choose a subsection or a source.');
  });
  it('sorts on import, oldest matching rule wins, case ignored, kind respected', async () => {
    const a = await owner();
    const { pocket, food, pay } = await setup(a);
    const sec2 = (await post(a, '/api/sections', { name: 'Wants' })).section;
    const fun = (await post(a, `/api/sections/${sec2.id}/subsections`, { name: 'Fun', budgetMinor: 0 })).subsection;
    await post(a, '/api/rules', { match: 'lidl', subsectionId: food.id });
    await post(a, '/api/rules', { match: 'LIDL', subsectionId: fun.id });
    await post(a, '/api/rules', { match: 'employer', sourceId: pay.id });
    await post(a, '/api/rules', { match: 'berlin', sourceId: pay.id }); // an income rule never sorts an expense
    expect((await get(a, '/api/rules')).rules.length).toBe(4);
    expect((await imp(a, pocket.id, SEMI).expect(201)).body).toEqual({ added: 2, duplicates: 0, closed: 0, unsorted: 0 });
    const t = await list(a, `month=${OCT}`);
    expect(t.map((x: any) => [x.subsectionId, x.sourceId])).toEqual([[null, pay.id], [food.id, null]]);
  });
  it('sorts waiting transactions in open months when created, and counts them', async () => {
    const a = await owner();
    const { pocket, food, pay } = await setup(a);
    await imp(a, pocket.id, SEMI).expect(201);
    expect((await get(a, `/api/budget?month=${OCT}`)).unsortedCount).toBe(2);
    expect((await list(a, 'unsorted=1')).length).toBe(2);
    const r = await post(a, '/api/rules', { match: 'Lidl', subsectionId: food.id });
    expect(r.sorted).toBe(1);
    expect(r.rule).toMatchObject({ match: 'Lidl', subsectionId: food.id, sourceId: null });
    expect((await post(a, '/api/rules', { match: 'lidl', subsectionId: food.id })).sorted).toBe(0);
    expect((await post(a, '/api/rules', { match: 'employer', sourceId: pay.id })).sorted).toBe(1);
    expect(await list(a, 'unsorted=1')).toEqual([]);
    expect((await get(a, `/api/budget?month=${OCT}`)).unsortedCount).toBe(0);
  });
  it('is deleted, and goes with its subsection or source', async () => {
    const a = await owner();
    const { food, pay } = await setup(a);
    const r1 = (await post(a, '/api/rules', { match: 'a', subsectionId: food.id })).rule;
    await post(a, '/api/rules', { match: 'b', sourceId: pay.id });
    await json(a.delete(`/api/rules/${r1.id}`)).expect(204);
    await json(a.delete(`/api/rules/${r1.id}`)).expect(404);
    await json(a.delete(`/api/sources/${pay.id}`)).expect(204);
    expect((await get(a, '/api/rules')).rules).toEqual([]);
    await post(a, '/api/rules', { match: 'a', subsectionId: food.id });
    await json(a.delete(`/api/subsections/${food.id}`)).expect(204);
    expect((await get(a, '/api/rules')).rules).toEqual([]);
  });
});

describe('figures and limits', () => {
  it('leaves transactions needing sorting out of every figure until sorted', async () => {
    const a = await owner();
    const { pocket, food, pay } = await setup(a);
    await imp(a, pocket.id, SEMI).expect(201);
    const before = await get(a, `/api/budget?month=${OCT}`);
    expect(before.totals).toMatchObject({ incomeMinor: 0, spentMinor: 0 });
    expect((await get(a, `/api/pipeline?month=${OCT}`)).boxes.every((b: any) => b.incomeMinor === 0)).toBe(true);
    const [inc, exp] = await list(a, `month=${OCT}`);
    await json(a.patch(`/api/transactions/${exp.id}`)).send({ subsectionId: food.id }).expect(200);
    await json(a.patch(`/api/transactions/${inc.id}`)).send({ sourceId: pay.id }).expect(200);
    const after = await get(a, `/api/budget?month=${OCT}`);
    expect(after.totals).toMatchObject({ incomeMinor: 150000, spentMinor: 1250 });
    expect(after.unsortedCount).toBe(0);
  });
  it('lets an imported transaction change only its subsection or source, payee and note', async () => {
    const a = await owner();
    const { pocket, food, pay } = await setup(a);
    const p2 = (await post(a, '/api/pockets', { name: 'Other', kind: 'bank', openingBalanceMinor: 0 })).pocket;
    await imp(a, pocket.id, SEMI).expect(201);
    const [inc, exp] = await list(a, `month=${OCT}`);
    const patch = (id: number, b: object) => json(a.patch(`/api/transactions/${id}`)).send(b);
    for (const [k, v] of [['date', `${OCT}-20`], ['kind', 'income'], ['amountMinor', 5], ['pocketId', p2.id]])
      await bad(patch(exp.id, { subsectionId: food.id, [k as string]: v }), k as string, 'An imported transaction keeps this.');
    // Sending the unchanged values back (a whole form) is fine.
    const ok = (await patch(exp.id, { ...exp, subsectionId: food.id, payee: ' Lidl ', note: 'n' }).expect(200)).body.transaction;
    expect(ok).toMatchObject({ subsectionId: food.id, payee: 'Lidl', note: 'n', source: 'import', amountMinor: 1250 });
    const i2 = (await patch(inc.id, { sourceId: pay.id, payee: 'ACME' }).expect(200)).body.transaction;
    expect(i2).toMatchObject({ sourceId: pay.id, payee: 'ACME', kind: 'income' });
    await json(a.delete(`/api/transactions/${exp.id}`)).expect(204);
  });
  it('lets an unsorted imported transaction change payee or note and stay unsorted, but not a hand-entered one', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    await imp(a, pocket.id, SEMI).expect(201);
    const [inc, exp] = await list(a, `month=${OCT}`);
    const patch = (id: number, b: object) => json(a.patch(`/api/transactions/${id}`)).send(b);
    expect((await patch(exp.id, { note: 'x' }).expect(200)).body.transaction).toMatchObject({ note: 'x', subsectionId: null });
    expect((await patch(exp.id, { subsectionId: null, payee: 'Lidl' }).expect(200)).body.transaction).toMatchObject({ payee: 'Lidl', subsectionId: null });
    expect((await patch(inc.id, { sourceId: null, note: 'y' }).expect(200)).body.transaction).toMatchObject({ note: 'y', sourceId: null, payee: 'Employer' });
    expect((await list(a, 'unsorted=1')).length).toBe(2);
    await post(a, '/api/transactions', { date: `${OCT}-09`, kind: 'expense', amountMinor: 700, pocketId: pocket.id, subsectionId: food.id, payee: 'Cafe' });
    const [hand] = await list(a, `month=${OCT}&subsectionId=${food.id}`);
    await bad(patch(hand.id, { subsectionId: null }), 'subsectionId', 'Choose a subsection.');
  });
  it('refuses to close a month with transactions needing sorting', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    await imp(a, pocket.id, `d;p;a\n${SEP}-03;Shop;-1.00\n`, ISO).expect(201);
    const res = await json(a.post(`/api/months/${SEP}/close`)).expect(409);
    expect(res.body.error).toMatchObject({ code: 'unsorted', message: "Sort this month's imported transactions first." });
    const [t] = await list(a, `month=${SEP}`);
    await json(a.patch(`/api/transactions/${t.id}`)).send({ subsectionId: food.id }).expect(200);
    await json(a.post(`/api/months/${SEP}/close`)).expect(200);
  });
  it('keeps the big body limit for signed-in imports only', async () => {
    const a = await owner();
    const { pocket } = await setup(a);
    const big = { pocketId: pocket.id, text: 'a,b\n' + '1,2\n'.repeat(1_000_000) }; // about 4 MB
    // Not signed in: refused before any body is read.
    // The server may hang up before the upload ends, which the client sees as a reset: also a refusal.
    for (const url of ['/api/imports', '/api/imports/preview'])
      expect(await json(request(app).post(url)).send(big).then((r) => r.status, () => 401)).toBe(401);
    // Any other route keeps the 100kb limit (the app answers a too-large body with 400 "too large").
    for (const url of ['/api/auth/login', '/api/rules', '/api/pockets']) {
      const res = await json(a.post(url)).send({ x: 'a'.repeat(150_000) });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('The request body is too large.');
    }
    const login = await json(request(app).post('/api/auth/login')).send({ x: 'a'.repeat(150_000) });
    expect(login.body.error.message).toBe('The request body is too large.');
    // Signed in: a few MB is read.
    const res = await json(a.post('/api/imports/preview')).send(big);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(5);
  });
  it('needs a month unless unsorted=1', async () => {
    const a = await owner();
    await bad(a.get('/api/transactions'), 'month', 'Use a month like 2026-10.');
  });
  it('keeps each person to their own pockets, rules and transactions', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    await json(a.post('/api/users')).send(acct('bob')).expect(201);
    const b = request.agent(app);
    await json(b.post('/api/auth/login')).send({ username: 'bob', password: PW }).expect(200);
    await bad(imp(b, pocket.id, SEMI), 'pocketId', 'Choose a pocket.');
    await bad(prev(b, pocket.id, SEMI), 'pocketId', 'Choose a pocket.');
    await bad(json(b.post('/api/rules')).send({ match: 'x', subsectionId: food.id }), 'subsectionId', 'Choose a subsection or a source.');
    const r = (await post(a, '/api/rules', { match: 'x', subsectionId: food.id })).rule;
    expect((await get(b, '/api/rules')).rules).toEqual([]);
    await json(b.delete(`/api/rules/${r.id}`)).expect(404);
    await imp(a, pocket.id, SEMI).expect(201);
    expect(await list(b, 'unsorted=1')).toEqual([]);
  });
});

describe('where specs 11-15 meet', () => {
  it('leaves unsorted transactions out of every figure, but keeps them in the pocket balance', async () => {
    const a = await owner();
    const { pocket, food } = await setup(a);
    const before = await get(a, `/api/budget?month=${OCT}`);
    await imp(a, pocket.id, SEMI).expect(201);
    const after = await get(a, `/api/budget?month=${OCT}`);
    expect({ ...after, unsortedCount: 0 }).toEqual(before);
    expect((await get(a, '/api/pockets')).pockets[0].balanceMinor).toBe(150000 - 1250);
    await json(a.post(`/api/months/${OCT}/close`)).send({}).expect(409);
    void food;
  });
});

describe('migrations', () => {
  it('applies 009 on a database that already has 010', () => {
    const file = path.join(dir, 'old.db');
    const old = openDb(file);
    old.exec("DROP TABLE rules; DELETE FROM migrations WHERE name = '009_import.sql'");
    old.close();
    const again = openDb(file);
    expect(again.prepare('SELECT COUNT(*) AS n FROM rules').get()).toEqual({ n: 0 });
    again.close();
  });
});
