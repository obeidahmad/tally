import { test, expect, dialog, shot, group, chip, seedBudget } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 05: the Segmented control in the section dialog (Budget) and the transaction dialog (Type).
const sizes = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
  narrow: { width: 360, height: 740 },
} as const;

const PCT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';
const HINT = "Of the month's income left after fixed-amount sections.";
const SUB_LINE = "The total of its subsections' budgets.";

// Token values from the spec's table, as the browser reports them.
const TOKENS = {
  light: { surface: 'rgb(255, 255, 255)', sunken: 'rgb(236, 238, 233)', ink: 'rgb(20, 26, 24)', muted: 'rgb(86, 97, 93)' },
  dark: { surface: 'rgb(26, 30, 28)', sunken: 'rgb(12, 14, 13)', ink: 'rgb(238, 241, 238)', muted: 'rgb(167, 176, 172)' },
} as const;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const nameField = (d: Locator) => d.getByLabel('Name', { exact: true });
const pctField = (d: Locator) => d.getByLabel('Percentage', { exact: true }).and(d.locator('input:not([type=radio])'));
const track = (d: Locator, legend: string) => group(d, legend).locator('.ty-segmented');
const segments = (d: Locator, legend: string) => track(d, legend).locator('label');
const sec = (page: Page, name: string): Locator =>
  page.locator('.ty-section').filter({ has: page.locator('.ty-shead__name b', { hasText: new RegExp(`^${name}$`) }) });
const pill = (s: Locator) => s.locator('.ty-shead .ty-pill');
const rule = (s: Locator) => s.locator('.ty-shead__name .ty-cap:not(.ty-shead__sub)');
const sectionsApi = async (page: Page) =>
  (await (await page.request.get('/api/sections')).json()).sections as { name: string; budgetKind: string; budgetMinor: number | null; budgetBasisPoints: number | null }[];

async function openAddSection(page: Page) {
  await page.getByRole('button', { name: 'Add section' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add section' })).toBeVisible();
  await page.waitForTimeout(300); // the dialog fade
  return d;
}
async function openAddTransaction(page: Page) {
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  await page.waitForTimeout(300);
  return d;
}

/** Left edge of the text a label or legend shows (not of its box). */
const textLeft = (l: Locator) =>
  l.evaluate((e) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getBoundingClientRect().left;
    }
    return e.getBoundingClientRect().left;
  });
const label = (d: Locator, text: string) => d.locator('.ty-label', { hasText: new RegExp(`^${text}$`) }).first();

// ---- criterion 2 ----
test('section dialog: "Budget" is one radio group of "Percentage", "Fixed amount", "Subsections", in that order, inside a ty-segmented, and the dialog has no ty-chip', async ({ page, me }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/budget');
  const d = await openAddSection(page);
  const g = group(d, 'Budget');
  await expect(g).toBeVisible();
  await expect(g.locator('.ty-segmented')).toHaveCount(1);
  await expect(g.locator('.ty-segmented').getByRole('radio')).toHaveCount(3);
  await expect(g.getByRole('radio')).toHaveCount(3);
  await expect(segments(d, 'Budget')).toHaveText(['Percentage', 'Fixed amount', 'Subsections']);
  expect(await g.getByRole('radio').evaluateAll((rs) => new Set(rs.map((r) => (r as HTMLInputElement).name)).size), 'one radio group').toBe(1);
  await expect(d.locator('.ty-chip')).toHaveCount(0);
  for (const old of ['Sum of subsections', 'Percentage of income']) await expect(page.getByText(old)).toHaveCount(0);
});

// ---- criterion 3 ----
test('"Add section" opens on "Percentage" with an empty field and its hint; saving without a percentage shows the error and adds no section', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAddSection(page);
  await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
  await expect(pctField(d)).toBeVisible();
  await expect(pctField(d)).toHaveValue('');
  await expect(d.getByText(HINT)).toBeVisible();
  await nameField(d).fill('Needs');
  await d.getByRole('button', { name: 'Add section', exact: true }).click();
  await expect(d.getByText(PCT_ERROR)).toBeVisible();
  await expect(pctField(d)).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
  expect(await sectionsApi(page)).toHaveLength(0);
});

