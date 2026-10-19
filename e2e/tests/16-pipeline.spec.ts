import { test, expect, dialog, toast, shot, row, chip, group, seedPipeline, seedBudget, WORKED, monthTitle, type Seed, bsection, restRow, cell, stat, summary, subNames, pillOf } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 06: the pipeline. Browser acceptance criteria 9 to 22 (and the screenshots of 24).
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };
test.use({ viewport: desktop });

const PCT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';
const AMOUNT_ERROR = 'Enter an amount above zero, with at most two decimals.';
const NEED_SECTION_ROWS = 'Choose a section in every row.';
const NEED_SECTION = 'Choose a section.';
const OVER_100 = 'The percentages of one step can add up to at most 100.';
const SAME_SECTION = 'Choose a different section in every row.';
const STEP_HINT = 'Each destination takes its percentage from what reaches this step. Together they can be at most 100%.';
const AMOUNT_HINT = 'For the whole month, however many payments come in.';
const SECTION_IN_USE = 'This section is used in the pipeline. Remove it from the steps and rest rules first.';
const NO_SOURCE = 'No income sources yet. A source is where money comes from, such as a paycheck.';
const NO_STEPS = 'No steps yet. All of it is left over.';
const WIDER = 'The pipeline needs a wider screen for now.';
const BOX_WARNING = "Its box will have no source left, so that box's steps will be removed.";

// ---- finders ----
const incomeCol = (page: Page) => page.locator('.ty-pipe__col').nth(0);
const sectionCol = (page: Page) => page.locator('.ty-pipe__col').nth(1);
/** An income box, found by a source name it holds. */
const box = (page: Page, source: string) => incomeCol(page).locator('.ty-node').filter({ hasText: source });
/** A section's node (or "Left over") in the second column. */
const sec = (page: Page, name: string) => sectionCol(page).locator('.ty-node').filter({ has: page.getByText(name, { exact: true }) });
const step = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const stepRows = (s: Locator) => s.locator('.ty-step');
const lefts = (scope: Locator) => scope.locator('.ty-pipe__left');
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const text = async (l: Locator) => norm(await l.innerText());
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
const kept = (page: Page) => page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true);
const pipelineApi = async (page: Page, month = new Date().toISOString().slice(0, 7)) =>
  (await (await page.request.get(`/api/pipeline?month=${month}`)).json()) as {
    boxes: { id: number; incomeMinor: number; leftOverMinor: number; sources: { id: number; name: string }[]; steps: { id: number; position: number; kind: string }[] }[];
    sections: { id: number; name: string; receivedMinor: number }[]; leftOverMinor: number;
  };

// ---- dialog helpers ----
const sectionSel = (d: Locator, n: number) => d.getByLabel(`Section ${n}`, { exact: true });
const pctInput = (d: Locator, n: number) => d.getByLabel(`Percentage ${n}`, { exact: true });
const takes = (d: Locator, which: 'Percentage' | 'Amount') => chip(d, 'Takes', which);
/** The "Amount" text field (the "Amount" radio of "Takes" has the same label). */
const amountField = (d: Locator): Locator => d.getByLabel('Amount', { exact: true }).and(d.locator('input:not([type=radio])'));

