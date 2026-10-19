import { test, expect, dialog, row, srow, pillOf, seedBudget, bsection, restRow, collapse, cell, ruleCell, allHeads, shownHeads, subNames, summary, stat, btable, pocketRow, dayHeadingRe, shot, stickyBar, darkWhenSystemIsDark, type Seed } from '../support/fixtures';
import { MINUS, octIso, seedExample, closeApi } from '../support/closing';
import type { Page, Locator } from '@playwright/test';

// Spec 21: a compact, columnar look; updated for spec 27 (the Monarch look) where it changed radii, shadows, colours, type and the top bar. Rows, columns, collapse, the phone table, the layouts and the surfaces.
// Screenshots: spec21-<page>-<desktop|phone>-<light|dark>.png in e2e/screenshots/.
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };

const box = async (l: Locator) => (await l.boundingBox())!;
const px = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** A section that receives `receivedMinor` this month (income plus an amount step). */
async function funded(page: Page, s: Seed, sectionName: string, receivedMinor: number) {
  const section = await s.section(sectionName);
  const pocket = await s.pocket('Revolut', 0);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, receivedMinor, src.id);
  await s.amountStep(src.boxId, section.id, receivedMinor);
  return { section, pocket, src };
}
const addSub = async (page: Page, sectionId: number, body: object) => {
  const r = await page.request.post(`/api/sections/${sectionId}/subsections`, { data: body });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()).subsection as { id: number };
};

/** 5 sections and 23 subsections, with an income and some spending so that every column has figures. */
async function seedBig(page: Page, s: Seed) {
  const plan: [string, string[]][] = [
    ['Needs', ['Mortgage', 'Food', 'Utilities', 'Transport', 'Insurance']],
    ['Wants', ['Eating out', 'Subscriptions', 'Clothes', 'Hobbies', 'Gifts']],
    ['Savings', ['Emergency', 'Holiday', 'Car', 'Home', 'Retirement']],
    ['Family', ['School', 'Clubs', 'Doctor', 'Toys']],
    ['Fun', ['Cinema', 'Games', 'Books', 'Trips']],
  ];
  const pocket = await s.pocket('Revolut', 500000);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, 400000, src.id);
  let n = 0;
  for (const [name, subs] of plan) {
    const sec = await s.section(name);
    await s.amountStep(src.boxId, sec.id, 60000);
    for (const sub of subs) {
      const created = await s.subsection(sec.id, sub, 5000 + (n % 5) * 3000);
      if (n % 2 === 0) await s.expense(pocket.id, created.id, 1200 + n * 311, `${sub} shop`);
      n++;
    }
  }
  expect(n).toBe(23);
}

