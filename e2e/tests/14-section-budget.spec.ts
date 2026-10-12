import { test, expect, dialog, toast, shot, row, chip, group, seedBudget, type Seed } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 04: a section has its own budget. Spec 05: the choices are Percentage / Fixed amount / Subsections, in a Segmented control, and a new section starts on Percentage.
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };

const PCT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';
const AMOUNT_ERROR = 'Enter an amount of zero or more, with at most two decimals.';
const HINT = "Of the month's income left after fixed-amount sections.";

/** A section on the Budget page, found by the name in its header. */
const sec = (page: Page, name: string): Locator =>
  page.locator('.ty-section').filter({ has: page.locator('.ty-shead__name b', { hasText: new RegExp(`^${name}$`) }) });
const total = (s: Locator, label: 'Budgeted' | 'Spent' | 'Available') => s.locator('.ty-shead__tot', { hasText: label }).locator('.ty-num');
const pill = (s: Locator) => s.locator('.ty-shead .ty-pill');
const rule = (s: Locator) => s.locator('.ty-shead__name .ty-cap:not(.ty-shead__sub)');
const monthBudgeted = (page: Page) => page.locator('.ty-stat', { hasText: 'Budgeted' }).locator('.num-lg');
const nameField = (d: Locator) => d.getByLabel('Name', { exact: true });
/** The "Percentage" text field (the "Percentage" radio has the same label). */
const pctField = (d: Locator) => d.getByLabel('Percentage', { exact: true }).and(d.locator('input:not([type=radio])'));
const submit = (d: Locator, name = 'Add section') => d.getByRole('button', { name, exact: true });
const sectionsApi = async (page: Page) => (await (await page.request.get('/api/sections')).json()).sections as { name: string }[];

async function openAdd(page: Page) {
  await page.getByRole('button', { name: 'Add section' }).first().click();
  await expect(dialog(page).getByRole('heading', { name: 'Add section' })).toBeVisible();
  return dialog(page);
}
/** Fills an open section dialog. */
async function fillSection(d: Locator, o: { name: string; kind?: 'Fixed amount' | 'Percentage' | 'Subsections'; value?: string }) {
  await nameField(d).fill(o.name);
  if (o.kind) {
    await chip(d, 'Budget', o.kind).check();
    if (o.kind === 'Subsections') return;
    await (o.kind === 'Fixed amount' ? d.getByLabel('Monthly budget', { exact: true }) : pctField(d)).fill(o.value ?? '');
  }
}
const editButton = (s: Locator) => s.getByRole('button', { name: 'Edit', exact: true });

/** Income of `amountMinor` this month, in one pocket. */
async function income(seed: Seed, amountMinor: number) {
  const p = await seed.pocket('Revolut', 0);
  await seed.income(p.id, amountMinor, 'Paycheck');
  return p;
}

/** The worked example of the spec: income 2,400.00; Home fixed 900, Needs 50%, Zakat 2.5%, Fun on subsections. */
async function seedWorkedExample(seed: Seed) {
  const p = await seed.pocket('Revolut', 0);
  await seed.income(p.id, 240000, 'Paycheck');
  const home = await seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  const rent = await seed.subsection(home.id, 'Rent', 80000);
  await seed.subsection(home.id, 'Internet', 13000);
  const needs = await seed.section('Needs', { budgetKind: 'percent', budgetBasisPoints: 5000 });
  await seed.subsection(needs.id, 'Food', 30000);
  await seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 250 });
  const fun = await seed.section('Fun');
  await seed.subsection(fun.id, 'Eating out', 15000);
  await seed.expense(p.id, rent.id, 80000, 'Landlord');
}

