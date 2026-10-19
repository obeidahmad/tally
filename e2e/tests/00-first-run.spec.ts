import { test, expect, OWNER, shot } from '../support/fixtures';

test('first run shows the set-up page, then the app', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText('Create the first account')).toBeVisible();
  await expect(page.getByLabel('Base currency')).toHaveValue('EUR');
  for (const [size, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(vp);
      await page.emulateMedia({ colorScheme: scheme });
      await shot(page, `setup-${size}-${scheme}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });

  await page.getByLabel('Display name').fill(OWNER.displayName);
  await page.getByLabel('Username').fill(OWNER.username);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/home$/); // spec 26: sign-in lands on Home
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await page.goto('/budget');
  await expect(page.getByText('No sections yet. A section is a group such as Needs or Savings.')).toBeVisible();
  await expect(page.locator('.ty-side').getByText('Sam')).toBeVisible();
});

test('after set-up, the set-up page is no longer offered', async ({ page }) => {
  const state = await (await page.request.get('/api/auth/state')).json();
  expect(state.needsSetup).toBe(false);
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/);
});
