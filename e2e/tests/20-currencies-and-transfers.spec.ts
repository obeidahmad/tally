import type { Page } from '@playwright/test';
import {
  test, expect, dialog, shot, row, chip, group, selectLike, createPerson, signInByApi, currencyPocket, todayIso, pocketRow, summary, srow } from '../support/fixtures';

// Spec 12: currencies and transfers. Browser acceptance criteria 2 to 7.
// Fixture rates (e2e/rates-fixture.xml): from 2026-01-05 USD 1.0860 and GBP 0.8650 per euro, from 2026-01-02 USD 1.1000 and GBP 0.8700.
// Today is after both dates, so today's rate is the 2026-01-05 one: 1 EUR = 1.0860 USD, 1 USD = 0.9208 EUR.
// 1,086.00 USD is exactly 1,000.00 EUR, 85.00 EUR received as 92.31 USD is "Rate 1.0860".
const desktop = { width: 1280, height: 900 };
test.use({ viewport: desktop });

const MINUS = '−';
const card = (page: Page, name: string) => pocketRow(page, name);
const addBtn = (page: Page) => page.getByRole('button', { name: 'Add transaction' }).first();

/** Two pockets and one subsection: "Bank of Cyprus" in EUR (1,000.00), "Revolut USD" in USD, and Needs / Food (300.00). */
async function seedTwo(page: Page, me: { seed: ReturnType<typeof import('../support/fixtures').seed> }, usdOpening = 0) {
  const needs = await me.seed.section('Needs');
  const food = await me.seed.subsection(needs.id, 'Food', 30000);
  const eur = await me.seed.pocket('Bank of Cyprus', 100000);
  const usd = await currencyPocket(page, 'Revolut USD', 'USD', usdOpening);
  return { food, eur, usd };
}

async function openTransfer(page: Page) {
  await page.goto('/transactions');
  await addBtn(page).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await chip(d, 'Type', 'Transfer').check();
  return d;
}
const submit = (d: ReturnType<typeof dialog>) => d.getByRole('button', { name: /^Add transfer$/ });
const amount = (d: ReturnType<typeof dialog>) => d.getByLabel('Amount', { exact: true });
const received = (d: ReturnType<typeof dialog>) => d.getByLabel('Amount received');

// ============ criterion 2: a USD pocket ============
test('the Pocket dialog offers Currency after Kind: base first, then the rest alphabetically, named in English; a USD pocket shows its balance, pill and "≈ … EUR"', async ({ page, me }) => {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  const d = dialog(page);
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  const order = ['name', 'emoji', 'kind', 'currency', 'opening balance'].map(at);
  expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
  expect([...order].sort((a, b) => a - b), JSON.stringify(labels)).toEqual(order);

  const options = await d.getByLabel('Currency').locator('option').allTextContents();
  expect(options[0].trim()).toBe('EUR · Euro');
  expect(options.map((o) => o.trim())).toContain('USD · US Dollar');
  expect(options.map((o) => o.trim())).toContain('GBP · British Pound');
  expect(options.some((o) => o.startsWith('JPY')), 'JPY has no two decimals and is not offered').toBe(false);
  const codes = options.slice(1).map((o) => o.trim().slice(0, 3));
  expect(codes).toEqual([...codes].sort());
  await expect(d.getByLabel('Currency')).toHaveValue('EUR');

  await d.getByLabel('Name').fill('Revolut USD');
  await d.getByLabel('Currency').selectOption({ label: 'USD · US Dollar' });
  await d.getByLabel('Opening balance').fill('1,086.00');
  await d.getByRole('button', { name: 'Add pocket' }).click();
  await expect(d).toBeHidden();
  const c = card(page, 'Revolut USD');
  await expect(c).toContainText('1,086.00');
  await expect(c).toContainText('USD'); // the row has no currency pill (spec 21); the currency stays in the row
  await expect(c).toContainText('≈ 1,000.00 EUR');
});

