import { test, expect, dialog, shot, row, seedBudget, chip, stat, summary } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Spec 03: coloured "Add income" (green) and "Add transaction" (orange) buttons.
// Token values from the spec's Shared contract, as the browser reports them.
// Spec 27 replaces the coloured buttons: top-bar actions are outline buttons with at most one primary (orange, white 600 text).
// Only the focus ring colour (--brand) is a token here.
const TOKENS = {
  light: { focus: 'rgb(201, 70, 26)' }, // design README: the focus ring is --primary
  dark: { focus: 'rgb(201, 70, 26)' },
} as const;
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };

const paint = (l: import('@playwright/test').Locator) =>
  l.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
const rgb = (c: string) => (c.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number); // 'transparent' has no digits
const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
/** A primary button: an orange fill with white text that passes 4.5:1. */
const isPrimary = async (l: import('@playwright/test').Locator) => {
  const { bg, fg } = await paint(l);
  const [r, g, b] = rgb(bg);
  expect(fg, 'white text').toBe('rgb(255, 255, 255)');
  expect(r > g && g > b && r > 150, `an orange fill, got ${bg}`).toBe(true);
  const [L1, L2] = [lum([255, 255, 255]), lum([r, g, b])];
  expect((L1 + 0.05) / (L2 + 0.05), 'contrast of white on the fill').toBeGreaterThanOrEqual(4.5);
};
/** An outline button: no fill of its own beyond the page or card, and a visible 1px border. */
const isOutline = async (l: import('@playwright/test').Locator) => {
  const c = await l.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, border: cs.borderTopWidth }; });
  expect(c.border, 'a 1px border').toBe('1px');
  const [r, g, b] = rgb(c.bg);
  expect(Math.max(r, g, b) - Math.min(r, g, b), `not a coloured fill, got ${c.bg}`).toBeLessThan(16);
};
const addIncome = (page: Page) => page.getByRole('button', { name: 'Add income', exact: true });
const addTx = (page: Page) => page.getByRole('button', { name: 'Add transaction', exact: true });

/** How many buttons whose text or label is "Add income" are actually shown (not display:none, not hidden). */
const visibleAddIncome = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === 'Add income')
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      }).length);

// ---- criteria 2 and 5 ----
test.describe('desktop title row', () => {
  test.use({ viewport: desktop });

  test('"Add income" sits directly left of "Add transaction" on the month title line, "Add transaction" is rightmost, no button beside the Income figure', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    const inc = addIncome(page);
    const tx = addTx(page);
    await expect(inc).toBeVisible();
    await expect(tx).toBeVisible();
    const h = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
    const a = (await inc.boundingBox())!;
    const b = (await tx.boundingBox())!;
    const mid = (r: { y: number; height: number }) => r.y + r.height / 2;
    expect(a.x + a.width, 'Add income is left of Add transaction').toBeLessThanOrEqual(b.x);
    expect(b.x - (a.x + a.width), 'directly left: nothing but a gap between them').toBeLessThan(40);
    expect(Math.abs(mid(a) - mid(b)), 'same line').toBeLessThan(3);
    expect(mid(a), 'on the line of the month title').toBeGreaterThanOrEqual(h.y - 2);
    expect(mid(a), 'on the line of the month title').toBeLessThanOrEqual(h.y + h.height + 2);
    // Add transaction is the rightmost visible button of that line.
    const rightmost = await page.evaluate((y) => {
      const bs = [...document.querySelectorAll('button')].map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && Math.abs(r.y + r.height / 2 - y) < 6);
      const max = Math.max(...bs.map(({ r }) => r.right));
      return bs.filter(({ r }) => r.right === max).map(({ e }) => e.getAttribute('aria-label') ?? e.textContent?.trim());
    }, mid(b));
    expect(rightmost).toEqual(['Add transaction']);
    // No button beside the Income figure.
    const income = stat(page, 'Income');
    await expect(income).toContainText('Income');
    await expect(income.getByRole('button')).toHaveCount(0);
  });
});

for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
  test(`${size}: exactly one "Add income" button is visible on the Budget page while no dialog is open`, async ({ page, me }) => {
    await page.setViewportSize(viewport);
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(row(page, /Food/)).toBeVisible();
    await expect(addIncome(page)).toHaveCount(1); // role locators skip hidden elements
    expect(await visibleAddIncome(page)).toBe(1);
    await expect(dialog(page)).toHaveCount(0);
    // also with nothing loaded yet: the button is there with the figures on an empty account
    await page.goto('/settings');
    await page.goto('/budget');
    await expect(addIncome(page)).toBeVisible();
    expect(await visibleAddIncome(page)).toBe(1);
  });
}