// ---- spec 04 criterion 8, as spec 05 changes it ----
test('Add section opens with Name and the Budget control on "Percentage" with its field; each choice shows its field', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await page.goto('/budget');
  const d = await openAdd(page);
  await expect(nameField(d)).toBeVisible();
  await expect(group(d, 'Budget').getByRole('radio')).toHaveCount(3);
  await expect(group(d, 'Budget').locator('.ty-segmented label')).toHaveText(['Percentage', 'Fixed amount', 'Subsections']);
  await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
  await expect(pctField(d)).toBeVisible();
  await expect(pctField(d)).toHaveValue('');
  await expect(d.getByText(HINT)).toBeVisible();
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
  // order: Name, then the control
  const nameBox = (await nameField(d).boundingBox())!;
  const ctlBox = (await group(d, 'Budget').boundingBox())!;
  expect(nameBox.y).toBeLessThan(ctlBox.y);

  await chip(d, 'Budget', 'Fixed amount').check();
  const monthly = d.getByLabel('Monthly budget', { exact: true });
  await expect(monthly).toBeVisible();
  await expect(pctField(d)).toHaveCount(0);
  await page.waitForTimeout(300); // the dialog fade
  const ctlBox2 = (await group(d, 'Budget').boundingBox())!;
  const mBox = (await monthly.boundingBox())!;
  expect(mBox.y, 'the field is under the control').toBeGreaterThan(ctlBox2.y + ctlBox2.height - 1);
  await expect(d.locator('.ty-affix')).toContainText('EUR');

  await chip(d, 'Budget', 'Subsections').check();
  await expect(pctField(d)).toHaveCount(0);
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);

  await chip(d, 'Budget', 'Percentage').check();
  const pct = pctField(d);
  await expect(pct).toBeVisible();
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
  await expect(d.getByText(HINT)).toBeVisible();
  await expect(pct).toHaveAccessibleDescription(HINT);
  await expect(d.locator('.ty-affix')).toContainText('%');
});

test('a section added on "Subsections" shows no Rest pill and no rule', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAdd(page);
  await fillSection(d, { name: 'Fun', kind: 'Subsections' });
  await submit(d).click();
  await expect(d).toBeHidden();
  await expect(sec(page, 'Fun')).toBeVisible();
  await expect(pill(sec(page, 'Fun'))).toHaveCount(0);
  await expect(rule(sec(page, 'Fun'))).toHaveCount(0);
  const s = (await (await page.request.get('/api/sections')).json()).sections[0];
  expect(s).toMatchObject({ budgetKind: 'subsections', budgetMinor: null, budgetBasisPoints: null });
});

// ---- criterion 9 ----
test('a fixed section of 900.00 without subsections shows Budgeted 900.00, Available 900.00, "Rest 900.00", "Fixed amount", and the month figure rises without a reload', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedBudget(me.seed); // month Budgeted 1,060.00
  await page.goto('/budget');
  await expect(monthBudgeted(page)).toHaveText('1,060.00');
  await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
  const d = await openAdd(page);
  await fillSection(d, { name: 'Home', kind: 'Fixed amount', value: '900' });
  await submit(d).click();
  await expect(d).toBeHidden();
  const home = sec(page, 'Home');
  await expect(home).toBeVisible();
  await expect(total(home, 'Budgeted')).toHaveText('900.00');
  await expect(total(home, 'Available')).toHaveText('900.00');
  await expect(pill(home)).toHaveText('Rest 900.00');
  await expect(pill(home)).not.toHaveClass(/ty-pill--(warning|negative|positive)/);
  await expect(rule(home)).toHaveText('Fixed amount');
  await expect(monthBudgeted(page)).toHaveText('1,960.00');
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true), 'no reload').toBe(true);
});

test('a fixed amount of zero is allowed', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAdd(page);
  await fillSection(d, { name: 'Nothing', kind: 'Fixed amount', value: '0' });
  await submit(d).click();
  await expect(d).toBeHidden();
  await expect(total(sec(page, 'Nothing'), 'Budgeted')).toHaveText('0.00');
  await expect(pill(sec(page, 'Nothing'))).toHaveText('Rest 0.00');
});

test('"Monthly budget" refuses a negative amount, three decimals and text, with the message under the field, and saves nothing', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAdd(page);
  await nameField(d).fill('Home');
  await chip(d, 'Budget', 'Fixed amount').check();
  const f = d.getByLabel('Monthly budget', { exact: true });
  for (const v of ['-5', '1.234', 'abc']) {
    await f.fill(v);
    await submit(d).click();
    await expect(d.getByText(AMOUNT_ERROR), v).toBeVisible();
    await expect(f, v).toHaveClass(/ty-input--error/);
    await expect(d).toBeVisible();
    expect(await sectionsApi(page), v).toHaveLength(0);
  }
});

