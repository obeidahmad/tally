import {
  test, expect, dialog, toast, shot, row, seedBudget, chip, group, em, pocketsApi, fillExpense, DEFAULT_EMOJI, checkedEmoji,
} from '../support/fixtures';

const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
const stat = (page: import('@playwright/test').Page) => page.locator('.ty-stat').first();
const kept = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true);
const mark = (page: import('@playwright/test').Page) => page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

// ---- criterion 4: the first income of a new account, in one save, without leaving the page ----
for (const [size, viewport] of Object.entries(sizes)) {
  test.describe(`first income, ${size}`, () => {
    test.use({ viewport });

    test('on a new account with no pocket, "Add income" ends with a saved income and a new pocket without leaving the page', async ({ page, me }) => {
      await page.goto('/budget');
      await mark(page);
      // Spec 03: the button is in the title row (desktop) or under the figures (phone), not beside the Income figure.
      const income = stat(page);
      await expect(income).toContainText('Income');
      await expect(income.locator('.num-lg')).toHaveText('0.00');
      await expect(income.getByRole('button')).toHaveCount(0);
      const add = page.getByRole('button', { name: 'Add income', exact: true });
      await expect(add).toBeVisible();
      await expect(add).toHaveClass(/ty-btn--income/);
      await shot(page, `budget-add-income-button-${size}-light`);
      await add.click();

      const d = dialog(page);
      await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
      await expect(chip(d, 'Type', 'Income')).toBeChecked();
      await expect(d.getByLabel('Subsection')).toBeHidden();
      await expect(chip(d, 'Pocket', '+ Add pocket')).toBeChecked();
      await expect(d.getByLabel('Pocket name')).toBeVisible();
      await expect(d.getByLabel('Kind').locator('option:checked')).toHaveText('Bank account');
      expect(await checkedEmoji(d)).toEqual([DEFAULT_EMOJI.bank]);
      await d.getByLabel('Pocket name').fill('Revolut');
      await d.getByLabel('Amount').fill('2000');
      // Spec 06: no source yet, so "+ Add source" is chosen and its panel is open; there is no Payee for an income.
      await expect(group(d, 'Source')).toBeVisible();
      await expect(chip(d, 'Source', '+ Add source')).toBeChecked();
      await expect(d.getByLabel('Payee')).toHaveCount(0);
      await d.getByLabel('Source name').fill('Paycheck');
      await shot(page, `dialog-first-income-${size}-light`);
      await d.getByRole('button', { name: 'Add income', exact: true }).click();

      await expect(d).toBeHidden();
      await expect(page).toHaveURL(/\/budget/);
      await expect(income.locator('.num-lg')).toHaveText('2,000.00');
      await expect(add).toBeVisible();

      // The pocket exists with an opening balance of 0 and the income in it.
      const pockets = await pocketsApi(page);
      expect(pockets).toHaveLength(1);
      expect(pockets[0]).toMatchObject({ name: 'Revolut', kind: 'bank', emoji: em('Bank'), openingBalanceMinor: 0, balanceMinor: 200000 });

      await page.getByRole('link', { name: 'Pockets' }).first().click();
      const card = page.locator('.ty-pocket', { hasText: 'Revolut' });
      await expect(card).toContainText('2,000.00');
      await expect(card.locator('.ty-emoji').first()).toHaveText(em('Bank'));
      await shot(page, `pockets-after-first-income-${size}-light`);
      expect(await kept(page), 'the page was reloaded').toBe(true);
    });
  });
}

test('Escape on the Add income dialog returns focus to the Add income button', async ({ page, me }) => {
  await page.goto('/budget');
  const add = page.getByRole('button', { name: 'Add income', exact: true });
  await add.click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(add).toBeFocused();
});

test('a pocket that cannot be created shows its errors in the panel, under "Pocket name", and nothing is saved', async ({ page, me }) => {
  await me.seed.source('Paycheck'); // an income starts on the first source, so only the pocket is wrong
  await page.goto('/budget');
  for (const name of ['', 'x'.repeat(61)]) {
    await page.getByRole('button', { name: 'Add income', exact: true }).click();
    const d = dialog(page);
    await d.getByLabel('Pocket name').fill(name);
    await d.getByLabel('Amount').fill('5');
    await d.getByRole('button', { name: 'Add income', exact: true }).click();
    await expect(d).toBeVisible();
    await expect(d.getByLabel('Pocket name')).toHaveClass(/ty-input--error/);
    await expect(d.locator('.ty-inset .ty-error')).toBeVisible();
    expect(await pocketsApi(page), `name length ${name.length}`).toHaveLength(0);
    if (!name) await shot(page, 'dialog-new-pocket-error-desktop-light');
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
  }
  await expect(stat(page).locator('.num-lg')).toHaveText('0.00');
});