// ============ the table's columns and figures ============
test('the Budget table has the seven columns, and a subsection with a percentage, a carry and a move shows each figure in its own column', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const ex = await seedExample(page, me.seed); // September: Food 149.99 with 100.00 spent, so 49.99 is carried
  await closeApi(page);
  await addSub(page, ex.needs.id, { name: 'Share', budgetKind: 'percent', budgetBasisPoints: 4445 });
  const mv = await page.request.post('/api/moves', { data: { month: octIso, from: { subsectionId: ex.food.id }, to: { subsectionId: ex.rent.id }, amountMinor: 1000, reason: 'Rent is short' } });
  expect(mv.status(), await mv.text()).toBe(201);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();

  expect(await allHeads(page)).toEqual(['Subsection', 'Rule', 'Carried', 'Moved', 'Budgeted', 'Spent', 'Available']);
  expect(await shownHeads(page)).toEqual(['Subsection', 'Rule', 'Carried', 'Moved', 'Budgeted', 'Spent', 'Available']);
  await expect(page.locator('.ty-btable__head > *').filter({ hasText: 'Carried' })).toHaveAttribute('title', 'From last month');
  for (const h of await page.locator('.ty-btable__head > *').all()) { const b = await h.boundingBox(); if (b && b.width > 0) expect(b.height, 'header labels fit on one line').toBeLessThanOrEqual(24); }

  const food = srow(page, /Food/);
  await expect(await cell(page, food, 'Rule')).toHaveText('Fixed');
  await expect(await cell(page, food, 'From last month')).toHaveText('49.99');
  await expect(await cell(page, food, 'Moved')).toHaveText(`${MINUS}10.00`);
  await expect(await cell(page, food, 'Budgeted')).toHaveText('149.99');
  await expect(await cell(page, food, 'Spent')).toHaveText('0.00');
  const avail = pillOf(food);
  await expect(avail).toContainText('189.98'); // 149.99 + 49.99 - 10.00 - 0.00
  await expect(avail).toHaveClass(/ty-pill--positive/);
  expect(await cell(page, food, 'Available').then((c) => c.locator('.ty-pill').count())).toBe(1);

  const rent = srow(page, /Rent/);
  await expect(await cell(page, rent, 'From last month')).toHaveText('—');
  await expect(await cell(page, rent, 'Moved')).toHaveText(/^[+]?10[.]00$/);
  await expect(await cell(page, rent, 'Budgeted')).toHaveText('800.00');

  const share = srow(page, /Share/);
  await expect(await cell(page, share, 'Rule')).toContainText('44.45%');
  await expect(await cell(page, share, 'Moved')).toHaveText('—');
  await expect(await cell(page, share, 'From last month')).toHaveText('—');

  // the section row carries the totals of the figure columns, in 600 weight on the sunken surface
  const needs = bsection(page, 'Needs');
  await expect(await cell(page, needs, 'Moved')).toHaveText('—'); // the move stays inside Needs: +10.00 and -10.00
  expect(Number(await (await cell(page, needs, 'Budgeted')).evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(needs).toHaveCSS('background-color', await page.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--surface-sunken)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }));
  await shot(page, 'spec21-budget-columns-desktop-light');
});

test('the Moved column appears only in a month that has a move', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  expect(await shownHeads(page)).toEqual(['Subsection', 'Rule', 'Carried', 'Budgeted', 'Spent', 'Available']);
});

test('the Rule cell says Fixed, a percentage or Goal {target}, and its tooltip carries the rollover words', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const { section } = await funded(page, me.seed, 'Pool', 100000);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 6000, keep: 'cap', capMinor: 10000 });
  await addSub(page, section.id, { name: 'Bravo', budgetKind: 'percent', budgetBasisPoints: 6000, keep: 'none' });
  await addSub(page, section.id, { name: 'Car', kind: 'goal', budgetMinor: 3000, keep: 'cap', capMinor: 1500000 });
  await page.goto('/budget');
  await expect(srow(page, /Alpha/)).toBeVisible();
  const title = (n: RegExp) => ruleCell(page, n).then((c) => c.evaluate((el) => el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? ''));
  await expect(await ruleCell(page, /Alpha/)).toHaveText('Fixed');
  expect(await title(/Alpha/)).toMatch(/rolls over up to 100\.00/i);
  await expect(await ruleCell(page, /Bravo/)).toContainText('60%');
  expect(await title(/Bravo/)).toMatch(/does not roll over/i);
  await expect(await ruleCell(page, /Car/)).toContainText('Goal 15,000.00');
  expect(await title(/Car/)).toMatch(/fills to 15,000\.00/i);
  await expect(await ruleCell(page, /Alpha/)).toHaveCSS('color', await page.evaluate(() => { const d = document.createElement('div'); d.style.color = 'var(--ink-muted)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
});

test('a budget row has no empty bar, no meter and no notes beside its name', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  await expect(btable(page).locator('.ty-meter')).toHaveCount(0);
  expect(await subNames(page, 'Needs')).toEqual(['Food', 'Mortgage', 'Utilities']);
  const nameCell = await cell(page, srow(page, /Food/), 'Subsection');
  expect((await nameCell.innerText()).trim()).toBe('Food');
  for (const old of [/of what is left/, /rolls over up to/, /does not roll over/, /fills to/, /\d of [\d,.]+ spent/, /from \w+$/m]) {
    await expect(btable(page).getByText(old), String(old)).toHaveCount(0);
  }
});

