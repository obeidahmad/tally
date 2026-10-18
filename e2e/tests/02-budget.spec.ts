import { test, expect, dialog, toast, shot, row, srow, pillOf, seedBudget, monthTitle, bsection, summary, cell } from '../support/fixtures';

const POSITIVE_OR_WARNING_OR_NEGATIVE = /ty-pill--(positive|warning|negative)/;

test('empty Budget shows one card with the empty line and Add section', async ({ page, me }) => {
  await page.goto('/budget');
  await expect(page.getByText('No sections yet. A section is a group such as Needs or Savings.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add section' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: monthTitle() }).first()).toBeVisible();
  await shot(page, 'budget-empty-desktop-light');
});

test('Add section: Escape closes the dialog and returns focus to the opener', async ({ page, me }) => {
  await page.goto('/budget');
  const opener = page.getByRole('button', { name: 'Add section' });
  await opener.click();
  await expect(dialog(page)).toBeVisible();
  await shot(page, 'dialog-add-section-desktop-light');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(opener).toBeFocused();
});

test('adding a section from the empty state lists it and moves focus to the page heading', async ({ page, me }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add section' }).click();
  await dialog(page).getByLabel('Name').fill('Needs');
  await dialog(page).getByRole('button', { name: 'Add section' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(bsection(page, 'Needs')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeFocused();
});

test('a section needs a name: the error shows under the field', async ({ page, me }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add section' }).click();
  await dialog(page).getByRole('button', { name: 'Add section' }).click();
  await expect(dialog(page).getByLabel('Name')).toHaveClass(/ty-input--error/);
  await expect(dialog(page).locator('.ty-error')).toBeVisible();
  await expect(dialog(page)).toBeVisible();
});

test('add a subsection: three decimals are refused, then it appears with its budget', async ({ page, me }) => {
  await me.seed.section('Needs');
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add subsection' }).click();
  await dialog(page).getByLabel('Name').fill('Food');
  await dialog(page).getByLabel('Monthly budget').fill('1.234');
  await dialog(page).getByRole('button', { name: 'Add subsection' }).click();
  await expect(dialog(page).getByText(/two decimals/)).toBeVisible();
  await expect(dialog(page).getByLabel('Monthly budget')).toHaveClass(/ty-input--error/);
  await dialog(page).getByLabel('Monthly budget').fill('300');
  await dialog(page).getByRole('button', { name: 'Add subsection' }).click();
  await expect(dialog(page)).toBeHidden();
  const food = srow(page, /Food/);
  await expect(food).toContainText('300.00');
  await expect(pillOf(food)).toContainText('300.00');
});

test('the four pill states, a zero budget, and the month figures', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  const food = srow(page, /Food/);
  await expect(pillOf(food)).toHaveClass(/ty-pill--positive/);
  await expect(pillOf(food)).toContainText('87.60');
  const mortgage = srow(page, /Mortgage/);
  await expect(pillOf(mortgage)).not.toHaveClass(POSITIVE_OR_WARNING_OR_NEGATIVE);
  await expect(pillOf(mortgage)).toContainText('0.00');
  const util = srow(page, /Utilities/);
  await expect(pillOf(util)).toHaveClass(/ty-pill--negative/);
  await expect(pillOf(util)).toContainText('11.75');
  const subs = srow(page, /Subscriptions/);
  await expect(pillOf(subs)).toHaveClass(/ty-pill--warning/);
  await expect(pillOf(subs)).toContainText('1.03');
  const gifts = srow(page, /Gifts/);
  await expect(pillOf(gifts)).not.toHaveClass(POSITIVE_OR_WARNING_OR_NEGATIVE);
  await expect(pillOf(gifts)).toHaveText('0.00');

  const stats = summary(page);
  await expect(stats).toContainText('2,000.00');
  await expect(stats).toContainText('1,060.00');
  await expect(stats).toContainText('983.12');
  await expect(stats).toContainText('940.00'); // Left over: 2,000.00 income minus the 1,060.00 the steps send
  const order = (await stats.innerText()).replace(/\s+/g, ' ').toLowerCase();
  expect(order.indexOf('income')).toBeLessThan(order.indexOf('budgeted'));
  expect(order.indexOf('budgeted')).toBeLessThan(order.indexOf('spent'));
  expect(order.indexOf('spent')).toBeLessThan(order.indexOf('left over'));
  await expect(page.getByText('Close month')).toHaveCount(0);
  await shot(page, 'budget-desktop-light');
});

test('sections take their colour slots in order', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(bsection(page, 'Needs').locator('.ty-dot').first()).toHaveClass(/ty-dot--1/);
  await expect(bsection(page, 'Wants').locator('.ty-dot').first()).toHaveClass(/ty-dot--2/);
});

test('previous month shows that month; next is disabled on the current month', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(page.getByRole('button', { name: 'Next month' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Previous month' }).first().click();
  const prev = new Date();
  prev.setUTCDate(1);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  await expect(page.getByRole('heading', { level: 1, name: monthTitle(prev) }).first()).toBeVisible();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  // A standing budget applies to every month, but nothing was spent last month.
  await expect(pillOf(srow(page, /Food/))).toContainText('300.00');
  await page.getByRole('button', { name: 'Next month' }).first().click();
  await expect(pillOf(srow(page, /Food/))).toContainText('87.60');
});

test('a row opens its dialog from the keyboard, and Escape returns focus to it', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  const food = row(page, /Food/);
  await food.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
  await shot(page, 'dialog-edit-subsection-desktop-light');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(food).toBeFocused();
});

test('a row also opens with the Space key', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await row(page, /Gifts/).focus();
  await page.keyboard.press('Space');
  await expect(dialog(page).getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
});

test('edit a subsection: rename and change the budget, figures update and Saved shows', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await row(page, /Gifts/).click();
  await dialog(page).getByLabel('Name').fill('Presents');
  await dialog(page).getByLabel('Monthly budget').fill('50');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  await expect(srow(page, /Presents/)).toContainText('50.00');
  await expect(row(page, /Gifts/)).toHaveCount(0);
  // Budgeted is what the pipeline sends, so a subsection's budget no longer moves it.
  await expect(summary(page)).toContainText('1,060.00');
  await expect(summary(page)).not.toContainText('1,110.00');
});

test('edit a section: rename it', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await bsection(page, 'Wants').getByRole('button', { name: /^Edit / }).click();
  await expect(dialog(page).getByRole('heading', { name: /Edit section/ })).toBeVisible();
  // Spec 06: the section dialog has the Name only.
  await expect(dialog(page).getByRole('group', { name: 'Budget' })).toHaveCount(0);
  await expect(dialog(page).getByLabel('Monthly budget')).toHaveCount(0);
  await shot(page, 'dialog-edit-section-desktop-light');
  await dialog(page).getByLabel('Name', { exact: true }).fill('Treats');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  await expect(bsection(page, 'Treats')).toBeVisible();
  await expect(page.getByText('Wants')).toHaveCount(0);
});