test('if the pocket is created and the income then fails, the new pocket stays chosen, the panel closes and the error shows; saving again does not create it twice', async ({ page, me }) => {
  const paycheck = await me.seed.source('Paycheck');
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  await expect(chip(d, 'Source', 'Paycheck')).toBeChecked();
  await d.getByLabel('Pocket name').fill('Wallet');
  await d.getByLabel('Amount').fill('50');
  // The chosen source is deleted behind the dialog's back, so the server refuses the income on `sourceId` after the pocket exists.
  expect((await page.request.delete(`/api/sources/${paycheck.id}`, { data: {} })).status()).toBe(204);
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeVisible();
  await expect(d.getByText('Choose a source.')).toBeVisible();
  await expect(chip(d, 'Pocket', /Wallet/)).toBeChecked();
  await expect(d.getByLabel('Pocket name')).toBeHidden();
  expect((await pocketsApi(page)).map((p) => p.name)).toEqual(['Wallet']);
  await shot(page, 'dialog-pocket-created-transaction-failed-desktop-light');
  // Choose a new source and save again: the pocket is used, not created a second time.
  await chip(d, 'Source', '+ Add source').check();
  await d.getByLabel('Source name').fill('Bonus');
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toBeHidden();
  const pockets = await pocketsApi(page);
  expect(pockets).toHaveLength(1);
  expect(pockets[0].balanceMinor).toBe(5000);
  await expect(stat(page).locator('.num-lg')).toHaveText('50.00');
});

// ---- criterion 5: with pockets present ----
test('with pockets present the dialog shows one chip per pocket with its emoji, and "+ Add pocket" creates one in place and uses it', async ({ page, me }) => {
  await seedBudget(me.seed); // Revolut (default bank emoji)
  await me.seed.pocket('Wallet', 5000, 'cash', em('Purse'));
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  const chips = group(d, 'Pocket').locator('label.ty-chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toContainText(/Revolut/);
  await expect(chips.nth(0).locator('.ty-emoji')).toHaveText(em('Bank'));
  await expect(chips.nth(1)).toContainText(/Wallet/);
  await expect(chips.nth(1).locator('.ty-emoji')).toHaveText(em('Purse'));
  await expect(chips.nth(2)).toHaveText('+ Add pocket');
  await expect(chips.nth(2)).toHaveClass(/ty-chip--add/);
  await expect(d.getByLabel('Pocket name')).toBeHidden(); // the panel is closed while pockets exist
  await shot(page, 'dialog-pocket-chips-desktop-light');

  await chip(d, 'Pocket', '+ Add pocket').check();
  await expect(d.getByLabel('Pocket name')).toBeVisible();
  await expect(d.locator('.ty-inset')).toBeVisible();
  await d.getByLabel('Pocket name').fill('Savings jar');
  await d.getByLabel('Kind').selectOption({ label: 'Fund' });
  expect(await checkedEmoji(d)).toEqual([DEFAULT_EMOJI.fund]);
  await fillExpense(d, { amount: '12.50', payee: 'Corner shop', subsection: 'Food' });
  await shot(page, 'dialog-new-pocket-panel-desktop-light');
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Corner shop/)).toContainText('−12.50');
  await expect(row(page, /Corner shop/)).toContainText('Savings jar');

  const jar = (await pocketsApi(page)).find((p) => p.name === 'Savings jar')!;
  expect(jar).toMatchObject({ kind: 'fund', emoji: em('Seedling'), openingBalanceMinor: 0, balanceMinor: -1250 });
  expect(await pocketsApi(page)).toHaveLength(3);
});

test('choosing an existing pocket chip and an expense still works next to the new-pocket chip', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await chip(d, 'Pocket', '+ Add pocket').check();
  await expect(d.getByLabel('Pocket name')).toBeVisible();
  await chip(d, 'Pocket', /Revolut/).check();
  await expect(chip(d, 'Pocket', /Revolut/)).toBeChecked();
  await expect(chip(d, 'Pocket', '+ Add pocket')).not.toBeChecked();
  await fillExpense(d, { amount: '3', payee: 'Existing pocket', subsection: 'Food' });
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Existing pocket/)).toBeVisible();
  expect(await pocketsApi(page)).toHaveLength(1);
});

