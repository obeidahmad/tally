import { test, expect, dialog, toast, shot, row, seedBudget, em } from '../support/fixtures';

test('empty Pockets shows one card with the empty line and Add pocket', async ({ page, me }) => {
  await page.goto('/pockets');
  await expect(page.getByText('No pockets yet. A pocket is where money sits: a bank account, cash, a fund.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add pocket' }).last()).toBeVisible();
  await shot(page, 'pockets-empty-desktop-light');
});

test('add a pocket: the card shows name, kind in words, currency, balance and source', async ({ page, me }) => {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  await expect(dialog(page).getByRole('heading', { name: 'Add pocket' })).toBeVisible();
  const labels = (await dialog(page).locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  const order = ['name', 'emoji', 'kind', 'opening balance'].map(at);
  expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
  expect([...order].sort((a, b) => a - b), JSON.stringify(labels)).toEqual(order);
  await shot(page, 'dialog-add-pocket-desktop-light');
  await dialog(page).getByLabel('Name').fill('Revolut');
  await dialog(page).getByLabel('Kind').selectOption({ label: 'Bank account' });
  await dialog(page).getByLabel('Opening balance').fill('1,000.00');
  await dialog(page).getByRole('button', { name: 'Add pocket' }).click();
  await expect(dialog(page)).toBeHidden();
  const card = page.locator('.ty-pocket', { hasText: 'Revolut' });
  await expect(card).toContainText('Bank account');
  await expect(card.locator('.ty-emoji').first()).toHaveText(em('Bank'));
  await expect(card).toContainText('EUR');
  await expect(card).toContainText('1,000.00');
  await expect(card).toContainText('Entered by hand');
  await expect(page.getByText('Total in pockets')).toBeVisible();
  await expect(page.locator('.num-hero').first()).toContainText('1,000.00');
  await expect(page.locator('.num-hero').first()).toContainText('EUR');
  await shot(page, 'pockets-desktop-light');
});

test('the four kinds are named in words', async ({ page, me }) => {
  await me.seed.pocket('A', 0, 'bank');
  await me.seed.pocket('B', 0, 'cash');
  await me.seed.pocket('C', 0, 'fund');
  await me.seed.pocket('D', 0, 'broker');
  await page.goto('/pockets');
  await expect(page.locator('.ty-pocket')).toHaveCount(4);
  for (const [n, kind] of [['A', 'Bank account'], ['B', 'Cash'], ['C', 'Fund'], ['D', 'Broker']]) {
    // The name follows its emoji, so match the end of the title line.
    await expect(page.locator('.ty-pocket').filter({ has: page.locator('b', { hasText: new RegExp(`\\s${n}$`) }) })).toContainText(kind);
  }
});

test('the total is the sum of all balances, and a balance is opening + income - expenses', async ({ page, me }) => {
  await seedBudget(me.seed); // Revolut: 1,000.00 + 2,000.00 - 983.12 = 2,016.88
  await me.seed.pocket('Wallet', -2500, 'cash');
  await page.goto('/pockets');
  await expect(page.locator('.ty-pocket', { hasText: 'Revolut' })).toContainText('2,016.88');
  await expect(page.locator('.ty-pocket', { hasText: 'Wallet' })).toContainText('−25.00');
  await expect(page.locator('.num-hero').first()).toContainText('1,991.88');
});

test('a pocket needs a name: the error shows under the field', async ({ page, me }) => {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  await dialog(page).getByRole('button', { name: 'Add pocket' }).click();
  await expect(dialog(page).getByLabel('Name')).toHaveClass(/ty-input--error/);
  await expect(dialog(page).locator('.ty-error')).toBeVisible();
});

test('edit a pocket: rename, change kind and opening balance', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000);
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  await expect(dialog(page).getByRole('heading', { name: 'Edit pocket' })).toBeVisible();
  await expect(dialog(page).getByLabel('Name')).toHaveValue('Revolut');
  await expect(dialog(page).getByLabel('Opening balance')).toHaveValue('1000.00'); // two decimals, no thousands separator
  await shot(page, 'dialog-edit-pocket-desktop-light');
  await dialog(page).getByLabel('Name').fill('Savings jar');
  await dialog(page).getByLabel('Kind').selectOption({ label: 'Cash' });
  await dialog(page).getByLabel('Opening balance').fill('250.50');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  const card = page.locator('.ty-pocket', { hasText: 'Savings jar' });
  await expect(card).toContainText('Cash');
  await expect(card).toContainText('250.50');
  await expect(page.getByText('Revolut')).toHaveCount(0);
});

test('a pocket card opens from the keyboard and Escape returns focus to it', async ({ page, me }) => {
  await me.seed.pocket('Revolut');
  await page.goto('/pockets');
  const card = row(page, /Revolut/);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
});

test('delete a pocket with no transactions: gone at once, Undo brings it back', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 5000);
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, /Revolut/)).toHaveCount(0);
  await expect(page.getByText('No pockets yet', { exact: false })).toBeVisible();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, /Revolut/)).toContainText('50.00');
});

test('a pocket with transactions cannot be deleted: the dialog says so', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('This pocket has transactions. Delete them first.')).toBeVisible();
  await shot(page, 'dialog-pocket-conflict-desktop-light');
  await page.keyboard.press('Escape');
  await expect(row(page, /Revolut/)).toBeVisible();
});