test('the four Available states use the Pill: positive, warning near zero, neutral at zero, negative below', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(pillOf(srow(page, /Food/))).toHaveClass(/ty-pill--positive/);
  await expect(pillOf(srow(page, /Subscriptions/))).toHaveClass(/ty-pill--warning/);
  await expect(pillOf(srow(page, /Mortgage/))).not.toHaveClass(/ty-pill--(positive|warning|negative)/);
  await expect(pillOf(srow(page, /Utilities/))).toHaveClass(/ty-pill--negative/);
  await expect(pillOf(srow(page, /Utilities/))).toContainText('11.75');
  // the pill shows the amount only; its title (and accessible name) say left or over
  await expect(pillOf(srow(page, /Food/))).toHaveText('87.60');
  await expect(pillOf(srow(page, /Food/))).toHaveAttribute('title', '87.60 left');
  await expect(pillOf(srow(page, /Utilities/))).toHaveAttribute('title', /11\.75 over/);
  await expect(srow(page, /Food/).getByRole('img', { name: '87.60 left' }).or(srow(page, /Food/).getByLabel('87.60 left')).or(srow(page, /Food/).getByTitle('87.60 left')).first()).toBeAttached();
});

// ============ the Rest row ============
test('every section ends its subsections with a "Rest" row: the rest as a Pill in Available and where it goes in Rule', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const { section } = await funded(page, me.seed, 'Pool', 100000);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 60000 });
  await page.goto('/budget');
  await expect(srow(page, /Alpha/)).toBeVisible();
  const rest = restRow(page, 'Pool');
  await expect(rest).toBeVisible();
  await expect(rest).toContainText('Rest');
  await expect(pillOf(rest)).toHaveText(/400\.00/);
  await expect(pillOf(rest)).toHaveClass(/ty-pill--positive/); // a positive rest uses the positive state
  const rule = (await (await cell(page, rest, 'Rule')).innerText()).trim();
  expect(rule, 'where the rest goes').toMatch(/to next month's income|kept in Pool/);
  await expect(rest).not.toHaveAttribute('role', 'button');
  // it comes after the section's subsection rows and before the next section
  const order = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.ty-btable__sec, .ty-btable__row')];
    return all.map((e) => (e.matches('.ty-btable__sec') ? 'S' : e.getAttribute('role') === 'button' ? 'r' : 'R')).join('');
  });
  expect(order).toBe('SrR');
  // the old "Rest" pill next to the section name is gone
  await expect(bsection(page, 'Pool').locator('.ty-pill')).toHaveCount(0);
});

test('a section whose subsections claim more than it received shows a negative Rest in a warning Pill', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const { section } = await funded(page, me.seed, 'Pool', 100000);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 60000 });
  await addSub(page, section.id, { name: 'Bravo', budgetMinor: 70000 });
  await page.goto('/budget');
  await expect(srow(page, /Bravo/)).toBeVisible();
  const pill = pillOf(restRow(page, 'Pool'));
  await expect(pill).toContainText(`${MINUS}300.00`);
  await expect(pill).toHaveClass(/ty-pill--(warning|negative)/);
});

// ============ collapsing a section ============
test('the chevron collapses its section (aria-expanded), only that section, and it stays collapsed after a reload', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const needs = collapse(page, 'Needs');
  await expect(needs).toHaveAttribute('aria-expanded', 'true');
  await expect(collapse(page, 'Wants')).toHaveAttribute('aria-expanded', 'true');

  await needs.click();
  await expect(needs).toHaveAttribute('aria-expanded', 'false');
  for (const n of [/Food/, /Mortgage/, /Utilities/]) await expect(srow(page, n)).toBeHidden();
  await expect(srow(page, /Subscriptions/)).toBeVisible(); // Wants stays open
  await expect(bsection(page, 'Needs')).toBeVisible(); // the section row and its totals stay
  await expect(await cell(page, bsection(page, 'Needs'), 'Budgeted')).toContainText('1,020.00');
  await shot(page, 'spec21-budget-collapsed-desktop-light');

  await page.reload();
  await expect(srow(page, /Subscriptions/)).toBeVisible();
  await expect(collapse(page, 'Needs')).toHaveAttribute('aria-expanded', 'false');
  await expect(srow(page, /Food/)).toBeHidden();
  await expect(collapse(page, 'Wants')).toHaveAttribute('aria-expanded', 'true');

  // keyboard: the chevron is a button, so Enter opens the section again
  await collapse(page, 'Needs').focus();
  await page.keyboard.press('Enter');
  await expect(collapse(page, 'Needs')).toHaveAttribute('aria-expanded', 'true');
  await expect(srow(page, /Food/)).toBeVisible();
  await page.reload();
  await expect(srow(page, /Food/)).toBeVisible();
  await expect(collapse(page, 'Needs')).toHaveAttribute('aria-expanded', 'true');
});