// ---- criterion 4 ----
test('"Fixed amount" shows "Monthly budget"; "Subsections" shows no field and the line "The total of its subsections\' budgets." in ty-cap', async ({ page, me }) => {
  await page.goto('/budget');
  const d = await openAddSection(page);
  await expect(d.getByText(SUB_LINE)).toHaveCount(0);
  await chip(d, 'Budget', 'Fixed amount').check();
  await expect(d.getByLabel('Monthly budget', { exact: true })).toBeVisible();
  await expect(pctField(d)).toHaveCount(0);
  await expect(d.getByText(SUB_LINE)).toHaveCount(0);
  await chip(d, 'Budget', 'Subsections').check();
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
  await expect(pctField(d)).toHaveCount(0);
  await expect(d.getByText(HINT)).toHaveCount(0);
  await expect(d.getByText(SUB_LINE)).toBeVisible();
  await expect(d.locator('.ty-cap', { hasText: SUB_LINE })).toHaveCount(1);
  await expect(d.locator('input:not([type=radio])')).toHaveCount(1); // only Name
  await chip(d, 'Budget', 'Percentage').check();
  await expect(d.getByText(SUB_LINE)).toHaveCount(0);
});

// ---- criterion 5 ----
test('a section saved on each choice shows on the Budget page as spec 04 says', async ({ page, me }) => {
  await page.setViewportSize(sizes.desktop);
  await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 }); // so "after fixed sections" has context
  await page.goto('/budget');
  for (const [name, kind, value] of [['Needs', 'Percentage', '50'], ['Rent', 'Fixed amount', '400'], ['Fun', 'Subsections', '']] as const) {
    const d = await openAddSection(page);
    await nameField(d).fill(name);
    await chip(d, 'Budget', kind).check();
    if (kind === 'Percentage') await pctField(d).fill(value);
    if (kind === 'Fixed amount') await d.getByLabel('Monthly budget', { exact: true }).fill(value);
    await d.getByRole('button', { name: 'Add section', exact: true }).click();
    await expect(d).toBeHidden();
    await expect(sec(page, name)).toBeVisible();
  }
  await expect(rule(sec(page, 'Needs'))).toHaveText('50% of income after fixed sections');
  await expect(pill(sec(page, 'Needs'))).toHaveCount(1);
  await expect(rule(sec(page, 'Rent'))).toHaveText('Fixed amount');
  await expect(pill(sec(page, 'Rent'))).toHaveCount(1);
  await expect(pill(sec(page, 'Fun'))).toHaveCount(0);
  await expect(rule(sec(page, 'Fun'))).toHaveCount(0);
  const made = await sectionsApi(page);
  expect(made.find((s) => s.name === 'Needs')).toMatchObject({ budgetKind: 'percent', budgetBasisPoints: 5000, budgetMinor: null });
  expect(made.find((s) => s.name === 'Rent')).toMatchObject({ budgetKind: 'fixed', budgetMinor: 40000, budgetBasisPoints: null });
  expect(made.find((s) => s.name === 'Fun')).toMatchObject({ budgetKind: 'subsections', budgetMinor: null, budgetBasisPoints: null });
});

// ---- criterion 6 ----
test('"Edit" opens on the section\'s own choice with its value filled in; a section from before spec 04 opens on "Subsections"', async ({ page, me }) => {
  await page.setViewportSize(sizes.desktop);
  await me.seed.section('Home', { budgetKind: 'fixed', budgetMinor: 90000 });
  await me.seed.section('Zakat', { budgetKind: 'percent', budgetBasisPoints: 250 });
  await me.seed.section('Old'); // no budget fields: the same as a section from before spec 04
  await page.goto('/budget');
  const d = dialog(page);
  const edit = (n: string) => sec(page, n).getByRole('button', { name: 'Edit', exact: true }).click();

  await edit('Home');
  await expect(d.getByRole('heading', { name: 'Edit section' })).toBeVisible();
  await expect(chip(d, 'Budget', 'Fixed amount')).toBeChecked();
  await expect(d.getByLabel('Monthly budget', { exact: true })).toHaveValue('900.00');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await edit('Zakat');
  await expect(chip(d, 'Budget', 'Percentage')).toBeChecked();
  await expect(pctField(d)).toHaveValue('2.5');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await edit('Old');
  await expect(chip(d, 'Budget', 'Subsections')).toBeChecked();
  await expect(d.getByText(SUB_LINE)).toBeVisible();
  await expect(pctField(d)).toHaveCount(0);
  await expect(d.getByLabel('Monthly budget')).toHaveCount(0);
});

