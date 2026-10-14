import { test, expect, dialog, shot, row, pillOf, chip, group, seedBudget, type Seed } from '../support/fixtures';
import { MINUS, octName, sepName, norm, octIso, seedExample, closeApi, openCloseDialog, CLOSE_BTN, bsection, stat, getJson } from '../support/closing';
import type { Page, Locator } from '@playwright/test';

// Spec 11: subsection budgets (amount or percentage), rollover caps and savings goals. Browser acceptance criteria 2 to 6.
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };
test.use({ viewport: desktop });

const PCT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';
const PCT_SUM = 'The percentages in one section can add up to at most 100.';

type SubBody = {
  name: string; kind?: 'spending' | 'goal'; budgetKind?: 'amount' | 'percent'; budgetMinor?: number; budgetBasisPoints?: number;
  keep?: 'all' | 'cap' | 'none'; capMinor?: number; position?: number;
};
const addSub = async (page: Page, sectionId: number, body: SubBody) => {
  const r = await page.request.post(`/api/sections/${sectionId}/subsections`, { data: body });
  expect(r.status(), `POST subsection ${body.name}: ${await r.text()}`).toBeLessThan(300);
  return (await r.json()).subsection as { id: number };
};
/** A section that receives `receivedMinor` in the current month (income plus an amount step). */
async function funded(page: Page, s: Seed, sectionName: string, receivedMinor: number) {
  const section = await s.section(sectionName);
  const pocket = await s.pocket('Revolut', 0);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, receivedMinor, src.id);
  await s.amountStep(src.boxId, section.id, receivedMinor);
  return { section, pocket, src };
}
/** Finds the first object with that name anywhere in a JSON value. */
const findNamed = (v: unknown, name: string): Record<string, unknown> | undefined => {
  if (Array.isArray(v)) for (const x of v) { const f = findNamed(x, name); if (f) return f; }
  else if (v && typeof v === 'object') {
    if ((v as { name?: unknown }).name === name) return v as Record<string, unknown>;
    for (const x of Object.values(v)) { const f = findNamed(x, name); if (f) return f; }
  }
  return undefined;
};

// ---- subsection dialog finders ----
/** A text field by label; the Budget control's "Percentage" radio has the same name as the field. */
const field = (d: Locator, label: string) => d.locator('input:not([type=radio]):not([type=checkbox])').and(d.getByLabel(label, { exact: true }));
const note = (r: Locator) => r.locator('.ty-brow__title .ty-cap');
const titles = (scope: Locator) => scope.locator('.ty-brow .ty-brow__title > span:first-child');
const openAdd = async (page: Page, sectionName?: string) => {
  const scope = sectionName ? bsection(page, sectionName) : page;
  await scope.getByRole('button', { name: 'Add subsection', exact: true }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add subsection' })).toBeVisible();
  return d;
};
const openEdit = async (page: Page, name: RegExp | string) => {
  await row(page, name).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
  return d;
};

// ============ criterion 2: the percentage example ============
test('1,000.01 received with A fixed 60.00, B 60% and C 40% shows B 564.00, C 376.00, "Rest 0.01" and B\'s note', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Pool', 100001);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 6000 });
  await addSub(page, section.id, { name: 'Bravo', budgetKind: 'percent', budgetBasisPoints: 6000 });
  await addSub(page, section.id, { name: 'Charlie', budgetKind: 'percent', budgetBasisPoints: 4000 });
  await page.goto('/budget');
  await expect(row(page, /Bravo/)).toBeVisible();
  await expect(row(page, /Alpha/)).toContainText('60.00');
  await expect(row(page, /Bravo/)).toContainText('564.00');
  await expect(row(page, /Charlie/)).toContainText('376.00');
  await expect(bsection(page, 'Pool')).toContainText('Rest 0.01');
  await expect(note(row(page, /Bravo/))).toHaveText('60% of what is left');
  await expect(note(row(page, /Charlie/))).toHaveText('40% of what is left');
  await expect(note(row(page, /Alpha/))).toHaveText('');
  const b = findNamed(await getJson(page, `/api/budget?month=${octIso}`), 'Bravo')!;
  expect(b.budgetMinor).toBe(56400);
  expect(b.budgetKind).toBe('percent');
  expect(b.budgetBasisPoints).toBe(6000);
});

