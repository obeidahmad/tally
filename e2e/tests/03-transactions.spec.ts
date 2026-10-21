import { test, expect, dialog, toast, shot, row, pillOf, seedBudget, monthTitle, dayHeadingRe, srow, summary, chip, group, selectLike, em } from '../support/fixtures';

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
};

test('empty Transactions shows one card with "No transactions in {month}." and Add transaction', async ({ page, me }) => {
  await page.goto('/transactions');
  await expect(page.getByText(`No transactions in ${monthTitle()}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add transaction' }).last()).toBeVisible();
  await shot(page, 'transactions-empty-desktop-light');
});

test('the list is grouped under day headings with signs, dots and source lines', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await expect(page.getByText(dayHeadingRe()).first()).toBeVisible();
  const alpha = row(page, /Alphamega/);
  await expect(alpha).toContainText('−212.40');
  await expect(alpha).not.toContainText('Entered by hand');
  await expect(alpha).toContainText('Food');
  const pay = row(page, /Paycheck/);
  await expect(pay).toContainText('+2,000.00');
  await expect(pay.locator('.ty-num--pos')).toBeVisible();
  await expect(pay).toContainText('Income');
  await expect(pay).not.toContainText(/entered by hand/i);
  await shot(page, 'transactions-desktop-light');
});

test('older days are listed below newer ones (newest first)', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const earlier = new Date();
  earlier.setUTCDate(1);
  const iso = earlier.toISOString().slice(0, 10);
  if (iso !== new Date().toISOString().slice(0, 10)) {
    await me.seed.expense(b.pocket.id, b.food.id, 100, 'Old coffee', iso);
    await page.goto('/transactions');
    const y = async (t: RegExp) => (await row(page, t).boundingBox())!.y;
    expect(await y(/Netflix/)).toBeLessThan(await y(/Old coffee/));
  }
});

test('filters: Month, Subsection and Pocket narrow the list', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const cash = await me.seed.pocket('Wallet', 5000, 'cash', em('Banknote'));
  await me.seed.expense(cash.id, b.food.id, 450, 'Bakery');
  const prev = lastMonth();
  await me.seed.expense(b.pocket.id, b.food.id, 999, 'Last month shop', prev.toISOString().slice(0, 10));
  await page.goto('/transactions');

  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(row(page, /Last month shop/)).toHaveCount(0);

  await selectLike(page.getByLabel('Pocket'), 'Wallet');
  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);

  await page.getByLabel('Pocket').selectOption({ label: 'Pocket' });
  await page.getByLabel('Subsection').selectOption({ label: 'Utilities' });
  await expect(row(page, /EAC electricity/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);

  await page.getByLabel('Subsection').selectOption({ label: 'Subsection' });
  await page.getByLabel('Month').selectOption({ label: monthTitle(prev) });
  await expect(row(page, /Last month shop/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await shot(page, 'transactions-filtered-desktop-light');
});

test('the transaction dialog has its fields in order and defaults to Expense and today', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
  await expect(group(d, 'Type')).toBeVisible();
  await expect(d.getByRole('radio', { name: 'Expense' })).toBeChecked();
  await expect(d.getByRole('radio', { name: 'Income' })).not.toBeChecked();
  await expect(group(d, 'Type').locator('.ty-segmented label')).toHaveCount(3);
  await expect(group(d, 'Type').locator('.ty-chip')).toHaveCount(0);
  await expect(d.getByLabel('Date')).toHaveValue(new Date().toISOString().slice(0, 10));
  await expect(d.getByLabel('Amount')).toHaveClass(/ty-input--amount/);
  await expect(d.getByText('EUR', { exact: true })).toBeVisible();
  await expect(d.locator('optgroup[label="Needs"]')).toHaveCount(1);
  await expect(d.locator('optgroup[label="Wants"]')).toHaveCount(1);
  // Pocket is chips, not a select: one per pocket plus "+ Add pocket".
  await expect(group(d, 'Paid from').locator('select')).toHaveCount(0);
  await expect(group(d, 'Paid from').locator('label.ty-chip')).toHaveCount(2);
  await expect(chip(d, 'Paid from', /Revolut/)).toBeVisible();
  await expect(chip(d, 'Paid from', '+ Add pocket')).toBeVisible();
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  const order = ['type', 'date', 'amount', 'payee', 'subsection', 'paid from', 'note'].map(at);
  expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await shot(page, 'dialog-add-transaction-desktop-light');
  await chip(d, 'Type', 'Income').check();
  await expect(d.getByLabel('Subsection')).toBeHidden();
  await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
  await shot(page, 'dialog-add-income-desktop-light');
});

test('amount entry accepts 12, 12.5, 12.50 and 1,234.56', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  const cases: [string, string][] = [
    ['12', '12.00'],
    ['12.5', '12.50'],
    ['12.50', '12.50'],
    ['1,234.56', '1,234.56'],
  ];
  for (const [i, [typed, shown]] of cases.entries()) {
    await page.getByRole('button', { name: 'Add transaction' }).first().click();
    const d = dialog(page);
    await d.getByLabel('Amount').fill(typed);
    await d.getByLabel('Payee').fill(`Case ${i}`);
    await d.getByLabel('Subsection').selectOption({ label: 'Food' });
    await chip(d, 'Paid from', /Revolut/).check();
    await d.getByRole('button', { name: 'Add expense' }).click();
    await expect(d).toBeHidden();
    await expect(row(page, `Case ${i}`)).toContainText(`−${shown}`);
  }
});

test('amount entry refuses 0, -5, 1.234 and text with the spec message', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await d.getByLabel('Payee').fill('Refused');
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await chip(d, 'Paid from', /Revolut/).check();
  for (const bad of ['0', '-5', '1.234', 'abc', '1,23', '']) {
    await d.getByLabel('Amount').fill(bad);
    await d.getByRole('button', { name: 'Add expense' }).click();
    await expect(d.getByText('Enter an amount above zero, with at most two decimals.'), `typed "${bad}"`).toBeVisible();
    await expect(d.getByLabel('Amount')).toHaveClass(/ty-input--error/);
    await expect(d).toBeVisible();
  }
  await shot(page, 'dialog-amount-error-desktop-light');
  await page.keyboard.press('Escape');
  await expect(row(page, /Refused/)).toHaveCount(0);
});

test('add, edit and delete a transaction update Budget and the pocket balance without a reload, and a delete offers Undo', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
  const kept = () => page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true);
  const food = () => pillOf(srow(page, /Food/));
  await expect(food()).toContainText('87.60');

  // add
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await d.getByLabel('Amount').fill('10');
  await d.getByLabel('Payee').fill('Kiosk');
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await chip(d, 'Paid from', /Revolut/).check();
  await d.getByRole('button', { name: 'Add expense' }).click();
  await expect(d).toBeHidden();
  await expect(food()).toContainText('77.60');
  await expect(summary(page)).toContainText('993.12');

  // pocket balance: 1,000.00 + 2,000.00 - 212.40 - 600 - 131.75 - 38.97 - 10 = 2,006.88
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(page.getByText('2,006.88').first()).toBeVisible();

  // edit
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await row(page, /Kiosk/).click();
  await expect(d.getByLabel('Payee')).toHaveValue('Kiosk');
  await d.getByLabel('Amount').fill('15.50');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  await expect(row(page, /Kiosk/)).toContainText('−15.50');
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await expect(food()).toContainText('72.10');
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(page.getByText('2,001.38').first()).toBeVisible();

  // delete + undo
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await row(page, /Kiosk/).click();
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Kiosk/)).toHaveCount(0);
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await expect(food()).toContainText('87.60');
  await expect(toast(page).getByRole('button', { name: 'Undo' })).toBeVisible();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(food()).toContainText('72.10');
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(page.getByText('2,001.38').first()).toBeVisible();
  expect(await kept(), 'the page was reloaded').toBe(true);
});

test('delete a transaction on the Transactions page: gone at once, Undo brings it back', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  await shot(page, 'dialog-edit-transaction-desktop-light');
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await shot(page, 'toast-undo-transactions-desktop-light');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, /Alphamega/)).toContainText('−212.40');
});

test('income has no subsection and shows with a plus sign', async ({ page, me }) => {
  await me.seed.pocket('Revolut');
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).last().click();
  const d = dialog(page);
  // No subsection exists, so an expense is blocked but income still has a form.
  await expect(d.getByRole('link', { name: /budget/i })).toBeVisible();
  await chip(d, 'Type', 'Income').check();
  await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
  await d.getByLabel('Amount').fill('75');
  // No source yet, so Source is a plain text field (spec 28).
  await expect(d.getByLabel('Payee')).toHaveCount(0);
  await d.getByLabel('Received from', { exact: true }).fill('Gift from Mum');
  await chip(d, 'Paid into', /Revolut/).check();
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Gift from Mum/)).toContainText('+75.00');
});

test('with no pocket the dialog shows plain "Pocket" and "Kind" fields, no chips, no panel, no emoji grid; "Add a pocket first" is gone', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Food', 10000);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(d.getByText('Add a pocket first')).toHaveCount(0);
  await expect(d.getByLabel('Amount')).toBeVisible();
  await expect(group(d, 'Paid from')).toHaveCount(0);
  await expect(d.locator('label.ty-chip', { hasText: '+ Add pocket' })).toHaveCount(0);
  const pocket = d.getByLabel('Paid from', { exact: true });
  await expect(pocket).toBeVisible();
  await expect(pocket).toHaveAttribute('placeholder', 'e.g. Current account');
  await expect(group(d, 'Emoji')).toHaveCount(0);
  await expect(d.getByLabel('Kind').locator('option:checked')).toHaveText('Bank account');
  await expect(d.locator('.ty-inset')).toHaveCount(0);
  await shot(page, 'dialog-no-pocket-desktop-light');
});

test('money out with no subsection points to the Budget page', async ({ page, me }) => {
  await me.seed.pocket('Revolut');
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).last().click();
  const d = dialog(page);
  await expect(d.getByText('Add a subsection first')).toBeVisible();
  await expect(d.getByRole('link', { name: /budget/i })).toBeVisible();
  await shot(page, 'dialog-no-subsection-desktop-light');
  await d.getByRole('link', { name: /budget/i }).click();
  await expect(page).toHaveURL(/\/budget/);
});
