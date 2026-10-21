import { test, expect, dialog, shot, chip, group, em, pocketsApi, seedBudget, fillExpense, row } from '../support/fixtures';
import type { Locator, Page } from '@playwright/test';

// Spec 28: the transaction dialog on a first run (no source, no pocket yet).

const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
const addIncome = (d: Locator) => d.getByRole('button', { name: 'Add income', exact: true });
const pocketField = (d: Locator) => d.getByLabel('Pocket', { exact: true });
const sourceField = (d: Locator) => d.getByLabel('Source', { exact: true });
const labelsOf = async (d: Locator) =>
  (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().toLowerCase());
const openIncome = async (page: Page) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
  return d;
};
/** The error text shown directly under `field`: below it and above `next`. */
async function expectErrorUnder(d: Locator, field: Locator, next: Locator, message?: string | RegExp) {
  const err = message ? d.locator('.ty-error', { hasText: message }) : d.locator('.ty-error');
  await expect(err).toHaveCount(1);
  const [f, e, n] = await Promise.all([field.boundingBox(), err.boundingBox(), next.boundingBox()]);
  expect(e!.y, 'error is below the field').toBeGreaterThanOrEqual(f!.y + f!.height - 1);
  expect(e!.y, 'error is above the next field').toBeLessThan(n!.y);
}

// ---- the first income ----
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`first income dialog, ${size}, ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });

      test('a new account has plain Source, Pocket and Kind fields, no chips, no panel, no emoji grid; saving creates the source and the pocket with the bank emoji', async ({ page, me }) => {
        const d = await openIncome(page);
        await expect(d.getByRole('radio', { name: '+ Add source' })).toHaveCount(0);
        await expect(d.getByRole('radio', { name: '+ Add pocket' })).toHaveCount(0);
        await expect(d.locator('.ty-chip--add')).toHaveCount(0);
        await expect(d.locator('.ty-inset')).toHaveCount(0);
        await expect(group(d, 'Emoji')).toHaveCount(0);
        await expect(sourceField(d)).toHaveAttribute('placeholder', 'e.g. Salary');
        await expect(pocketField(d)).toHaveAttribute('placeholder', 'e.g. Current account');
        await expect(d.getByLabel('Kind').locator('option:checked')).toHaveText('Bank account');
        await expect(d.getByLabel('Source name')).toHaveCount(0);
        await expect(d.getByLabel('Pocket name')).toHaveCount(0);
        await shot(page, `spec28-first-income-${size}-${scheme}`);

        await sourceField(d).fill('Salary');
        await pocketField(d).fill('Current account');
        await d.getByLabel('Amount').fill('1500');
        await addIncome(d).click();
        await expect(d).toBeHidden();

        expect((await page.request.get('/api/sources').then((r) => r.json())).sources.map((s: { name: string }) => s.name)).toEqual(['Salary']);
        const pockets = await pocketsApi(page);
        expect(pockets).toHaveLength(1);
        expect(pockets[0]).toMatchObject({ name: 'Current account', kind: 'bank', emoji: em('Bank'), balanceMinor: 150000 });
      });
    });
  }
}

test('the first income dialog shows Type, Date, Amount, Source, Pocket, Kind, Note, Tags and nothing else, and fits a 900px-tall window without scrolling', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const d = await openIncome(page);
  await page.waitForTimeout(300);
  const labels = await labelsOf(d);
  const wanted = ['type', 'date', 'amount', 'source', 'pocket', 'kind', 'note', 'tags'];
  expect(labels.length, JSON.stringify(labels)).toBe(wanted.length);
  wanted.forEach((w, i) => expect(labels[i], JSON.stringify(labels)).toMatch(new RegExp(`^${w}\\b`)));
  expect(await d.evaluate((e) => e.scrollHeight <= e.clientHeight + 1), 'the dialog does not scroll').toBe(true);
  const box = (await d.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(900.5);
  const primary = (await addIncome(d).boundingBox())!;
  expect(primary.y + primary.height).toBeLessThanOrEqual(900.5);
});

// ---- the expense on a first run ----
test('an expense on a new account has plain Pocket and Kind fields; saving creates the pocket first, then the expense', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Food', 10000);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(group(d, 'Pocket')).toHaveCount(0);
  await expect(group(d, 'Emoji')).toHaveCount(0);
  await expect(d.locator('.ty-inset')).toHaveCount(0);
  await pocketField(d).fill('Wallet');
  await d.getByLabel('Kind').selectOption({ label: 'Cash' });
  await fillExpense(d, { amount: '4.50', payee: 'Kiosk', subsection: 'Food' });
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Kiosk/)).toContainText('−4.50');
  expect((await pocketsApi(page))[0]).toMatchObject({ name: 'Wallet', kind: 'cash', emoji: em('Banknote') });
});

// ---- with sources and pockets ----
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`with sources and pockets, ${size}, ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });

      test('"+ Add source" and "+ Add pocket" show their fields directly under the chips, with no panel and no emoji grid, and save', async ({ page, me }) => {
        await me.seed.source('Paycheck');
        await me.seed.pocket('Revolut', 0);
        const d = await openIncome(page);
        await expect(d.getByLabel('Source name')).toBeHidden();
        await expect(d.getByLabel('Pocket name')).toBeHidden();

        await chip(d, 'Source', '+ Add source').check();
        const sName = d.getByLabel('Source name');
        await expect(sName).toBeVisible();
        await expect(d.locator('.ty-inset')).toHaveCount(0);
        const [chips, field] = await Promise.all([group(d, 'Source').boundingBox(), sName.boundingBox()]);
        expect(field!.y, 'Source name is under the Source chips').toBeGreaterThanOrEqual(chips!.y + chips!.height - 1);

        await chip(d, 'Pocket', '+ Add pocket').check();
        const pName = d.getByLabel('Pocket name');
        await expect(pName).toBeVisible();
        await expect(d.getByLabel('Kind')).toBeVisible();
        await expect(d.getByLabel('Kind').locator('option:checked')).toHaveText('Bank account');
        await expect(d.locator('.ty-inset')).toHaveCount(0);
        await expect(group(d, 'Emoji')).toHaveCount(0);
        await expect(d.getByRole('radio', { name: 'Star', exact: true })).toHaveCount(0);
        const [pChips, pField, kind] = await Promise.all([group(d, 'Pocket').boundingBox(), pName.boundingBox(), d.getByLabel('Kind').boundingBox()]);
        expect(pField!.y, 'Pocket name is under the Pocket chips').toBeGreaterThanOrEqual(pChips!.y + pChips!.height - 1);
        expect(kind!.y, 'Kind is under Pocket name').toBeGreaterThan(pField!.y);
        await shot(page, `spec28-add-pocket-${size}-${scheme}`);

        await sName.fill('Side gig');
        await pName.fill('Jar');
        await d.getByLabel('Kind').selectOption({ label: 'Fund' });
        await d.getByLabel('Amount').fill('25');
        await addIncome(d).click();
        await expect(d).toBeHidden();
        const jar = (await pocketsApi(page)).find((p) => p.name === 'Jar')!;
        expect(jar).toMatchObject({ kind: 'fund', emoji: em('Seedling'), balanceMinor: 2500 });
        expect((await me.seed.sourcesApi()).map((s) => s.name)).toEqual(['Paycheck', 'Side gig']);
      });
    });
  }
}