// ---- criterion 10 ----
test('with income 2,400.00 and a fixed 900.00 section, a 50% section shows Budgeted 750.00 and its rule; adding income 100.00 makes it 800.00 without a reload', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await income(me.seed, 240000);
  await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await page.goto('/budget');
  await expect(sec(page, 'Home')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
  const d = await openAdd(page);
  await fillSection(d, { name: 'Needs', kind: 'Percentage', value: '50' });
  await submit(d).click();
  await expect(d).toBeHidden();
  const needs = sec(page, 'Needs');
  await expect(total(needs, 'Budgeted')).toHaveText('750.00');
  await expect(rule(needs)).toHaveText('50% of income after fixed sections');
  await expect(pill(needs)).toHaveText('Rest 750.00');
  await expect(monthBudgeted(page)).toHaveText('1,650.00');

  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const t = dialog(page);
  await expect(t.getByRole('heading', { name: 'Add income' })).toBeVisible();
  await t.getByLabel('Amount').fill('100');
  await t.getByLabel('Payee').fill('Bonus');
  await chip(t, 'Pocket', /Revolut/).check();
  await t.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(t).toBeHidden();
  await expect(total(needs, 'Budgeted')).toHaveText('800.00');
  await expect(monthBudgeted(page)).toHaveText('1,700.00');
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true), 'no reload').toBe(true);
});

test('a percentage section with no income has a budget of 0.00, and a 2.5% section reads "2.5% of income after fixed sections"', async ({ page, me }) => {
  await me.seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 250 });
  await page.goto('/budget');
  const z = sec(page, 'Zakat');
  await expect(total(z, 'Budgeted')).toHaveText('0.00');
  await expect(rule(z)).toHaveText('2.5% of income after fixed sections');
  await expect(pill(z)).toHaveText('Rest 0.00');
});

// ---- criterion 11 ----
test('subsections claiming 30.00 more than a fixed section has give the warning pill "Rest −30.00"; a "Subsections" section shows no pill and no rule', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  const home = await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await me.seed.subsection(home.id, 'Rent', 80000);
  await me.seed.subsection(home.id, 'Internet', 13000);
  const fun = await me.seed.section('Fun');
  await me.seed.subsection(fun.id, 'Eating out', 15000);
  await page.goto('/budget');
  const h = sec(page, 'Home');
  await expect(pill(h)).toHaveText('Rest −30.00');
  await expect(pill(h)).toHaveClass(/ty-pill--warning/);
  await expect(rule(h)).toHaveText('Fixed amount');
  await expect(total(h, 'Budgeted')).toHaveText('900.00');
  const f = sec(page, 'Fun');
  await expect(total(f, 'Budgeted')).toHaveText('150.00');
  await expect(pill(f)).toHaveCount(0);
  await expect(rule(f)).toHaveCount(0);
});

test('the Rest pill is neutral while the rest is zero or more', async ({ page, me }) => {
  const home = await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await me.seed.subsection(home.id, 'Rent', 80000);
  await page.goto('/budget');
  await expect(pill(sec(page, 'Home'))).toHaveText('Rest 100.00');
  await expect(pill(sec(page, 'Home'))).not.toHaveClass(/ty-pill--(warning|negative|positive)/);
});

// ---- the worked example, all four sections ----
test('the worked example: Home, Needs, Zakat and Fun show the spec\'s figures and the month Budgeted is 1,837.50', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await seedWorkedExample(me.seed);
  await page.goto('/budget');
  const home = sec(page, 'Home');
  await expect(total(home, 'Budgeted')).toHaveText('900.00');
  await expect(total(home, 'Spent')).toHaveText('800.00');
  await expect(total(home, 'Available')).toHaveText('100.00');
  await expect(pill(home)).toHaveText('Rest −30.00');
  const needs = sec(page, 'Needs');
  await expect(total(needs, 'Budgeted')).toHaveText('750.00');
  await expect(pill(needs)).toHaveText('Rest 450.00');
  await expect(rule(needs)).toHaveText('50% of income after fixed sections');
  const zakat = sec(page, 'Zakat');
  await expect(total(zakat, 'Budgeted')).toHaveText('37.50');
  await expect(pill(zakat)).toHaveText('Rest 37.50');
  await expect(rule(zakat)).toHaveText('2.5% of income after fixed sections');
  await expect(total(sec(page, 'Fun'), 'Budgeted')).toHaveText('150.00');
  await expect(monthBudgeted(page)).toHaveText('1,837.50');
  // sections keep the order they were created in
  expect(await page.locator('.ty-shead__name b').allTextContents()).toEqual(['Home', 'Needs', 'Zakat', 'Fun']);
});