test('a pocket in the base currency shows no "≈" line', async ({ page, me }) => {
  await me.seed.pocket('Wallet', 5000, 'cash');
  await page.goto('/pockets');
  await expect(card(page, 'Wallet')).not.toContainText('≈');
});

test('GET /api/rates gives the fixture rate for the day, falling back both ways, and leaves out currencies without two decimals', async ({ page, me }) => {
  const get = async (date?: string) => (await (await page.request.get(`/api/rates${date ? `?date=${date}` : ''}`)).json());
  const usd = (r: { currencies: { currency: string; rate: string }[] }) => r.currencies.find((c) => c.currency === 'USD')?.rate;
  const today = await get();
  expect(today.base).toBe('EUR');
  expect(today.date).toBe('2026-01-05');
  expect(usd(today)).toBe('1.0860');
  const between = await get('2026-01-03');
  expect(between.date).toBe('2026-01-02');
  expect(usd(between)).toBe('1.1000');
  const before = await get('2025-12-30');
  expect(before.date, 'no rate on or before: the earliest after').toBe('2026-01-02');
  expect(usd(before)).toBe('1.1000');
  expect(today.currencies.find((c: { currency: string }) => c.currency === 'JPY')).toBeUndefined();
});

// ============ criterion 3: net worth header ============
test('the Pockets header shows Net worth, the total in the base currency and one line per currency', async ({ page, me }) => {
  await me.seed.pocket('Bank of Cyprus', 894255);
  await currencyPocket(page, 'Revolut USD', 'USD', 108600);
  await page.goto('/pockets');
  await expect(page.getByText('Net worth', { exact: true })).toBeVisible();
  const hero = page.locator('.num-hero').first();
  await expect(hero).toContainText('9,942.55');
  await expect(hero.locator('.ty-cur')).toHaveText('EUR');
  await expect(page.getByText('8,942.55 in EUR · 1,086.00 USD, worth 1,000.00 EUR at 0.9208')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add pocket' }).first()).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('Transfer is visible on a phone as a 44px outline button in the top bar (spec 27)', async ({ page, me }) => {
    await me.seed.pocket('Bank of Cyprus', 100000);
    await page.goto('/pockets');
    const btn = page.getByRole('button', { name: 'Transfer', exact: true });
    await expect(btn).toBeVisible();
    const b = (await btn.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
  });
});

test('with only base-currency pockets the net worth line is just that currency', async ({ page, me }) => {
  await me.seed.pocket('Bank of Cyprus', 894255);
  await page.goto('/pockets');
  await expect(page.locator('.num-hero').first()).toContainText('8,942.55');
  await expect(page.getByText('8,942.55 in EUR')).toHaveCount(0); // spec 21: no line that only repeats the net worth
  await expect(page.getByText(/worth .* at /)).toHaveCount(0);
});

test('a currency without a rate reads "No exchange rate for USD yet." and stays out of the total', async ({ page, baseURL }) => {
  // CHF is not in the fixture file, so USD cannot be converted into it.
  const who = await createPerson(baseURL!, 'Chuck', 'CHF');
  await signInByApi(page, who);
  await page.request.post('/api/pockets', { data: { name: 'Swiss', kind: 'bank', openingBalanceMinor: 10000 } });
  await currencyPocket(page, 'Revolut USD', 'USD', 5000);
  await page.goto('/pockets');
  await expect(page.locator('.num-hero').first()).toContainText('100.00');
  await expect(page.locator('.num-hero').first().locator('.ty-cur')).toHaveText('CHF');
  await expect(page.getByText('No exchange rate for USD yet.').first()).toBeVisible();
});

// ============ criterion 4: a transfer across currencies ============
test('the Transfer button on Pockets opens the transaction dialog on Transfer', async ({ page, me }) => {
  await seedTwo(page, me);
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('radio', { name: 'Transfer' })).toBeChecked();
});