test('delete a subsection happens at once and Undo brings it back', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await row(page, /Gifts/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, /Gifts/)).toHaveCount(0);
  await expect(toast(page).getByRole('button', { name: 'Undo' })).toBeVisible();
  await shot(page, 'toast-undo-desktop-light');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(srow(page, /Gifts/)).toBeVisible();
});

test('delete a section (without transactions) and Undo brings it back', async ({ page, me }) => {
  const s = await me.seed.section('Savings');
  await me.seed.subsection(s.id, 'Holiday', 10000);
  await page.goto('/budget');
  await bsection(page, 'Savings').getByRole('button', { name: /^Edit / }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(bsection(page, 'Savings')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(bsection(page, 'Savings')).toBeVisible();
  await expect(srow(page, /Holiday/)).toBeVisible();
});

test('a subsection with transactions cannot be deleted, and the dialog says so', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await row(page, /Food/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('This subsection has transactions. Delete them first.')).toBeVisible();
  await shot(page, 'dialog-subsection-conflict-desktop-light');
  await page.keyboard.press('Escape');
  await expect(row(page, /Food/)).toBeVisible();
});

test('a section whose subsection has transactions cannot be deleted, and the dialog says so', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await bsection(page, 'Needs').getByRole('button', { name: /^Edit / }).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('This section has transactions. Delete them first.')).toBeVisible();
  await shot(page, 'dialog-section-conflict-desktop-light');
  await page.keyboard.press('Escape');
  await expect(bsection(page, 'Needs')).toBeVisible();
});

test('a new section takes the next colour slot, and Add section stays available', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add section' }).click();
  await dialog(page).getByLabel('Name').fill('Savings');
  await dialog(page).getByRole('button', { name: 'Add section' }).click();
  const sec = bsection(page, 'Savings');
  await expect(sec.locator('.ty-dot').first()).toHaveClass(/ty-dot--3/);
  await expect(page.getByRole('button', { name: 'Add section' })).toBeVisible();
});