test('collapsing is remembered per section, and the page still works when the browser keeps nothing', async ({ page, me, context }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  await collapse(page, 'Wants').click();
  await page.reload();
  await expect(collapse(page, 'Wants')).toHaveAttribute('aria-expanded', 'false');
  await expect(collapse(page, 'Needs')).toHaveAttribute('aria-expanded', 'true');
  await expect(srow(page, /Food/)).toBeVisible();
  // a storage that throws must not break the page
  const p2 = await context.newPage();
  await p2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const errors: string[] = [];
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto('/budget');
  await expect(srow(p2, /Food/)).toBeVisible();
  await collapse(p2, 'Needs').click();
  await expect(collapse(p2, 'Needs')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
  await p2.close();
});

// ============ the phone ============
test.describe('phone', () => {
  test.use({ viewport: phone });

  test('the table keeps Subsection, Spent and Available, rows are 44px, and a row still opens its dialog with the other figures', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(srow(page, /Food/)).toBeVisible();
    expect(await shownHeads(page)).toEqual(['Subsection', 'Spent', 'Available']);
    const food = srow(page, /Food/);
    await expect(food).toContainText('212.40'); // Spent
    await expect(pillOf(food)).toContainText('87.60'); // Available
    expect(await food.evaluate((e) => (e as HTMLElement).innerText), 'Budgeted is not a phone column').not.toContain('300.00');
        expect(Math.round((await box(food)).height)).toBe(44);
    expect(Math.round((await box(bsection(page, 'Needs'))).height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll').toBe(true);
    expect(Math.round((await box(btable(page))).x)).toBe(16); // phone gutter
    await food.click();
    await expect(dialog(page).getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
    await expect(dialog(page).getByLabel('Monthly budget')).toHaveValue(/^300(\.00)?$/);
    await page.keyboard.press('Escape');
    await expect(food).toBeFocused();
  });

  test('the Rest row and the section\'s plus button fit the phone columns, and a section name is never clipped', async ({ page, me }) => {
    const { section } = await funded(page, me.seed, 'Pool', 100000);
    await addSub(page, section.id, { name: 'Alpha', budgetMinor: 60000 });
    await page.goto('/budget');
    await expect(srow(page, /Alpha/)).toBeVisible();
    await expect(pillOf(restRow(page, 'Pool'))).toContainText('400.00');
    await expect(page.getByRole('button', { name: 'Add subsection to Pool', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Pool', exact: true })).toBeVisible();
    expect(Math.round((await box(restRow(page, 'Pool'))).height)).toBe(44);
    const name = bsection(page, 'Pool').getByText('Pool', { exact: true });
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth), 'the section name is not clipped').toBe(true);
    expect(await name.evaluate((e) => (e as HTMLElement).innerText)).toBe('Pool');
  });

  test('with several sections, no section name is clipped on a phone', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(srow(page, /Food/)).toBeVisible();
    for (const n of ['Needs', 'Wants']) {
      const name = bsection(page, n).getByText(n, { exact: true });
      await expect(name).toBeVisible();
      expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth), `${n} fits`).toBe(true);
      const b = await box(name);
      expect(b.width, `${n} is fully drawn`).toBeGreaterThan(30);
    }
    await shot(page, 'spec21-phone-section-names');
  });
});

// ============ the Budget screen's layout ============
test('wide (1500px): four equal stat cards above the table with the figure centred and the label under it, and a sticky 56px top bar', async ({ page, me }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const t = await box(btable(page));
  const boxes: Locator[] = [];
  let prev: { x: number; width: number } | null = null;
  for (const [label, amount] of [['Income', '2,000.00'], ['Budgeted', '1,060.00'], ['Spent', '983.12'], ['Left over', '940.00']] as const) {
    const r = stat(page, label);
    await expect(r, label).toContainText(amount);
    boxes.push(r);
    const rb = await box(r);
    expect(rb.y + rb.height, `${label} is above the table`).toBeLessThanOrEqual(t.y + 1);
    const lb = await box(r.getByText(label === 'Spent' ? /^Spent/ : label, { exact: label !== 'Spent' }).first());
    const ab = await box(r.getByText(amount, { exact: true }).first());
    expect(ab.y, `${label}: the figure is above its label`).toBeLessThan(lb.y);
    expect(Math.abs(ab.x + ab.width / 2 - (rb.x + rb.width / 2)), `${label}: the figure is centred`).toBeLessThan(6);
    if (prev) expect(rb.x, 'cards are side by side').toBeGreaterThan(prev.x + prev.width - 1);
    prev = rb;
  }
  const widths = await Promise.all(boxes.map(async (l) => Math.round((await box(l)).width)));
  expect(Math.max(...widths) - Math.min(...widths), 'equal cards').toBeLessThanOrEqual(2);
  const bar = await stickyBar(page);
  expect(Math.round(bar!.height), 'a 56px top bar').toBe(56);
});

test('narrow (under 1464px): the four stats are one row above the table, and "Moved this month" goes below it', async ({ page, me }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  const ex = await seedExample(page, me.seed);
  await closeApi(page);
  const mv = await page.request.post('/api/moves', { data: { month: octIso, from: { subsectionId: ex.food.id }, to: { subsectionId: ex.rent.id }, amountMinor: 1000, reason: 'Rent is short' } });
  expect(mv.status()).toBe(201);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const t = await box(btable(page));
  const ys = [];
  for (const label of ['Income', 'Budgeted', 'Spent', 'Left over']) {
    const b = await box(stat(page, label));
    ys.push(b.y);
    expect(b.y + b.height, `${label} is above the table`).toBeLessThanOrEqual(t.y + 1);
  }
  expect(Math.max(...ys) - Math.min(...ys), 'one row of four').toBeLessThan(6);
  const moved = await box(page.getByText('Moved this month', { exact: true }));
  expect(moved.y, '"Moved this month" is below the table').toBeGreaterThanOrEqual(t.y + t.height - 1);
});

test('wide (1500px): "Moved this month" is in the aside right of the table', async ({ page, me }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  const ex = await seedExample(page, me.seed);
  await closeApi(page);
  const mv = await page.request.post('/api/moves', { data: { month: octIso, from: { subsectionId: ex.food.id }, to: { subsectionId: ex.rent.id }, amountMinor: 1000, reason: 'Rent is short' } });
  expect(mv.status()).toBe(201);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const t = await box(btable(page));
  const m = await box(page.getByText('Moved this month', { exact: true }));
  expect(m.x).toBeGreaterThanOrEqual(t.x + t.width);
});

// ============ sizes ============
test('desktop sizes: 20/28 page title, 14/20 body, 32px top-bar buttons, 28px small buttons, rows of 40px', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const h1 = page.getByRole('heading', { level: 1 }).first();
  expect(await px(h1, 'font-size')).toBe('20px');
  expect(await px(h1, 'line-height')).toBe('28px');
  expect(await px(h1, 'font-weight')).toBe('600');
  const food = srow(page, /Food/);
  expect(await px(await cell(page, food, 'Subsection'), 'font-size')).toBe('14px');
  expect(await px(await cell(page, food, 'Subsection'), 'line-height')).toBe('20px');
  expect(Math.round((await box(food)).height)).toBe(40);
  expect(Math.round((await box(bsection(page, 'Needs'))).height)).toBe(40);
  expect(Math.round((await box(restRow(page, 'Needs'))).height)).toBe(40);
  expect(Math.round((await box(page.getByRole('button', { name: 'Add transaction', exact: true }))).height)).toBe(32);
  expect(Math.round((await box(page.getByRole('button', { name: 'Add income', exact: true }))).height)).toBe(32);
  expect(Math.round((await box(bsection(page, 'Needs').getByRole('button', { name: 'Edit Needs', exact: true }))).height)).toBe(28);
  expect(Math.round((await box(page.getByRole('button', { name: 'Add subsection to Needs', exact: true }))).height)).toBe(28);
  await expect(page.locator('.ty-btable__add')).toHaveCount(0);
  expect(await px(page.locator('.ty-btable__head').first(), 'font-size')).toBe('11px'); // text-label
  // the page content is at most 1200px wide, the table is a card with a 16px padding
  await page.setViewportSize({ width: 1700, height: 900 });
  expect((await box(page.locator('.ty-budget').first())).width, 'content width').toBeLessThanOrEqual(1264);
});