// ---- criterion 12 ----
test('Edit opens on the section\'s kind with its value filled in (900.00, 2.5); changing to "Subsections" removes the pill and the rule', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await me.seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 250 });
  await me.seed.section('Needs', { budgetKind: 'percent', budgetBasisPoints: 5000 });
  await page.goto('/budget');

  await editButton(sec(page, 'Home')).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit section' })).toBeVisible();
  await expect(nameField(d)).toHaveValue('Home');
  await expect(chip(d, 'Budget', 'Fixed amount')).toBeChecked();
  await expect(d.getByLabel('Monthly budget', { exact: true })).toHaveValue('900.00');
  await expect(submit(d, 'Save')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Delete' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await editButton(sec(page, 'Zakat')).click();
  await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
  await expect(pctField(d)).toHaveValue('2.5');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await editButton(sec(page, 'Needs')).click();
  await expect(pctField(d)).toHaveValue('50');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await editButton(sec(page, 'Home')).click();
  await chip(d, 'Budget', 'Subsections').check();
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
  await submit(d, 'Save').click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  const home = sec(page, 'Home');
  await expect(pill(home)).toHaveCount(0);
  await expect(rule(home)).toHaveCount(0);
  await expect(total(home, 'Budgeted')).toHaveText('0.00');
  const s = (await (await page.request.get('/api/sections')).json()).sections.find((x: { name: string }) => x.name === 'Home');
  expect(s).toMatchObject({ budgetKind: 'subsections', budgetMinor: null, budgetBasisPoints: null });
});

test('editing the value of a percentage section changes its figures; a fixed section changed to a percentage keeps working', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await income(me.seed, 100000);
  await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 20000 });
  await page.goto('/budget');
  await editButton(sec(page, 'Home')).click();
  const d = dialog(page);
  await chip(d, 'Budget', 'Percentage').check();
  await pctField(d).fill('12.25');
  await submit(d, 'Save').click();
  await expect(d).toBeHidden();
  await expect(total(sec(page, 'Home'), 'Budgeted')).toHaveText('122.50');
  await expect(rule(sec(page, 'Home'))).toHaveText('12.25% of income after fixed sections');
  const s = (await (await page.request.get('/api/sections')).json()).sections[0];
  expect(s).toMatchObject({ budgetKind: 'percent', budgetMinor: null, budgetBasisPoints: 1225 });
});

// ---- criterion 13 ----
test('"Percentage" refuses 0, 101, 2.555 and abc with the message under the field instead of the hint, and saves nothing', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAdd(page);
  await nameField(d).fill('Zakat');
  await chip(d, 'Budget', 'Percentage').check();
  const f = pctField(d);
  for (const v of ['0', '101', '2.555', 'abc']) {
    await f.fill(v);
    await submit(d).click();
    await expect(d.getByText(PCT_ERROR), v).toBeVisible();
    await expect(d.getByText(HINT), `${v}: the error replaces the hint`).toHaveCount(0);
    await expect(f, v).toHaveClass(/ty-input--error/);
    await expect(d, v).toBeVisible();
    expect(await sectionsApi(page), v).toHaveLength(0);
  }
  await shot(page, 'spec04-dialog-percentage-error-desktop-light');
});

for (const [v, bp] of [['2.5', 250], ['2.50', 250], ['12.25', 1225], ['100', 10000]] as const) {
  test(`"Percentage" accepts ${v} and stores ${bp} basis points`, async ({ page, me }) => {
    await page.goto('/budget');
    const d = await openAdd(page);
    await fillSection(d, { name: 'Zakat', kind: 'Percentage', value: v });
    await submit(d).click();
    await expect(d).toBeHidden();
    const made = (await (await page.request.get('/api/sections')).json()).sections;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ name: 'Zakat', budgetKind: 'percent', budgetBasisPoints: bp, budgetMinor: null });
  });
}