async function openAddStep(page: Page, source: string) {
  await box(page, source).getByRole('button', { name: 'Add step', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add step' })).toBeVisible();
  return d;
}
/** Fills the rows of an open step dialog on "Percentage", adding rows as needed. */
async function fillShares(d: Locator, shares: [string, string][]) {
  for (const [i, [section, pct]] of shares.entries()) {
    if (i > 0) await d.getByRole('button', { name: '+ Add destination', exact: true }).click();
    await sectionSel(d, i + 1).selectOption({ label: section });
    await pctInput(d, i + 1).fill(pct);
  }
}
async function addPercentStep(page: Page, source: string, shares: [string, string][]) {
  const d = await openAddStep(page, source);
  await fillShares(d, shares);
  await d.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(d).toBeHidden();
}
async function addAmountStep(page: Page, source: string, section: string, amount: string) {
  const d = await openAddStep(page, source);
  await takes(d, 'Amount').check();
  await d.getByLabel('Section', { exact: true }).selectOption({ label: section });
  await amountField(d).fill(amount);
  await d.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(d).toBeHidden();
}
async function openEditSource(page: Page, name: string) {
  const src = incomeCol(page).locator('.ty-node__head, .ty-node__src').filter({ hasText: name });
  await src.getByRole('button', { name: 'Edit', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit income source' })).toBeVisible();
  return d;
}
const gotoPipeline = async (page: Page) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
};

/** One income of `amountMinor` from a new source in a new pocket. Returns the ids. */
async function oneSource(seed: Seed, name = 'Paycheck', amountMinor = 100000) {
  const source = await seed.source(name);
  const pocket = await seed.pocket('Revolut', 0);
  if (amountMinor) await seed.income(pocket.id, amountMinor, source.id);
  return { source, pocket };
}

// ============ criterion 9: navigation ============
test('"Pipeline" is in the sidebar right after "Budget" and opens the page, with the month and the title row buttons', async ({ page, me }) => {
  await page.goto('/budget');
  const side = page.locator('.ty-side');
  const links = await side.getByRole('link').allInnerTexts();
  expect(links.indexOf('Pipeline')).toBe(links.indexOf('Budget') + 1);
  await side.getByRole('link', { name: 'Pipeline' }).click();
  await expect(page).toHaveURL(/\/pipeline/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
  await expect(side.getByRole('link', { name: 'Budget' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.ty-monthnav')).toContainText(monthTitle());
  await expect(page.getByRole('button', { name: 'Next month', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add section', exact: true })).toBeVisible();
  const add = page.getByRole('button', { name: 'Add income source', exact: true }).first();
  await expect(page.getByRole('button', { name: 'Add source', exact: true })).toHaveCount(0); // spec 08
  await expect(add).toBeVisible();
  await expect(add).toHaveClass(/ty-btn--primary/);
  // title row order: heading, previous, month, next, then the two buttons at the end
  const x = async (l: Locator) => (await l.boundingBox())!.x;
  const h = await x(page.getByRole('heading', { level: 1, name: 'Pipeline' }));
  const prev = await x(page.getByRole('button', { name: 'Previous month' }));
  const nextB = await x(page.getByRole('button', { name: 'Next month', exact: true }));
  const addSec = await x(page.getByRole('button', { name: 'Add section', exact: true }));
  expect(h).toBeLessThan(prev);
  expect(prev).toBeLessThan(nextB);
  expect(nextB).toBeLessThan(addSec);
  expect(addSec).toBeLessThan(await x(add));
});

test('the page takes ?month= and the standing steps apply to the month in view', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await expect(lefts(page.locator('.ty-pipe')).first()).toHaveText('2,535.00 left');
  await page.getByRole('button', { name: 'Previous month' }).click();
  const prev = new Date();
  prev.setUTCDate(1);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  await expect(page.locator('.ty-monthnav')).toContainText(monthTitle(prev));
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(page.getByRole('button', { name: 'Next month', exact: true })).toBeEnabled();
  // no income last month: the steps are still there and take nothing
  await expect(step(page, 'Step 1: 2.5% to Zakat')).toBeVisible();
  await expect(lefts(page.locator('.ty-pipe'))).toHaveText(['0.00 left', '0.00 left', '0.00 left', '0.00 left']);
  await expect(sec(page, 'Zakat')).toContainText('0.00');
  await expect(sec(page, 'Left over')).toContainText('0.00');
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(lefts(page.locator('.ty-pipe')).first()).toHaveText('2,535.00 left');
  await page.goto(`/pipeline?month=${prev.toISOString().slice(0, 7)}`);
  await expect(page.locator('.ty-monthnav')).toContainText(monthTitle(prev));
});

test.describe('phone', () => {
  test.use({ viewport: phone });

  test('"Pipeline" is not in the tab bar, and at 390px the page shows only the top bar and "The pipeline needs a wider screen for now."', async ({ page, me }) => {
    await seedPipeline(me.seed);
    await page.goto('/budget');
    await expect(page.locator('.ty-tabbar').getByRole('link')).toHaveText(['Home', 'Budget', 'Transactions', 'Pockets', 'Settings']);
    await page.goto('/pipeline');
    await expect(page.getByText(WIDER)).toBeVisible();
    await expect(page.locator('.ty-top')).toContainText('Pipeline');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('.ty-pipe')).toBeHidden(); // rendered or not, never shown at this width
    await expect(page.getByRole('button', { name: 'Add income source' })).toBeHidden();
    await expect(page.locator('.ty-tabbar').getByRole('link')).toHaveText(['Home', 'Budget', 'Transactions', 'Pockets', 'Settings']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, 'spec06-pipeline-phone-light');
  });

  test('640px wide is still the phone card, 641px shows the diagram', async ({ page, me }) => {
    await seedPipeline(me.seed);
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto('/pipeline');
    await expect(page.getByText(WIDER)).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByText(WIDER)).toBeHidden();
    await expect(page.locator('.ty-pipe')).toBeVisible();
  });
});

// ============ criterion 10: a new account ============
test('on a new account the page shows the "No income sources yet" card; "Add income source" creates a source and the diagram appears', async ({ page, me }) => {
  await gotoPipeline(page);
  await expect(page.getByText(NO_SOURCE)).toBeVisible();
  await expect(page.locator('.ty-pipe')).toHaveCount(0);
  await shot(page, 'spec06-pipeline-empty-desktop-light');
  await mark(page);
  await page.getByRole('button', { name: 'Add income source', exact: true }).last().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add income source' })).toBeVisible();
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(d.getByLabel('Box', { exact: true }).locator('option')).toHaveText(['A box of its own']);
  await expect(d.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await d.getByLabel('Name', { exact: true }).fill('Paycheck');
  await d.getByRole('button', { name: 'Add income source', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(NO_SOURCE)).toHaveCount(0);
  await expect(page.locator('.ty-pipe')).toBeVisible();
  await expect(page.locator('.ty-pipe__col > .ty-label')).toHaveText(['Income', 'Sections', new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })]);
  await expect(box(page, 'Paycheck')).toBeVisible();
  await expect(box(page, 'Paycheck')).toContainText('0.00');
  await expect(box(page, 'Paycheck')).toContainText(NO_STEPS);
  await expect(box(page, 'Paycheck').getByRole('button', { name: 'Add step', exact: true })).toBeVisible();
  await expect(sec(page, 'Left over')).toBeVisible();
  await expect(sec(page, 'Left over').getByRole('button', { name: 'Edit' })).toHaveCount(0);
  expect(await kept(page), 'no reload').toBe(true);
  expect((await me.seed.sourcesApi()).map((s) => s.name)).toEqual(['Paycheck']);
});

test('a source needs a name, and a name already used (in another letter case) is refused under the field', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await gotoPipeline(page);
  await page.getByRole('button', { name: 'Add income source', exact: true }).first().click();
  const d = dialog(page);
  await d.getByRole('button', { name: 'Add income source', exact: true }).click();
  await expect(d.getByText('Enter a name.')).toBeVisible();
  await expect(d.getByLabel('Name', { exact: true })).toHaveClass(/ty-input--error/);
  await d.getByLabel('Name', { exact: true }).fill('PAYCHECK');
  await d.getByRole('button', { name: 'Add income source', exact: true }).click();
  await expect(d.getByText('You already have a source with this name.')).toBeVisible();
  await expect(d).toBeVisible();
  expect(await me.seed.sourcesApi()).toHaveLength(1);
});

// ============ criterion 11: income from the Budget page reaches the Pipeline page ============
test('an income added from the Budget page to a source shows on the Pipeline page in the box\'s head and in "Left over"', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await me.seed.pocket('Revolut', 0);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await expect(chip(d, 'Source', 'Paycheck')).toBeChecked();
  await d.getByLabel('Amount').fill('100');
  await chip(d, 'Pocket', /Revolut/).check();
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  await page.locator('.ty-side').getByRole('link', { name: 'Pipeline' }).click();
  await expect(box(page, 'Paycheck').locator('.ty-node__head')).toContainText('100.00');
  await expect(box(page, 'Paycheck')).toContainText(NO_STEPS);
  await expect(lefts(box(page, 'Paycheck'))).toHaveText('100.00 left');
  await expect(sec(page, 'Left over')).toContainText('100.00');
});

// ============ criterion 12: a first step ============
test('"Add step" with "Percentage" and one row of 2.5% shows the step, its "left" line, and the section\'s money, without a reload', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 100000);
  await me.seed.section('Zakat');
  await gotoPipeline(page);
  await mark(page);
  const d = await openAddStep(page, 'Paycheck');
  await expect(takes(d, 'Percentage')).toBeChecked();
  await sectionSel(d, 1).selectOption({ label: 'Zakat' });
  await pctInput(d, 1).fill('2.5');
  await d.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(d).toBeHidden();
  const s = step(page, 'Step 1: 2.5% to Zakat');
  await expect(s).toBeVisible();
  await expect(s.locator('.ty-step__rule')).toHaveText('2.5%');
  await expect(s).toContainText('Zakat');
  await expect(s).toContainText('25.00');
  await expect(lefts(box(page, 'Paycheck'))).toHaveText('975.00 left');
  await expect(box(page, 'Paycheck')).not.toContainText(NO_STEPS);
  await expect(sec(page, 'Zakat')).toContainText('25.00');
  await expect(sec(page, 'Left over')).toContainText('975.00');
  expect(await kept(page), 'no reload').toBe(true);
  expect((await pipelineApi(page)).boxes[0].steps).toHaveLength(1);
});

test('the Budget page follows the pipeline: a section\'s Budgeted is what the step sent it', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 100000);
  await me.seed.section('Zakat');
  await gotoPipeline(page);
  await addPercentStep(page, 'Paycheck', [['Zakat', '2.5']]);
  await page.locator('.ty-side').getByRole('link', { name: 'Budget' }).click();
  await expect(await cell(page, bsection(page, 'Zakat'), 'Budgeted')).toContainText('25.00');
});

// ============ criterion 13: the worked example, built through the page ============
async function checkWorkedExample(page: Page) {
  const together = incomeCol(page).locator('.ty-node').first();
  await expect(together.locator('.ty-node__src')).toHaveCount(2);
  await expect(together.locator('.ty-node__src').nth(0)).toContainText('Paycheck');
  await expect(together.locator('.ty-node__src').nth(0)).toContainText('2,000.00');
  await expect(together.locator('.ty-node__src').nth(1)).toContainText('Second job');
  await expect(together.locator('.ty-node__src').nth(1)).toContainText('600.00');
  await expect(together.locator('.ty-node__head--sum')).toContainText('Together');
  await expect(together.locator('.ty-node__head--sum')).toContainText(WORKED.together);
  for (const src of await together.locator('.ty-node__src').all()) {
    await expect(src.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  }

  const s1 = step(page, 'Step 1: 2.5% to Zakat');
  const s2 = step(page, 'Step 2: 500.00 to Family');
  const s3 = step(page, 'Step 3: 50% to Needs, 30% to Wants, 20% to Savings');
  await expect(s1.locator('.ty-step__rule')).toHaveText('2.5%');
  await expect(s1).toContainText(WORKED.zakat);
  await expect(s2.locator('.ty-step__rule')).toHaveText('500.00');
  await expect(s2).toContainText(WORKED.family);
  await expect(stepRows(s3)).toHaveCount(3);
  await expect(stepRows(s3).locator('.ty-step__rule')).toHaveText(['50%', '30%', '20%']);
  for (const [i, [name, amount]] of ([['Needs', WORKED.needs], ['Wants', WORKED.wants], ['Savings', WORKED.savings]] as const).entries()) {
    await expect(stepRows(s3).nth(i)).toContainText(name);
    await expect(stepRows(s3).nth(i)).toContainText(amount);
  }
  // the step's number is on its first row only
  expect(await stepRows(s3).evaluateAll((rs) => rs.map((r) => (r.querySelector('.ty-step__n')?.textContent ?? '').trim()))).toEqual(['3', '', '']);
  await expect(lefts(together)).toHaveText([...WORKED.lefts]);

  const fund = box(page, 'Fund payout');
  await expect(fund.locator('.ty-node__head')).toContainText('12.40');
  await expect(fund).toContainText(NO_STEPS);
  await expect(lefts(fund)).toHaveText('12.40 left');

  for (const [name, amount] of [['Zakat', WORKED.zakat], ['Family', WORKED.family], ['Needs', WORKED.needs], ['Wants', WORKED.wants], ['Savings', WORKED.savings], ['Left over', WORKED.leftOver]]) {
    await expect(sec(page, name), name).toContainText(amount);
  }
  // sections in order, "Left over" last
  const heads = (await sectionCol(page).locator('.ty-node').allInnerTexts()).map((t) => norm(t));
  expect(heads).toHaveLength(6);
  ['Zakat', 'Family', 'Needs', 'Wants', 'Savings', 'Left over'].forEach((n, i) => expect(heads[i].startsWith(n), `${n} is number ${i + 1}: ${heads[i]}`).toBe(true));
}

test('building the worked example through the page shows every figure of the example', async ({ page, me }) => {
  const seed = me.seed;
  for (const n of ['Zakat', 'Family', 'Needs', 'Wants', 'Savings']) await seed.section(n);
  const pocket = await seed.pocket('Revolut', 0);
  const paycheck = await seed.source('Paycheck');
  const fund = await seed.source('Fund payout');
  await seed.income(pocket.id, 200000, paycheck.id);
  await seed.income(pocket.id, 1240, fund.id);
  await gotoPipeline(page);

  // a second source joins the Paycheck box
  await page.getByRole('button', { name: 'Add income source', exact: true }).first().click();
  const sd = dialog(page);
  await sd.getByLabel('Name', { exact: true }).fill('Second job');
  const boxSel = sd.getByLabel('Box', { exact: true });
  await expect(boxSel.locator('option')).toHaveText(['A box of its own', 'With Paycheck', 'With Fund payout']);
  await boxSel.selectOption({ label: 'With Paycheck' });
  await sd.getByRole('button', { name: 'Add income source', exact: true }).click();
  await expect(sd).toBeHidden();
  await seed.income(pocket.id, 60000, 'Second job');
  await page.reload();
  await expect(page.locator('.ty-node__head--sum')).toContainText('2,600.00');

  await addPercentStep(page, 'Paycheck', [['Zakat', '2.5']]);
  await addAmountStep(page, 'Paycheck', 'Family', '500');
  await addPercentStep(page, 'Paycheck', [['Needs', '50'], ['Wants', '30'], ['Savings', '20']]);
  await checkWorkedExample(page);
  await shot(page, 'spec06-pipeline-built-desktop-light');
});

// ============ criterion 14: the step dialog's checks ============
test.describe('step dialog checks', () => {
  test.beforeEach(async ({ page, me }) => {
    await me.seed.section('Zakat');
    await me.seed.section('Needs');
    await oneSource(me.seed, 'Paycheck', 100000);
    await gotoPipeline(page);
  });

  const stepsSaved = async (page: Page) => (await pipelineApi(page)).boxes[0].steps.length;

  test('a percentage of 0, 101 or 2.555 is refused with the sentence under the row, and nothing is saved', async ({ page }) => {
    const d = await openAddStep(page, 'Paycheck');
    await sectionSel(d, 1).selectOption({ label: 'Zakat' });
    for (const v of ['0', '101', '2.555', 'abc', '']) {
      await pctInput(d, 1).fill(v);
      await d.getByRole('button', { name: 'Add step', exact: true }).click();
      await expect(d.getByText(PCT_ERROR), `"${v}"`).toBeVisible();
      await expect(pctInput(d, 1), `"${v}"`).toHaveClass(/ty-input--error/);
      await expect(d).toBeVisible();
      expect(await stepsSaved(page), v).toBe(0);
    }
    await shot(page, 'spec06-step-dialog-error-desktop-light');
    await pctInput(d, 1).fill('100'); // 100 and 0.01 are the limits that do pass
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d).toBeHidden();
    expect(await stepsSaved(page)).toBe(1);
  });

  test('a row without a section is refused with "Choose a section in every row."', async ({ page }) => {
    const d = await openAddStep(page, 'Paycheck');
    await pctInput(d, 1).fill('10');
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d.getByText(NEED_SECTION_ROWS)).toBeVisible();
    await expect(d).toBeVisible();
    expect(await stepsSaved(page)).toBe(0);
  });

  test('an Amount step with no amount or no section is refused with its sentence, and nothing is saved', async ({ page }) => {
    const d = await openAddStep(page, 'Paycheck');
    await takes(d, 'Amount').check();
    // a valid amount with no section chosen
    await amountField(d).fill('50');
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d.getByText(NEED_SECTION, { exact: true })).toBeVisible();
    await expect(d).toBeVisible();
    await d.getByLabel('Section', { exact: true }).selectOption({ label: 'Zakat' });
    for (const v of ['', '0', '1.234', 'abc', '-5']) {
      await amountField(d).fill(v);
      await d.getByRole('button', { name: 'Add step', exact: true }).click();
      await expect(d.getByText(AMOUNT_ERROR), `"${v}"`).toBeVisible();
      await expect(amountField(d), `"${v}"`).toHaveClass(/ty-input--error/);
      await expect(d).toBeVisible();
    }
    expect(await stepsSaved(page)).toBe(0);
  });

  test('percentages adding up to more than 100 show the server\'s sentence under the rows; the same section twice shows its sentence', async ({ page }) => {
    const d = await openAddStep(page, 'Paycheck');
    await fillShares(d, [['Zakat', '60'], ['Needs', '50']]);
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d.getByText(OVER_100)).toBeVisible();
    await expect(d).toBeVisible();
    expect(await stepsSaved(page)).toBe(0);
    await shot(page, 'spec06-step-dialog-over-100-desktop-light');
    await pctInput(d, 2).fill('40'); // exactly 100 fits
    await sectionSel(d, 2).selectOption({ label: 'Zakat' });
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d.getByText(SAME_SECTION)).toBeVisible();
    expect(await stepsSaved(page)).toBe(0);
    await sectionSel(d, 2).selectOption({ label: 'Needs' });
    await d.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(d).toBeHidden();
    expect(await stepsSaved(page)).toBe(1);
  });
});