test('percentages get 0.00 when the fixed amounts claim everything', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Pool', 5000);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 6000 });
  await addSub(page, section.id, { name: 'Bravo', budgetKind: 'percent', budgetBasisPoints: 5000 });
  await page.goto('/budget');
  await expect(row(page, /Bravo/)).toBeVisible();
  await expect(pillOf(row(page, /Bravo/))).toContainText('0.00');
  await expect(row(page, /Bravo/)).not.toContainText('50.00');
});

// ============ criterion 3: the subsection dialog ============
test('the dialog lists its fields in order, with Spending, Amount and Everything chosen to start', async ({ page, me }) => {
  await me.seed.section('Needs');
  await page.goto('/budget');
  const d = await openAdd(page);
  await expect(d.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(group(d, 'Kind').locator('.ty-segmented')).toHaveCount(1);
  await expect(chip(d, 'Kind', 'Spending')).toBeChecked();
  await expect(chip(d, 'Kind', 'Savings goal')).not.toBeChecked();
  await expect(chip(d, 'Budget', 'Amount')).toBeChecked();
  await expect(chip(d, 'Budget', 'Percentage')).not.toBeChecked();
  await expect(field(d, 'Monthly budget')).toBeVisible();
  await expect(d.getByText('EUR').first()).toBeVisible();
  await expect(field(d, 'Percentage')).toHaveCount(0);
  await expect(chip(d, 'At month end, keep', 'Everything')).toBeChecked();
  await expect(chip(d, 'At month end, keep', 'Up to')).toBeVisible();
  await expect(chip(d, 'At month end, keep', 'Nothing')).toBeVisible();
  await expect(field(d, 'Keep up to')).toHaveCount(0);
  await expect(d.getByText("What is not kept joins the section's rest.")).toBeVisible();
  await expect(d.getByLabel('Position', { exact: true })).toHaveCount(0);
  // field order: Name, Kind, Budget, keep
  const text = norm(await d.innerText()).toLowerCase();
  const at = ['Name', 'Kind', 'Budget', 'At month end, keep'].map((t) => text.indexOf(t.toLowerCase()));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join(), `order ${at}`).toBe(true);

  await chip(d, 'Budget', 'Percentage').check();
  await expect(field(d, 'Percentage')).toBeVisible();
  await expect(field(d, 'Monthly budget')).toHaveCount(0);
  await expect(d.getByText('Of what is left in the section after the fixed amounts.')).toBeVisible();
  await chip(d, 'At month end, keep', 'Up to').check();
  await expect(field(d, 'Keep up to')).toBeVisible();
  await chip(d, 'Kind', 'Savings goal').check();
  await expect(field(d, 'Target')).toBeVisible();
  await expect(d.getByText('It keeps its money until it reaches the target.')).toBeVisible();
  await expect(group(d, 'At month end, keep')).toHaveCount(0);
  await expect(field(d, 'Keep up to')).toHaveCount(0);
  await chip(d, 'Kind', 'Spending').check();
  await expect(group(d, 'At month end, keep')).toBeVisible();
});