// ---- criterion 7 ----
test('transaction dialog: "Type" is a ty-segmented of "Expense" and "Income"; title, button label and colour follow it; Pocket is still ty-chips', async ({ page, me }) => {
  await page.setViewportSize(sizes.desktop);
  await seedBudget(me.seed);
  await page.goto('/budget');
  const d = await openAddTransaction(page);
  const g = group(d, 'Type');
  await expect(g.locator('.ty-segmented')).toHaveCount(1);
  await expect(segments(d, 'Type')).toHaveText(['Expense', 'Income']);
  await expect(g.getByRole('radio')).toHaveCount(2);
  await expect(g.locator('.ty-chip')).toHaveCount(0);
  await expect(chip(d, 'Type', 'Expense')).toBeChecked();
  await expect(d.getByRole('button', { name: 'Add expense', exact: true })).toHaveClass(/ty-btn--spend/);
  await expect(d.getByLabel('Subsection')).toBeVisible();

  await chip(d, 'Type', 'Income').check();
  await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Add income', exact: true })).toHaveClass(/ty-btn--income/);
  await expect(d.getByLabel('Subsection')).toBeHidden();

  await chip(d, 'Type', 'Expense').check();
  await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();

  const pocketChips = group(d, 'Pocket').locator('label.ty-chip');
  await expect(pocketChips).toHaveCount(2); // Revolut and "+ Add pocket"
  await expect(group(d, 'Pocket').locator('.ty-segmented')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
  await expect(chip(d, 'Type', 'Income')).toBeChecked();
  await expect(chip(d, 'Type', 'Expense')).not.toBeChecked();
});

// ---- criterion 8 ----
for (const [size, viewport] of Object.entries(sizes)) {
  test.describe(`geometry at ${viewport.width}px`, () => {
    test.use({ viewport });

    /** One line, equal widths, as wide as the reference input, and the right height. */
    async function checkTrack(page: Page, d: Locator, legend: string, reference: Locator, what: string) {
      const t = (await track(d, legend).boundingBox())!;
      const r = (await reference.boundingBox())!;
      expect(Math.abs(t.width - r.width), `${what}: as wide as its form (${t.width} vs ${r.width})`).toBeLessThanOrEqual(1);
      if (viewport.width > 640) expect(Math.abs(t.height - 40), `${what}: 40px tall (${t.height})`).toBeLessThanOrEqual(0.5);
      else expect(t.height, `${what}: at least 44px tall`).toBeGreaterThanOrEqual(44);
      const boxes = await segments(d, legend).evaluateAll((ls) => ls.map((l) => { const b = l.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      for (const b of boxes) {
        expect(Math.abs(b.y - boxes[0].y), `${what}: one line`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.w - boxes[0].w), `${what}: equal widths ${JSON.stringify(boxes)}`).toBeLessThanOrEqual(1);
        expect(b.x + b.w, `${what}: inside the control`).toBeLessThanOrEqual(t.x + t.width + 0.5);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].x, `${what}: side by side`).toBeGreaterThan(boxes[i - 1].x);
      expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `${what}: no sideways scroll`).toBe(true);
      if (viewport.width <= 640) {
        const inputs = await segments(d, legend).locator('input').evaluateAll((is) => is.map((i) => i.getBoundingClientRect().height));
        for (const h of inputs) expect.soft(h, `${what}: each radio input is at least 44px tall (${inputs})`).toBeGreaterThanOrEqual(44);
        // a press in the top 3px of the track, above the outlined shape, still chooses the segment
        const n = boxes.length;
        for (const i of [...Array(n).keys()].reverse()) {
          // measured again each time: choosing a segment can change the form's height and move a bottom sheet
          const tb = (await track(d, legend).boundingBox())!;
          await page.mouse.click(boxes[i].x + boxes[i].w / 2, tb.y + 1.5);
          await expect(segments(d, legend).nth(i).locator('input'), `${what}: top-edge press on segment ${i}`).toBeChecked();
        }
      }
    }

    test(`${size}: the Budget segments of the section dialog fit on one line, on every choice`, async ({ page, me }) => {
      await page.goto('/budget');
      const d = await openAddSection(page);
      for (const kind of ['Percentage', 'Fixed amount', 'Subsections'] as const) {
        await chip(d, 'Budget', kind).check();
        await checkTrack(page, d, 'Budget', nameField(d), `Budget on ${kind}`);
      }
    });

    for (const type of ['Expense', 'Income'] as const) {
      test(`${size}: the Type segments of the transaction dialog fit on one line, on ${type}`, async ({ page, me }) => {
        await seedBudget(me.seed);
        await page.goto('/budget');
        const d = await openAddTransaction(page);
        await chip(d, 'Type', type).check();
        await checkTrack(page, d, 'Type', d.getByLabel('Date'), `Type on ${type}`);
      });
    }
  });
}

// ---- criteria 9 and 10: colours and keyboard, in light and dark ----
for (const scheme of ['light', 'dark'] as const) {
  const t = TOKENS[scheme];
  const paint = (l: Locator) =>
    l.evaluate((e) => {
      const cs = getComputedStyle(e);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, fg: cs.color };
    });

  /** Waits out the 150ms colour change before comparing. */
  async function checkColours(d: Locator, legend: string, chosen: number, what: string) {
    const labels = segments(d, legend);
    const n = await labels.count();
    await expect.poll(async () => (await track(d, legend).evaluate((e) => getComputedStyle(e).backgroundColor)), `${what}: track`).toBe(t.sunken);
    for (let i = 0; i < n; i++) {
      if (i === chosen) await expect.poll(() => paint(labels.nth(i)), `${what}: chosen segment`).toEqual({ bg: t.surface, border: t.ink, fg: t.ink });
      else {
        await expect.poll(async () => (await paint(labels.nth(i))).bg, `${what}: segment ${i} has no background`).toBe(TRANSPARENT);
        await expect.poll(async () => (await paint(labels.nth(i))).fg, `${what}: segment ${i} text`).toBe(t.muted);
      }
    }
  }

  test.describe(`colours and keyboard (${scheme})`, () => {
    test.use({ colorScheme: scheme, viewport: sizes.desktop });

    test(`section dialog: track, chosen and other segments use the tokens (${scheme})`, async ({ page, me }) => {
      await page.goto('/budget');
      const d = await openAddSection(page);
      await checkColours(d, 'Budget', 0, 'Percentage');
      await chip(d, 'Budget', 'Fixed amount').check();
      await checkColours(d, 'Budget', 1, 'Fixed amount');
      await chip(d, 'Budget', 'Subsections').check();
      await checkColours(d, 'Budget', 2, 'Subsections');
    });

    test(`transaction dialog: track, chosen and other segments use the tokens (${scheme})`, async ({ page, me }) => {
      await seedBudget(me.seed);
      await page.goto('/budget');
      const d = await openAddTransaction(page);
      await checkColours(d, 'Type', 0, 'Expense');
      await chip(d, 'Type', 'Income').check();
      await checkColours(d, 'Type', 1, 'Income');
    });

    const focus = (page: Page) =>
      page.evaluate(() => {
        const e = document.activeElement as HTMLInputElement;
        const ringed = (e.matches('input[type=radio]') && e.closest('label')) || e;
        const cs = getComputedStyle(ringed);
        return {
          radio: e.matches('input[type=radio]'),
          name: (e.labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? '').trim(),
          legend: e.closest('fieldset')?.querySelector('legend')?.textContent?.trim() ?? '',
          style: cs.outlineStyle,
          width: cs.outlineWidth,
        };
      });

    test(`transaction dialog keyboard: arrow keys move the Type choice, Tab leaves it, the chosen segment shows the focus ring (${scheme})`, async ({ page, me }) => {
      await seedBudget(me.seed);
      await page.goto('/budget');
      const d = await openAddTransaction(page);
      await chip(d, 'Type', 'Expense').focus();
      // a script focus() is not focus-visible, so the keys below are what show the ring
      await page.keyboard.press('ArrowRight');
      await expect(chip(d, 'Type', 'Income')).toBeChecked();
      await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
      expect(await focus(page)).toMatchObject({ radio: true, name: 'Income', legend: 'Type', style: 'solid', width: '2px' });
      await shot(page, `spec05-focus-type-desktop-${scheme}`);
      await page.keyboard.press('ArrowLeft');
      await expect(chip(d, 'Type', 'Expense')).toBeChecked();
      expect(await focus(page)).toMatchObject({ radio: true, name: 'Expense', style: 'solid', width: '2px' });
      await page.keyboard.press('Tab');
      const after = await focus(page);
      expect(after.legend === 'Type' && after.radio, 'Tab leaves the control').toBe(false);
      await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible(); // Tab does not change the choice
    });

    test(`section dialog keyboard: arrow keys move the Budget choice, Tab leaves it, the chosen segment shows the focus ring (${scheme})`, async ({ page, me }) => {
      await page.goto('/budget');
      const d = await openAddSection(page);
      await chip(d, 'Budget', 'Percentage').focus();
      await page.keyboard.press('ArrowRight');
      await expect(chip(d, 'Budget', 'Fixed amount')).toBeChecked();
      expect(await focus(page)).toMatchObject({ radio: true, name: 'Fixed amount', legend: 'Budget', style: 'solid', width: '2px' });
      await page.keyboard.press('ArrowRight');
      await expect(chip(d, 'Budget', 'Subsections')).toBeChecked();
      await page.keyboard.press('Tab');
      const after = await focus(page);
      expect(after.legend === 'Budget' && after.radio, 'Tab leaves the control').toBe(false);
      await expect(chip(d, 'Budget', 'Subsections')).toBeChecked();
    });
  });
}