// ============ the step dialog's shape ============
test('step dialog: "Takes" is a Segmented, rows have named fields, rows are added up to 8 and removed, and the hints show', async ({ page, me }) => {
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) await me.seed.section(n);
  await oneSource(me.seed, 'Paycheck', 0);
  await gotoPipeline(page);
  const d = await openAddStep(page, 'Paycheck');
  await expect(group(d, 'Takes').locator('.ty-segmented')).toHaveCount(1);
  await expect(group(d, 'Takes').locator('.ty-segmented label')).toHaveText(['Percentage', 'Amount']);
  await expect(takes(d, 'Percentage')).toBeChecked();
  await expect(d.locator('.ty-shares')).toBeVisible();
  await expect(d.locator('.ty-shares .ty-label')).toHaveText(['Section', 'Percentage']);
  await expect(sectionSel(d, 1)).toBeVisible();
  await expect(pctInput(d, 1)).toBeVisible();
  await expect(d.locator('.ty-shares .ty-muted', { hasText: '%' })).toHaveCount(1);
  await expect(d.getByRole('button', { name: /^Remove/ })).toHaveCount(0); // one row: nothing to remove
  await expect(d.getByText(STEP_HINT)).toBeVisible();
  await expect(d.getByLabel('Position', { exact: true })).toHaveCount(0); // a new step
  await expect(d.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Add step', exact: true })).toBeVisible();

  const add = d.getByRole('button', { name: '+ Add destination', exact: true });
  await add.click();
  await expect(sectionSel(d, 2)).toBeVisible();
  await expect(d.getByRole('button', { name: 'Remove destination 1', exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Remove destination 2', exact: true })).toBeVisible();
  await sectionSel(d, 1).selectOption({ label: 'A' });
  await sectionSel(d, 2).selectOption({ label: 'B' });
  await pctInput(d, 1).fill('10');
  await pctInput(d, 2).fill('20');
  await d.getByRole('button', { name: 'Remove destination 1', exact: true }).click();
  await expect(sectionSel(d, 2)).toHaveCount(0);
  await expect(sectionSel(d, 1).locator('option:checked')).toHaveText('B');
  await expect(pctInput(d, 1)).toHaveValue('20');
  await expect(d.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

  for (let i = 0; i < 7; i++) await add.click(); // 1 + 7 = 8 rows
  await expect(d.locator('.ty-shares select')).toHaveCount(8);
  await expect(add, 'no ninth row').toHaveCount(0);
  await expect(d.locator('.ty-shares select')).toHaveCount(8);

  await takes(d, 'Amount').check();
  await expect(d.locator('.ty-shares')).toHaveCount(0);
  await expect(d.getByLabel('Section', { exact: true })).toBeVisible();
  await expect(amountField(d)).toBeVisible();
  await expect(d.locator('.ty-affix')).toContainText('EUR');
  await expect(d.getByText(AMOUNT_HINT)).toBeVisible();
  await expect(d.getByText(STEP_HINT)).toHaveCount(0);
  await takes(d, 'Percentage').check();
  await expect(d.locator('.ty-shares')).toBeVisible();
});

test('step dialog with no section yet says "Add a section first" and shows no fields', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 0);
  await gotoPipeline(page);
  const d = await openAddStep(page, 'Paycheck');
  await expect(d.getByText('Add a section first')).toBeVisible();
  await expect(group(d, 'Takes')).toHaveCount(0);
  await expect(d.locator('input, select')).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Add step', exact: true })).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await shot(page, 'spec06-step-dialog-no-section-desktop-light');
});

// ============ criterion 15: Edit step ============
test('"Edit step" opens with the step\'s values; "Position" moves it and every figure after it follows; a save says "Saved"', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await step(page, 'Step 3: 50% to Needs, 30% to Wants, 20% to Savings').click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit step' })).toBeVisible();
  await expect(takes(d, 'Percentage')).toBeChecked();
  for (const [i, [name, pct]] of [['Needs', '50'], ['Wants', '30'], ['Savings', '20']].entries()) {
    await expect(sectionSel(d, i + 1).locator('option:checked')).toHaveText(name);
    await expect(pctInput(d, i + 1)).toHaveValue(pct);
  }
  await expect(d.getByRole('button', { name: /^Remove destination/ })).toHaveCount(3);
  const pos = d.getByLabel('Position', { exact: true });
  await expect(pos.locator('option')).toHaveText(['1', '2', '3']);
  await expect(pos.locator('option:checked')).toHaveText('3');
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Delete' })).toBeVisible();
  await shot(page, 'spec06-step-dialog-edit-desktop-light');
  await pos.selectOption({ label: '2' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');

  // order is now: 2.5% Zakat, 50/30/20, 500.00 Family; the 50/30/20 step shares what is left after Zakat
  await expect(step(page, 'Step 1: 2.5% to Zakat')).toBeVisible();
  const moved = step(page, 'Step 2: 50% to Needs, 30% to Wants, 20% to Savings');
  await expect(moved).toBeVisible();
  await expect(stepRows(moved).nth(0)).toContainText('1,267.50');
  await expect(stepRows(moved).nth(1)).toContainText('760.50');
  await expect(stepRows(moved).nth(2)).toContainText('507.00');
  await expect(step(page, 'Step 3: 500.00 to Family')).toBeVisible();
  await expect(lefts(box(page, 'Paycheck'))).toHaveText(['2,535.00 left', '0.00 left', '0.00 left']);
  await expect(sec(page, 'Needs')).toContainText('1,267.50');
  await expect(sec(page, 'Family')).toContainText('0.00');
  await expect(sec(page, 'Left over')).toContainText('12.40');
  const api = await pipelineApi(page);
  expect(api.boxes[0].steps.map((s) => s.position)).toEqual([1, 2, 3]);
});

test('editing a step\'s values: an Amount step shows its section and amount, and a new amount changes the figures', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await step(page, 'Step 2: 500.00 to Family').click();
  const d = dialog(page);
  await expect(takes(d, 'Amount')).toBeChecked();
  await expect(d.getByLabel('Section', { exact: true }).locator('option:checked')).toHaveText('Family');
  await expect(amountField(d)).toHaveValue('500.00');
  await amountField(d).fill('300');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(step(page, 'Step 2: 300.00 to Family')).toBeVisible();
  await expect(lefts(box(page, 'Paycheck')).nth(1)).toHaveText('2,235.00 left');
  await expect(sec(page, 'Family')).toContainText('300.00');
});

test('"Delete" removes a step with a "Step deleted" toast, the later steps move up, and Undo puts it back at the same position', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await step(page, 'Step 2: 500.00 to Family').click();
  const d = dialog(page);
  await expect(d.getByLabel('Position', { exact: true }).locator('option:checked')).toHaveText('2');
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Step deleted');
  await expect(step(page, 'Step 2: 500.00 to Family')).toHaveCount(0);
  await expect(step(page, 'Step 2: 50% to Needs, 30% to Wants, 20% to Savings')).toBeVisible(); // moved up
  await expect(sec(page, 'Family')).toContainText('0.00');
  await expect(lefts(box(page, 'Paycheck'))).toHaveText(['2,535.00 left', '0.00 left']);
  expect((await pipelineApi(page)).boxes[0].steps.map((s) => s.position)).toEqual([1, 2]);
  await shot(page, 'spec06-toast-step-deleted-desktop-light');

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(step(page, 'Step 2: 500.00 to Family')).toBeVisible();
  await expect(step(page, 'Step 3: 50% to Needs, 30% to Wants, 20% to Savings')).toBeVisible();
  await expect(lefts(box(page, 'Paycheck'))).toHaveText([...WORKED.lefts]);
  await expect(sec(page, 'Family')).toContainText(WORKED.family);
  expect((await pipelineApi(page)).boxes[0].steps.map((s) => s.position)).toEqual([1, 2, 3]);
});

test('a box with a single step does not offer "Position"', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 100000);
  const z = await me.seed.section('Zakat');
  const { boxId } = (await me.seed.sourcesApi())[0];
  await me.seed.amountStep(boxId, z.id, 1000);
  await gotoPipeline(page);
  await step(page, 'Step 1: 10.00 to Zakat').click();
  await expect(dialog(page).getByRole('heading', { name: 'Edit step' })).toBeVisible();
  await expect(dialog(page).getByLabel('Position', { exact: true })).toHaveCount(0);
});