test('Type has Expense, Income, Transfer in that order and the transfer fields come in the spec order', async ({ page, me }) => {
  await seedTwo(page, me);
  const d = await openTransfer(page);
  await expect(group(d, 'Type').locator('.ty-segmented label')).toHaveText(['Expense', 'Income', 'Transfer']);
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  // Before a To pocket is chosen there is no "Amount received" yet.
  await chip(d, 'From', /Bank of Cyprus/).check();
  await chip(d, 'To', /Revolut USD/).check();
  const after = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at2 = (s: string) => after.findIndex((l) => l.startsWith(s));
  const order = ['type', 'date', 'from', 'to', 'amount', 'amount received', 'note (optional)'].map(at2);
  expect(order.every((i) => i >= 0), JSON.stringify(after)).toBe(true);
  expect([...order].sort((a, b) => a - b), JSON.stringify(after)).toEqual(order);
  void at;
  await expect(d.getByLabel('Payee')).toHaveCount(0);
  await expect(d.getByLabel('Subsection')).toHaveCount(0); // spec 29: a transfer has no subsection
});

test('To leaves out the From pocket', async ({ page, me }) => {
  await seedTwo(page, me);
  const d = await openTransfer(page);
  await chip(d, 'From', /Bank of Cyprus/).check();
  await expect(chip(d, 'To', /Bank of Cyprus/)).toHaveCount(0);
  await expect(chip(d, 'To', /Revolut USD/)).toBeVisible();
});

test('85.00 EUR becoming 92.31 USD: the dialog says "Rate 1.0860", balances move, Budget is unchanged, the row reads as designed', async ({ page, me }) => {
  const { food } = await seedTwo(page, me);
  void food;
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();
  const budgetBefore = { stats: await summary(page).innerText(), food: await srow(page, /Food/).innerText() };

  const d = await openTransfer(page);
  await chip(d, 'From', /Bank of Cyprus/).check();
  await chip(d, 'To', /Revolut USD/).check();
  await expect(d.getByRole('heading', { name: 'Add transfer' })).toBeVisible();
  await amount(d).fill('85.00');
  await expect(d.getByText('EUR', { exact: true }).first()).toBeVisible();
  await expect(received(d)).toBeVisible();
  await expect(d.getByText('USD', { exact: true }).first()).toBeVisible();
  await received(d).fill('92.31');
  await expect(d.getByText("Rate 1.0860. Today's reference rate is 1.0860.")).toBeVisible();
  await submit(d).click();
  await expect(d).toBeHidden();

  // Transactions page
  const r = row(page, /Moved to Revolut USD/);
  await expect(r).toBeVisible();
  await expect(r.locator('b')).toHaveText('Moved to Revolut USD');
  await expect(r).toContainText('Transfer · 85.00 EUR became 92.31 USD at 1.0860');
  await expect(r).not.toContainText('Food'); // spec 29: no subsection on a transfer
  await expect(r).toContainText('Bank of Cyprus');
  const amt = r.locator('.ty-num');
  await expect(amt).toHaveText(/^\s*−85\.00\s*$/); // money out of the From pocket, in plain ink as TransactionRow shows
  await expect(amt).not.toHaveClass(/ty-num--pos/);

  // balances
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(card(page, 'Bank of Cyprus')).toContainText('915.00');
  await expect(card(page, 'Revolut USD')).toContainText('92.31');
  await expect(card(page, 'Revolut USD')).toContainText('≈ 85.00 EUR');
  await expect(page.locator('.num-hero').first()).toContainText('1,000.00');

  // Budget unchanged
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await expect(row(page, /Food/)).toBeVisible();
  expect(await summary(page).innerText()).toBe(budgetBefore.stats);
  expect(await srow(page, /Food/).innerText()).toBe(budgetBefore.food);
});

