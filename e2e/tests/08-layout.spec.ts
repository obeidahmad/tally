import { test, expect, dialog, shot, seedBudget } from '../support/fixtures';

const names = ['Budget', 'Transactions', 'Pockets', 'Settings']; // the phone tab bar
const sidebar = ['Budget', 'Pipeline', 'Transactions', 'Pockets', 'Investments', 'Settings']; // spec 06 adds Pipeline after Budget, spec 14 Investments after Pockets

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('all six pages are reachable from the sidebar, Pipeline right after Budget, Investments after Pockets, and only those six', async ({ page, me }) => {
    await page.goto('/budget');
    const side = page.locator('.ty-side');
    await expect(side.getByRole('link')).toHaveText(sidebar);
    await expect(side.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page');
    for (const n of ['Pipeline', 'Transactions', 'Pockets', 'Settings', 'Budget']) {
      await side.getByRole('link', { name: n }).click();
      await expect(page).toHaveURL(new RegExp(`/${n.toLowerCase()}$`));
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(side.getByRole('link', { name: n })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the sidebar foot shows who is signed in and the base currency, and the sidebar reaches the bottom', async ({ page, me }) => {
    await page.goto('/pockets');
    await expect(page.getByText('No pockets yet', { exact: false })).toBeVisible();
    const side = page.locator('.ty-side');
    await expect(side).toContainText(`Signed in as ${me.displayName}`);
    await expect(side).toContainText('Base currency EUR');
    await expect(side.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const box = (await side.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(900 - 1);
    await expect(page.locator('.ty-tabs')).toBeHidden();
    await expect(page.locator('.ty-topbar')).toBeHidden();
  });

  test('no sideways scroll on any page', async ({ page, me }) => {
    await seedBudget(me.seed);
    for (const p of ['/budget', '/pipeline', '/transactions', '/pockets', '/settings']) {
      await page.goto(p);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), p).toBe(true);
    }
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the tab bar shows the same four pages (Settings, not More) and the sidebar is gone', async ({ page, me }) => {
    await page.goto('/budget');
    await expect(page.locator('.ty-side')).toBeHidden();
    const tabs = page.locator('.ty-tabs');
    await expect(tabs.getByRole('link')).toHaveText(names);
    for (const n of ['Transactions', 'Pockets', 'Settings', 'Budget']) {
      await tabs.getByRole('link', { name: n }).click();
      await expect(page).toHaveURL(new RegExp(`/${n.toLowerCase()}$`));
      await expect(tabs.getByRole('link', { name: n })).toHaveAttribute('aria-current', 'page');
    }
  });

  const topbars: [string, string, string | null][] = [
    ['/budget', 'October', 'Add transaction'],
    ['/transactions', 'Transactions', 'Add transaction'],
    ['/pockets', 'Pockets', 'Add pocket'],
    ['/settings', 'Settings', null],
  ];
  for (const [path, title, action] of topbars) {
    test(`${path}: top bar holds the title${action ? ' and the shortened action "Add"' : ''}; the desktop title row is not shown`, async ({ page, me }) => {
      await page.goto(path);
      const bar = page.locator('.ty-topbar');
      await expect(bar).toBeVisible();
      if (path === '/budget') await expect(bar).toContainText(new Date().toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }));
      else await expect(bar).toContainText(title);
      if (action) {
        const btn = bar.getByRole('button', { name: action, exact: true });
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText('Add');
      } else {
        await expect(bar.getByRole('button')).toHaveCount(0);
      }
      if (path === '/budget') {
        await expect(bar.getByRole('button', { name: 'Previous month' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Next month' })).toBeDisabled();
      }
      const box = (await bar.boundingBox())!;
      expect(box.y).toBeLessThanOrEqual(1);
      expect(box.height).toBeLessThan(80);
      // Only one visible level-1 heading: the bar's, not a second desktop title row.
      expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }

  test('Sign out is on the Settings page on phones', async ({ page, me }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a dialog sits at the bottom edge at full width', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await page.locator('.ty-topbar').getByRole('button', { name: 'Add transaction' }).click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await page.waitForTimeout(300); // the 150ms fade
    const box = (await d.boundingBox())!;
    expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(1);
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(390);
    await shot(page, 'dialog-add-transaction-phone-light');
  });

  test('the Budget rows drop the Budgeted and Spent columns for one line under the meter', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(page.getByRole('button', { name: /Food/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Food/ })).toContainText('212.40');
  });

  test('every section header ends with one "{spent} of {budgeted} spent" line (Spec 04)', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(page.getByRole('button', { name: /Food/ })).toBeVisible();
    const subs = page.locator('.ty-shead__sub');
    await expect(subs).toHaveCount(2);
    await expect(subs.nth(0)).toHaveText('944.15 of 1,020.00 spent');
    await expect(subs.nth(1)).toHaveText('38.97 of 40.00 spent');
    await expect(subs.nth(0)).toBeVisible();
  });
});

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' });

  test('dark mode follows the system setting', async ({ page, me }) => {
    await seedBudget(me.seed);
    await page.goto('/budget');
    await expect(page.getByRole('button', { name: /Food/ })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 20, 19)');
    await shot(page, 'budget-desktop-dark');
  });
});

test('nothing is requested from another host, and no request fails or logs a console error, across every page', async ({ page, me, baseURL }) => {
  const foreign: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(baseURL!)) foreign.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await seedBudget(me.seed);
  for (const p of ['/budget', '/pipeline', '/transactions', '/pockets', '/settings']) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  await page.goto('/budget');
  await page.getByRole('button', { name: /Food/ }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  // The emoji font must also come from the app itself: open the pocket dialog with the picker and the transaction dialog with its chips.
  await page.goto('/pockets');
  await page.getByRole('button', { name: /Revolut/ }).click();
  await expect(dialog(page).getByRole('group', { name: 'Emoji' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  expect(fonts.length, 'fonts loaded from the app itself').toBeGreaterThan(0);
  expect(foreign).toEqual([]);
  expect(problems).toEqual([]);
});
