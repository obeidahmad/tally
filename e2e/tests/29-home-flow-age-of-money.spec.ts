import type { Page, Locator } from '@playwright/test';
import { test, expect, shot, row, em, seedBudget, stat, todayIso, openTab, type Seed } from '../support/fixtures';
import { seedImport, importFile, sortedPills } from '../support/importing';
import { octName, sepName, norm, octIso, sepIso } from '../support/closing';

// Spec 26: the Home page, where the money went, age of money and top payees. Dates are counted from today (UTC).
test.use({ viewport: { width: 1280, height: 900 } });
const phone = { width: 390, height: 844 };
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const at = (offset: number) => new Date(Date.now() + offset * 864e5);
const iso = (offset: number) => at(offset).toISOString().slice(0, 10);
const dayMonth = (offset: number) => new RegExp(`\\b${at(offset).getUTCDate()} (${SHORT[at(offset).getUTCMonth()]}|${LONG[at(offset).getUTCMonth()]})\\b`);
const fmt = (minor: number) => (Math.abs(minor) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Home = {
  month: string;
  budget: { budgetedMinor: number; spentMinor: number; leftMinor: number; overspent: { subsectionId: number; overMinor: number }[] };
  networth: { minor: number; changeMinor: number; series: { month: string; minor: number }[] };
  cashflow: { incomeMinor: number; spendingMinor: number };
  upcoming: { key: string; payee: string; amountMinor: number; date: string }[];
  recent: { payee: string }[];
  goals: { subsectionId: number; savedMinor: number; targetMinor: number; goalStatus: string | null }[];
  needsSorting: number;
  ageOfMoneyDays: number | null;
};
const homeApi = async (page: Page) => {
  const r = await page.request.get('/api/home');
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Home;
};
const goHome = async (page: Page) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
};
const card = (page: Page, title: string | RegExp): Locator => page.locator('.ty-card').filter({ hasText: title }).first();
const tooltip = (page: Page) => page.getByRole('tooltip').filter({ visible: true });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/** Expenses of one payee, one per offset, in the given subsection. */
async function pays(s: Seed, subId: number, pocketId: number, payee: string, minor: number | number[], offsets: number[]) {
  for (const [i, o] of offsets.entries()) await s.expense(pocketId, subId, Array.isArray(minor) ? minor[i] : minor, payee, iso(o));
}
/** Needs > Food and a pocket, nothing else. */
async function basics(s: Seed, opening = 0) {
  const needs = await s.section('Needs');
  const food = await s.subsection(needs.id, 'Food', 50000);
  const pocket = await s.pocket('Revolut', opening);
  return { needs, food, pocket };
}
async function addGoal(page: Page, sectionId: number, body: Record<string, unknown>) {
  const r = await page.request.post(`/api/sections/${sectionId}/subsections`, { data: { kind: 'goal', keep: 'cap', ...body } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()).subsection as { id: number };
}
const ym = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 7); };