test('a percentage that takes the sections past 100% shows the server\'s message under the field', async ({ page, me }) => {
  await me.seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 6000 });
  await page.goto('/budget');
  const d = await openAdd(page);
  await fillSection(d, { name: 'Savings', kind: 'Percentage', value: '50' });
  await submit(d).click();
  await expect(d.getByText('Your sections would take more than 100% of income. Other sections already take 60%.')).toBeVisible();
  await expect(pctField(d)).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
  expect(await sectionsApi(page)).toHaveLength(1);
  // 40% fits exactly
  await pctField(d).fill('40');
  await submit(d).click();
  await expect(d).toBeHidden();
  await expect(sec(page, 'Savings')).toBeVisible();

  // editing a section's own percentage does not count it twice: 60 -> 60 is fine, 61 is not
  await editButton(sec(page, 'Zakat')).click();
  await pctField(d).fill('61');
  await submit(d, 'Save').click();
  await expect(d.getByText('Other sections already take 40%.')).toBeVisible();
  await pctField(d).fill('60');
  await submit(d, 'Save').click();
  await expect(d).toBeHidden();
});

// ---- criterion 14 ----
test('deleting a section with a budget and choosing Undo brings it back with the same budget, rule and subsections', async ({ page, me }) => {
  await page.setViewportSize(desktop);
  await income(me.seed, 240000);
  const home = await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await me.seed.subsection(home.id, 'Rent', 80000);
  await me.seed.subsection(home.id, 'Internet', 13000);
  const z = await me.seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 250 });
  await me.seed.subsection(z.id, 'Charity', 1000);
  await page.goto('/budget');
  for (const [name, budgeted, pillText, ruleText, subs] of [
    ['Home', '900.00', 'Rest −30.00', 'Fixed amount', ['Rent', 'Internet']],
    ['Zakat', '37.50', 'Rest 27.50', '2.5% of income after fixed sections', ['Charity']],
  ] as const) {
    await editButton(sec(page, name)).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(sec(page, name)).toHaveCount(0);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    const s = sec(page, name);
    await expect(s).toBeVisible();
    await expect(total(s, 'Budgeted')).toHaveText(budgeted);
    await expect(pill(s)).toHaveText(pillText);
    await expect(rule(s)).toHaveText(ruleText);
    for (const sub of subs) await expect(s.getByRole("button", { name: new RegExp(sub) })).toBeVisible();
  }
});

