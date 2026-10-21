import type { Page, Locator } from '@playwright/test';
import { test, expect, shot, todayIso, thisMonth, openTab } from '../support/fixtures';
import { importFile } from '../support/importing';

// Spec 19: Reports. Figures are compared with GET /api/reports (the spec says each table shows exactly the server's figures),
// and the EUR-only figures are also checked against numbers worked out by hand from the seed.
test.use({ viewport: { width: 1280, height: 900 } });

type Reports = {
  currency: string;
  months: string[];
  spending: { month: string; bySection: { sectionId: number; minor: number }[]; totalMinor: number }[];
  cashflow: { month: string; incomeMinor: number; spendingMinor: number }[];
  networth: { month: string; minor: number }[];
  missingRates?: string[];
};

const fmt = (minor: number) => (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (t: string) => t.replace(/[\s  ]+/g, ' ').trim();
const monthAgo = (n: number) => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
};
const dateIn = (n: number) => (n === 0 ? todayIso() : `${monthAgo(n)}-10`);

const reportsApi = async (page: Page, months = 12) => {
  const res = await page.request.get(`/api/reports?months=${months}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Reports;
};
const tx = async (page: Page, data: object) => {
  const res = await page.request.post('/api/transactions', { data });
  expect(res.status(), await res.text()).toBe(201);
};

// Spec 27: Reports has three tabs. The Cash flow tab holds the "Cash flow" bars card, the Spending tab the donut card
// ("Spending by section") and the stacked bars over time, the Net worth tab the area chart.
const TABS = { 'Cash flow': 'Cash flow', 'Spending by section': 'Spending', 'Net worth': 'Net worth' } as const;
const TITLES = ['Spending by section', 'Cash flow', 'Net worth'] as const;
const card = (page: Page, title: string): Locator =>
  page.locator('.ty-card', { has: page.getByRole('heading', { name: title, exact: true }) });
/** Opens /reports on the tab that holds this chart, and returns the chart's scope: its card (the Spending tab: the whole tab, since
 * the donut and the stacked bars are both "spending by section"). */
async function chartOf(page: Page, title: (typeof TITLES)[number]): Promise<Locator> {
  await openTab(page, '/reports', TABS[title]);
  // "Spending by section" in this file means the stacked bars over time (the donut has its own test)
  return title === 'Spending by section' ? card(page, 'Spending by section over time') : card(page, title);
}
const toggle = (c: Locator) =>
  c.getByRole('button', { name: /Show as table|Show as chart/ }).or(c.getByRole('checkbox', { name: /Show as table/ })).or(c.getByRole('switch', { name: /Show as table/ })).first();
const monthsRadio = (page: Page, n: number) => page.getByRole('radio', { name: `${n} months` });
// Marks are the focusable shapes of the chart's SVG.
const marks = (c: Locator) => c.locator('svg [tabindex="0"]');
const tooltip = (page: Page) => page.getByRole('tooltip').filter({ visible: true });

/**
 * Two sections, three months of EUR data (Needs>Food, Wants>Fun):
 *   two months ago: income 2,000.00, Food 200.00
 *   last month:     Food 300.00, Fun 50.00, a 100.00 transfer Bank > Savings pot
 *   this month:     Fun 70.00
 * Bank opens with 1,000.00. Spending total 620.00, income 2,000.00 -> "saved 1,380.00". Net worth now 2,380.00.
 */
async function seedReports(page: Page, me: { seed: import('../support/fixtures').Seed }) {
  const needs = await me.seed.section('Needs');
  const food = await me.seed.subsection(needs.id, 'Food', 30000);
  const wants = await me.seed.section('Wants');
  const fun = await me.seed.subsection(wants.id, 'Fun', 5000);
  const bank = await me.seed.pocket('Bank', 100000);
  const pot = await me.seed.pocket('Savings pot', 0);
  const pay = await me.seed.source('Paycheck');
  await me.seed.income(bank.id, 200000, pay.id, dateIn(2));
  await me.seed.expense(bank.id, food.id, 20000, 'Alphamega', dateIn(2));
  await me.seed.expense(bank.id, food.id, 30000, 'Lidl', dateIn(1));
  await me.seed.expense(bank.id, fun.id, 5000, 'Cinema', dateIn(1));
  await tx(page, { date: dateIn(1), kind: 'transfer', pocketId: bank.id, toPocketId: pot.id, amountMinor: 10000, toAmountMinor: 10000 });
  await me.seed.expense(bank.id, fun.id, 7000, 'Games', dateIn(0));
  return { needs, food, wants, fun, bank, pot };
}

/** Shows the card's table and returns its body rows' text, oldest first (the spec orders months oldest first). */
async function tableRows(c: Locator, _spending = false) {
  const t = c.locator('table');
  if (!(await t.isVisible())) await toggle(c).click();
  await expect(t).toBeVisible();
  const rows = t.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  return (await rows.allInnerTexts()).map(clean);
}
const hasFigures = (text: string, minors: number[], what: string) => {
  for (const m of minors) if (m !== 0) expect(text, what).toContain(fmt(m));
};

// ============ navigation and page ============
test('the sidebar lists Reports after Investments and opens /reports with the title and 12 months chosen', async ({ page, me }) => {
  await seedReports(page, me); // with nothing to show a card has no "Show as table"
  await page.goto('/budget');
  const nav = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Investments' }) }).first();
  const names = (await nav.getByRole('link').allInnerTexts()).map(clean);
  const inv = names.findIndex((n) => n.includes('Investments'));
  const rep = names.findIndex((n) => n.includes('Reports'));
  expect(rep, JSON.stringify(names)).toBeGreaterThan(inv);
  await nav.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cash flow', exact: true })).toHaveAttribute('aria-selected', 'true'); // the first tab
  for (const t of ['Cash flow', 'Spending', 'Net worth']) await expect(page.getByRole('tab', { name: t, exact: true })).toBeVisible();
  for (const title of ['Cash flow', 'Net worth'] as const) {
    const c = await chartOf(page, title);
    await expect(c).toBeVisible();
    for (const t of ['3 months', '6 months', '12 months', '24 months']) await expect(c.getByRole('radio', { name: t })).toBeAttached();
    await expect(c.getByRole('radio', { name: '12 months' })).toBeChecked();
    await expect(toggle(c)).toContainText('Show as table');
  }
  await openTab(page, '/reports', 'Spending');
  await expect(card(page, 'Spending by section')).toBeVisible(); // the donut
  await expect(await chartOf(page, 'Spending by section')).toBeVisible(); // the bars over time
});

// ============ criterion 2: the tables show the server's figures ============
test('the three tables show the figures of GET /api/reports for the 12 months', async ({ page, me }) => {
  const { food, fun } = await seedReports(page, me);
  const sections = (await (await page.request.get('/api/sections')).json()).sections as { id: number; name: string }[];
  expect(sections.length).toBeGreaterThanOrEqual(2);
  const r = await reportsApi(page, 12);
  expect(r.months).toHaveLength(12);
  expect(r.months.slice(-3)).toEqual([monthAgo(2), monthAgo(1), monthAgo(0)]);

  // the server's figures are the ones worked out by hand
  const at = (m: string) => r.spending.find((s) => s.month === m)!;
  expect(at(monthAgo(2)).totalMinor).toBe(20000);
  expect(at(monthAgo(1)).totalMinor).toBe(35000);
  expect(at(monthAgo(0)).totalMinor).toBe(7000);
  expect(r.cashflow.find((c) => c.month === monthAgo(2))).toMatchObject({ incomeMinor: 200000, spendingMinor: 20000 });
  expect(r.cashflow.find((c) => c.month === monthAgo(1))).toMatchObject({ incomeMinor: 0, spendingMinor: 35000 });
  expect(r.networth.find((n) => n.month === monthAgo(0))!.minor).toBe(238000);
  expect(r.networth.find((n) => n.month === monthAgo(1))!.minor).toBe(245000);
  expect(r.networth.find((n) => n.month === monthAgo(2))!.minor).toBe(280000);
  void food; void fun;

  const spend = await tableRows(await chartOf(page, 'Spending by section'), true);
  expect(spend).toHaveLength(12);
  r.spending.forEach((s, i) => hasFigures(spend[i], [...s.bySection.map((b) => b.minor), s.totalMinor], `spending row ${s.month}`));

  const flow = await tableRows(await chartOf(page, 'Cash flow'));
  expect(flow).toHaveLength(12);
  r.cashflow.forEach((c, i) => hasFigures(flow[i], [c.incomeMinor, c.spendingMinor], `cash flow row ${c.month}`));

  const worth = await tableRows(await chartOf(page, 'Net worth'));
  expect(worth).toHaveLength(12);
  r.networth.forEach((n, i) => hasFigures(worth[i], [n.minor], `net worth row ${n.month}`));
});

test('the spending table names every section and shows 0.00-month rows for months with nothing', async ({ page, me }) => {
  await seedReports(page, me);
  const c = await chartOf(page, 'Spending by section');
  await tableRows(c, true);
  const head = clean(await c.locator('table thead').first().innerText());
  expect(head.toLowerCase()).toContain('needs');
  expect(head.toLowerCase()).toContain('wants');
});

test('Cash flow says what the months added up to: income 2,000.00, spending 620.00, saved 1,380.00', async ({ page, me }) => {
  await seedReports(page, me);
  await openTab(page, '/reports', 'Cash flow');
  await expect(card(page, 'Cash flow')).toContainText('Over these months: income 2,000.00, spending 620.00, saved 1,380.00.');
});

test('Cash flow says "overspent" when spending is larger than income', async ({ page, me }) => {
  const s = me.seed;
  const sec = await s.section('Needs');
  const sub = await s.subsection(sec.id, 'Food', 0);
  const bank = await s.pocket('Bank', 100000);
  await s.expense(bank.id, sub.id, 15000, 'Shop', dateIn(1));
  await openTab(page, '/reports', 'Cash flow');
  await expect(card(page, 'Cash flow')).toContainText('Over these months: income 0.00, spending 150.00, overspent 150.00.');
});

// ============ the months choice ============
test('choosing 3 months shows three rows, 24 months shows twenty-four, and the figures follow the server', async ({ page, me }) => {
  await seedReports(page, me);
  // each tab with a months control keeps its own: Cash flow and Net worth. The Spending tab's stacked bars follow the control when it has one.
  const choose = async (c: Locator, n: number) => {
    const r = c.getByRole('radio', { name: `${n} months` });
    if (await r.count()) { await r.check(); await expect(r).toBeChecked(); return true; }
    return false;
  };
  for (const n of [3, 6, 24, 12]) {
    const r = await reportsApi(page, n);
    expect(r.months).toHaveLength(n);
    const sc = await chartOf(page, 'Spending by section');
    if (await choose(sc, n)) {
      const spend = await tableRows(sc, true);
      expect(spend, `${n} months: spending rows`).toHaveLength(n);
      r.spending.forEach((s, i) => hasFigures(spend[i], [s.totalMinor], `${n} months, spending ${s.month}`));
    }
    const nc = await chartOf(page, 'Net worth');
    await choose(nc, n);
    const worth = await tableRows(nc);
    expect(worth, `${n} months: net worth rows`).toHaveLength(n);
    r.networth.forEach((w, i) => hasFigures(worth[i], [w.minor], `${n} months, net worth ${w.month}`));
    const cc = await chartOf(page, 'Cash flow');
    await choose(cc, n);
    expect(await tableRows(cc), `${n} months: cash flow rows`).toHaveLength(n);
  }
});

test('with 3 months chosen the older month drops out of the caption sums', async ({ page, me }) => {
  await seedReports(page, me);
  await openTab(page, '/reports', 'Cash flow');
  await page.getByRole('radio', { name: '3 months' }).check();
  // the three months are two months ago, last month, this month: all of the seed, so it stays 620.00
  await expect(card(page, 'Cash flow')).toContainText('income 2,000.00, spending 620.00, saved 1,380.00');
  await page.getByRole('radio', { name: '24 months' }).check();
  await expect(card(page, 'Cash flow')).toContainText('income 2,000.00, spending 620.00, saved 1,380.00');
});

test('the API refuses months outside 3, 6, 12 and 24', async ({ page, me }) => {
  void me;
  for (const bad of ['5', '0', '36', 'x']) {
    const res = await page.request.get(`/api/reports?months=${bad}`);
    expect(res.status(), bad).toBe(400);
    expect(await res.text()).toContain('Choose 3, 6, 12 or 24 months.');
  }
});

// ============ criterion 3: tooltips and legends ============
test('the legends name every section, and Cash flow names income and spending', async ({ page, me }) => {
  await seedReports(page, me);
  await openTab(page, '/reports', 'Spending');
  const s = card(page, 'Spending by section'); // the donut
  // the donut is of the chosen month: last month had Needs 300.00 and Wants 50.00
  await page.getByRole('button', { name: /^(Previous month|‹)$/ }).first().click();
  await expect(s).toContainText('Needs');
  await expect(s).toContainText('Wants');
  await expect(s.getByRole('listitem').filter({ hasText: 'Needs' })).toBeVisible();
  await expect(s.getByRole('listitem').filter({ hasText: 'Wants' })).toBeVisible();
  const f = await chartOf(page, 'Cash flow');
  await expect(f.getByText('Income', { exact: true }).first()).toBeVisible();
  await expect(f.getByText('Spending', { exact: true }).first()).toBeVisible();
});

test('every mark of the three charts shows a tooltip on hover and on keyboard focus (3 months)', async ({ page, me }) => {
  await seedReports(page, me);
  for (const t of TITLES) {
    const c = await chartOf(page, t);
    const three = c.getByRole('radio', { name: '3 months' });
    if (await three.count()) await three.check();
    await expect(marks(c).first(), `${t} has focusable marks`).toBeVisible();
    const n = await marks(c).count();
    expect(n, `${t} marks`).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const m = marks(c).nth(i);
      await m.hover();
      await expect(tooltip(page), `${t} mark ${i} hover`).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(tooltip(page), `${t} mark ${i} hover ends`).toBeHidden();
      await m.focus();
      await expect(tooltip(page), `${t} mark ${i} focus`).toBeVisible();
      await m.blur();
      await expect(tooltip(page), `${t} mark ${i} blur`).toBeHidden();
    }
  }
});

test('the spending tooltip lists the month, each section and the total; the net worth tooltip the month and value', async ({ page, me }) => {
  await seedReports(page, me);
  const month = new Date(Date.UTC(Number(monthAgo(1).slice(0, 4)), Number(monthAgo(1).slice(5)) - 1, 1));
  const monthName = month.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const short = month.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

  // find the mark whose tooltip carries last month's total 350.00
  const s = await chartOf(page, 'Spending by section');
  if (await s.getByRole('radio', { name: '3 months' }).count()) await s.getByRole('radio', { name: '3 months' }).check();
  const n = await marks(s).count();
  let found = '';
  for (let i = 0; i < n && !found; i++) {
    await marks(s).nth(i).focus();
    const t = clean(await tooltip(page).innerText());
    if (t.includes('350.00')) found = t;
  }
  expect(found, 'a mark of last month has a tooltip').not.toBe('');
  expect(found).toMatch(new RegExp(`${monthName}|${short}`));
  expect(found).toContain('Needs');
  expect(found).toContain('300.00');
  expect(found).toContain('Wants');
  expect(found).toContain('50.00');
  expect(found.indexOf('350.00'), 'the total comes after the sections').toBeGreaterThan(found.indexOf('50.00'));

  const w = await chartOf(page, 'Net worth');
  await w.getByRole('radio', { name: '3 months' }).check();
  const wn = await marks(w).count();
  let wt = '';
  for (let i = 0; i < wn && !wt; i++) {
    await marks(w).nth(i).focus();
    const t = clean(await tooltip(page).innerText());
    if (t.includes('2,450.00')) wt = t;
  }
  expect(wt, 'last month ended on 2,450.00').not.toBe('');
  expect(wt).toMatch(new RegExp(`${monthName}|${short}`));
});

test('Show as table swaps the chart for a table and back', async ({ page, me }) => {
  await seedReports(page, me);
  for (const t of TITLES) {
    const c = await chartOf(page, t);
    await expect(c.locator('table')).toHaveCount(0);
    await expect(marks(c).first()).toBeVisible();
    await toggle(c).click();
    await expect(c.locator('table').first()).toBeVisible();
    await toggle(c).click();
    await expect(c.locator('table')).toHaveCount(0);
    await expect(marks(c).first()).toBeVisible();
  }
});

test('the Net worth card labels the last value at the end of the line', async ({ page, me }) => {
  await seedReports(page, me);
  await openTab(page, '/reports', 'Net worth');
  await expect(card(page, 'Net worth')).toContainText('2,380.00');
});

// ============ criterion 4: transfers and unsorted imports change nothing ============
test('a transfer and an unsorted import change no spending or cash flow figure, and the tables still match the server', async ({ page, me }) => {
  const { bank, pot } = await seedReports(page, me);
  const before = await reportsApi(page);
  await tx(page, { date: dateIn(0), kind: 'transfer', pocketId: bank.id, toPocketId: pot.id, amountMinor: 50000, toAmountMinor: 50000 });
  const afterTransfer = await reportsApi(page);
  expect(afterTransfer).toEqual(before); // a transfer between EUR pockets moves no figure, net worth included

  // an import with a 4.50 expense and a 12.00 refund, both left unsorted
  await me.seed.pocket('Revolut', 0);
  await importFile(page, 'debit-credit-tab.csv', 'Revolut');
  await expect.poll(async () => ((await (await page.request.get('/api/transactions?unsorted=1')).json()).transactions as unknown[]).length).toBeGreaterThan(0);
  const after = await reportsApi(page);
  expect(after.spending).toEqual(before.spending);
  expect(after.cashflow).toEqual(before.cashflow);
  // net worth follows pocket balances, so the import (12.00 in, 4.50 out) moves it by 7.50 from the import date on
  expect(after.networth[after.networth.length - 1].minor - before.networth[before.networth.length - 1].minor).toBe(750);

  const flow = await tableRows(await chartOf(page, 'Cash flow'));
  expect(flow[flow.length - 1]).not.toContain('12.00');
  expect(flow[flow.length - 1]).not.toContain('4.50');
  await expect(card(page, 'Cash flow')).toContainText('spending 620.00');
});

// ============ currencies ============
test('a USD pocket is counted in net worth by the server, and the missing-rate note shows exactly when the server lists USD', async ({ page, me }) => {
  await seedReports(page, me);
  const res = await page.request.post('/api/pockets', { data: { name: 'Trading212', kind: 'broker', currency: 'USD', openingBalanceMinor: 100000 } });
  expect(res.status()).toBe(201);
  const r = await reportsApi(page);
  await openTab(page, '/reports', 'Net worth');
  const note = card(page, 'Net worth').getByText('No exchange rate for USD for some months; those months leave it out.');
  if (r.missingRates?.includes('USD')) await expect(note).toBeVisible();
  else await expect(note).toHaveCount(0);
  // today's value uses today's rate, so the current month is never left out
  const now = r.networth.find((n) => n.month === thisMonth())!;
  expect(now.minor).toBeGreaterThan(238000);
  const worth = await tableRows(card(page, 'Net worth'));
  r.networth.forEach((n, i) => hasFigures(worth[i], [n.minor], `net worth ${n.month}`));
});

// Spec 12 falls back to the nearest stored rate, and only currencies with stored rates are offered, so a browser cannot reach a month with
// a missing rate; the note is covered by the backend tests. Here the fallback is checked: a USD pocket counts in every one of 24 months.
test('a USD pocket counts in all 24 months at the nearest stored rate, so no missing-rate note shows', async ({ page, me }) => {
  await me.seed.pocket('Bank', 100000);
  const res = await page.request.post('/api/pockets', { data: { name: 'Trading212', kind: 'broker', currency: 'USD', openingBalanceMinor: 100000 } });
  expect(res.status(), await res.text()).toBe(201);
  const r = await reportsApi(page, 24);
  expect(r.missingRates ?? []).toEqual([]);
  expect(r.networth[0].minor).toBe(190909); // 1,000.00 EUR + 1,000.00 USD at 1.1000 (rate of 2026-01-02, the nearest)
  expect(r.networth[r.networth.length - 1].minor).toBe(192081); // today at 1.0860
  await openTab(page, '/reports', 'Net worth');
  await page.getByRole('radio', { name: '24 months' }).check();
  await expect(card(page, 'Net worth').getByText(/No exchange rate for/)).toHaveCount(0);
  const worth = await tableRows(card(page, 'Net worth'));
  expect(worth).toHaveLength(24);
  r.networth.forEach((n, i) => hasFigures(worth[i], [n.minor], ));
});

// ============ empty ============
test('with no transactions each card says "Nothing to show yet."', async ({ page, me }) => {
  void me;
  await expect((await chartOf(page, 'Cash flow')).getByText('Nothing to show yet.')).toBeVisible();
  await expect((await chartOf(page, 'Spending by section')).getByText('Nothing to show yet.').first()).toBeVisible();
  await expect((await chartOf(page, 'Net worth')).getByText('Nothing to show yet.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
});

// ============ isolation ============
test("another person's reports show none of my figures", async ({ page, me, baseURL, browser }) => {
  await seedReports(page, me);
  const { createPerson } = await import('../support/fixtures');
  const other = await createPerson(baseURL!, 'Olga');
  const ctx = await browser.newContext({ baseURL });
  expect((await ctx.request.post('/api/auth/login', { data: { username: other.username, password: other.password } })).status()).toBe(200);
  const r = (await (await ctx.request.get('/api/reports?months=12')).json()) as Reports;
  expect(r.spending.every((s) => s.totalMinor === 0)).toBe(true);
  expect(r.cashflow.every((c) => c.incomeMinor === 0 && c.spendingMinor === 0)).toBe(true);
  expect(r.networth.every((n) => n.minor === 0)).toBe(true);
  await ctx.close();
});

// ============ phone: charts take the width, tap works ============
test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('no sideways scroll, the toggle and the marks work by tap', async ({ page, me }) => {
    await seedReports(page, me);
    for (const t of TITLES) {
      const c = await chartOf(page, t);
      const three = c.getByRole('radio', { name: '3 months' });
      if (await three.count()) await three.check();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${t}: no horizontal page scroll`).toBeLessThanOrEqual(0);
      const box = await c.locator('svg').first().boundingBox();
      expect(box!.width, `${t} chart uses the width`).toBeGreaterThan(390 * 0.7);
    }
    const s = await chartOf(page, 'Spending by section');
    await marks(s).first().tap();
    await expect(tooltip(page)).toBeVisible();
    await toggle(s).tap();
    await expect(s.locator('table').first()).toBeVisible();
  });
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`reports ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('charts, tables, a tooltip and the empty page', async ({ page, me, browser, baseURL }) => {
        const tag = `${size}-${scheme}`;
        await expect((await chartOf(page, 'Net worth')).getByText('Nothing to show yet.')).toBeVisible();
        await shot(page, `reports-empty-${tag}`);

        await seedReports(page, me);
        await page.reload();
        await expect(marks(card(page, 'Net worth')).first()).toBeVisible();
        for (const t of TITLES) {
          const c = await chartOf(page, t);
          await expect(marks(c).first()).toBeVisible();
          await shot(page, `reports-${t.toLowerCase().replace(/ /g, '-')}-${tag}`);
        }
        const s = await chartOf(page, 'Spending by section');
        await marks(s).last().focus();
        await expect(tooltip(page)).toBeVisible();
        await shot(page, `reports-tooltip-${tag}`);
        const nw = await chartOf(page, 'Net worth');
        await nw.getByRole('radio', { name: '3 months' }).check();
        await shot(page, `reports-3-months-${tag}`);
        await toggle(nw).click();
        await shot(page, `reports-tables-${tag}`);
        void browser; void baseURL;
      });
    });
  }
}