// ============ criterion 16: sources ============
test('"Edit" on a source renames it and says "Saved"', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 100000);
  await gotoPipeline(page);
  const d = await openEditSource(page, 'Paycheck');
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Paycheck');
  await expect(d.getByLabel('Box', { exact: true }).locator('option:checked')).toHaveText('A box of its own');
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(d.getByText(BOX_WARNING)).toHaveCount(0);
  await d.getByLabel('Name', { exact: true }).fill('Salary');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  await expect(box(page, 'Salary')).toContainText('1,000.00');
  await expect(page.getByText('Paycheck')).toHaveCount(0);
});

test('"Box" offers "A box of its own" first, then "With {names}" for each other box', async ({ page, me }) => {
  const a = await me.seed.source('Paycheck');
  await me.seed.source('Second job', a.boxId);
  await me.seed.source('Fund payout');
  await me.seed.source('Rent');
  await gotoPipeline(page);
  const d = await openEditSource(page, 'Fund payout');
  await expect(d.getByLabel('Box', { exact: true }).locator('option')).toHaveText(['A box of its own', 'With Paycheck and Second job', 'With Rent']);
  await expect(d.getByLabel('Box', { exact: true }).locator('option:checked')).toHaveText('A box of its own');
});

test('moving the only source of a box that has steps shows the warning, and after saving that box and its steps are gone', async ({ page, me }) => {
  const w = await seedPipeline(me.seed);
  // Fund payout has no steps; Second job joins Paycheck. Make a box of one source with steps: Rent with a step.
  const rent = await me.seed.source('Rent');
  await me.seed.amountStep(rent.boxId, w.zakat.id, 1000);
  await gotoPipeline(page);
  await expect(step(page, 'Step 1: 10.00 to Zakat')).toBeVisible();
  const d = await openEditSource(page, 'Rent');
  const sel = d.getByLabel('Box', { exact: true });
  await expect(d.getByText(BOX_WARNING)).toHaveCount(0);
  await sel.selectOption({ label: 'With Fund payout' });
  await expect(d.getByText(BOX_WARNING)).toBeVisible();
  await shot(page, 'spec06-source-dialog-warning-desktop-light');
  await sel.selectOption({ label: 'A box of its own' });
  await expect(d.getByText(BOX_WARNING)).toHaveCount(0);
  await sel.selectOption({ label: 'With Fund payout' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  const merged = box(page, 'Rent');
  await expect(merged).toContainText('Fund payout');
  await expect(merged.locator('.ty-node__head--sum')).toContainText('Together');
  await expect(merged).toContainText(NO_STEPS);
  await expect(step(page, 'Step 1: 10.00 to Zakat')).toHaveCount(0);
  const api = await pipelineApi(page);
  expect(api.boxes).toHaveLength(2);
  expect(api.boxes.reduce((n, b) => n + b.steps.length, 0)).toBe(3); // only the worked example's three steps are left
});

test('no warning shows when the source is not alone in its box, or its box has no steps', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  let d = await openEditSource(page, 'Second job'); // shares a box that has steps
  await d.getByLabel('Box', { exact: true }).selectOption({ label: 'With Fund payout' });
  await expect(d.getByText(BOX_WARNING)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  d = await openEditSource(page, 'Fund payout'); // alone, no steps
  await d.getByLabel('Box', { exact: true }).selectOption({ label: 'With Paycheck and Second job' });
  await expect(d.getByText(BOX_WARNING)).toHaveCount(0);
});

test('a source can be moved out of a merged box into a box of its own', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  const d = await openEditSource(page, 'Second job');
  await expect(d.getByLabel('Box', { exact: true }).locator('option:checked')).toHaveText('With Paycheck');
  await d.getByLabel('Box', { exact: true }).selectOption({ label: 'A box of its own' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(incomeCol(page).locator('.ty-node')).toHaveCount(3);
  await expect(box(page, 'Second job').locator('.ty-node__head--sum')).toHaveCount(0);
  // the Paycheck box now has 2,000.00: 2.5% = 50.00
  await expect(step(page, 'Step 1: 2.5% to Zakat')).toContainText('50.00');
});

test('a source with income cannot be deleted and the dialog says why', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 100000);
  await gotoPipeline(page);
  const d = await openEditSource(page, 'Paycheck');
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d.getByText('This source has transactions. Delete them first.')).toBeVisible();
  await expect(d).toBeVisible();
  await shot(page, 'spec06-source-dialog-conflict-desktop-light');
  await page.keyboard.press('Escape');
  await expect(box(page, 'Paycheck')).toBeVisible();
  expect(await me.seed.sourcesApi()).toHaveLength(1);
});