test('adding a percentage subsection that keeps up to 50.00 shows both notes and saves every field', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Pool', 100000);
  await addSub(page, section.id, { name: 'Alpha', budgetMinor: 20000 });
  await page.goto('/budget');
  const d = await openAdd(page, 'Pool');
  await d.getByLabel('Name', { exact: true }).fill('Bravo');
  await chip(d, 'Budget', 'Percentage').check();
  await field(d, 'Percentage').fill('25');
  await chip(d, 'At month end, keep', 'Up to').check();
  await field(d, 'Keep up to').fill('50');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  const r = row(page, /Bravo/);
  await expect(note(r)).toHaveText('25% of what is left · rolls over up to 50.00');
  await expect(r).toContainText('200.00'); // 25% of 800.00
  const b = findNamed(await getJson(page, `/api/budget?month=${octIso}`), 'Bravo')!;
  expect(b).toMatchObject({ kind: 'spending', budgetKind: 'percent', budgetBasisPoints: 2500, keep: 'cap', capMinor: 5000, budgetMinor: 20000 });
});

test('adding a savings goal and a "Nothing" subsection shows "fills to 15,000.00" and "does not roll over"', async ({ page, me }) => {
  await funded(page, me.seed, 'Pool', 100000);
  await page.goto('/budget');
  let d = await openAdd(page, 'Pool');
  await d.getByLabel('Name', { exact: true }).fill('Car');
  await chip(d, 'Kind', 'Savings goal').check();
  await field(d, 'Monthly budget').fill('300');
  await field(d, 'Target').fill('15000');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(note(row(page, /Car/))).toHaveText('fills to 15,000.00');

  d = await openAdd(page, 'Pool');
  await d.getByLabel('Name', { exact: true }).fill('Fun');
  await field(d, 'Monthly budget').fill('50');
  await chip(d, 'At month end, keep', 'Nothing').check();
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(note(row(page, /Fun/))).toHaveText('does not roll over');

  const api = await getJson(page, `/api/budget?month=${octIso}`);
  expect(findNamed(api, 'Car')).toMatchObject({ kind: 'goal', keep: 'cap', capMinor: 1500000 });
  expect(findNamed(api, 'Fun')).toMatchObject({ kind: 'spending', keep: 'none' });
});

test('editing opens with the saved choices and switching them changes the row', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Pool', 100000);
  await addSub(page, section.id, { name: 'Gym', budgetMinor: 4000, keep: 'cap', capMinor: 1000 });
  await page.goto('/budget');
  await expect(note(row(page, /Gym/))).toHaveText('rolls over up to 10.00');
  let d = await openEdit(page, /Gym/);
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Gym');
  await expect(chip(d, 'At month end, keep', 'Up to')).toBeChecked();
  await expect(field(d, 'Keep up to')).toHaveValue(/^10(\.00)?$/);
  await expect(field(d, 'Monthly budget')).toHaveValue(/^40(\.00)?$/);
  await chip(d, 'Budget', 'Percentage').check();
  await field(d, 'Percentage').fill('10');
  await chip(d, 'At month end, keep', 'Everything').check();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(note(row(page, /Gym/))).toHaveText('10% of what is left');
  await expect(row(page, /Gym/)).toContainText('100.00');

  d = await openEdit(page, /Gym/);
  await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
  await expect(field(d, 'Percentage')).toHaveValue(/^10(\.0+)?$/);
  await chip(d, 'Kind', 'Savings goal').check();
  await field(d, 'Target').fill('500');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(note(row(page, /Gym/))).toHaveText('10% of what is left · fills to 500.00');
});

test('percentages and amounts are checked with the sentences of spec 04 before anything is sent', async ({ page, me }) => {
  await me.seed.section('Needs');
  await page.goto('/budget');
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/subsections$/.test(r.url())) posts.push(r.url()); });
  const d = await openAdd(page);
  await d.getByLabel('Name', { exact: true }).fill('Bad');
  await chip(d, 'Budget', 'Percentage').check();
  for (const bad of ['0', '101', '12.345']) {
    await field(d, 'Percentage').fill(bad);
    await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
    await expect(d.getByText(PCT_ERROR), bad).toBeVisible();
    await expect(field(d, 'Percentage')).toHaveClass(/ty-input--error/);
    await expect(d).toBeVisible();
  }
  await field(d, 'Percentage').fill('20');
  await chip(d, 'At month end, keep', 'Up to').check();
  await field(d, 'Keep up to').fill('1.234');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d.getByText(/two decimals/)).toBeVisible();
  await expect(field(d, 'Keep up to')).toHaveClass(/ty-input--error/);
  expect(posts, 'nothing was sent').toEqual([]);
});

