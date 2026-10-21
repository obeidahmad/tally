import { test, expect, dialog, toast, shot, row, chip, em, EMOJI, seedBudget, monthTitle, fillExpense, bsection } from '../support/fixtures';
import type { Page } from '@playwright/test';

const heading = (page: Page) => page.getByRole('heading', { level: 1 }).first();
// Focus must be there and stay there once lists and toasts have settled.
const onHeading = async (page: Page, what: string) => {
  await expect(heading(page), what).toBeFocused();
  await page.waitForTimeout(400);
  await expect(heading(page), `${what} (after settling)`).toBeFocused();
};

// ---- criterion 9, every page: focus goes to the heading when a page flips between empty and list ----
test('Pockets: deleting the last pocket and then Undo both leave focus on the heading', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 5000);
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText('No pockets yet', { exact: false })).toBeVisible();
  await onHeading(page, 'after deleting the last pocket');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, /Revolut/)).toBeVisible();
  await onHeading(page, 'after Undo');
});

test('Transactions: deleting the last transaction and then Undo both leave focus on the heading', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  const f = await me.seed.subsection(s.id, 'Food', 10000);
  const p = await me.seed.pocket('Revolut', 5000);
  await me.seed.expense(p.id, f.id, 500, 'Only one');
  await page.goto('/transactions');
  await row(page, /Only one/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(`No transactions in ${monthTitle()}.`)).toBeVisible();
  await onHeading(page, 'after deleting the last transaction');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, /Only one/)).toBeVisible();
  await onHeading(page, 'after Undo');
});

test('Transactions: adding the first transaction from the empty card leaves focus on the heading', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Food', 10000);
  await me.seed.pocket('Revolut', 5000);
  await page.goto('/transactions');
  await expect(page.getByText(`No transactions in ${monthTitle()}.`)).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction' }).last().click();
  const d = dialog(page);
  await fillExpense(d, { amount: '4', payee: 'First one', subsection: 'Food', pocket: /Revolut/ });
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /First one/)).toBeVisible();
  await onHeading(page, 'after adding the first transaction');
});

test('Budget: deleting the last section and then Undo both leave focus on the heading', async ({ page, me }) => {
  await me.seed.section('Savings');
  await page.goto('/budget');
  await bsection(page, 'Savings').getByRole('button', { name: /^Edit / }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText('No sections yet', { exact: false })).toBeVisible();
  await onHeading(page, 'after deleting the last section');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(bsection(page, 'Savings')).toBeVisible();
  await onHeading(page, 'after Undo');
});

test('Pockets: adding the first pocket and deleting it again both leave focus on the heading', async ({ page, me }) => {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  await dialog(page).getByLabel('Name').fill('Jar');
  await dialog(page).getByRole('button', { name: 'Add pocket' }).click();
  await onHeading(page, 'after adding the first pocket');
  // and the opposite flow: deleting it again
  await row(page, /Jar/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await onHeading(page, 'after deleting it again');
});

// ---- criterion 12: changing a filter or the month never moves focus, even to an empty result ----
test('Transactions: a filter or the month changed to a result with no rows keeps focus on that select', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  await me.seed.pocket('Empty pocket', 0, 'cash');
  void b;
  await page.goto('/transactions');
  await expect(row(page, /Alphamega/)).toBeVisible();

  const cases: [string, (s: import('@playwright/test').Locator) => Promise<void>][] = [
    ['Pocket', async (s) => {
      const labels = await s.locator('option').allTextContents();
      await s.selectOption({ index: labels.findIndex((l) => l.includes('Empty pocket')) });
    }],
    ['Subsection', (s) => s.selectOption({ label: 'Gifts' })], // a subsection with a budget of 0 and no transactions
    ['Month', async (s) => {
      const labels = await s.locator('option').allTextContents();
      const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
      await s.selectOption({ label: monthTitle(prev) });
      expect(labels.length).toBeGreaterThan(1);
    }],
  ];
  for (const [name, change] of cases) {
    const select = page.getByLabel(name, { exact: true });
    await select.focus();
    await change(select);
    await expect(page.getByText(/^No transactions (in|match)/), `${name}: empty result`).toBeVisible();
    await expect(select, `${name}: focus stays on the select`).toBeFocused();
    await page.waitForTimeout(400);
    await expect(select, `${name}: focus stays on the select (settled)`).toBeFocused();
    await shot(page, `transactions-empty-filter-${name.toLowerCase()}-desktop-light`);
    // back to a non-empty result: focus is still on the select
    await select.selectOption({ index: 0 });
    await expect(row(page, /Alphamega/)).toBeVisible();
    await expect(select).toBeFocused();
  }
});