// ============ navigation ============
test('Home is first in the sidebar and the tab bar, is where /setup and the root go, and has the title "Home"', async ({ page, me }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  const side = page.locator('.ty-side');
  expect((await side.getByRole('link').first().innerText()).trim()).toBe('Home');
  await expect(side.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize(phone);
  const tabs = page.locator('.ty-tabs');
  expect((await tabs.getByRole('link').first().innerText()).trim()).toBe('Home');
  await expect(tabs.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('signing in with the form lands on Home', async ({ browser, baseURL, me }) => {
  const ctx = await browser.newContext({ baseURL: baseURL! });
  const p = await ctx.newPage();
  await p.goto('/sign-in');
  await p.getByLabel('Username').fill(me.username);
  await p.getByLabel('Password').fill(me.password);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p).toHaveURL(/\/home$/);
  await expect(p.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await ctx.close();
});

// ============ the cards ============
test('a new person sees Home with its cards in order, and no "Goals" card and no sorting notice', async ({ page, me }) => {
  await goHome(page);
  const text = norm(await page.locator('main, body').first().innerText());
  const titles = [`${octName} so far`, 'Net worth', 'Cash flow this month', 'Coming up', 'Recent transactions', 'Age of money'];
  const at = titles.map((t) => text.indexOf(t));
  expect(at.every((i) => i >= 0), JSON.stringify(titles.map((t, i) => [t, at[i]]))).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  await expect(page.getByText('Goals', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/need sorting/)).toHaveCount(0);
  await expect(card(page, 'Coming up')).toContainText('No bills in the next 14 days.');
  await expect(card(page, 'Age of money')).toContainText('Not enough history yet.');
});

test('the grid has two columns from 900px and one below', async ({ page, me }) => {
  await goHome(page);
  const a = card(page, `${octName} so far`);
  const b = card(page, 'Net worth');
  const [ba, bb] = [(await a.boundingBox())!, (await b.boundingBox())!];
  expect(Math.abs(ba.y - bb.y), 'side by side at 1280').toBeLessThan(4);
  expect(bb.x).toBeGreaterThan(ba.x + ba.width - 2);
  await page.setViewportSize({ width: 880, height: 900 });
  await expect(a).toBeVisible();
  const [wa, wb] = [(await a.boundingBox())!, (await b.boundingBox())!];
  expect(wb.y, 'stacked below 900').toBeGreaterThan(wa.y + wa.height - 2);
  expect(Math.abs(wb.x - wa.x)).toBeLessThan(4);
});

test('the figures of the cards equal the server\'s and the Budget page\'s', async ({ page, me }) => {
  const w = await seedBudget(me.seed);
  void w;
  const h = await homeApi(page);
  // worked out by hand from the seed: budgets 1,060.00, spent 212.40 + 600.00 + 131.75 + 38.97, Utilities 11.75 over
  expect(h.month).toBe(octIso);
  expect(h.budget).toMatchObject({ budgetedMinor: 106000, spentMinor: 98312 });
  expect(h.budget.overspent).toHaveLength(1);
  expect(h.budget.overspent[0].overMinor).toBe(1175);
  expect(h.networth.minor).toBe(201688);
  expect(h.cashflow).toEqual({ incomeMinor: 200000, spendingMinor: 98312 });
  expect(h.networth.series).toHaveLength(7);

  await goHome(page);
  const so = card(page, `${octName} so far`);
  await expect(so).toContainText('983.12');
  await expect(so).toContainText('1,060.00');
  await expect(so).toContainText(`${fmt(h.budget.leftMinor)} left`);
  await expect(so).toContainText('Over budget');
  await expect(so).toContainText('Utilities');
  await expect(so).toContainText('11.75');
  await expect(so.locator('.ty-meter')).toHaveCount(1);
  await expect(so.getByRole('link').first()).toHaveAttribute('href', /\/budget/);

  const nw = card(page, 'Net worth');
  await expect(nw).toContainText('2,016.88');
  const pill = nw.locator('.ty-pill').filter({ hasText: /since / });
  await expect(pill).toContainText(`since ${sepName}`);
  await expect(pill).toContainText(fmt(h.networth.changeMinor));
  await expect(pill).toHaveClass(h.networth.changeMinor >= 0 ? /ty-pill--positive/ : /ty-pill--negative/);

  const cf = card(page, 'Cash flow this month');
  await expect(cf).toContainText('2,000.00');
  await expect(cf).toContainText('983.12');
  await expect(cf).toContainText('Saved 1,016.88');

  // The same figures on the Budget page.
  await page.goto('/budget');
  await expect(stat(page, 'Spent')).toContainText('983.12');
  await expect(stat(page, 'Budgeted')).toContainText('1,060.00');
});

test('Home\'s net worth and cash flow equal the Reports API for today', async ({ page, me }) => {
  await seedBudget(me.seed);
  const h = await homeApi(page);
  const rep = await (await page.request.get('/api/reports?months=6')).json();
  expect(h.networth.minor).toBe(rep.networth.at(-1).minor);
  expect(h.cashflow).toMatchObject({ incomeMinor: rep.cashflow.at(-1).incomeMinor, spendingMinor: rep.cashflow.at(-1).spendingMinor });
});

test('spending more than the income reads "Overspent" in the Cash flow card', async ({ page, me }) => {
  const { food, pocket } = await basics(me.seed);
  await me.seed.income(pocket.id, 10000, 'Paycheck');
  await me.seed.expense(pocket.id, food.id, 15000, 'Shop');
  await goHome(page);
  await expect(card(page, 'Cash flow this month')).toContainText('Overspent 50.00');
});

test('the sparkline has a mark for each point with a tooltip on hover and focus', async ({ page, me }) => {
  await seedBudget(me.seed);
  const h = await homeApi(page);
  await goHome(page);
  const nw = card(page, 'Net worth');
  const marks = nw.locator('svg [tabindex="0"]');
  await expect(marks).toHaveCount(h.networth.series.length);
  await marks.last().focus();
  await expect(tooltip(page)).toContainText(fmt(h.networth.series.at(-1)!.minor));
  await marks.first().hover();
  await expect(tooltip(page)).toContainText(fmt(h.networth.series[0].minor));
});

test('Coming up lists the bills of the next 14 days with their dates, and leaves a later one out', async ({ page, me }) => {
  const { food, pocket } = await basics(me.seed);
  await pays(me.seed, food.id, pocket.id, 'Netflix', 1299, [-80, -50, -20]); // next in 10 days
  await pays(me.seed, food.id, pocket.id, 'Domain', 5000, [-565, -200]); // yearly, next in 165 days
  const h = await homeApi(page);
  expect(h.upcoming.map((u) => u.payee)).toEqual(['Netflix']);
  expect(h.upcoming[0]).toMatchObject({ amountMinor: 1299, date: iso(10) });
  await goHome(page);
  const c = card(page, 'Coming up');
  await expect(c).toContainText('Netflix');
  await expect(c).toContainText('12.99');
  expect(norm(await c.innerText())).toMatch(dayMonth(10));
  await expect(c).not.toContainText('Domain');
  await expect(c).not.toContainText('No bills in the next 14 days.');
});

test('Recent transactions shows the latest 5 as rows and "All transactions" opens the Transactions page', async ({ page, me }) => {
  const { food, pocket } = await basics(me.seed, 100000);
  for (let i = 1; i <= 7; i++) await me.seed.expense(pocket.id, food.id, 100 * i, `Payee${i}`, iso(-i));
  await goHome(page);
  const c = card(page, 'Recent transactions');
  await expect(c.locator('.ty-trow')).toHaveCount(5);
  for (let i = 1; i <= 5; i++) await expect(c).toContainText(`Payee${i}`);
  await expect(c).not.toContainText('Payee6');
  await expect(c).not.toContainText('Payee7');
  await c.getByRole('link', { name: 'All transactions' }).click();
  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
});

test('the Goals card shows each goal with its emoji, saved against target and a status Pill; it is hidden without goals', async ({ page, me }) => {
  const sec = await me.seed.section('Savings');
  const pocket = await me.seed.pocket('Revolut', 0);
  const src = await me.seed.source('Paycheck');
  await me.seed.income(pocket.id, 40000, src.id);
  await me.seed.amountStep(src.boxId, sec.id, 40000);
  await goHome(page);
  await expect(page.getByText('Goals', { exact: true })).toHaveCount(0);

  const plane = await addGoal(page, sec.id, { name: 'Holiday', budgetMinor: 10000, capMinor: 120000, targetMonth: ym(11), emoji: em('Plane') });
  await addGoal(page, sec.id, { name: 'House', budgetMinor: 5000, capMinor: 120000, targetMonth: ym(11) });
  await addGoal(page, sec.id, { name: 'Laptop', budgetMinor: 10000, capMinor: 10000 });
  const h = await homeApi(page);
  expect(h.goals).toHaveLength(3);
  expect(h.goals.find((g) => g.subsectionId === plane.id)).toMatchObject({ targetMinor: 120000, goalStatus: 'on_track' });
  await page.reload();
  const c = card(page, /Goals/);
  await expect(c).toBeVisible();
  const line = (name: string) => c.locator('*').filter({ hasText: name }).filter({ has: page.locator('.ty-pill') }).last();
  expect(norm(await line('Holiday').innerText())).toContain(em('Plane'));
  await expect(line('Holiday').locator('.ty-pill')).toHaveClass(/ty-pill--positive/);
  await expect(line('Holiday').locator('.ty-pill')).toContainText(/on track/i);
  await expect(line('House').locator('.ty-pill')).toHaveClass(/ty-pill--warning/);
  await expect(line('House').locator('.ty-pill')).toContainText(/behind/i);
  await expect(line('Laptop').locator('.ty-pill')).toContainText('Reached');
  await expect(c.locator('.ty-meter')).toHaveCount(3);
});

// ============ needs sorting ============
test('imported transactions that need sorting show a notice above the grid whose link opens the filtered Transactions page', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await goHome(page);
  await expect(page.getByText(/need sorting/)).toHaveCount(0);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await me.seed.expense(w.pocket.id, w.food.id, 999, 'Hand entered coffee', todayIso());
  expect((await homeApi(page)).needsSorting).toBe(6);
  await goHome(page);
  const n = page.locator('.ty-inset').filter({ hasText: 'need sorting' });
  await expect(n).toContainText('6 transactions need sorting.');
  expect((await n.boundingBox())!.y, 'above the grid').toBeLessThan((await card(page, `${octName} so far`).boundingBox())!.y);
  await n.getByRole('link').click();
  await expect(page).toHaveURL(/\/transactions\?.*unsorted=1/);
  await expect(sortedPills(page)).toHaveCount(6);
  await expect(row(page, /Hand entered coffee/)).toHaveCount(0);
});

// ============ age of money ============
async function agedMoney(page: Page, s: Seed, expenses: number, incomeMinor = 100000) {
  const { food, pocket } = await basics(s);
  await s.income(pocket.id, incomeMinor, 'Paycheck', iso(-40));
  for (let i = 0; i < expenses; i++) await s.expense(pocket.id, food.id, 1000, `Shop${i}`, iso(-10 + i));
}

test('age of money: ten equal expenses 30 to 39 days after the money arrived make 34 days', async ({ page, me }) => {
  await agedMoney(page, me.seed, 10);
  expect((await homeApi(page)).ageOfMoneyDays).toBe(34);
  await goHome(page);
  const c = card(page, 'Age of money');
  await expect(c).toContainText('34 days');
  await expect(c).toContainText('How long your money waits between arriving and being spent.');
  await expect(c).not.toContainText('Not enough history yet.');
});

test('age of money: with 9 expenses it is "Not enough history yet."', async ({ page, me }) => {
  await agedMoney(page, me.seed, 9);
  expect((await homeApi(page)).ageOfMoneyDays).toBeNull();
  await goHome(page);
  await expect(card(page, 'Age of money')).toContainText('Not enough history yet.');
});

test('age of money: when the money runs out before the 10th expense it is "Not enough history yet."', async ({ page, me }) => {
  await agedMoney(page, me.seed, 10, 5000);
  expect((await homeApi(page)).ageOfMoneyDays).toBeNull();
  await goHome(page);
  await expect(card(page, 'Age of money')).toContainText('Not enough history yet.');
});

test('age of money: an opening balance counts as income the day before the first transaction, and transfers do not', async ({ page, me }) => {
  const { food, pocket } = await basics(me.seed, 100000);
  const other = await me.seed.pocket('Savings pot', 0);
  for (let i = 0; i < 10; i++) await me.seed.expense(pocket.id, food.id, 1000, `Shop${i}`, iso(-10 + i));
  // a transfer is neither income nor spending
  const t = await page.request.post('/api/transactions', { data: { date: iso(-5), kind: 'transfer', pocketId: pocket.id, toPocketId: other.id, amountMinor: 20000, toAmountMinor: 20000 } });
  expect(t.status(), await t.text()).toBe(201);
  // the first transaction is 10 days ago, so the opening money is dated 11 days ago; expenses are 1 to 10 days after it: (1+...+10)/10 = 5.5 -> 5
  expect((await homeApi(page)).ageOfMoneyDays).toBe(5);
});

// ============ Reports: where the money went ============
/** Paycheck 3,000.00 (Needs 1,000.00, Wants 500.00, the rest left over); Needs: Rent 700.00, Food 100.00; Wants: Fun 500.00. All this month. */
async function seedFlow(page: Page, s: Seed) {
  const needs = await s.section('Needs');
  const wants = await s.section('Wants');
  const rent = await s.subsection(needs.id, 'Rent', 70000);
  const food = await s.subsection(needs.id, 'Food', 30000);
  const fun = await s.subsection(wants.id, 'Fun', 50000);
  const pocket = await s.pocket('Revolut', 0);
  const pay = await s.source('Paycheck');
  await s.income(pocket.id, 300000, pay.id);
  await s.amountStep(pay.boxId, needs.id, 100000);
  await s.amountStep(pay.boxId, wants.id, 50000);
  await s.expense(pocket.id, rent.id, 70000, 'Landlord');
  await s.expense(pocket.id, food.id, 10000, 'Grocer');
  await s.expense(pocket.id, fun.id, 50000, 'Cinema');
  return { needs, wants, rent, food, fun, pocket, pay };
}
type Flow = { nodes: { id: string | number; label: string; kind: string }[]; links: { from: string | number; to: string | number; minor: number }[] };
const flowApi = async (page: Page, month = '') => {
  const r = await page.request.get(`/api/reports/flow${month ? `?month=${month}` : ''}`);
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Flow;
};
const label = (f: Flow, id: string | number) => f.nodes.find((n) => n.id === id)!.label;
const flowCard = (page: Page) => page.locator('.ty-card').filter({ has: page.getByText(/money went/) }).first();
const showTable = async (c: Locator) => {
  const t = c.locator('table');
  if (!(await t.isVisible())) await c.getByRole('button', { name: /Show as table/ }).or(c.getByRole('checkbox', { name: /Show as table/ })).or(c.getByRole('switch', { name: /Show as table/ })).first().click();
  await expect(t).toBeVisible();
  return t;
};

test('the flow API: every link is above 0, kinds are right, each section\'s outgoing equals what it received and the source\'s equals its income', async ({ page, me }) => {
  await seedFlow(page, me.seed);
  const f = await flowApi(page);
  const bad = await page.request.get('/api/reports/flow?month=nope');
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain('month');
  for (const l of f.links) expect(l.minor).toBeGreaterThan(0);
  const named = (a: string, b: string) => f.links.find((l) => label(f, l.from) === a && label(f, l.to) === b)?.minor;
  expect(named('Paycheck', 'Needs')).toBe(100000);
  expect(named('Paycheck', 'Wants')).toBe(50000);
  expect(named('Paycheck', 'Left over')).toBe(150000);
  expect(named('Needs', 'Rent')).toBe(70000);
  expect(named('Needs', 'Food')).toBe(10000);
  expect(named('Needs', 'Kept')).toBe(20000);
  expect(named('Wants', 'Fun')).toBe(50000);
  expect(named('Wants', 'Kept')).toBeUndefined();
  const kind = (l: string) => f.nodes.find((n) => n.label === l)!.kind;
  expect([kind('Paycheck'), kind('Needs'), kind('Rent'), kind('Left over'), kind('Kept')]).toEqual(['source', 'section', 'subsection', 'other', 'other']);
  const sum = (pred: (l: Flow['links'][number]) => boolean) => f.links.filter(pred).reduce((a, l) => a + l.minor, 0);
  for (const n of f.nodes.filter((x) => x.kind === 'section')) expect(sum((l) => l.from === n.id), n.label).toBe(sum((l) => l.to === n.id));
  expect(sum((l) => f.nodes.find((n) => n.id === l.from)!.kind === 'source')).toBe(300000);
});

test('sources of one box are one node, and the sources\' outgoing links add up to all the income', async ({ page, me }) => {
  const needs = await me.seed.section('Needs');
  const rent = await me.seed.subsection(needs.id, 'Rent', 70000);
  const pocket = await me.seed.pocket('Revolut', 0);
  const pay = await me.seed.source('Paycheck');
  const second = await me.seed.source('Second job', pay.boxId);
  const fund = await me.seed.source('Fund payout');
  await me.seed.income(pocket.id, 200000, pay.id);
  await me.seed.income(pocket.id, 60000, second.id);
  await me.seed.income(pocket.id, 1240, fund.id);
  await me.seed.amountStep(pay.boxId, needs.id, 100000);
  await me.seed.expense(pocket.id, rent.id, 70000, 'Landlord');
  const f = await flowApi(page);
  const sources = f.nodes.filter((n) => n.kind === 'source');
  expect(sources).toHaveLength(2); // the merged box and the Fund payout box
  const out = (id: string | number) => f.links.filter((l) => l.from === id).reduce((a, l) => a + l.minor, 0);
  expect(out(sources.find((s) => s.label !== 'Fund payout')!.id)).toBe(260000);
  expect(out(sources.find((s) => s.label === 'Fund payout')!.id)).toBe(1240);
  const leftOver = f.nodes.find((n) => n.label === 'Left over')!;
  expect(f.links.filter((l) => l.to === leftOver.id).reduce((a, l) => a + l.minor, 0)).toBe(160000 + 1240);
});

test('Reports starts with "Where <month>\'s money went", whose table lists every link of the API', async ({ page, me }) => {
  await seedFlow(page, me.seed);
  const f = await flowApi(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  const c = flowCard(page);
  await expect(c).toBeVisible();
  await expect(c).toContainText(new RegExp(`Where ${octName}.s money went`));
  await expect(page.getByRole('tab', { name: 'Cash flow', exact: true })).toHaveAttribute('aria-selected', 'true'); // spec 27: the first tab
  const t = await showTable(c);
  const rows = (await t.locator('tbody tr').allInnerTexts()).map(norm);
  // spec 27: the sources feed one "Income" node, which feeds the sections. The API links from a source become "<source> -> Income"
  // with the source's total; every other link of the API is a row of its own.
  const isSource = (id: string | number) => f.nodes.find((n) => n.id === id)!.kind === 'source';
  const others = f.links.filter((l) => !isSource(l.from));
  for (const l of others) {
    const hit = rows.find((r) => r.includes(label(f, l.from)) && r.includes(label(f, l.to)) && r.includes(fmt(l.minor)));
    expect(hit, `${label(f, l.from)} to ${label(f, l.to)} ${fmt(l.minor)} in ${JSON.stringify(rows)}`).toBeTruthy();
  }
  for (const src of f.nodes.filter((n) => n.kind === 'source')) {
    const total = f.links.filter((l) => l.from === src.id).reduce((a, l) => a + l.minor, 0);
    expect(rows.find((r) => r.includes(src.label) && r.includes('Income') && r.includes(fmt(total))), `${src.label} to Income ${fmt(total)}`).toBeTruthy();
  }
  for (const l of f.links.filter((x) => isSource(x.from))) {
    expect(rows.find((r) => r.includes('Income') && r.includes(label(f, l.to)) && r.includes(fmt(l.minor))), `Income to ${label(f, l.to)}`).toBeTruthy();
  }
  await expect(c.getByRole('button', { name: /Show as chart/ }).or(c.getByRole('checkbox', { name: /Show as table/ })).or(c.getByRole('switch', { name: /Show as table/ })).first()).toBeVisible();
});

test('the diagram shows the labels and amounts of its nodes, and a link\'s tooltip reads "<from> → <to>: <amount>"', async ({ page, me }) => {
  await seedFlow(page, me.seed);
  await page.goto('/reports');
  const c = flowCard(page);
  const svg = c.locator('svg').first();
  await expect(svg).toBeVisible();
  for (const t of ['Paycheck', 'Needs', 'Wants', 'Rent', 'Food', 'Fun', 'Left over', 'Kept']) await expect(svg).toContainText(t);
  await expect(svg).toContainText('3,000.00');
  const marks = svg.locator('[tabindex="0"]');
  const n = await marks.count();
  expect(n).toBeGreaterThan(0);
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await marks.nth(i).focus();
    const tip = tooltip(page);
    if (await tip.count()) seen.push(norm(await tip.first().innerText()));
  }
  expect(seen, JSON.stringify(seen)).toContain('Income → Needs: 1,000.00'); // spec 27: the Income node sits between
  expect(seen).toContain('Paycheck → Income: 3,000.00');
  expect(seen).toContain('Needs → Kept: 200.00');
});

test('the month ‹ › of the card moves to last month, where nothing happened, and back', async ({ page, me }) => {
  await seedFlow(page, me.seed);
  await page.goto('/reports');
  const c = flowCard(page);
  await page.getByRole('button', { name: /^(Previous month|‹)$/ }).first().click(); // spec 27: the month control is in the top bar
  await expect(c).toContainText(new RegExp(`Where ${sepName}.s money went`));
  expect((await flowApi(page, sepIso)).links).toHaveLength(0);
  await page.getByRole('button', { name: /^(Next month|›)$/ }).first().click();
  await expect(c).toContainText(new RegExp(`Where ${octName}.s money went`));
});

test('on a phone the diagram scrolls sideways inside its card and the page does not', async ({ page, me }) => {
  await page.setViewportSize(phone);
  await seedFlow(page, me.seed);
  await page.goto('/reports');
  const c = flowCard(page);
  await expect(c.locator('svg').first()).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  const inner = await c.evaluate((el) => [el, ...el.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)));
  expect(inner, 'a scroller inside the card').toBe(true);
});

// ============ Reports: top payees ============
test('Top payees lists the top 10 by spending with count and amount, grouped by payee key with the latest spelling, sorted expenses only', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await me.seed.income(w.pocket.id, 500000, w.paycheck.id);
  await pays(me.seed, w.food.id, w.pocket.id, 'Alphamega', [2000, 3000, 2500], [-3, -2, -1]);
  await pays(me.seed, w.food.id, w.pocket.id, 'Lidl', 2000, [-5, -4]);
  await pays(me.seed, w.food.id, w.pocket.id, 'NETFLIX.COM 4471', 1299, [-9]);
  await pays(me.seed, w.food.id, w.pocket.id, 'Netflix.com', 1299, [-8]);
  const d = await importFile(page, 'lidl-semicolon.csv'); // unsorted, so never counted
  await d.getByRole('button', { name: 'Done', exact: true }).click();

  const r = await (await page.request.get('/api/reports?months=12')).json();
  expect(r.payees).toEqual([
    { payee: 'Alphamega', minor: 7500, count: 3 },
    { payee: 'Lidl', minor: 4000, count: 2 },
    { payee: 'Netflix.com', minor: 2598, count: 2 },
  ]);

  await openTab(page, '/reports', 'Spending');
  const c = card(page, 'Top payees');
  await expect(c).toBeVisible();
  const rows = (await c.locator('table tbody tr').allInnerTexts()).map(norm);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatch(/Alphamega.*\b3\b.*75\.00/);
  expect(rows[1]).toMatch(/Lidl.*\b2\b.*40\.00/);
  expect(rows[2]).toMatch(/Netflix\.com.*\b2\b.*25\.98/);
  await expect(c).not.toContainText('LIDL Limassol');
});

test('Top payees holds at most 10 payees', async ({ page, me }) => {
  const { food, pocket } = await basics(me.seed, 1000000);
  for (let i = 1; i <= 12; i++) await me.seed.expense(pocket.id, food.id, 100 * i, `Place${String.fromCharCode(96 + i)}`, iso(-i));
  const r = await (await page.request.get('/api/reports?months=12')).json();
  expect(r.payees).toHaveLength(10);
  expect(r.payees[0].payee).toBe('Placel');
});

// ============ screenshots ============
async function richHome(page: Page, s: Seed) {
  const w = await seedBudget(s);
  const sav = await s.section('Savings');
  const sec = await s.section('Goals');
  void sav;
  await addGoal(page, sec.id, { name: 'Holiday', budgetMinor: 10000, capMinor: 120000, targetMonth: ym(11), emoji: em('Plane') });
  await addGoal(page, sec.id, { name: 'Laptop', budgetMinor: 5000, capMinor: 120000, targetMonth: ym(11), emoji: em('Phone') });
  await pays(s, w.subs.id, w.pocket.id, 'Spotify', 999, [-80, -50, -20]);
  return w;
}
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot: Home and the flow diagram, ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await richHome(page, me.seed);
      await goHome(page);
      await expect(card(page, 'Age of money')).toBeVisible();
      expect(await noSideways(page), 'no sideways scroll on Home').toBe(true);
      await shot(page, `spec26-home-${size}-${scheme}`);
      await page.screenshot({ path: `screenshots/spec26-home-full-${size}-${scheme}.png`, fullPage: true });
      await page.goto('/reports');
      const c = flowCard(page);
      await expect(c.locator('svg').first()).toBeVisible();
      expect(await noSideways(page), 'no sideways scroll on Reports').toBe(true);
      await page.waitForTimeout(300);
      await c.screenshot({ path: `screenshots/spec26-flow-${size}-${scheme}.png` });
      await showTable(c);
      await c.screenshot({ path: `screenshots/spec26-flow-table-${size}-${scheme}.png` });
      await shot(page, `spec26-reports-${size}-${scheme}`);
    });
  }
}
void sepIso;

test('flow with an overspent subsection: each section\'s outgoing links still add up to what it received', async ({ page, me }) => {
  await seedBudget(me.seed); // Needs receives 1,020.00 and spends 944.15 (Utilities is 11.75 over its budget); Wants receives 40.00 and spends 38.97
  const f = await flowApi(page);
  const sum = (pred: (l: Flow['links'][number]) => boolean) => f.links.filter(pred).reduce((a, l) => a + l.minor, 0);
  for (const n of f.nodes.filter((x) => x.kind === 'section')) {
    expect(sum((l) => l.from === n.id), `${n.label}: out ${JSON.stringify(f.links.filter((l) => l.from === n.id).map((l) => [label(f, l.to), l.minor]))}`).toBe(sum((l) => l.to === n.id));
  }
});
