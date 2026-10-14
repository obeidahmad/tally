import { test, expect, dialog, shot, group, chip, seedBudget } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 05: the Segmented control in the transaction dialog (Type). Spec 06 removed the section dialog's Budget control.
const sizes = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
  narrow: { width: 360, height: 740 },
} as const;


// Token values from the spec's table, as the browser reports them.
const TOKENS = {
  light: { surface: 'rgb(255, 255, 255)', sunken: 'rgb(236, 238, 233)', ink: 'rgb(20, 26, 24)', muted: 'rgb(86, 97, 93)' },
  dark: { surface: 'rgb(26, 30, 28)', sunken: 'rgb(12, 14, 13)', ink: 'rgb(238, 241, 238)', muted: 'rgb(167, 176, 172)' },
} as const;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const track = (d: Locator, legend: string) => group(d, legend).locator('.ty-segmented');
const segments = (d: Locator, legend: string) => track(d, legend).locator('label');
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

  });
}

// ---- criterion 11 ----
for (const [size, viewport] of Object.entries(sizes)) {
  test(`${size}: the "Type", "Pocket" and "Emoji" legends start at the same left edge as the "Name" or "Date" label`, async ({ page, me }) => {
    await page.setViewportSize(viewport);
    await seedBudget(me.seed);

    await page.goto('/budget');
    let d = await openAddTransaction(page);
    const dateLeft = await textLeft(label(d, 'Date'));
    for (const legend of ['Type', 'Pocket']) {
      const l = d.locator('legend', { hasText: new RegExp(`^${legend}$`) });
      expect(Math.abs((await textLeft(l)) - dateLeft), legend).toBeLessThanOrEqual(0.5);
    }
    await chip(d, 'Type', 'Income').check();
    expect(Math.abs((await textLeft(d.locator('legend', { hasText: /^Source$/ }))) - dateLeft), 'Source').toBeLessThanOrEqual(0.5);
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

// ---- screenshots: the transaction dialog on Expense and on Income ----
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