test('the Transactions page Pocket filter shows a transfer for either of its pockets', async ({ page, me }) => {
  const { eur, usd } = await seedTwo(page, me);
  const res = await page.request.post('/api/transactions', {
    data: { date: todayIso(), kind: 'transfer', pocketId: eur.id, toPocketId: usd.id, amountMinor: 8500, toAmountMinor: 9231 },
  });
  expect(res.status()).toBe(201);
  await page.goto('/transactions');
  await expect(page.getByLabel('Pocket').locator('option')).toHaveCount(3); // All pockets + the two
  await selectLike(page.getByLabel('Pocket'), 'Revolut USD');
  await expect(row(page, /Moved to Revolut USD/)).toBeVisible();
  await page.getByLabel('Pocket').selectOption({ label: 'Pocket' });
  await selectLike(page.getByLabel('Pocket'), 'Bank of Cyprus');
  await expect(row(page, /Moved to Revolut USD/)).toBeVisible();
});

test('a transfer across currencies without "Amount received" is refused with "Enter the amount that arrived."', async ({ page, me }) => {
  await seedTwo(page, me);
  const d = await openTransfer(page);
  await chip(d, 'From', /Bank of Cyprus/).check();
  await chip(d, 'To', /Revolut USD/).check();
  await amount(d).fill('85.00');
  await submit(d).click();
  await expect(d.getByText('Enter the amount that arrived.')).toBeVisible();
  await expect(received(d)).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
});

test('a transfer in one currency has no "Amount received" and reads "Transfer · 25.00 EUR"', async ({ page, me }) => {
  await me.seed.pocket('Bank of Cyprus', 100000);
  await me.seed.pocket('Wallet', 0, 'cash');
  const d = await openTransfer(page);
  await chip(d, 'From', /Bank of Cyprus/).check();
  await chip(d, 'To', /Wallet/).check();
  await amount(d).fill('25');
  await expect(d.getByLabel('Amount received')).toHaveCount(0);
  await submit(d).click();
  await expect(d).toBeHidden();
  const r = row(page, /Moved to Wallet/);
  await expect(r).not.toContainText('Transfer ·'); // spec 21: no same-currency transfer line
  await expect(r).toContainText('25.00');
  await expect(r).not.toContainText('became');
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(card(page, 'Bank of Cyprus')).toContainText('975.00');
  await expect(card(page, 'Wallet')).toContainText('25.00');
});

// ============ criterion 5: an expense from the USD pocket ============
test('a 10.00 expense from the USD pocket counts in the budget at 9.21 EUR and shows "10.00 USD" with "≈ 9.21 EUR"', async ({ page, me }) => {
  await seedTwo(page, me, 108600);
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();
  const food = () => srow(page, /Food/).locator('.ty-pill');
  await expect(food()).toHaveText('300.00');

  await page.goto('/transactions');
  await addBtn(page).click();
  const d = dialog(page);
  await chip(d, 'Paid from', /Revolut USD/).check();
  await expect(d.getByText('USD', { exact: true }).first()).toBeVisible();
  await amount(d).fill('10');
  await d.getByLabel('Payee').fill('Kiosk');
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await d.getByRole('button', { name: 'Add expense' }).click();
  await expect(d).toBeHidden();

  const r = row(page, /Kiosk/);
  await expect(r).toContainText('10.00 USD');
  await expect(r).toContainText('≈ 9.21 EUR');

  await page.getByRole('link', { name: 'Budget' }).first().click();
  await expect(food()).toHaveText('290.79'); // 300.00 - 9.21
  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(card(page, 'Revolut USD')).toContainText('1,076.00');
});

test('an expense takes the base amount at its own date: between two dates, before the first, after the last', async ({ page, me }) => {
  const { food, usd } = await seedTwo(page, me, 108600);
  const base = async (date: string) => {
    const res = await page.request.post('/api/transactions', { data: { date, kind: 'expense', amountMinor: 1000, pocketId: usd.id, subsectionId: food.id, payee: 'x' } });
    expect(res.status()).toBe(201);
    return (await res.json()).transaction.baseAmountMinor as number;
  };
  expect(await base('2026-01-03')).toBe(909); // 10.00 / 1.1000 on 2026-01-02
  expect(await base('2025-12-30')).toBe(909); // before every stored date: the earliest after
  expect(await base('2026-01-06')).toBe(921); // 10.00 / 1.0860 on 2026-01-05
});