test('a source without income is deleted with a "Source deleted" toast, and Undo brings it back in a box of its own', async ({ page, me }) => {
  const a = await me.seed.source('Paycheck');
  await me.seed.source('Idle', a.boxId);
  await gotoPipeline(page);
  const d = await openEditSource(page, 'Idle');
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Source deleted');
  await expect(page.getByText('Idle')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(box(page, 'Idle')).toBeVisible();
  await expect(box(page, 'Idle')).not.toContainText('Paycheck');
  await expect(incomeCol(page).locator('.ty-node')).toHaveCount(2);
});

// ============ sections on the Pipeline page ============
test('"Add section" and a section\'s "Edit" open the section dialog with the Name only, and the column updates', async ({ page, me }) => {
  await me.seed.section('Needs');
  await oneSource(me.seed, 'Paycheck', 0);
  await gotoPipeline(page);
  await mark(page);
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  let d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add section' })).toBeVisible();
  await expect(d.locator('input:not([type=radio])')).toHaveCount(1);
  await d.getByLabel('Name', { exact: true }).fill('Fun');
  await d.getByRole('button', { name: 'Add section', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(sec(page, 'Fun')).toBeVisible();
  await expect(sec(page, 'Fun')).toContainText('0.00');
  const dots = await sectionCol(page).locator('.ty-node .ty-dot').evaluateAll((es) => es.map((e) => e.className));
  expect(dots[1]).toMatch(/ty-dot--2/); // the second section takes the second colour slot
  await sec(page, 'Needs').getByRole('button', { name: 'Edit', exact: true }).click();
  d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit section' })).toBeVisible();
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Needs');
  await d.getByLabel('Name', { exact: true }).fill('Basics');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(sec(page, 'Basics')).toBeVisible();
  expect(await kept(page)).toBe(true);
});

// ============ criterion 17: wires ============
/** Everything the spec says about the wires, measured from the rendered page. Empty means all is well. */
const wireProblems = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const svg = document.querySelector('svg.ty-pipe__wires');
    if (!svg) return ['no svg.ty-pipe__wires'];
    const o = svg.getBoundingClientRect();
    const rel = (r: DOMRect) => ({ left: r.left - o.left, right: r.right - o.left, top: r.top - o.top, bottom: r.bottom - o.top });
    const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const wires = [...svg.querySelectorAll('path.ty-wire:not(.ty-wire--next)')].map((p) => {
      const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = nums(p.getAttribute('d') ?? '');
      return { x1, y1, c1x, c1y, c2x, c2y, x2, y2, cls: p.getAttribute('class') ?? '' };
    });
    const cols = document.querySelectorAll('.ty-pipe__col');
    const heads = [...cols[1].querySelectorAll('.ty-node')].map((n) => {
      const h = n.querySelector('.ty-node__head') as HTMLElement;
      return { text: (h.textContent ?? '').replace(/\s+/g, ' ').trim(), r: rel(h.getBoundingClientRect()), slot: (h.querySelector('.ty-dot')?.className.match(/ty-dot--(\d+)/) ?? [])[1] as string | undefined };
    });
    const used = new Set<number>();
    const find = (x: number, top: number, bottom: number) =>
      wires.findIndex((w, i) => !used.has(i) && Math.abs(w.x1 - x) <= 2 && w.y1 >= top - 1 && w.y1 <= bottom + 1);
    const check = (what: string, i: number, head: (typeof heads)[number] | undefined, slot: string | undefined) => {
      if (i < 0) return out.push(`${what}: no wire starts at its right edge`);
      used.add(i);
      const w = wires[i];
      if (!head) return out.push(`${what}: no section head to end at`);
      if (Math.abs(w.x2 - head.r.left) > 2) out.push(`${what}: ends at x=${w.x2}, head left edge is ${head.r.left}`);
      if (w.y2 < head.r.top - 1 || w.y2 > head.r.bottom + 1) out.push(`${what}: ends at y=${w.y2}, outside the head ${head.r.top}..${head.r.bottom}`);
      const mid = (w.x1 + w.x2) / 2;
      if (Math.abs(w.c1y - w.y1) > 0.5 || Math.abs(w.c2y - w.y2) > 0.5) out.push(`${what}: control points are not level with the ends`);
      if (Math.abs(w.c1x - mid) > 1 || Math.abs(w.c2x - mid) > 1) out.push(`${what}: control points are not halfway across the gap`);
      const has = (w.cls.match(/ty-wire--(\d+)/) ?? [])[1];
      if (has !== slot) out.push(`${what}: colour class ${has ?? 'none'} but the section's slot is ${slot ?? 'none'}`);
    };
    let expected = 0;
    for (const [n, r] of [...document.querySelectorAll('.ty-pipe__step .ty-step:not(.ty-step--rest)')].entries()) {
      expected++;
      const name = (r.querySelector('.ty-tag')?.textContent ?? '').trim();
      const rr = rel(r.getBoundingClientRect());
      const head = heads.find((h) => h.text.startsWith(name)); // textContent has no spaces between the name, Edit and the amount
      check(`row ${n + 1} (${name})`, find(rr.right, rr.top, rr.bottom), head, head?.slot);
    }
    const leftHead = heads.find((h) => h.text.startsWith('Left over'));
    for (const b of cols[0].querySelectorAll('.ty-node')) {
      const l = [...b.querySelectorAll('.ty-pipe__left')].pop();
      if (!l) continue;
      if (parseFloat((l.textContent ?? '').replace(/,/g, '')) === 0) continue;
      expected++;
      const lr = rel(l.getBoundingClientRect());
      check(`left line "${(l.textContent ?? '').trim()}"`, find(lr.right, lr.top, lr.bottom), leftHead, undefined);
    }
    if (wires.length !== expected) out.push(`${wires.length} wires, expected ${expected}`);
    const ports = [...svg.querySelectorAll('circle.ty-port')];
    if (ports.length !== (wires.length + svg.querySelectorAll('path.ty-wire--next').length) * 2) out.push(`${ports.length} ports for ${wires.length} wires`);
    for (const p of ports) if (p.getAttribute('r') !== '4') out.push('a port is not 4px');
    for (const w of wires) {
      const at = (x: number, y: number) => ports.some((p) => Math.abs(+p.getAttribute('cx')! - x) <= 0.5 && Math.abs(+p.getAttribute('cy')! - y) <= 0.5);
      if (!at(w.x1, w.y1) || !at(w.x2, w.y2)) out.push('a wire has no port at one end');
    }
    return out;
  });

test('each step row has a wire to its section\'s box in that section\'s colour, a box with money left has a plain wire to "Left over"; ends within 2px of the edges, also after resizing', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  const svg = page.locator('svg.ty-pipe__wires');
  await expect(svg.locator('path.ty-wire:not(.ty-wire--next)')).toHaveCount(6); // 1 + 1 + 3 rows, and Fund payout's 12.40
  await expect.poll(() => wireProblems(page)).toEqual([]);
  // the colour of each wire: one per colour slot of the five sections, plus one plain
  const classes = await svg.locator('path.ty-wire:not(.ty-wire--next)').evaluateAll((ps) => ps.map((p) => p.getAttribute('class')!.split(/\s+/).filter((c) => c.startsWith('ty-wire--')).join('') || 'plain'));
  expect(classes.sort()).toEqual(['plain', 'ty-wire--1', 'ty-wire--2', 'ty-wire--3', 'ty-wire--4', 'ty-wire--5']);
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  await shot(page, 'spec06-pipeline-wires-1280-light');

  for (const size of [{ width: 1024, height: 800 }, { width: 1100, height: 800 }, { width: 1500, height: 700 }, { width: 900, height: 900 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => wireProblems(page), `after resizing to ${size.width}x${size.height}`).toEqual([]);
  }
});

test('wires are drawn again when the data changes: a new step, a deleted step and a new income', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await expect.poll(() => wireProblems(page)).toEqual([]);
  const wires = page.locator('svg.ty-pipe__wires path.ty-wire:not(.ty-wire--next)');
  await expect(wires).toHaveCount(6);
  await addPercentStep(page, 'Fund payout', [['Zakat', '50']]);
  await expect(wires).toHaveCount(7); // one more row; the box still has 6.20 left
  await expect.poll(() => wireProblems(page)).toEqual([]);
  await step(page, 'Step 1: 50% to Zakat').click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(wires).toHaveCount(6);
  await expect.poll(() => wireProblems(page)).toEqual([]);
  // an amount step that takes all of the Fund payout box leaves nothing: no wire to "Left over" from it
  await addAmountStep(page, 'Fund payout', 'Family', '12.40');
  await expect(lefts(box(page, 'Fund payout'))).toHaveText('0.00 left');
  await expect(wires).toHaveCount(6); // +1 row, -1 plain wire
  await expect.poll(() => wireProblems(page)).toEqual([]);
});