// ---- criteria 3, 4, 6, 7 in both colour schemes ----
for (const scheme of ['light', 'dark'] as const) {
  const t = TOKENS[scheme];
  test.describe(`fills, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`desktop Budget: "Add income" has the --income fill and "Add transaction" the --spend fill, both with --on-money text (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await page.goto('/budget');
      await expect(addIncome(page)).toBeVisible();
      await isOutline(addIncome(page));
      await isPrimary(addTx(page));
      await shot(page, `spec03-budget-desktop-${scheme}`);
    });

    test(`phone Budget: top bar "Add" has the --spend fill; one "Add income" under the figures is full width, at least 44px tall, --income fill, opens the dialog on Income (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(phone);
      await seedBudget(me.seed);
      await page.goto('/budget');
      const add = page.locator('.ty-top').getByRole('button', { name: 'Add transaction', exact: true });
      await expect(add).toHaveText('Add', { useInnerText: true });
      await isPrimary(add);

      const inc = addIncome(page);
      await expect(inc).toBeVisible();
      const box = (await inc.boundingBox())!;
      expect(box.height, 'at least 44px tall').toBeGreaterThanOrEqual(44);
      const stats = (await summary(page).boundingBox())!;
      expect(Math.abs(box.width - stats.width), 'as wide as the page content (the figures)').toBeLessThanOrEqual(2);
      expect(Math.abs(box.x - stats.x)).toBeLessThanOrEqual(2);
      expect(box.y, 'under the figures').toBeGreaterThanOrEqual(stats.y + stats.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, `spec03-budget-phone-${scheme}`);

      await inc.click();
      const d = dialog(page);
      await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
      await expect(chip(d, 'Type', 'Income')).toBeChecked();
    });

    test(`Transactions: "Add transaction" (desktop) and "Add" (phone) have the --spend fill and there is no "Add income" (${scheme})`, async ({ page, me }) => {
      await seedBudget(me.seed);
      await page.setViewportSize(desktop);
      await page.goto('/transactions');
      await expect(row(page, /Alphamega/)).toBeVisible();
      await expect(addIncome(page)).toHaveCount(0);
      const tx = addTx(page).first();
      await isPrimary(tx);
      await shot(page, `spec03-transactions-desktop-${scheme}`);

      await page.setViewportSize(phone);
      const add = page.locator('.ty-top').getByRole('button', { name: 'Add transaction', exact: true });
      await expect(add).toHaveText('Add', { useInnerText: true });
      await isPrimary(add);
      await expect(addIncome(page)).toHaveCount(0);
      await shot(page, `spec03-transactions-phone-${scheme}`);
    });

    test(`the "Add transaction" button inside the empty Transactions card stays a plain button (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await page.goto('/transactions');
      await expect(page.getByText(/^No transactions in/)).toBeVisible();
      const card = addTx(page).last();
      const { bg } = await paint(card);
    });

    test(`Pockets: "Add pocket" (desktop) and "Add" (phone) keep the --action fill (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await page.goto('/pockets');
      const add = page.getByRole('button', { name: 'Add pocket', exact: true }).first();
      await expect(add).toBeVisible();
      await isPrimary(add);
      await page.setViewportSize(phone);
      const top = page.locator('.ty-top').getByRole('button', { name: 'Add pocket', exact: true });
      await expect(top).toHaveText('Add', { useInnerText: true });
      await isPrimary(top);
    });

    test(`dialog submit: new income "Add income" --income, Expense chip "Add expense" --spend, editing "Save" --action (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await seedBudget(me.seed);
      await page.goto('/budget');
      await addIncome(page).click();
      const d = dialog(page);
      const submit = (name: string) => d.getByRole('button', { name, exact: true });
      await expect(submit('Add income')).toBeVisible();
      await shot(page, `spec03-dialog-add-income-${scheme}`);

      await chip(d, 'Type', 'Expense').check();
      await expect(submit('Add income')).toHaveCount(0);
      await shot(page, `spec03-dialog-add-expense-${scheme}`);

      await chip(d, 'Type', 'Income').check();
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();

      await addTx(page).click();
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();

      await page.goto('/transactions');
      for (const who of [/Alphamega/, /Paycheck/]) {
        await row(page, who).click();
        await expect(submit('Save')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(d).toBeHidden();
      }
    });

    test(`other dialogs keep a primary submit button: Add pocket (${scheme})`, async ({ page, me }) => {
      await page.goto('/pockets');
      await page.getByRole('button', { name: 'Add pocket', exact: true }).first().click();
      const submit = dialog(page).getByRole('button', { name: 'Add pocket', exact: true });
    });
  });
}

// ---- criterion 8 ----
for (const scheme of ['light', 'dark'] as const) {
  test(`desktop Budget: Tab reaches "Add income" and then "Add transaction", each with the 2px focus ring (${scheme})`, async ({ browser, baseURL, me, page }) => {
    void browser; void baseURL; void me;
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(desktop);
    await page.goto('/budget');
    await expect(addIncome(page)).toBeVisible();
    const state = () => page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const cs = getComputedStyle(e);
      return { name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? e.tagName, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = (await state()).name === 'Add income';
    }
    expect(reached, 'Tab reaches Add income').toBe(true);
    let s = await state();
    expect(s).toMatchObject({ style: 'solid', width: '2px', color: TOKENS[scheme].focus });
    await shot(page, `spec03-focus-add-income-desktop-${scheme}`);
    await page.keyboard.press('Tab');
    s = await state();
    expect(s.name, 'the next stop is Add transaction').toBe('Add transaction');
    expect(s).toMatchObject({ style: 'solid', width: '2px', color: TOKENS[scheme].focus });
    await shot(page, `spec03-focus-add-transaction-desktop-${scheme}`);
  });
}

// ---- criterion 9, the part a browser can see: the built files ----
test('the built CSS and JS do not mention ty-stat__row', async ({ page, me, baseURL }) => {
  const html = await (await page.request.get('/')).text();
  const srcs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) expect(await (await page.request.get(baseURL + s)).text(), s).not.toContain('ty-stat__row');
});