test('a goal with a target of 0 is refused under "Target"', async ({ page, me }) => {
  await me.seed.section('Needs');
  await page.goto('/budget');
  const d = await openAdd(page);
  await d.getByLabel('Name', { exact: true }).fill('Car');
  await chip(d, 'Kind', 'Savings goal').check();
  await field(d, 'Monthly budget').fill('100');
  await field(d, 'Target').fill('0');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d.getByText(/Enter (a target|an amount) above zero/)).toBeVisible();
  await expect(field(d, 'Target')).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
});

test('percentages adding up to more than 100 in one section show the server\'s sentence under "Percentage"', async ({ page, me }) => {
  const s = await me.seed.section('Pool');
  await addSub(page, s.id, { name: 'Bravo', budgetKind: 'percent', budgetBasisPoints: 6000 });
  await page.goto('/budget');
  const d = await openAdd(page, 'Pool');
  await d.getByLabel('Name', { exact: true }).fill('Charlie');
  await chip(d, 'Budget', 'Percentage').check();
  await field(d, 'Percentage').fill('50');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d.getByText(PCT_SUM)).toBeVisible();
  await expect(field(d, 'Percentage')).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
  await field(d, 'Percentage').fill('40');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(note(row(page, /Charlie/))).toHaveText('40% of what is left');
});