test('with a source and no step the only wire is the plain one to "Left over"', async ({ page, me }) => {
  await oneSource(me.seed, 'Paycheck', 5000);
  await gotoPipeline(page);
  await expect(page.locator('svg.ty-pipe__wires path.ty-wire:not(.ty-wire--next)')).toHaveCount(1);
  await expect(page.locator('svg.ty-pipe__wires path.ty-wire:not(.ty-wire--next)')).toHaveClass(/^ty-wire$/);
  await expect.poll(() => wireProblems(page)).toEqual([]);
  await me.seed.source('Idle'); // no income: nothing left, no wire
  await page.reload();
  await expect(page.locator('svg.ty-pipe__wires path.ty-wire:not(.ty-wire--next)')).toHaveCount(1);
});

// ============ criterion 18: keyboard ============
test('Tab reaches every "Edit" button, every step and every "Add step", each with the focus ring; Enter and Space open a step; the wires cannot be reached', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await page.evaluate(() => {
    (window as unknown as { __seen: Element[] }).__seen = [];
    document.addEventListener('focusin', (e) => (window as unknown as { __seen: Element[] }).__seen.push(e.target as Element));
  });
  const rings: { name: string; style: string; width: string }[] = [];
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const cs = getComputedStyle(e);
      return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 50), style: cs.outlineStyle, width: cs.outlineWidth, inMain: !!e.closest('.ty-pipe'), inSvg: !!e.closest('svg') };
    });
    expect(f.inSvg, `${f.name}: Tab never lands in the wires`).toBe(false);
    if (f.inMain) rings.push(f);
  }
  for (const r of rings) {
    expect(r.style, `${r.name}: ring style`).toBe('solid');
    expect(r.width, `${r.name}: ring width`).toBe('2px');
  }
  const wanted = [
    ...(await page.getByRole('button', { name: 'Edit', exact: true }).all()),
    ...(await page.getByRole('button', { name: /^Step \d/ }).all()),
    ...(await page.getByRole('button', { name: 'Add step', exact: true }).all()),
  ];
  expect(wanted.length).toBe(3 + 5 + 3 + 2); // 3 sources + 5 sections, 3 steps, 2 boxes
  for (const [i, w] of wanted.entries()) {
    expect(await w.evaluate((el) => (window as unknown as { __seen: Element[] }).__seen.includes(el)), `control ${i} was reached by Tab`).toBe(true);
  }
  // the wires hold nothing focusable and nothing readable
  const svg = page.locator('svg.ty-pipe__wires');
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  expect(await svg.evaluate((s) => s.querySelectorAll('[tabindex], a, button').length)).toBe(0);
  await expect(svg.getByRole('img')).toHaveCount(0);

  const s2 = step(page, 'Step 2: 500.00 to Family');
  await s2.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Edit step' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(s2).toBeFocused(); // the dialog hands focus back to the step that opened it (retries until it does)
  await page.keyboard.press('Space');
  await expect(dialog(page).getByRole('heading', { name: 'Edit step' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(s2).toBeFocused(); // focus returns to the step after the second dialog too
  // a step shows the ring when reached by keyboard
  await page.keyboard.press('Tab');
  await expect(s2).not.toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(s2).toBeFocused();
  expect(await s2.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
  await shot(page, 'spec06-pipeline-focus-step-desktop-light');
});

// ============ criterion 19: the income dialog ============
test('in the income dialog "Source" replaces "Payee"; with no source the panel is open, and saving creates the source and the income', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 0);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByLabel('Payee')).toHaveCount(0);
  await expect(d.getByText('Payee', { exact: true })).toHaveCount(0);
  await expect(group(d, 'Source')).toBeVisible();
  await expect(group(d, 'Source').locator('label.ty-chip')).toHaveCount(1);
  await expect(chip(d, 'Source', '+ Add source')).toBeChecked();
  await expect(d.getByLabel('Source name')).toBeVisible();
  await expect(d.locator('.ty-inset').first()).toBeVisible();
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  const order = ['type', 'date', 'amount', 'source', 'pocket', 'note (optional)'].map(at);
  expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await d.getByLabel('Amount').fill('1500');
  await d.getByLabel('Source name').fill('Salary');
  await chip(d, 'Pocket', /Revolut/).check();
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  expect((await me.seed.sourcesApi()).map((s) => s.name)).toEqual(['Salary']);
  await page.locator('.ty-side').getByRole('link', { name: 'Transactions' }).click();
  const r = row(page, /Salary/);
  await expect(r).toContainText('+1,500.00');
  await expect(r).toContainText(/Income/);
});