// ---- criterion 7, strictly: what is drawn in the emoji face is grey, not the device's colour emoji ----
test('the emoji face paints only shades of grey: a colour emoji font would ignore the fill colour', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 0, 'bank');
  await page.goto('/pockets');
  const mark = page.locator('.ty-emoji').first();
  await expect(mark).toBeVisible();
  const result = await mark.evaluate(async (el, cps) => {
    const family = getComputedStyle(el).fontFamily; // the app's own stack, so a missing face falls back to the device's
    await document.fonts.load(`700 48px ${family}`, 'A');
    await document.fonts.ready;
    const out: { cp: number; painted: number; coloured: number; spread: number }[] = [];
    for (const cp of cps) {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.font = `700 48px ${family}`;
      g.fillStyle = '#000';
      g.textBaseline = 'middle';
      await document.fonts.load(g.font, String.fromCodePoint(cp));
      g.fillText(String.fromCodePoint(cp), 8, 48);
      const d = g.getImageData(0, 0, 96, 96).data;
      let painted = 0, coloured = 0, spread = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        painted++;
        spread = Math.max(spread, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 2) coloured++;
      }
      out.push({ cp, painted, coloured, spread });
    }
    return out;
  }, EMOJI.map(([cp]) => cp));
  for (const r of result) {
    const name = EMOJI.find(([cp]) => cp === r.cp)![1];
    expect(r.painted, `${name}: something is drawn`).toBeGreaterThan(150);
    expect(r.coloured, `${name}: pixels that are not grey (colour emoji drawn)`).toBe(0);
  }
});

// ---- criterion 11: the primary button is in view with the new-pocket panel open ----
const windows = [
  ['desktop', { width: 1280, height: 900 }],
  ['desktop short', { width: 1280, height: 560 }],
  ['phone', { width: 390, height: 844 }],
  ['phone short', { width: 390, height: 600 }],
] as const;
for (const [name, viewport] of windows) {
  test.describe(`dialog buttons in view, ${name}`, () => {
    test.use({ viewport });

    test('with the new-pocket fields shown, the primary button and Cancel are inside the window when the dialog opens and after its content is scrolled', async ({ page, me }) => {
      const s = await me.seed.section('Needs');
      await me.seed.subsection(s.id, 'Food', 10000);
      await page.goto('/budget');
      await page.getByRole('button', { name: 'Add income', exact: true }).click();
      const d = dialog(page);
      await expect(d.getByLabel('Pocket', { exact: true })).toBeVisible();
      await page.waitForTimeout(300); // the 150ms fade
      const primary = d.getByRole('button', { name: 'Add income', exact: true });
      const cancel = d.getByRole('button', { name: 'Cancel' });
      const inView = async (what: string) => {
        for (const [n, b] of [['primary', primary], ['Cancel', cancel]] as const) {
          const box = (await b.boundingBox())!;
          expect(box.y, `${what}: ${n} top`).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height, `${what}: ${n} bottom (${viewport.height})`).toBeLessThanOrEqual(viewport.height + 0.5);
          expect(box.x + box.width, `${what}: ${n} right`).toBeLessThanOrEqual(viewport.width + 0.5);
        }
        const dbox = (await d.boundingBox())!;
        expect(dbox.y + dbox.height, `${what}: dialog bottom`).toBeLessThanOrEqual(viewport.height + 0.5);
      };
      await inView('just opened');
      await shot(page, `dialog-buttons-pinned-${name.replace(' ', '-')}-light`);
      const scrollable = await d.evaluate((e) => e.scrollHeight > e.clientHeight);
      await d.evaluate((e) => { e.scrollTop = e.scrollHeight; });
      await page.waitForTimeout(100);
      await inView('scrolled to the bottom');
      await d.evaluate((e) => { e.scrollTop = 0; });
      await page.waitForTimeout(100);
      await inView('scrolled back to the top');
      if (viewport.height <= 600) expect(scrollable, 'the content is taller than a short window, so it scrolls').toBe(true);
    });
  });
}

test('with pockets present, choosing "+ Add pocket" also keeps the primary button in view on a phone', async ({ page, me }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Pocket', '+ Add pocket').check();
  await expect(d.getByLabel('Pocket name')).toBeVisible();
  await page.waitForTimeout(300);
  const box = (await d.getByRole('button', { name: 'Add expense', exact: true }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(700.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
});

// ---- an income row on a phone ----
test.describe('phone rows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an income row\'s third line shows only the pocket (emoji and name); "Income" is not said twice', async ({ page, me }) => {
    const s = await me.seed.section('Needs');
    const f = await me.seed.subsection(s.id, 'Food', 30000);
    const w = await me.seed.pocket('Wallet', 0, 'cash');
    await me.seed.income(w.id, 4100, 'Bonus');
    await me.seed.expense(w.id, f.id, 500, 'Bakery');
    await page.goto('/transactions');
    const inc = row(page, /Bonus/);
    await expect(inc).toBeVisible();
    const text = (await inc.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/entered by hand/i); // spec 21: no filler line
    const meta = inc.locator('.ty-trow__meta');
    await expect(meta).toBeVisible();
    expect((await meta.innerText()).replace(/\s+/g, ' ').trim()).toBe(`${em('Banknote')} Wallet`);
    // an expense still names its subsection on the third line
    const exp = row(page, /Bakery/).locator('.ty-trow__meta');
    expect((await exp.innerText()).replace(/\s+/g, ' ').trim()).toBe(`Food · ${em('Banknote')} Wallet`);
    await shot(page, 'transactions-income-row-phone-light');
  });
});
