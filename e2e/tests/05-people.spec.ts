import { test, expect, OWNER, createPerson, signInByApi, seedBudget, dialog, shot, row, openTab } from '../support/fixtures';

test('Settings shows the account read-only, and no People list to a non-owner', async ({ page, me }) => {
  await openTab(page, '/settings', 'Account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  const main = page.getByRole('main').first();
  for (const v of [me.displayName, me.username, 'EUR']) {
    await expect(main.getByText(v, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a person' })).toHaveCount(0);
  await shot(page, 'settings-person-desktop-light');
});

test('the owner sees the people with an Owner pill, adds a person, and that person signs in and changes their password', async ({ page, browser, baseURL }) => {
  await signInByApi(page, OWNER);
  await openTab(page, '/settings', 'People and sharing');
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(page.locator('.ty-pill', { hasText: 'Owner' })).toBeVisible();
  await expect(page.locator('.ty-section', { hasText: OWNER.username })).toContainText(OWNER.displayName);

  const username = `lina${Date.now().toString(36)}`;
  await page.getByRole('button', { name: 'Add a person' }).click();
  const d = dialog(page);
  await shot(page, 'dialog-add-person-desktop-light');
  await d.getByLabel('Display name').fill('Lina');
  await d.getByLabel('Username').fill(username);
  await d.getByLabel('Temporary password').fill('temporary pass 1');
  await d.getByRole('button', { name: 'Add person' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(username)).toBeVisible();
  await shot(page, 'settings-owner-desktop-light');

  // The new person, in a separate browser, signs in with the temporary password.
  const ctx = await browser.newContext({ baseURL });
  const p2 = await ctx.newPage();
  await p2.goto('/sign-in');
  await p2.getByLabel('Username').fill(username);
  await p2.getByLabel('Password').fill('temporary pass 1');
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2).toHaveURL(/\/home$/);
  await p2.goto('/budget');
  await expect(p2.getByText('No sections yet', { exact: false })).toBeVisible();
  await openTab(p2, '/settings', 'Account');
  await expect(p2.getByRole('heading', { name: 'People' })).toHaveCount(0);
  await p2.getByLabel('Current password').fill('temporary pass 1');
  await p2.getByLabel('New password').fill('lina chose this one');
  await p2.getByRole('button', { name: 'Change password' }).click();
  await expect(p2.getByRole('status')).toContainText('Saved');
  await ctx.close();
});

test('adding a person with a taken username shows the error under the field', async ({ page, me }) => {
  await signInByApi(page, OWNER);
  await openTab(page, '/settings', 'People and sharing');
  await page.getByRole('button', { name: 'Add a person' }).click();
  const d = dialog(page);
  await d.getByLabel('Display name').fill('Copy');
  await d.getByLabel('Username').fill(me.username);
  await d.getByLabel('Temporary password').fill('temporary pass 1');
  await d.getByRole('button', { name: 'Add person' }).click();
  await expect(d.getByLabel('Username')).toHaveClass(/ty-input--error/);
  await expect(d.locator('.ty-error')).toBeVisible();
  await expect(d).toBeVisible();
});

test('a second person sees none of the first person\'s data on any page', async ({ page, browser, baseURL, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();

  const other = await createPerson(baseURL!, 'Otto');
  const ctx = await browser.newContext({ baseURL });
  const p2 = await ctx.newPage();
  await signInByApi(p2, other);

  await p2.goto('/budget');
  await expect(p2.getByText('No sections yet', { exact: false })).toBeVisible();
  await expect(p2.getByText('Food')).toHaveCount(0);
  await p2.goto('/transactions');
  await expect(p2.getByText('No transactions in', { exact: false })).toBeVisible();
  await expect(p2.getByText('Alphamega')).toHaveCount(0);
  await p2.goto('/pockets');
  await expect(p2.getByText('No pockets yet', { exact: false })).toBeVisible();
  await expect(p2.getByText('Revolut')).toHaveCount(0);
  await expect(p2.locator('.ty-side').getByText('Otto')).toBeVisible();
  await shot(p2, 'second-person-pockets-desktop-light');
  await ctx.close();
});