test('a touch screen keeps a hit area of 44px on every row and control', async ({ browser, baseURL }) => {
  const { createPerson, signInByApi, seed } = await import('../support/fixtures');
  const person = await createPerson(baseURL!);
  const ctx = await browser.newContext({ viewport: desktop, hasTouch: true, baseURL });
  const page = await ctx.newPage();
  await signInByApi(page, person);
  await seedBudget(seed(page));
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  test.skip(!coarse, 'this browser does not report a coarse pointer');
  expect((await box(srow(page, /Food/))).height).toBeGreaterThanOrEqual(44);
  expect((await box(page.getByRole('button', { name: 'Add transaction', exact: true }))).height).toBeGreaterThanOrEqual(44);
  // the pencil keeps a 44px hit area: a point 20px below its centre still lands on it
  const pen = await box(bsection(page, 'Needs').getByRole('button', { name: /^Edit / }));
  const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? ''), [pen.x + pen.width / 2, pen.y + pen.height / 2 + 20]);
  expect(hit, 'the pencil hit area').toMatch(/^Edit /);
  await ctx.close();
});

// ============ surfaces ============
for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: cards read like Monarch's (${scheme === 'light' ? 'warm page, white card, no outline, soft shadow' : 'a card one step above the page, a 1px line, no shadow'})`, async ({ browser, baseURL }) => {
    const { createPerson, signInByApi, seed } = await import('../support/fixtures');
    const person = await createPerson(baseURL!);
    const ctx = await browser.newContext({ viewport: desktop, colorScheme: scheme, baseURL });
    await ctx.addInitScript(darkWhenSystemIsDark);
    const page = await ctx.newPage();
    await signInByApi(page, person);
    await seedBudget(seed(page));
    await page.goto('/budget');
    await expect(srow(page, /Food/)).toBeVisible();
    const probe = (v: string, prop: 'backgroundColor') => page.evaluate(([name, p]) => { const d = document.createElement('div'); d.style.background = `var(${name})`; document.body.append(d); const c = getComputedStyle(d)[p as 'backgroundColor']; d.remove(); return c; }, [v, prop]);
    const card = btable(page);
    const pageBg = await page.evaluate(() => {
      for (const el of [document.querySelector('.ty-main'), document.querySelector('.ty-shell'), document.body, document.documentElement]) {
        const c = el ? getComputedStyle(el).backgroundColor : '';
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      }
      return '';
    });
    const css = await card.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, radius: c.borderTopLeftRadius, border: c.borderTopWidth, shadow: c.boxShadow, outline: c.outlineStyle }; });
    expect(css.radius, 'an 8px radius').toBe('8px');
    expect(css.border, scheme === 'light' ? 'no border' : 'a 1px line').toBe(scheme === 'light' ? '0px' : '1px');
    expect(css.bg).toBe(await probe('--surface', 'backgroundColor'));
    expect(css.bg, 'the card differs from the page').not.toBe(pageBg);
    if (scheme === 'light') {
      expect(pageBg, 'the page is --bg').toBe('rgb(246, 245, 242)');
      expect(css.bg).toBe('rgb(255, 255, 255)');
      expect(css.shadow).toContain('rgba(0, 0, 0, 0.05) 0px 1px 2px');
    } else {
      expect(css.shadow, 'no shadow in dark').toBe('none');
      const lum = (c: string) => c.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
      expect(lum(css.bg), 'the card is lighter than the page').toBeGreaterThan(lum(pageBg));
    }
    await ctx.close();
  });
}

