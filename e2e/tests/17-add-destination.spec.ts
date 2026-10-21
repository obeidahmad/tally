import { test, expect, dialog, group, shot, seedPipeline } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 07: "+ Add destination". Browser acceptance criteria 2 to 8 and the screenshots of 9.
test.use({ viewport: { width: 1280, height: 900 } });

const HINT = 'Each destination takes its percentage from what reaches this step. Together they can be at most 100%.';
// The old words, split so that this file does not itself contain them (criterion 6).
const OLD = ['Add another ' + 'section', 'Remove ' + 'row', 'Each percentage is ' + 'taken'];
// rgb of --line-strong and --surface from the spec
const PAINT = {
  light: { border: 'rgb(214, 210, 203)', bg: 'rgb(255, 255, 255)' },
  dark: { border: 'rgb(58, 58, 64)', bg: 'rgb(29, 29, 32)' },
};

const add = (d: Locator) => d.getByRole('button', { name: '+ Add destination', exact: true });
const removes = (d: Locator) => d.getByRole('button', { name: /^Remove destination/ });
const sectionSel = (d: Locator, n: number) => d.getByLabel(`Section ${n}`, { exact: true });
const pctInput = (d: Locator, n: number) => d.getByLabel(`Percentage ${n}`, { exact: true });
const takes = (d: Locator, which: 'Percentage' | 'Amount') => group(d, 'Takes').getByRole('radio', { name: which, exact: true });
const visibleText = (d: Locator) => d.evaluate((e) => (e as HTMLElement).innerText + '\n' + [...e.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).join('\n'));

async function gotoPipeline(page: Page) {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
}
/** The add dialog of the box that holds a source (no steps in "Fund payout"). */
async function openAdd(page: Page, source = 'Fund payout') {
  const b = page.locator('.ty-pipe__col').nth(0).locator('.ty-node').filter({ hasText: source });
  await b.getByRole('button', { name: 'Add step', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add step' })).toBeVisible();
  return d;
}
async function openEdit(page: Page) {
  await page.getByRole('button', { name: 'Step 3: 50% to Needs, 30% to Wants, 20% to Savings', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit step' })).toBeVisible();
  return d;
}

// ============ criterion 2: the button, its classes and its colours ============
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the button (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const which of ['add', 'edit'] as const) {
      test(`${which} step dialog on "Percentage" has one outlined "+ Add destination" button (${scheme})`, async ({ page, me }) => {
        await seedPipeline(me.seed);
        await gotoPipeline(page);
        const d = which === 'add' ? await openAdd(page) : await openEdit(page);
        await expect(takes(d, 'Percentage')).toBeChecked();
        await expect(add(d)).toHaveCount(1);
        await expect(add(d)).toHaveClass(/(^|\s)ty-btn(\s|$)/);
        await expect(add(d)).toHaveClass(/(^|\s)ty-btn--sm(\s|$)/);
        await expect(add(d)).not.toHaveClass(/ty-btn--quiet/);
        await expect.poll(() => add(d).evaluate((e) => {
          const cs = getComputedStyle(e);
          return { border: cs.borderTopColor, width: cs.borderTopWidth, bg: cs.backgroundColor };
        })).toEqual({ border: PAINT[scheme].border, width: '1px', bg: PAINT[scheme].bg });
      });
    }
  });
}

// ============ criterion 3: adding rows ============
test('pressing "+ Add destination" adds one empty row named with the next number, up to 8; none on "Amount"', async ({ page, me }) => {
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) await me.seed.section(n);
  const src = await me.seed.source('Paycheck');
  expect(src.id).toBeGreaterThan(0);
  await gotoPipeline(page);
  const d = await openAdd(page, 'Paycheck');
  await expect(d.locator('.ty-shares select')).toHaveCount(1);
  for (let n = 2; n <= 8; n++) {
    await add(d).click();
    await expect(d.locator('.ty-shares select')).toHaveCount(n);
    await expect(sectionSel(d, n)).toHaveValue('');
    await expect(pctInput(d, n)).toHaveValue('');
  }
  await expect(add(d)).toHaveCount(0); // 8 rows: not shown
  await removes(d).first().click();
  await expect(add(d)).toBeVisible(); // 7 rows: back
  await takes(d, 'Amount').check();
  await expect(add(d)).toHaveCount(0);
  await takes(d, 'Percentage').check();
  await expect(add(d)).toBeVisible();
});