// ---- criterion 11 ----
for (const [size, viewport] of Object.entries(sizes)) {
  test(`${size}: the "Budget", "Type", "Pocket" and "Emoji" legends start at the same left edge as the "Name" or "Date" label`, async ({ page, me }) => {
    await page.setViewportSize(viewport);
    await seedBudget(me.seed);

    await page.goto('/budget');
    let d = await openAddSection(page);
    const nameLeft = await textLeft(label(d, 'Name'));
    expect(Math.abs((await textLeft(d.locator('legend', { hasText: /^Budget$/ }))) - nameLeft), 'Budget').toBeLessThanOrEqual(0.5);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();

    d = await openAddTransaction(page);
    const dateLeft = await textLeft(label(d, 'Date'));
    for (const legend of ['Type', 'Pocket']) {
      const l = d.locator('legend', { hasText: new RegExp(`^${legend}$`) });
      expect(Math.abs((await textLeft(l)) - dateLeft), legend).toBeLessThanOrEqual(0.5);
    }
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();

    await page.goto('/pockets');
    await page.getByRole('button', { name: 'Add pocket' }).first().click();
    d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Add pocket' })).toBeVisible();
    await page.waitForTimeout(300);
    const pocketName = await textLeft(label(d, 'Name'));
    const emoji = d.locator('legend', { hasText: /^Emoji$/ });
    expect(Math.abs((await textLeft(emoji)) - pocketName), 'Emoji').toBeLessThanOrEqual(0.5);
  });
}

// ---- screenshots: the transaction dialog on Expense and on Income (the section dialog's are in 14-section-budget) ----
for (const [size, viewport] of [['desktop', sizes.desktop], ['phone', sizes.phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshots ${size} ${scheme}: transaction dialog on Expense and on Income`, async ({ page, me }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(viewport);
      await seedBudget(me.seed);
      await page.goto('/budget');
      const d = await openAddTransaction(page);
      await shot(page, `spec05-transaction-expense-${size}-${scheme}`);
      await chip(d, 'Type', 'Income').check();
      await shot(page, `spec05-transaction-income-${size}-${scheme}`);
    });
  }
}