// ============ Transactions ============
test('Transactions is one card with sticky 36px date headers ("Sunday, 18 October" and the day total on the right) and 44px rows, the amount on the right and income in positive', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const b = await seedBudget(me.seed);
  for (let i = 1; i <= 25; i++) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCDate(1 + (i % 9));
    await me.seed.expense(b.pocket.id, b.food.id, 100 + i, `Filler ${i}`, d.toISOString().slice(0, 10));
  }
  await page.goto('/transactions');
  const alpha = row(page, /Alphamega/);
  await expect(alpha).toBeVisible();
  const head = page.getByText(dayHeadingRe()).first();
  await expect(head).toBeVisible();
  expect(Math.round((await box(page.locator('.ty-day').first())).height), 'a 36px date header').toBe(36);
  expect(await px(page.locator('.ty-day').first(), 'position')).toBe('sticky');
  const dh = await box(page.locator('.ty-day').first());
  const total = await box(page.locator('.ty-day').first().getByText(/d[d,]*.dd/).first());
  expect(total.x + total.width, 'the day total is on the right of the header').toBeGreaterThan(dh.x + dh.width - 40);
  expect(Math.round((await box(alpha)).height), 'a 44px row').toBe(44);
  expect(await px(alpha.getByText('Alphamega'), 'font-weight')).toBe('500');
  expect(await px(alpha.getByText('Alphamega'), 'font-size')).toBe('14px');
  const r = await box(alpha);
  const amount = await box(alpha.getByText('−212.40'));
  expect(amount.x + amount.width, 'amount right-aligned').toBeGreaterThan(r.x + r.width - 40);
  await expect(alpha.locator('.ty-dot').first()).toBeVisible();
  const pay = row(page, /Paycheck/);
  await expect(pay.locator('.ty-num--pos')).toBeVisible();
  // one card: the rows share one container with the date headers
  const cards = await page.locator('main .ty-card, .ty-main .ty-card').count();
  expect(cards, 'one card holds the list').toBeLessThanOrEqual(2);
  // sticky: after scrolling, a date header stays at the top
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
  const stuck = page.locator('.ty-day').first();
  const y = (await box(stuck)).y;
  expect(y, 'a date header sticks under the top bar').toBeLessThan(120);
  await shot(page, 'spec21-transactions-scrolled-desktop-light');
});