// ---- criterion 6: titles and buttons follow the type; Add income opens with Income; the old words are gone ----
for (const [size, viewport] of Object.entries(sizes)) {
  test(`${size}: "Add transaction" opens with Expense, "Add income" with Income, and the title and button follow the type`, async ({ page, me }) => {
    await page.setViewportSize(viewport);
    await seedBudget(me.seed);
    await page.goto('/budget');
    const d = dialog(page);

    await page.getByRole('button', { name: 'Add transaction' }).first().click();
    await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();
    await expect(chip(d, 'Type', 'Expense')).toBeChecked();
    await expect(d.getByRole('button', { name: 'Add expense', exact: true })).toBeVisible();
    await chip(d, 'Type', 'Income').check();
    await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Add income', exact: true })).toBeVisible();
    await expect(d.getByRole('heading', { name: 'Add expense' })).toHaveCount(0);
    await chip(d, 'Type', 'Expense').check();
    await expect(d.getByRole('heading', { name: 'Add expense' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();

    await page.getByRole('button', { name: 'Add income', exact: true }).click();
    await expect(d.getByRole('heading', { name: 'Add income' })).toBeVisible();
    await expect(chip(d, 'Type', 'Income')).toBeChecked();
    await expect(chip(d, 'Type', 'Expense')).not.toBeChecked();
    await expect(d.getByLabel('Subsection')).toBeHidden();
    await expect(d.getByRole('button', { name: 'Add income', exact: true })).toBeVisible();
    await shot(page, `dialog-add-income-from-budget-${size}-light`);
    await page.keyboard.press('Escape');
  });
}

test('editing: "Edit expense" and "Edit income" with a Save button', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  const d = dialog(page);
  await row(page, /Alphamega/).click();
  await expect(d.getByRole('heading', { name: 'Edit expense' })).toBeVisible();
  await expect(chip(d, 'Type', 'Expense')).toBeChecked();
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Add expense' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await row(page, /Paycheck/).click();
  await expect(d.getByRole('heading', { name: 'Edit income' })).toBeVisible();
  await expect(chip(d, 'Type', 'Income')).toBeChecked();
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(d.getByLabel('Subsection')).toBeHidden();
  await shot(page, 'dialog-edit-income-desktop-light');
  await d.getByLabel('Amount').fill('2500');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  await expect(row(page, /Paycheck/)).toContainText('+2,500.00');
});

test('"Money in" and "Money out" appear nowhere: not in any page, dialog, label or bundle', async ({ page, me, baseURL }) => {
  await seedBudget(me.seed);
  const bad = /money\s+(in|out)\b/i;
  const seen = async (where: string) => {
    const text = await page.evaluate(() =>
      document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[title],[placeholder]')]
        .map((e) => ['aria-label', 'title', 'placeholder'].map((a) => e.getAttribute(a) ?? '').join(' ')).join('\n') +
      '\n' + [...document.querySelectorAll('option')].map((o) => o.textContent).join('\n'));
    expect(text, where).not.toMatch(bad);
  };
  for (const p of ['/budget', '/pipeline', '/transactions', '/pockets', '/settings']) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await seen(p);
  }
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await seen('Add expense dialog');
  await chip(dialog(page), 'Type', 'Income').check();
  await seen('Add income dialog');
  await page.keyboard.press('Escape');
  await row(page, /Paycheck/).click();
  await seen('Edit income dialog');
  await page.keyboard.press('Escape');
  // The built files too.
  const html = await (await page.request.get('/')).text();
  const srcs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const s of srcs) expect(await (await page.request.get(baseURL + s)).text(), s).not.toMatch(bad);
});

// ---- carried over: amount fields that open with a value ----
test('amount fields that open with a value show two decimals and no thousands separators', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Rent', 123456789);
  const p = await me.seed.pocket('Revolut', 100000);
  await me.seed.income(p.id, 100000, 'Bonus');
  await me.seed.income(p.id, 1250, 'Refund');
  await me.seed.income(p.id, 123456789, 'Windfall');

  await page.goto('/transactions');
  const d = dialog(page);
  for (const [who, shown] of [['Bonus', '1000.00'], ['Refund', '12.50'], ['Windfall', '1234567.89']]) {
    await row(page, new RegExp(who)).click();
    await expect(d.getByLabel('Amount'), who).toHaveValue(shown);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
  }
  await page.goto('/budget');
  await row(page, /Rent/).click();
  await expect(d.getByLabel('Monthly budget')).toHaveValue('1234567.89');
  await page.keyboard.press('Escape');
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  await expect(d.getByLabel('Opening balance')).toHaveValue('1000.00');
});

// ---- signed in: /setup and /sign-in go to /budget ----
test('opening /setup or /sign-in while signed in goes to /budget', async ({ page, me }) => {
  for (const p of ['/setup', '/sign-in']) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/budget/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
});
