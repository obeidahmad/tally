import { test, expect, OWNER, signInByApi, shot, seedBudget, dialog, row, chip, em, pocketRows, bsection, openTab } from '../support/fixtures';

// A screenshot of every page and dialog at desktop and phone width, in light and dark.
// Filenames: <what>-<desktop|phone>-<light|dark>.png in e2e/screenshots/.
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;

for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      const tag = `${size}-${scheme}`;

      test('pages', async ({ page, me }) => {
        await seedBudget(me.seed);
        for (const [path, name, ready] of [
          ['/budget', 'budget', /Food/],
          ['/transactions', 'transactions', /Alphamega/],
          ['/pockets', 'pockets', /Revolut/],
          ['/settings', 'settings', /Change password/],
        ] as const) {
          await page.goto(path);
          await expect(page.getByText(ready).first()).toBeVisible();
          await page.waitForTimeout(250);
          await shot(page, `${name}-${tag}`);
        }
      });

      test('empty pages and sign-in', async ({ page, me }) => {
        for (const [path, name, ready] of [
          ['/budget', 'budget-empty', /No sections yet/],
          ['/transactions', 'transactions-empty', /No transactions in/],
          ['/pockets', 'pockets-empty', /No pockets yet/],
        ] as const) {
          await page.goto(path);
          await expect(page.getByText(ready)).toBeVisible();
          await shot(page, `${name}-${tag}`);
        }
        await page.context().clearCookies();
        await page.goto('/sign-in');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await shot(page, `sign-in-${tag}`);
      });

      test('settings as owner', async ({ page }) => {
        await signInByApi(page, OWNER);
        await openTab(page, '/settings', 'People and sharing');
        await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
        await shot(page, `settings-owner-${tag}`);
      });

      test('dialogs', async ({ page, me }) => {
        const b = await seedBudget(me.seed);
        void b;
        await page.goto('/transactions');
        await expect(page.getByText(/Alphamega/).first()).toBeVisible();
        await page.getByRole('button', { name: 'Add transaction' }).first().click();
        await expect(dialog(page)).toBeVisible();
        await page.waitForTimeout(300);
        await shot(page, `dialog-add-transaction-${tag}`);
        await page.keyboard.press('Escape');
        await row(page, /Alphamega/).click();
        await page.waitForTimeout(300);
        await shot(page, `dialog-edit-transaction-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/budget');
        await row(page, /Food/).click();
        await page.waitForTimeout(300);
        await shot(page, `dialog-edit-subsection-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/pockets');
        await row(page, /Revolut/).click();
        await dialog(page).getByRole('button', { name: 'Delete' }).click();
        await expect(dialog(page).getByText('This pocket has transactions. Delete them first.')).toBeVisible();
        await shot(page, `dialog-pocket-conflict-${tag}`);
      });

      test('dialogs of spec 02: Add income, new-pocket panel, pocket dialogs, conflicts', async ({ page, me }) => {
        await seedBudget(me.seed);
        await page.goto('/budget');
        await page.getByRole('button', { name: 'Add income', exact: true }).click();
        await expect(dialog(page).getByRole('heading', { name: 'Add income' })).toBeVisible();
        await shot(page, `dialog-add-income-${tag}`);
        await chip(dialog(page), 'Pocket', '+ Add pocket').check();
        await expect(dialog(page).getByLabel('Pocket name')).toBeVisible();
        await shot(page, `dialog-new-pocket-panel-${tag}`);
        await page.keyboard.press('Escape');

        await bsection(page, 'Needs').getByRole('button', { name: /^Edit / }).click();
        await dialog(page).getByRole('button', { name: 'Delete' }).click();
        await expect(dialog(page).getByText('This section has transactions. Delete them first.')).toBeVisible();
        await shot(page, `dialog-section-conflict-${tag}`);
        await page.keyboard.press('Escape');
        await row(page, /Food/).click();
        await dialog(page).getByRole('button', { name: 'Delete' }).click();
        await expect(dialog(page).getByText('This subsection has transactions. Delete them first.')).toBeVisible();
        await shot(page, `dialog-subsection-conflict-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/pockets');
        await page.getByRole('button', { name: 'Add pocket' }).first().click();
        await expect(dialog(page).getByRole('group', { name: 'Emoji' })).toBeVisible();
        await shot(page, `dialog-add-pocket-${tag}`);
        await page.keyboard.press('Escape');
        await row(page, /Revolut/).click();
        await expect(dialog(page).getByRole('heading', { name: 'Edit pocket' })).toBeVisible();
        await shot(page, `dialog-edit-pocket-${tag}`);
      });

      test('the transaction dialog with no pocket yet', async ({ page, me }) => {
        const s = await me.seed.section('Needs');
        await me.seed.subsection(s.id, 'Food', 10000);
        await page.goto('/budget');
        await page.getByRole('button', { name: 'Add income', exact: true }).click();
        await expect(dialog(page).getByLabel('Pocket', { exact: true })).toBeVisible();
        await shot(page, `dialog-no-pocket-${tag}`);
      });

      test('pockets with their emoji on the Pockets and Transactions pages', async ({ page, me }) => {
        await seedBudget(me.seed);
        await me.seed.pocket('Piggy', 2500, 'cash', em('Piggy bank'));
        await me.seed.pocket('Fund', 0, 'fund');
        await page.goto('/pockets');
        await expect(pocketRows(page)).toHaveCount(3);
        await shot(page, `pockets-emoji-${tag}`);
        await page.goto('/transactions');
        await expect(row(page, /Alphamega/)).toBeVisible();
        await shot(page, `transactions-emoji-${tag}`);
      });
    });
  }
}