// ============ criterion 6: the currency stays once there are transactions ============
test('a pocket with transactions shows Currency disabled with the reason; one without can change currency', async ({ page, me }) => {
  const { usd, eur } = await seedTwo(page, me);
  const src = await me.seed.source('Gift');
  await me.seed.income(usd.id, 1000, src.id);
  await page.goto('/pockets');
  await row(page, /Revolut USD/).click();
  const d = dialog(page);
  await expect(d.getByLabel('Currency')).toBeDisabled();
  await expect(d.getByLabel('Currency')).toHaveValue('USD');
  await expect(d.getByText('A pocket with transactions keeps its currency.')).toBeVisible();
  await page.keyboard.press('Escape');

  const res = await page.request.patch(`/api/pockets/${usd.id}`, { data: { currency: 'GBP' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.fields.currency).toBe('A pocket with transactions keeps its currency.');

  void eur;
  await row(page, /Bank of Cyprus/).click();
  await expect(d.getByLabel('Currency')).toBeEnabled();
  await expect(d.getByText('A pocket with transactions keeps its currency.')).toHaveCount(0);
  await d.getByLabel('Currency').selectOption({ label: 'GBP · British Pound' });
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(card(page, 'Bank of Cyprus')).toContainText('GBP');
});

test('a pocket is refused an unknown currency with "Choose a currency."', async ({ page, me }) => {
  const res = await page.request.post('/api/pockets', { data: { name: 'Odd', kind: 'bank', currency: 'JPY', openingBalanceMinor: 0 } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.fields.currency).toBe('Choose a currency.');
});

// ============ criterion 7: a transfer to the same pocket ============
test('a transfer to the same pocket is refused with "Choose a different pocket."', async ({ page, me }) => {
  const { eur, usd } = await seedTwo(page, me);
  const post = (data: object) => page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'transfer', amountMinor: 1000, ...data } });
  const same = await post({ pocketId: eur.id, toPocketId: eur.id });
  expect(same.status()).toBe(400);
  expect((await same.json()).error.fields.toPocketId).toBe('Choose a different pocket.');
  const missing = await post({ pocketId: eur.id, toPocketId: usd.id });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error.fields.toAmountMinor).toBe('Enter the amount that arrived.');
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`currencies ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('pockets with a USD pocket, the transfer dialog, and the Transactions page with a transfer', async ({ page, me }) => {
        const tag = `${size}-${scheme}`;
        const { eur, usd } = await seedTwo(page, me, 108600);
        await me.seed.pocket('Wallet', 12000, 'cash');
        await page.goto('/pockets');
        await expect(card(page, 'Revolut USD')).toContainText('≈ 1,000.00 EUR');
        await shot(page, `currencies-pockets-${tag}`);

        const d = await openTransfer(page);
        await chip(d, 'From', /Bank of Cyprus/).check();
        await chip(d, 'To', /Revolut USD/).check();
        await amount(d).fill('85.00');
        await received(d).fill('92.31');
        await expect(d.getByText(/Rate 1\.0860/)).toBeVisible();
        await shot(page, `currencies-dialog-transfer-${tag}`);
        await page.keyboard.press('Escape');

        const res = await page.request.post('/api/transactions', {
          data: { date: todayIso(), kind: 'transfer', pocketId: eur.id, toPocketId: usd.id, amountMinor: 8500, toAmountMinor: 9231 },
        });
        expect(res.status()).toBe(201);
        await page.goto('/transactions');
        await expect(row(page, /Moved to Revolut USD/)).toBeVisible();
        await shot(page, `currencies-transactions-${tag}`);
      });
    });
  }
}

void MINUS;