test('with sources present the dialog has one chip per source and a last "+ Add source"; the first source is chosen; "+ Add source" creates one in place', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await me.seed.source('Second job');
  await me.seed.pocket('Revolut', 0);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  const chips = group(d, 'Source').locator('label.ty-chip');
  await expect(chips).toHaveText(['Paycheck', 'Second job', '+ Add source']);
  await expect(chips.nth(2)).toHaveClass(/ty-chip--add/);
  await expect(chip(d, 'Source', 'Paycheck')).toBeChecked();
  await expect(d.getByLabel('Source name')).toBeHidden();
  await shot(page, 'spec06-income-dialog-sources-desktop-light');
  await chip(d, 'Source', '+ Add source').check();
  await expect(d.getByLabel('Source name')).toBeVisible();
  await d.getByLabel('Source name').fill('Side gig');
  await d.getByLabel('Amount').fill('80');
  await chip(d, 'Pocket', /Revolut/).check();
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  const sources = await me.seed.sourcesApi();
  expect(sources.map((s) => s.name)).toEqual(['Paycheck', 'Second job', 'Side gig']);
  expect(new Set(sources.map((s) => s.boxId)).size, 'the new source has a box of its own').toBe(3);
  await page.goto('/transactions');
  await expect(row(page, /Side gig/)).toContainText('+80.00');
});

test('choosing an existing source chip saves the income to it, and editing an income opens on its source', async ({ page, me }) => {
  const a = await me.seed.source('Paycheck');
  await me.seed.source('Second job', a.boxId);
  const p = await me.seed.pocket('Revolut', 0);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Type', 'Income').check();
  await chip(d, 'Source', 'Second job').check();
  await d.getByLabel('Amount').fill('60');
  await chip(d, 'Pocket', /Revolut/).check();
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  await row(page, /Second job/).click();
  await expect(d.getByRole('heading', { name: 'Edit income' })).toBeVisible();
  await expect(chip(d, 'Source', 'Second job')).toBeChecked();
  await expect(chip(d, 'Source', 'Paycheck')).not.toBeChecked();
  await chip(d, 'Source', 'Paycheck').check();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Paycheck/)).toContainText('+60.00');
  void p;
});

test('an expense still has a Payee and no Source', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(d.getByLabel('Payee')).toBeVisible();
  await expect(group(d, 'Source')).toHaveCount(0);
  await chip(d, 'Type', 'Income').check();
  await expect(group(d, 'Source')).toBeVisible();
  await expect(d.getByLabel('Payee')).toHaveCount(0);
  await chip(d, 'Type', 'Expense').check();
  await expect(d.getByLabel('Payee')).toBeVisible();
  await expect(group(d, 'Source')).toHaveCount(0);
});

test('a source name that is empty or already used shows its error in the source panel, and nothing is saved', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await me.seed.pocket('Revolut', 0);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await chip(d, 'Source', '+ Add source').check();
  await d.getByLabel('Amount').fill('10');
  await chip(d, 'Pocket', /Revolut/).check();
  for (const [name, message] of [['', 'Enter a name.'], ['paycheck', 'You already have a source with this name.']]) {
    await d.getByLabel('Source name').fill(name);
    await d.getByRole('button', { name: 'Add income', exact: true }).click();
    await expect(d).toBeVisible();
    await expect(d.getByLabel('Source name'), name).toHaveClass(/ty-input--error/);
    await expect(d.locator('.ty-inset .ty-error', { hasText: message }), name).toBeVisible();
    expect(await me.seed.sourcesApi(), name).toHaveLength(1);
  }
  await shot(page, 'spec06-income-dialog-source-error-desktop-light');
  const budget = await (await page.request.get(`/api/budget?month=${new Date().toISOString().slice(0, 7)}`)).json();
  expect(budget.totals.incomeMinor).toBe(0);
});

test('if the source is created and the income then fails, the new source stays chosen and its panel closes', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 0);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await d.getByLabel('Source name').fill('Salary');
  await d.getByLabel('Amount').fill('50');
  await chip(d, 'Pocket', /Revolut/).check();
  // The pocket is removed behind the dialog's back, so the income fails on `pocketId` after the source exists.
  const pocket = (await (await page.request.get('/api/pockets')).json()).pockets[0];
  expect((await page.request.delete(`/api/pockets/${pocket.id}`, { data: {} })).status()).toBe(204);
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeVisible();
  expect((await me.seed.sourcesApi()).map((s) => s.name)).toEqual(['Salary']);
  await expect(chip(d, 'Source', 'Salary')).toBeChecked();
  await expect(d.getByLabel('Source name')).toBeHidden();
});

// ============ criterion 20: the Budget page ============
const btotal = async (page: Page, name: string, label: 'Budgeted' | 'Spent' | 'Available') => cell(page, bsection(page, name), label);
const leftOverStat = (page: Page) => stat(page, 'Left over');

test('Budget page: each section\'s Budgeted is its received money, every section ends with a Rest row, and no rule line shows', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await page.goto('/budget');
  for (const [name, amount] of [['Zakat', WORKED.zakat], ['Family', WORKED.family], ['Needs', WORKED.needs], ['Wants', WORKED.wants], ['Savings', WORKED.savings]]) {
    await expect(await btotal(page, name, 'Budgeted'), name).toContainText(amount);
    const rest = restRow(page, name);
    await expect(rest, name).toBeVisible();
    await expect(pillOf(rest), name).toContainText(amount);
    await expect(await cell(page, rest, 'Rule'), `${name}: where the rest goes`).not.toHaveText('');
    expect(await subNames(page, name), `${name}: no note under the name`).not.toContain('Rest');
  }
  for (const old of ['Fixed amount', 'of income after fixed sections', 'Sum of subsections']) await expect(page.getByText(old)).toHaveCount(0);
  await expect(stat(page, 'Budgeted')).toContainText('2,600.00'); // everything the box's steps took
  await expect(stat(page, 'Income')).toContainText('2,612.40');
});

test('Budget page: a section whose subsections claim more than it received shows a warning Rest row', async ({ page, me }) => {
  const home = await me.seed.section('Home');
  await me.seed.subsection(home.id, 'Rent', 80000);
  await me.seed.subsection(home.id, 'Internet', 13000);
  const { source } = await oneSource(me.seed, 'Paycheck', 240000);
  await me.seed.amountStep(source.boxId, home.id, 90000);
  await page.goto('/budget');
  await expect(await btotal(page, 'Home', 'Budgeted')).toContainText('900.00');
  const rest = pillOf(restRow(page, 'Home'));
  await expect(rest).toContainText('−30.00');
  await expect(rest).toHaveClass(/ty-pill--(warning|negative)/);
});

test('Budget page month header: "Left over" is the fourth figure, and above zero a line with "Open the pipeline" opens the Pipeline page', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await page.goto('/budget');
  const stats = summary(page);
  const order = (await stats.innerText()).replace(/\s+/g, ' ').toLowerCase();
  expect(order.indexOf('spent')).toBeLessThan(order.indexOf('left over'));
  for (const l of ['Income', 'Budgeted', 'Spent', 'Left over']) await expect(stat(page, l), l).toBeVisible();
  await expect(leftOverStat(page)).toContainText(WORKED.leftOver);
  const line = page.locator('.ty-cap', { hasText: 'is left over: no step in the pipeline takes it.' });
  await expect(line).toBeVisible();
  expect(norm(await line.innerText())).toContain('12.40 is left over: no step in the pipeline takes it.');
  const link = page.getByRole('link', { name: 'Open the pipeline', exact: true });
  await expect(link).toBeVisible();
  const lineBox = (await line.boundingBox())!;
  const statsBox = (await stats.boundingBox())!;
  expect(lineBox.y, 'under the figures').toBeGreaterThanOrEqual(statsBox.y + statsBox.height - 1);
  await link.click();
  await expect(page).toHaveURL(/\/pipeline/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
});

