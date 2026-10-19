import { test, expect, shot, toast, openTab } from '../support/fixtures';

test('a signed-out visitor is sent to the sign-in page', async ({ page }) => {
  await page.goto('/budget');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'sign-in-desktop-light');
});

test('sign out, a wrong password, then the right one', async ({ page, me }) => {
  await page.goto('/budget');
  await expect(page.getByText(`Signed in as ${me.displayName}`)).toBeVisible();
  await expect(page.getByText('Base currency EUR')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The only deliberate wrong password in the suite.
  await page.getByLabel('Username').fill(me.username);
  await page.getByLabel('Password').fill('not the password!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That username and password don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  await shot(page, 'sign-in-error-desktop-light');

  await page.getByLabel('Password').fill(me.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('signing out ends the session: the app no longer opens', async ({ page, me }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/pockets');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('a 401 from any later call returns the person to sign-in', async ({ page, me }) => {
  await page.goto('/budget');
  await expect(page.getByText('No sections yet', { exact: false })).toBeVisible();
  await page.context().clearCookies();
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('change password: the new one signs in', async ({ page, me }) => {
  await openTab(page, '/settings', 'Account');
  const newPassword = 'a brand new password 7';
  await page.getByLabel('Current password').fill(me.password);
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(toast(page)).toContainText('Saved');
  await shot(page, 'settings-password-saved-desktop-light');

  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Username').fill(me.username);
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('change password with a wrong current password shows the error under the field', async ({ page, me }) => {
  await openTab(page, '/settings', 'Account');
  await page.getByLabel('Current password').fill('this is not it at all');
  await page.getByLabel('New password').fill('a brand new password 7');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByLabel('Current password')).toHaveClass(/ty-input--error/);
  await expect(page.locator('.ty-error')).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
});

test('a new password that is too short is refused under its field', async ({ page, me }) => {
  await openTab(page, '/settings', 'Account');
  await page.getByLabel('Current password').fill(me.password);
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByLabel('New password')).toHaveClass(/ty-input--error/);
  await expect(page.locator('.ty-error')).toBeVisible();
});

test('a changing request without the JSON content type answers 400', async ({ page, me }) => {
  const res = await page.request.post('/api/sections', { headers: { 'Content-Type': 'text/plain' }, data: JSON.stringify({ name: 'X' }) });
  expect(res.status()).toBe(400);
});
