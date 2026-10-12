import { test, expect, dialog, shot, row, seedBudget, chip } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Spec 03: coloured "Add income" (green) and "Add transaction" (orange) buttons.
// Token values from the spec's Shared contract, as the browser reports them.
const TOKENS = {
  light: { income: 'rgb(25, 160, 109)', spend: 'rgb(222, 110, 24)', onMoney: 'rgb(20, 26, 24)', action: 'rgb(20, 26, 24)', focus: 'rgb(31, 95, 208)' },
  dark: { income: 'rgb(47, 184, 134)', spend: 'rgb(230, 124, 38)', onMoney: 'rgb(20, 26, 24)', action: 'rgb(238, 241, 238)', focus: 'rgb(127, 176, 255)' },
} as const;
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };

const paint = (l: import('@playwright/test').Locator) =>
  l.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
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
    const income = page.locator('.ty-stat').first();
    await expect(income).toContainText('Income');
    await expect(income.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.ty-stat__row')).toHaveCount(0);
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
      await expect(addIncome(page)).toHaveClass(/ty-btn--income/);
      await expect(addTx(page)).toHaveClass(/ty-btn--spend/);
      expect(await paint(addIncome(page))).toEqual({ bg: t.income, fg: t.onMoney });
      expect(await paint(addTx(page))).toEqual({ bg: t.spend, fg: t.onMoney });
      await shot(page, `spec03-budget-desktop-${scheme}`);
    });

    test(`phone Budget: top bar "Add" has the --spend fill; one "Add income" under the figures is full width, at least 44px tall, --income fill, opens the dialog on Income (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(phone);
      await seedBudget(me.seed);
      await page.goto('/budget');
      const add = page.locator('.ty-topbar').getByRole('button', { name: 'Add transaction', exact: true });
      await expect(add).toHaveText('Add');
      await expect(add).toHaveClass(/ty-btn--spend/);
      expect(await paint(add)).toEqual({ bg: t.spend, fg: t.onMoney });

      const inc = addIncome(page);
      await expect(inc).toBeVisible();
      await expect(inc).toHaveClass(/ty-btn--income/);
      expect(await paint(inc)).toEqual({ bg: t.income, fg: t.onMoney });
      const box = (await inc.boundingBox())!;
      expect(box.height, 'at least 44px tall').toBeGreaterThanOrEqual(44);
      const stats = (await page.locator('.ty-stats').first().boundingBox())!;
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
      await expect(tx).toHaveClass(/ty-btn--spend/);
      expect(await paint(tx)).toEqual({ bg: t.spend, fg: t.onMoney });
      await shot(page, `spec03-transactions-desktop-${scheme}`);

      await page.setViewportSize(phone);
      const add = page.locator('.ty-topbar').getByRole('button', { name: 'Add transaction', exact: true });
      await expect(add).toHaveText('Add');
      expect(await paint(add)).toEqual({ bg: t.spend, fg: t.onMoney });
      await expect(addIncome(page)).toHaveCount(0);
      await shot(page, `spec03-transactions-phone-${scheme}`);
    });

    test(`the "Add transaction" button inside the empty Transactions card stays a plain button (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await page.goto('/transactions');
      await expect(page.getByText(/^No transactions in/)).toBeVisible();
      const card = addTx(page).last();
      await expect(card).not.toHaveClass(/ty-btn--(spend|income)/);
      const { bg } = await paint(card);
      expect(bg).not.toBe(t.spend);
      expect(bg).not.toBe(t.income);
    });

    test(`Pockets: "Add pocket" (desktop) and "Add" (phone) keep the --action fill (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await page.goto('/pockets');
      const add = page.getByRole('button', { name: 'Add pocket', exact: true }).first();
      await expect(add).toBeVisible();
      expect((await paint(add)).bg).toBe(t.action);
      await page.setViewportSize(phone);
      const top = page.locator('.ty-topbar').getByRole('button', { name: 'Add pocket', exact: true });
      await expect(top).toHaveText('Add');
      expect((await paint(top)).bg).toBe(t.action);
    });

    test(`dialog submit: new income "Add income" --income, Expense chip "Add expense" --spend, editing "Save" --action (${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(desktop);
      await seedBudget(me.seed);
      await page.goto('/budget');
      await addIncome(page).click();
      const d = dialog(page);
      const submit = (name: string) => d.getByRole('button', { name, exact: true });
      await expect(submit('Add income')).toBeVisible();
      await expect(submit('Add income')).toHaveClass(/ty-btn--income/);
      expect(await paint(submit('Add income'))).toEqual({ bg: t.income, fg: t.onMoney });
      await shot(page, `spec03-dialog-add-income-${scheme}`);

      await chip(d, 'Type', 'Expense').check();
      await expect(submit('Add income')).toHaveCount(0);
      await expect(submit('Add expense')).toHaveClass(/ty-btn--spend/);
      await expect.poll(() => paint(submit('Add expense')), 'the 150ms colour transition settles').toEqual({ bg: t.spend, fg: t.onMoney });
      await shot(page, `spec03-dialog-add-expense-${scheme}`);

      await chip(d, 'Type', 'Income').check();
      await expect.poll(async () => (await paint(submit('Add income'))).bg).toBe(t.income);
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();

      await addTx(page).click();
      await expect(submit('Add expense')).toHaveClass(/ty-btn--spend/);
      await expect.poll(async () => (await paint(submit('Add expense'))).bg).toBe(t.spend);
      await page.keyboard.press('Escape');
      await expect(d).toBeHidden();

      await page.goto('/transactions');
      for (const who of [/Alphamega/, /Paycheck/]) {
        await row(page, who).click();
        await expect(submit('Save')).toBeVisible();
        await expect(submit('Save')).toHaveClass(/ty-btn--primary/);
        expect((await paint(submit('Save'))).bg).toBe(t.action);
        await page.keyboard.press('Escape');
        await expect(d).toBeHidden();
      }
    });

    test(`other dialogs keep a primary submit button: Add pocket (${scheme})`, async ({ page, me }) => {
      await page.goto('/pockets');
      await page.getByRole('button', { name: 'Add pocket', exact: true }).first().click();
      const submit = dialog(page).getByRole('button', { name: 'Add pocket', exact: true });
      await expect(submit).toHaveClass(/ty-btn--primary/);
      expect((await paint(submit)).bg).toBe(t.action);
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