test('"Position" moves a subsection among its section\'s subsections', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  const other = await me.seed.section('Wants');
  await me.seed.subsection(other.id, 'Solo', 1000);
  for (const n of ['One', 'Two', 'Three']) await me.seed.subsection(s.id, n, 1000);
  await page.goto('/budget');
  const needs = bsection(page, 'Needs');
  await expect(titles(needs)).toHaveText(['One', 'Two', 'Three']);

  // a section with one subsection offers no Position
  const solo = await openEdit(page, /Solo/);
  await expect(solo.getByLabel('Position', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(solo).toBeHidden();

  const d = await openEdit(page, /Three/);
  const pos = d.getByLabel('Position', { exact: true });
  await expect(pos.locator('option')).toHaveText(['1', '2', '3']);
  await expect(pos.locator('option:checked')).toHaveText('3');
  await pos.selectOption({ label: '1' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(titles(needs)).toHaveText(['Three', 'One', 'Two']);
  await page.reload();
  await expect(titles(bsection(page, 'Needs'))).toHaveText(['Three', 'One', 'Two']);

  const d2 = await openEdit(page, /Three/);
  await d2.getByLabel('Position', { exact: true }).selectOption({ label: '2' });
  await d2.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d2).toBeHidden();
  await expect(titles(bsection(page, 'Needs'))).toHaveText(['One', 'Three', 'Two']);
});

// ============ criterion 4: goals ============
test('a goal row shows This month, Saved, "42% of 700", the goal meter and "fills to 700.00"', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Savings', 30000);
  await addSub(page, section.id, { name: 'Car', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 70000 });
  await page.goto('/budget');
  const r = row(page, /Car/);
  await expect(r).toBeVisible();
  await expect(note(r)).toHaveText('fills to 700.00');
  await expect(pillOf(r)).toHaveText('42% of 700');
  const cells = r.locator('.ty-num');
  await expect(cells.nth(0)).toHaveText('300.00'); // This month
  await expect(cells.nth(1)).toHaveText('300.00'); // Saved
  const meter = r.locator('.ty-meter');
  await expect(meter).toHaveClass(/ty-meter--goal/);
  await expect(meter).toHaveAttribute('aria-label', '300.00 of 700.00 saved');
  const w = await meter.locator('span').evaluate((e) => e.getBoundingClientRect().width / e.parentElement!.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(0.41);
  expect(w).toBeLessThan(0.44);
});

test('a goal\'s meter never goes past full', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Savings', 30000);
  await addSub(page, section.id, { name: 'Trip', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 10000 });
  await page.goto('/budget');
  const meter = row(page, /Trip/).locator('.ty-meter');
  await expect(meter).toHaveClass(/ty-meter--goal/);
  const w = await meter.locator('span').evaluate((e) => e.getBoundingClientRect().width / e.parentElement!.getBoundingClientRect().width);
  expect(w).toBeLessThanOrEqual(1.001);
  expect(w).toBeGreaterThan(0.99);
});

test('a section of goals shows "This month", "Saved" and "Target" with the first two totalled and nothing under "Target"', async ({ page, me }) => {
  const { section } = await funded(page, me.seed, 'Savings', 50000);
  await addSub(page, section.id, { name: 'Car', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 70000 });
  await addSub(page, section.id, { name: 'Trip', kind: 'goal', budgetMinor: 20000, keep: 'cap', capMinor: 100000 });
  await page.goto('/budget');
  const sec = bsection(page, 'Savings');
  const tots = sec.locator('.ty-shead__tot');
  await expect(tots).toHaveCount(3);
  await expect(tots.nth(0).locator('.ty-label')).toHaveText('This month');
  await expect(tots.nth(1).locator('.ty-label')).toHaveText('Saved');
  await expect(tots.nth(2).locator('.ty-label')).toHaveText('Target');
  await expect(tots.nth(0).locator('.ty-num')).toHaveText('500.00');
  await expect(tots.nth(1).locator('.ty-num')).toHaveText('500.00');
  expect(norm(await tots.nth(2).locator('.ty-num').innerText())).toBe('');
  await expect(sec).not.toContainText('Budgeted');
});

test.describe('phone', () => {
  test.use({ viewport: phone });
  test('a goal row\'s line under the meter reads "300.00 of 700.00 saved"', async ({ page, me }) => {
    const { section } = await funded(page, me.seed, 'Savings', 30000);
    await addSub(page, section.id, { name: 'Car', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 70000 });
    await page.goto('/budget');
    const r = row(page, /Car/);
    await expect(r.locator('.ty-brow__sub')).toHaveText('300.00 of 700.00 saved');
    await expect(pillOf(r)).toHaveText('42% of 700');
    await expect(note(r)).toHaveText('fills to 700.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll').toBe(true);
  });
});

// ============ criterion 5: closing with a cap ============
test('Food at "Up to 30.00": the note, then the close dialog with 42.00 and 28.00, the total −59.60 and the kept line', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await page.goto('/budget');
  const d0 = await openEdit(page, /Food/);
  await chip(d0, 'At month end, keep', 'Up to').check();
  await field(d0, 'Keep up to').fill('30');
  await d0.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d0).toBeHidden();
  await expect(note(row(page, /Food/))).toHaveText('rolls over up to 30.00');

  // September is the month to close; its Food note reads the same
  const d = await openCloseDialog(page);
  const rows = d.locator('.ty-restrow');
  await expect(rows).toHaveCount(5);
  const expected: [string, string][] = [
    ['Rest of Needs, 60% to Savings', '42.00'],
    [`Rest of Needs, 40% to ${octName}'s income`, '28.00'],
    [`Overspent in Wants, taken from ${octName}'s income`, `${MINUS}100.00`],
    ['Rest of Savings to Savings', '400.00'],
    [`Left over to ${octName}'s income`, '12.40'],
  ];
  for (const [i, [words, amount]] of expected.entries()) {
    const r = rows.nth(i);
    expect(norm(await r.locator('.ty-num').innerText()), `row ${i + 1} amount`).toBe(amount);
    expect(norm(await r.innerText()).replace(amount, '').trim(), `row ${i + 1} words`).toBe(words);
  }
  expect(norm(await d.locator('.ty-sum').innerText())).toBe(`Last month's leftovers in ${octName} ${MINUS}59.60`);
  await expect(d.getByText('Subsections keep what they did not spend: 30.00.')).toBeVisible();
  await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
  await expect(d).toBeHidden();
  await page.goto('/budget');
  await expect(stat(page, 'Income')).toContainText(`${MINUS}59.60`);
  await expect(note(row(page, /Food/))).toContainText(`+30.00 from ${sepName}`);
});