test.describe('phone transactions', () => {
  test.use({ viewport: phone });
  test('the subsection sits under the payee in a caption', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/transactions');
    const alpha = row(page, /Alphamega/);
    await expect(alpha).toBeVisible();
    const payee = await box(alpha.getByText('Alphamega', { exact: true }));
    const sub = await box(alpha.getByText(/Food/).first());
    expect(sub.y, 'Food is under Alphamega').toBeGreaterThanOrEqual(payee.y + payee.height - 2);
    expect(Math.round((await box(alpha)).height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

// ============ Pockets ============
test('Pockets: net worth in the 30/36 hero size, the pockets in cards of 56px rows with emoji, name, kind and the balance on the right', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await me.seed.pocket('Wallet', 2500, 'cash');
  await page.goto('/pockets');
  const rev = pocketRow(page, 'Revolut');
  await expect(rev).toBeVisible();
  const hero = page.locator('.num-hero').first();
  expect(await px(hero, 'font-size')).toBe('30px');
  expect(await px(hero, 'line-height')).toBe('36px');
  expect(Math.round((await box(rev)).height), 'a 56px row').toBe(56);
  expect(Math.round((await box(pocketRow(page, 'Wallet'))).height)).toBe(56);
  await expect(rev.locator('.ty-emoji').first()).toBeVisible();
  await expect(rev).toContainText('Bank account');
  const r = await box(rev);
  const bal = await box(rev.getByText('2,016.88'));
  expect(bal.x + bal.width, 'balance right-aligned').toBeGreaterThan(r.x + r.width - 40);
  // spec 27: pockets sit in group cards (8px radius); the emoji is on a 36px round avatar
  const cardRadius = await rev.evaluate((el) => { let a: Element | null = el; while (a && getComputedStyle(a).boxShadow === 'none' && getComputedStyle(a).borderTopWidth === '0px') a = a.parentElement; return a ? getComputedStyle(a).borderTopLeftRadius : ''; });
  expect(cardRadius, 'the group card').toBe('8px');
  const av = await box(rev.locator('.ty-emoji').first().locator('xpath=ancestor-or-self::*[contains(@class,"avatar") or contains(@class,"ty-emoji")][last()]'));
  expect(Math.round(av.width), 'a 36px avatar').toBe(36);
  await rev.click();
  await expect(dialog(page).getByRole('heading', { name: 'Edit pocket' })).toBeVisible();
});

// ============ the height of the Budget page ============
test('5 sections and 23 subsections at 1280x800: the table holds 34 rows of exactly 40px and nothing else', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBig(page, me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Retirement/)).toBeVisible();
  const table = await box(btable(page));
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.ty-btable__head, .ty-btable__sec, .ty-btable__row')].map((e) => ({ k: e.className.split(' ')[0], h: e.getBoundingClientRect().height, button: e.getAttribute('role') === 'button' })));
  console.log(`BUDGET HEIGHT 1280x800, 5 sections, 23 subsections: table ${Math.round(table.height)}px = ${(table.height / 800).toFixed(2)} screens; page ${pageHeight}px = ${(pageHeight / 800).toFixed(2)} screens; ${kinds.length} rows`);
  test.info().annotations.push({ type: 'budget-height', description: `table ${Math.round(table.height)}px, page ${pageHeight}px, ${kinds.length} rows` });
  expect(kinds.length, 'header + 5 sections + 23 subsections + 5 rests').toBe(34);
  expect(kinds.filter((x) => x.k === 'ty-btable__sec')).toHaveLength(5);
  expect(kinds.filter((x) => x.button)).toHaveLength(23);
  expect(kinds.filter((x) => x.k === 'ty-btable__row' && !x.button)).toHaveLength(5);
  for (const x of kinds) expect(x.h, JSON.stringify(x)).toBeCloseTo(x.k === 'ty-btable__head' ? 32 : 40, 0);
  expect(table.height, 'header 32 + 33 rows of 40').toBeCloseTo(32 + 33 * 40, 0);
  await expect(page.locator('.ty-btable__add')).toHaveCount(0);
  // the header row sticks while the page scrolls
  const head = page.locator('.ty-btable__head').first();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  const hy = (await box(head)).y;
  expect(hy, 'the column header stays in view').toBeGreaterThanOrEqual(0);
  expect(hy, 'the column header stays near the top').toBeLessThan(120);
});

// ============ screenshots: Budget (to scroll), Transactions, Pockets; light and dark, desktop and phone ============
for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`screenshots ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('Budget with 23 subsections, Transactions and Pockets', async ({ page, me }) => {
        await seedBig(page, me.seed);
        const tag = `${size}-${scheme}`;
        await page.goto('/budget');
        await expect(srow(page, /Retirement/)).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `screenshots/spec21-budget-${tag}.png`, fullPage: false });
        await page.screenshot({ path: `screenshots/spec21-budget-full-${tag}.png`, fullPage: true });
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `screenshots/spec21-budget-scrolled-${tag}.png`, fullPage: false });
        await page.goto('/transactions');
        await expect(row(page, /Mortgage shop/)).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `screenshots/spec21-transactions-${tag}.png`, fullPage: false });
        await page.goto('/pockets');
        await expect(pocketRow(page, 'Revolut')).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `screenshots/spec21-pockets-${tag}.png`, fullPage: false });
        await page.goto('/budget');
        await srow(page, /Food/).click();
        await expect(dialog(page)).toBeVisible();
        await shot(page, `spec21-dialog-subsection-${tag}`);
      });
    });
  }
}

test('a 1280px laptop gets every column and the four stats above the table, not an aside', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toBeVisible();
  const t = await box(btable(page));
  expect((await box(stat(page, 'Left over'))).y + 1).toBeLessThanOrEqual(t.y);
  await expect(page.getByText('Spent', { exact: true }).first()).toBeVisible(); // the label is Spent, not "Spent so far"
  await expect(page.getByText('Spent so far')).toHaveCount(0);
  expect((await shownHeads(page)).length).toBeGreaterThanOrEqual(6);
});