// ---- criterion 15 ----
test.describe('phone', () => {
  test.use({ viewport: phone });

  test('each section header shows "{spent} of {budgeted} spent" under its name, including a fixed section', async ({ page, me }) => {
    await seedWorkedExample(me.seed);
    await page.goto('/budget');
    const expected: Record<string, string> = {
      Home: '800.00 of 900.00 spent', Needs: '0.00 of 750.00 spent', Zakat: '0.00 of 37.50 spent', Fun: '0.00 of 150.00 spent',
    };
    for (const [name, text] of Object.entries(expected)) {
      const s = sec(page, name);
      const sub = s.locator('.ty-shead__sub');
      await expect(sub, name).toHaveText(text);
      await expect(sub, name).toBeVisible();
      const n = (await s.locator('.ty-shead__name b').boundingBox())!;
      const b = (await sub.boundingBox())!;
      expect(b.y, `${name}: under the name`).toBeGreaterThanOrEqual(n.y + n.height - 1);
    }
    await expect(total(sec(page, 'Home'), 'Spent').first()).toBeHidden(); // the totals the line replaces
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('the section dialog Budget segments are at least 44px tall and its primary button is in view without scrolling, on each choice', async ({ page, me }) => {
    await page.goto('/budget');
    const d = await openAdd(page);
    await page.waitForTimeout(300);
    for (const kind of [null, 'Fixed amount', 'Subsections', 'Percentage'] as const) {
      if (kind) await chip(d, 'Budget', kind).check();
      for (const label of await group(d, 'Budget').locator('.ty-segmented').all()) {
        const box = (await label.boundingBox())!;
        expect(box.height, `${kind}: control height`).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, 'control inside the window').toBeLessThanOrEqual(phone.width + 0.5);
      }
      for (const b of [submit(d), d.getByRole('button', { name: 'Cancel' })]) {
        const box = (await b.boundingBox())!;
        expect(box.y, `${kind}: top`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${kind}: bottom`).toBeLessThanOrEqual(phone.height + 0.5);
      }
      expect(await d.evaluate((e) => e.scrollHeight <= e.clientHeight + 1), `${kind}: the dialog does not scroll`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

// ---- criterion 16 ----
for (const scheme of ['light', 'dark'] as const) {
  test(`keyboard: the Budget segments are one radio group moved with the arrow keys, Tab leaves it, the chosen one has the focus ring (${scheme})`, async ({ page, me }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(desktop);
    await page.goto('/budget');
    const d = await openAdd(page);
    const focus = () => page.evaluate(() => {
      const e = document.activeElement as HTMLInputElement;
      const ringed = (e.matches('input[type=radio]') && e.closest('label')) || e;
      const cs = getComputedStyle(ringed);
      return { radio: e.matches('input[type=radio]'), name: (e.labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? e.textContent ?? '').trim(), style: cs.outlineStyle, width: cs.outlineWidth, inDialog: !!e.closest('dialog,[role=dialog]') };
    });
    expect(await group(d, 'Budget').getByRole('radio').evaluateAll((rs) => new Set(rs.map((r) => (r as HTMLInputElement).name)).size), 'one radio group').toBe(1);

    await nameField(d).focus();
    await page.keyboard.press('Tab');
    let f = await focus();
    expect(f).toMatchObject({ radio: true, name: 'Percentage', style: 'solid', width: '2px', inDialog: true });
    await shot(page, `spec04-focus-segment-desktop-${scheme}`);

    await page.keyboard.press('ArrowRight');
    await expect(chip(d, 'Budget', 'Fixed amount')).toBeChecked();
    f = await focus();
    expect(f).toMatchObject({ radio: true, name: 'Fixed amount', style: 'solid', width: '2px' });
    await expect(d.getByLabel('Monthly budget', { exact: true })).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(d.getByLabel('Monthly budget', { exact: true })).toBeFocused();
    await expect(d.getByLabel('Monthly budget', { exact: true })).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Shift+Tab');
    expect(await focus()).toMatchObject({ radio: true, name: 'Fixed amount' }); // back on the chosen segment: one tab stop

    await page.keyboard.press('ArrowRight');
    await expect(chip(d, 'Budget', 'Subsections')).toBeChecked();
    expect(await focus()).toMatchObject({ radio: true, name: 'Subsections', style: 'solid', width: '2px' });
    await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
    await page.keyboard.press('Tab');
    expect((await focus()).radio, 'Tab leaves the control').toBe(false);

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
    await expect(pctField(d)).toBeVisible();
  });
}

// ---- keyboard: a section can be added from the keyboard ----
test('a fixed section is added from the keyboard: Enter in the amount field saves it', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAdd(page);
  await nameField(d).fill('Home');
  await chip(d, 'Budget', 'Fixed amount').check();
  await d.getByLabel('Monthly budget', { exact: true }).fill('900');
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();
  await expect(total(sec(page, 'Home'), 'Budgeted')).toHaveText('900.00');
});

// ---- screenshots: Budget page and the two dialog states, desktop and phone, light and dark ----
for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`screenshots ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });

      test('Budget page with the four sections of the worked example', async ({ page, me }) => {
        await seedWorkedExample(me.seed);
        await page.goto('/budget');
        await expect(sec(page, 'Fun')).toBeVisible();
        await expect(row(page, /Eating out/)).toBeVisible();
        await shot(page, `spec04-budget-${size}-${scheme}`);
        // the page can be longer than the window, so also keep the full page
        await page.screenshot({ path: `screenshots/spec04-budget-full-${size}-${scheme}.png`, fullPage: true });
      });

      test('Section dialog on each of the three choices', async ({ page, me }) => {
        await page.goto('/budget');
        const d = await openAdd(page);
        await nameField(d).fill('Home');
        await pctField(d).fill('50');
        await shot(page, `spec05-section-percentage-${size}-${scheme}`);
        await chip(d, 'Budget', 'Fixed amount').check();
        await d.getByLabel('Monthly budget', { exact: true }).fill('900.00');
        await shot(page, `spec05-section-fixed-${size}-${scheme}`);
        await chip(d, 'Budget', 'Subsections').check();
        await shot(page, `spec05-section-subsections-${size}-${scheme}`);
      });
    });
  }
}