// ============ criterion 6: existing subsections ============
test('a subsection made the old way keeps its budget and shows no note, and its dialog opens on Spending, Amount, Everything', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  const food = row(page, /Food/);
  await expect(food).toContainText('300.00');
  await expect(pillOf(food)).toHaveText('87.60');
  await expect(note(food)).toHaveText('');
  await expect(pillOf(row(page, /Utilities/))).toHaveClass(/ty-pill--negative/);
  const d = await openEdit(page, /Food/);
  await expect(chip(d, 'Kind', 'Spending')).toBeChecked();
  await expect(chip(d, 'Budget', 'Amount')).toBeChecked();
  await expect(chip(d, 'At month end, keep', 'Everything')).toBeChecked();
  await expect(field(d, 'Monthly budget')).toHaveValue(/^300(\.00)?$/);
  await expect(d.getByLabel('Position', { exact: true }).locator('option')).toHaveText(['1', '2', '3']);
  await d.getByLabel('Name', { exact: true }).fill('Groceries');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Groceries/)).toContainText('300.00');
  await expect(note(row(page, /Groceries/))).toHaveText('');
});

test('the old body {name, budgetMinor} still makes a spending subsection with an amount budget', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Rent', 80000);
  const rent = findNamed(await getJson(page, `/api/budget?month=${octIso}`), 'Rent')!;
  expect(rent).toMatchObject({ kind: 'spending', budgetKind: 'amount', keep: 'all' });
});

// ============ screenshots (criterion 8) ============
for (const scheme of ['light', 'dark'] as const) {
  for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
    test.describe(`screenshots, ${size} ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport });
      const tag = `${size}-${scheme}`;

      test('the Budget page and the subsection dialog', async ({ page, me }) => {
        const pool = await funded(page, me.seed, 'Needs', 100001);
        await addSub(page, pool.section.id, { name: 'Rent', budgetMinor: 6000 });
        await addSub(page, pool.section.id, { name: 'Food', budgetKind: 'percent', budgetBasisPoints: 6000, keep: 'cap', capMinor: 10000 });
        await addSub(page, pool.section.id, { name: 'Fun', budgetKind: 'percent', budgetBasisPoints: 4000, keep: 'none' });
        const sav = await me.seed.section('Savings');
        await me.seed.amountStep(pool.src.boxId, sav.id, 100);
        await addSub(page, sav.id, { name: 'Car', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 1500000 });
        await addSub(page, sav.id, { name: 'Emergencies', kind: 'goal', budgetMinor: 20000, keep: 'cap', capMinor: 300000 });
        await page.goto('/budget');
        await expect(row(page, /Emergencies/)).toBeVisible();
        await page.waitForTimeout(300); await page.screenshot({ path: `screenshots/spec11-budget-${tag}.png`, fullPage: true });

        let d = await openAdd(page, 'Savings');
        await d.getByLabel('Name', { exact: true }).fill('Holiday');
        await chip(d, 'Kind', 'Savings goal').check();
        await field(d, 'Target').fill('2000');
        await expect(d.getByText('It keeps its money until it reaches the target.')).toBeVisible();
        await shot(page, `spec11-dialog-goal-${tag}`);
        await page.keyboard.press('Escape');
        await expect(d).toBeHidden();

        d = await openAdd(page, 'Needs');
        await d.getByLabel('Name', { exact: true }).fill('Gym');
        await chip(d, 'At month end, keep', 'Up to').check();
        await field(d, 'Keep up to').fill('50');
        await shot(page, `spec11-dialog-spending-up-to-${tag}`);
      });
    });
  }
}