// ============ criterion 4: remove buttons ============
test('with one row there is no remove button; with two or more every row has "Remove destination N" and pressing one removes that row', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  const d = await openAdd(page);
  await expect(removes(d)).toHaveCount(0);
  await add(d).click();
  await add(d).click();
  await expect(removes(d)).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    const b = d.getByRole('button', { name: `Remove destination ${n}`, exact: true });
    await expect(b).toBeVisible();
    await expect(b).toHaveText('Remove');
    await expect(b).toHaveClass(/ty-btn--quiet/);
    await expect(b).toHaveClass(/ty-btn--sm/);
  }
  await sectionSel(d, 1).selectOption({ label: 'Needs' });
  await sectionSel(d, 2).selectOption({ label: 'Wants' });
  await sectionSel(d, 3).selectOption({ label: 'Savings' });
  await d.getByRole('button', { name: 'Remove destination 2', exact: true }).click();
  await expect(d.locator('.ty-shares select')).toHaveCount(2);
  await expect(sectionSel(d, 1).locator('option:checked')).toHaveText('Needs');
  await expect(sectionSel(d, 2).locator('option:checked')).toHaveText('Savings');
  await expect(removes(d)).toHaveCount(2);
  await d.getByRole('button', { name: 'Remove destination 1', exact: true }).click();
  await expect(d.locator('.ty-shares select')).toHaveCount(1);
  await expect(sectionSel(d, 1).locator('option:checked')).toHaveText('Savings');
  await expect(removes(d)).toHaveCount(0);
});

// ============ criteria 5 and 6: the hint, and the old words gone ============
test('the hint under the button reads the new sentence, and the old words appear nowhere in the dialog or the built files', async ({ page, me, baseURL }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  for (const open of ['add', 'edit'] as const) {
    const d = open === 'add' ? await openAdd(page) : await openEdit(page);
    await expect(d.getByText(HINT, { exact: true })).toBeVisible();
    await add(d).click(); // the hint stays with rows added
    await expect(d.getByText(HINT, { exact: true })).toHaveCount(1);
    const t = await visibleText(d);
    for (const w of OLD) expect(t, `${open}: "${w}"`).not.toContain(w);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
  }
  const html = await (await page.request.get('/')).text();
  const srcs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) {
    const body = await (await page.request.get(baseURL + s)).text();
    for (const w of OLD) expect(body, `${s}: "${w}"`).not.toContain(w);
  }
});

// ============ criterion 7: the page's "Add section" is untouched ============
test('"Add section" on the Pipeline page still opens the section dialog titled "Add section"', async ({ page, me }) => {
  expect(me.seed).toBeTruthy(); // `me` signs the page in
  await gotoPipeline(page);
  await page.getByRole('button', { name: 'Add section', exact: true }).first().click();
  await expect(dialog(page).getByRole('heading', { name: 'Add section' })).toBeVisible();
  await expect(add(dialog(page))).toHaveCount(0);
});

// ============ criterion 8: two destinations are one step ============
test('a step saved with two destinations shows as one step with one number and two rows', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await gotoPipeline(page);
  const d = await openAdd(page);
  await sectionSel(d, 1).selectOption({ label: 'Needs' });
  await pctInput(d, 1).fill('60');
  await add(d).click();
  await sectionSel(d, 2).selectOption({ label: 'Wants' });
  await pctInput(d, 2).fill('40');
  await d.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(d).toBeHidden();
  const s = page.getByRole('button', { name: 'Step 1: 60% to Needs, 40% to Wants', exact: true });
  await expect(s).toHaveCount(1);
  await expect(s.locator('.ty-step')).toHaveCount(2);
});

// ============ criterion 9: screenshots, desktop, light and dark ============
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`screenshots ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test('step dialog on Percentage with one row, and with three rows', async ({ page, me }) => {
      await seedPipeline(me.seed);
      await gotoPipeline(page);
      const d = await openAdd(page);
      await shot(page, `spec07-step-dialog-one-row-desktop-${scheme}`);
      await add(d).click();
      await add(d).click();
      await sectionSel(d, 1).selectOption({ label: 'Needs' });
      await pctInput(d, 1).fill('50');
      await sectionSel(d, 2).selectOption({ label: 'Wants' });
      await pctInput(d, 2).fill('30');
      await sectionSel(d, 3).selectOption({ label: 'Savings' });
      await pctInput(d, 3).fill('20');
      await shot(page, `spec07-step-dialog-three-rows-desktop-${scheme}`);
    });
  });
}