test('the transaction dialog never shows the emoji grid: expense, income, transfer and edit', async ({ page, me }) => {
  await seedBudget(me.seed);
  await me.seed.pocket('Wallet', 0, 'cash');
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  for (const type of ['Expense', 'Income', 'Transfer']) {
    await chip(d, 'Type', type).check();
    await expect(group(d, 'Emoji'), type).toHaveCount(0);
  }
  await chip(d, 'Type', 'Expense').check();
  await chip(d, 'Pocket', '+ Add pocket').check();
  await expect(group(d, 'Emoji')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row(page, /Alphamega/).click();
  await expect(d.getByRole('heading', { name: 'Edit expense' })).toBeVisible();
  await expect(group(d, 'Emoji')).toHaveCount(0);
});

// ---- transfer ----
test('a transfer with one pocket shows "A transfer needs two pockets" and a link to Pockets', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 0);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Type', 'Transfer').check();
  await expect(d.getByText('A transfer needs two pockets')).toBeVisible();
  const link = d.getByRole('link', { name: 'Go to Pockets' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/pockets');
  await expect(d.getByLabel('Amount')).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Add transfer' })).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/pockets$/);
});

test('a transfer with no pocket at all shows the same message', async ({ page, me }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Type', 'Transfer').check();
  await expect(d.getByText('A transfer needs two pockets')).toBeVisible();
  await expect(d.getByRole('link', { name: 'Go to Pockets' })).toBeVisible();
});

test('a transfer with two pockets shows the form, not the message', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 1000);
  await me.seed.pocket('Wallet', 0, 'cash');
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Type', 'Transfer').check();
  await expect(d.getByText('A transfer needs two pockets')).toHaveCount(0);
  await expect(d.getByLabel('Amount', { exact: true })).toBeVisible();
});

// ---- the name errors ----
test('an empty pocket name shows its error under "Pocket" on an income and on an expense', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Food', 10000);
  await me.seed.source('Paycheck');

  const d = await openIncome(page);
  await d.getByLabel('Amount').fill('5');
  await addIncome(d).click();
  await expect(d).toBeVisible();
  await expect(pocketField(d)).toHaveClass(/ty-input--error/);
  await expectErrorUnder(d, pocketField(d), d.getByLabel('Kind'));
  await shot(page, 'spec28-pocket-name-error-desktop-light');
  expect(await pocketsApi(page)).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  await fillExpense(d, { amount: '5', payee: 'Shop', subsection: 'Food' });
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeVisible();
  await expect(pocketField(d)).toHaveClass(/ty-input--error/);
  await expectErrorUnder(d, pocketField(d), d.getByLabel('Kind'));
  expect(await pocketsApi(page)).toHaveLength(0);
});

test('an empty source name shows its error under "Source", and nothing is saved', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 0);
  const d = await openIncome(page);
  await d.getByLabel('Amount').fill('5');
  await addIncome(d).click();
  await expect(d).toBeVisible();
  await expect(sourceField(d)).toHaveClass(/ty-input--error/);
  await expectErrorUnder(d, sourceField(d), group(d, 'Pocket'));
  await expect(d.locator('.ty-inset')).toHaveCount(0);
  expect((await me.seed.sourcesApi())).toHaveLength(0);
});

test('if the pocket is created and the income then fails, the new pocket stays chosen as a chip', async ({ page, me }) => {
  const paycheck = await me.seed.source('Paycheck');
  const d = await openIncome(page);
  await pocketField(d).fill('Wallet');
  await d.getByLabel('Amount').fill('50');
  expect((await page.request.delete(`/api/sources/${paycheck.id}`, { data: {} })).status()).toBe(204);
  await addIncome(d).click();
  await expect(chip(d, 'Pocket', /Wallet/)).toBeChecked();
  await expect(pocketField(d)).toHaveCount(0);
  expect((await pocketsApi(page)).map((p) => p.name)).toEqual(['Wallet']);
});