test('Budget page month header: with nothing left over the figure is 0.00 and there is no line', async ({ page, me }) => {
  const { source } = await oneSource(me.seed, 'Paycheck', 10000);
  const s = await me.seed.section('Needs');
  await me.seed.amountStep(source.boxId, s.id, 10000);
  await page.goto('/budget');
  await expect(leftOverStat(page)).toContainText('0.00');
  await expect(page.getByText('is left over: no step in the pipeline takes it.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open the pipeline' })).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: phone });

  test('Budget page on a phone shows the "Left over" figure but not the line', async ({ page, me }) => {
    await seedPipeline(me.seed);
    await page.goto('/budget');
    await expect(leftOverStat(page)).toContainText(WORKED.leftOver);
    await expect(page.getByText('is left over: no step in the pipeline takes it.')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Open the pipeline' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

// ============ criterion 21: the section dialog has only Name ============
test('the section dialog has only "Name", and the old budget words appear nowhere', async ({ page, me, baseURL }) => {
  await seedPipeline(me.seed);
  const bad = ['Sum of subsections', 'Fixed amount', 'Percentage of income'];
  const visibleText = () => page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('option,[aria-label]')].map((e) => e.textContent + ' ' + e.getAttribute('aria-label')).join('\n'));
  for (const p of ['/budget', '/pipeline']) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    for (const open of ['add', 'edit'] as const) {
      if (open === 'add') await page.getByRole('button', { name: 'Add section', exact: true }).first().click();
      else await sec(page, 'Needs').or(bsection(page, 'Needs')).getByRole('button', { name: /^Edit/ }).first().click();
      const d = dialog(page);
      await expect(d.getByRole('heading', { name: open === 'add' ? 'Add section' : 'Edit section' })).toBeVisible();
      await expect(d.locator('input:not([type=radio])'), `${p} ${open}`).toHaveCount(1);
      await expect(d.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(d.getByRole('group')).toHaveCount(0);
      await expect(d.getByRole('radio')).toHaveCount(0);
      await expect(d.getByRole('group', { name: 'Budget' })).toHaveCount(0);
      await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
      const t = await visibleText();
      for (const b of bad) expect(t, `${p} ${open}: "${b}"`).not.toContain(b);
      if (open === 'add') await shot(page, `spec06-section-dialog-${p.slice(1)}-desktop-light`);
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();
    }
  }
  // and in the built files
  const html = await (await page.request.get('/')).text();
  const srcs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) expect(await (await page.request.get(baseURL + s)).text(), s).not.toMatch(/Sum of subsections|Percentage of income/);
});

// ============ criterion 22: deleting a section a step uses ============
test('deleting a section that a step uses shows the sentence in the dialog, from the Pipeline page and from the Budget page', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  await sec(page, 'Zakat').getByRole('button', { name: 'Edit', exact: true }).click();
  let d = dialog(page);
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d.getByText(SECTION_IN_USE)).toBeVisible();
  await expect(d).toBeVisible();
  await shot(page, 'spec06-section-in-use-desktop-light');
  await page.keyboard.press('Escape');
  await expect(sec(page, 'Zakat')).toBeVisible();

  await page.goto('/budget');
  await bsection(page, 'Needs').getByRole('button', { name: /^Edit / }).click();
  d = dialog(page);
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d.getByText(SECTION_IN_USE)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bsection(page, 'Needs')).toBeVisible();
});

test('a section no step uses is deleted, and Undo brings it back', async ({ page, me }) => {
  await me.seed.section('Spare');
  await oneSource(me.seed, 'Paycheck', 0);
  await gotoPipeline(page);
  await sec(page, 'Spare').getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(sec(page, 'Spare')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(sec(page, 'Spare')).toBeVisible();
});

// ============ states ============
test('Escape on the step dialog returns focus to the "Add step" button that opened it', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  const add = box(page, 'Fund payout').getByRole('button', { name: 'Add step', exact: true });
  await add.click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(add).toBeFocused();
});

test('no sideways scroll on the Pipeline page at 1024px, 1280px and 1440px', async ({ page, me }) => {
  await seedPipeline(me.seed);
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoPipeline(page);
    await expect(sec(page, 'Left over')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px`).toBe(true);
  }
});

// ============ screenshots (criterion 24): light and dark, desktop ============
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`screenshots ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: desktop });

    test('Pipeline page with the worked example, and with no source', async ({ page, me }) => {
      await gotoPipeline(page);
      await expect(page.getByText(NO_SOURCE)).toBeVisible();
      await shot(page, `spec06-pipeline-empty-desktop-${scheme}`);
      await seedPipeline(me.seed);
      await page.reload();
      await expect(sec(page, 'Left over')).toContainText(WORKED.leftOver);
      await expect.poll(() => wireProblems(page)).toEqual([]);
      await shot(page, `spec06-pipeline-desktop-${scheme}`);
      await page.screenshot({ path: `screenshots/spec06-pipeline-full-desktop-${scheme}.png`, fullPage: true });
    });

    test('Step dialog on Percentage with three rows, and on Amount', async ({ page, me }) => {
      await seedPipeline(me.seed);
      await gotoPipeline(page);
      const d = await openAddStep(page, 'Fund payout');
      await fillShares(d, [['Needs', '50'], ['Wants', '30'], ['Savings', '20']]);
      await shot(page, `spec06-step-dialog-percentage-desktop-${scheme}`);
      await takes(d, 'Amount').check();
      await d.getByLabel('Section', { exact: true }).selectOption({ label: 'Family' });
      await amountField(d).fill('500');
      await shot(page, `spec06-step-dialog-amount-desktop-${scheme}`);
      await page.keyboard.press('Escape');
      await step(page, 'Step 3: 50% to Needs, 30% to Wants, 20% to Savings').click();
      await shot(page, `spec06-step-dialog-edit-desktop-${scheme}`);
    });

    test('Source dialog, adding and editing', async ({ page, me }) => {
      await seedPipeline(me.seed);
      await gotoPipeline(page);
      await page.getByRole('button', { name: 'Add income source', exact: true }).first().click();
      const d = dialog(page);
      await d.getByLabel('Name', { exact: true }).fill('Side gig');
      await d.getByLabel('Box', { exact: true }).selectOption({ label: 'With Paycheck and Second job' });
      await shot(page, `spec06-source-dialog-add-desktop-${scheme}`);
      await page.keyboard.press('Escape');
      const e = await openEditSource(page, 'Fund payout');
      await shot(page, `spec06-source-dialog-edit-desktop-${scheme}`);
      await e.getByLabel('Box', { exact: true }).selectOption({ label: 'With Paycheck and Second job' });
      await shot(page, `spec06-source-dialog-edit-moved-desktop-${scheme}`);
    });

    test('Income dialog with the source panel open', async ({ page, me }) => {
      await seedPipeline(me.seed);
      await page.goto('/budget');
      await page.getByRole('button', { name: 'Add income', exact: true }).click();
      const d = dialog(page);
      await shot(page, `spec06-income-dialog-desktop-${scheme}`);
      await chip(d, 'Source', '+ Add source').check();
      await d.getByLabel('Source name').fill('Side gig');
      await shot(page, `spec06-income-dialog-source-panel-desktop-${scheme}`);
    });

    test('Budget page with the worked example, on desktop and on a phone', async ({ page, me }) => {
      await seedPipeline(me.seed);
      const sub = await me.seed.subsection((await (await page.request.get('/api/sections')).json()).sections[2].id, 'Food', 30000);
      void sub;
      await page.goto('/budget');
      await expect(bsection(page, 'Needs')).toBeVisible();
      await expect(leftOverStat(page)).toContainText(WORKED.leftOver);
      await shot(page, `spec06-budget-desktop-${scheme}`);
      await page.screenshot({ path: `screenshots/spec06-budget-full-desktop-${scheme}.png`, fullPage: true });
      await page.setViewportSize(phone);
      await page.goto('/budget');
      await expect(leftOverStat(page)).toContainText(WORKED.leftOver);
      await shot(page, `spec06-budget-phone-${scheme}`);
      await page.screenshot({ path: `screenshots/spec06-budget-full-phone-${scheme}.png`, fullPage: true });
    });
  });
}
