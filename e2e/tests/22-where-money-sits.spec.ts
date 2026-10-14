import type { Page, Locator } from '@playwright/test';
import { test, expect, dialog, shot, row, chip, selectLike, currencyPocket, todayIso, thisMonth, group } from '../support/fixtures';

// Spec 14: where money sits and investments. Browser acceptance criteria 2 to 6.
// Fixture rates: today 1 EUR = 1.0860 USD, so 2,310.00 USD is about 2,127.07 EUR and 2,100.00 USD about 1,933.70 EUR.
test.use({ viewport: { width: 1280, height: 900 } });

const MINUS = '−';
const card = (page: Page, name: string) => page.locator('.ty-pocket', { hasText: name });
const invCard = (page: Page, name: string) => page.locator('.ty-card', { hasText: name }).filter({ hasText: /paid|No holdings/ }).first();
const heroNum = async (page: Page) => {
  await expect(page.locator('.num-hero').first()).toContainText(/[0-9]/);
  const t = (await page.locator('.num-hero').first().innerText()).replace(/[^0-9.]/g, '');
  return Math.round(parseFloat(t) * 100);
};
const whereTable = (page: Page): Locator =>
  page.locator('section', { has: page.getByRole('heading', { name: "Where each subsection's money sits" }) }).locator('table');
/** The text of the cell in `sub`'s row under the column headed with `pocket` ("Total in EUR" for the total). */
async function cellText(page: Page, sub: string, pocket: string) {
  const t = whereTable(page);
  await expect(t.locator('th').first()).toBeVisible();
  const heads = await t.locator('th').allInnerTexts();
  const i = heads.findIndex((h) => h.toLowerCase().includes(pocket.toLowerCase()));
  expect(i, `column ${pocket} in ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  const r = t.getByRole('row').filter({ hasText: sub });
  return (await r.locator('td').nth(i).innerText()).replace(/\s+/g, ' ').trim();
}

/** Car with 6,000.00 available (budget, nothing spent), "Bank" (oldest, 10,000.00 EUR, the home pocket) and "Fund" (0). */
async function seedWhere(page: Page, me: { seed: ReturnType<typeof import('../support/fixtures').seed> }) {
  const sec = await me.seed.section('Savings');
  const car = await me.seed.subsection(sec.id, 'Car', 600000);
  const bank = await me.seed.pocket('Bank', 1000000);
  const fund = await me.seed.pocket('Fund', 0, 'fund');
  return { car, bank, fund };
}
const transfer = (page: Page, data: object) =>
  page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'transfer', ...data } });

/** A USD broker, an EUR bank and a subsection, for holdings. */
async function seedBroker(page: Page, me: { seed: ReturnType<typeof import('../support/fixtures').seed> }, usdOpening = 210000) {
  const sec = await me.seed.section('Savings');
  const inv = await me.seed.subsection(sec.id, 'Long-term investing', 0);
  const bank = await me.seed.pocket('Bank', 100000);
  const broker = await currencyPocket(page, 'Trading212', 'USD', usdOpening, 'broker');
  return { inv, bank, broker };
}
const holdings = async (page: Page) => (await (await page.request.get('/api/holdings')).json()).holdings as
  { id: number; name: string; paidMinor: number; worthMinor: number; soldDate: string | null }[];
const addHolding = async (page: Page, data: object) => {
  const res = await page.request.post('/api/holdings', { data });
  expect(res.status()).toBe(201);
  return (await res.json()).holding as { id: number };
};
const txs = async (page: Page) => (await (await page.request.get(`/api/transactions?month=${thisMonth()}`)).json()).transactions as
  { kind: string; amountMinor: number; note: string; sourceId: number | null; subsectionId: number | null; pocketId: number }[];

// ============ criterion 2: the where table ============
test('Car 6,000.00: after a 2,000.00 transfer tagged Car, Bank shows 4,000.00 and Fund 2,000.00; after a 100.00 expense from Fund, Fund shows 1,900.00; the total matches Available', async ({ page, me }) => {
  const { car, bank, fund } = await seedWhere(page, me);
  await page.goto('/pockets');
  await expect(page.getByRole('heading', { name: "Where each subsection's money sits" })).toBeVisible();
  expect(await cellText(page, 'Car', 'Bank')).toBe('6,000.00');
  expect(await cellText(page, 'Car', 'Total in EUR')).toBe('6,000.00');

  expect((await transfer(page, { pocketId: bank.id, toPocketId: fund.id, amountMinor: 200000, toAmountMinor: 200000, subsectionId: car.id })).status()).toBe(201);
  await page.reload();
  expect(await cellText(page, 'Car', 'Bank')).toBe('4,000.00');
  expect(await cellText(page, 'Car', 'Fund')).toBe('2,000.00');
  expect(await cellText(page, 'Car', 'Total in EUR')).toBe('6,000.00');

  await me.seed.expense(fund.id, car.id, 10000, 'Garage');
  await page.reload();
  expect(await cellText(page, 'Car', 'Bank')).toBe('4,000.00');
  expect(await cellText(page, 'Car', 'Fund')).toBe('1,900.00');
  expect(await cellText(page, 'Car', 'Total in EUR')).toBe('5,900.00');

  await page.goto('/budget');
  await expect(row(page, /Car/).locator('.ty-pill')).toHaveText('5,900.00');
});

test('a cell with no money reads "–", a pocket nobody uses is not a column, and a row has its section dot', async ({ page, me }) => {
  const { car, bank, fund } = await seedWhere(page, me);
  await me.seed.pocket('Unused', 5000);
  const sec2 = await me.seed.section('Wants');
  await me.seed.subsection(sec2.id, 'Gifts', 0);
  await page.goto('/pockets');
  await expect(whereTable(page).locator('th').first()).toBeVisible();
  const heads = await whereTable(page).locator('th').allInnerTexts();
  expect(heads[0]).toMatch(/subsection/i);
  expect(heads.some((h) => /unused/i.test(h)), JSON.stringify(heads)).toBe(false);
  expect(heads.some((h) => /fund/i.test(h)), 'Fund has no money of any subsection').toBe(false);
  await expect(whereTable(page).getByRole('row').filter({ hasText: 'Gifts' })).toHaveCount(0); // nothing available, no cell
  await expect(whereTable(page).getByRole('row').filter({ hasText: 'Car' }).locator('.ty-dot')).toHaveCount(1);
  void car; void bank; void fund;
  // once a transfer moves 2,000.00 to Fund, Fund appears and Bank keeps 4,000.00
  await transfer(page, { pocketId: bank.id, toPocketId: fund.id, amountMinor: 200000, toAmountMinor: 200000, subsectionId: car.id });
  await page.reload();
  expect(await cellText(page, 'Car', 'Fund')).toBe('2,000.00');
});

test('a cell in another currency shows the code, and the total is in EUR', async ({ page, me }) => {
  const { bank, broker } = await seedBroker(page, me, 0);
  const sec = await me.seed.section('Goals');
  const inv = await me.seed.subsection(sec.id, 'Nest egg', 212707); // available 2,127.07
  // 1,933.70 EUR moved to the broker as 2,100.00 USD, tagged Nest egg, then spent on a holding worth 2,310.00 USD
  expect((await transfer(page, { pocketId: bank.id, toPocketId: broker.id, amountMinor: 193370, toAmountMinor: 210000, subsectionId: inv.id })).status()).toBe(201);
  await addHolding(page, { name: 'Index fund', pocketId: broker.id, subsectionId: inv.id, paidMinor: 210000, worthMinor: 231000, worthCurrency: 'USD' });
  await page.goto('/pockets');
  expect((await cellText(page, 'Nest egg', 'Trading212')).replace(/[  \n]/g, '')).toBe('2,310.00USD');
  expect(await cellText(page, 'Nest egg', 'Total in EUR')).toMatch(/^2,127\.0[6-8]$/);
});

// ============ criterion 3: a holding ============
test('adding a holding of 2,100.00 USD and updating its worth to 2,310.00 USD shows +10.0%, the card line and net worth rising by the difference', async ({ page, me }) => {
  await seedBroker(page, me, 210000);
  await page.goto('/pockets');
  const before = await heroNum(page);

  await page.getByRole('link', { name: 'Investments' }).first().click();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();
  await expect(page.getByText('No holdings yet. Add one to follow what it is worth.')).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add holding' })).toBeVisible();
  await d.getByLabel('Name', { exact: true }).fill('Index fund');
  await chip(d, 'Pocket', /Trading212/).check();
  await selectLike(d.getByLabel('Subsection', { exact: true }), 'Long-term investing');
  await d.getByLabel('Paid', { exact: true }).fill('2100.00');
  await d.getByRole('button', { name: 'Add holding' }).click();
  await expect(d).toBeHidden();

  const c = invCard(page, 'Trading212');
  await expect(c).toContainText('Index fund');
  await expect(c).toContainText('Long-term investing');
  await expect(c).toContainText('paid 2,100.00 USD');
  await expect(c).toContainText('worth 2,100.00 USD');
  await expect(c).toContainText('updated');
  await expect(c.locator('.ty-pill').filter({ hasText: '%' })).toHaveText('0.0%'); // neutral

  await c.getByRole('button', { name: 'Update value' }).click();
  await expect(d.getByLabel('Worth now', { exact: true })).toBeFocused();
  await d.getByLabel('Worth now', { exact: true }).fill('2310.00');
  await expect(d.getByLabel('Currency', { exact: true })).toHaveValue('USD');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(c).toContainText('worth 2,310.00 USD');
  const pill = c.locator('.ty-pill').filter({ hasText: '%' });
  await expect(pill).toHaveText('+10.0%');
  await expect(pill).toHaveClass(/ty-pill--positive/);

  await page.getByRole('link', { name: 'Pockets' }).first().click();
  await expect(card(page, 'Trading212')).toContainText(/≈ 2,127\.0[6-8] EUR · paid 2,100\.00 USD/);
  const after = await heroNum(page);
  // 210.00 USD at 1.0860 is 193.37 EUR
  expect(Math.abs(after - before - 19337)).toBeLessThanOrEqual(2);
});

test('a holding below its paid amount reads as a negative pill with a minus sign', async ({ page, me }) => {
  const { inv, broker } = await seedBroker(page, me);
  await addHolding(page, { name: 'Dip', pocketId: broker.id, subsectionId: inv.id, paidMinor: 100000, worthMinor: 95800, worthCurrency: 'USD' });
  await page.goto('/investments');
  const pill = invCard(page, 'Trading212').locator('.ty-pill').filter({ hasText: '%' });
  await expect(pill).toHaveText(`${MINUS}4.2%`);
  await expect(pill).toHaveClass(/ty-pill--negative/);
});

test('a holding can change currency: paid 1,000.00 EUR, worth 900.00 USD', async ({ page, me }) => {
  const { inv, bank } = await seedBroker(page, me);
  await addHolding(page, { name: 'Gold', pocketId: bank.id, subsectionId: inv.id, paidMinor: 100000 });
  await page.goto('/investments');
  const c = invCard(page, 'Bank');
  await c.getByRole('button', { name: 'Update value' }).click();
  const d = dialog(page);
  await expect(d.getByLabel('Currency', { exact: true })).toHaveValue('EUR');
  await d.getByLabel('Worth now', { exact: true }).fill('900.00');
  await d.getByLabel('Currency', { exact: true }).selectOption({ label: 'USD · US Dollar' });
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(c).toContainText('paid 1,000.00 EUR');
  await expect(c).toContainText('worth 900.00 USD');
});

test('editing a holding offers Delete, and deleting removes it', async ({ page, me }) => {
  const { inv, bank } = await seedBroker(page, me);
  await addHolding(page, { name: 'Gold', pocketId: bank.id, subsectionId: inv.id, paidMinor: 100000 });
  await page.goto('/investments');
  await expect(page.getByText('Gold')).toBeVisible();
  await page.getByText('Gold').first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit holding' })).toBeVisible();
  await d.getByRole('button', { name: 'Delete' }).click();
  // a confirmation may follow; accept it when it does
  const confirm = page.getByRole('dialog').getByRole('button', { name: /^Delete$/ });
  if (await confirm.count() && (await page.getByRole('dialog').count()) > 0 && await confirm.isVisible()) await confirm.click();
  await expect(page.getByText('No holdings yet. Add one to follow what it is worth.')).toBeVisible();
  expect(await holdings(page)).toHaveLength(0);
});

test('the Add holding dialog refuses an empty name with "Enter a name."', async ({ page, me }) => {
  await seedBroker(page, me);
  await page.goto('/investments');
  await page.getByRole('button', { name: 'Add holding' }).first().click();
  const d = dialog(page);
  await chip(d, 'Pocket', /Trading212/).check();
  await d.getByLabel('Paid', { exact: true }).fill('10');
  await d.getByRole('button', { name: 'Add holding' }).click();
  await expect(d.getByText('Enter a name.')).toBeVisible();
  await expect(d).toBeVisible();
});

// ============ criterion 4: selling ============
test('selling for 2,400.00 with a source records 300.00 income from that source and moves the holding under Sold', async ({ page, me }) => {
  const { inv, broker } = await seedBroker(page, me, 210000);
  const src = await me.seed.source('Trading profit');
  await addHolding(page, { name: 'Index fund', pocketId: broker.id, subsectionId: inv.id, paidMinor: 210000, worthMinor: 231000, worthCurrency: 'USD' });
  await page.goto('/investments');
  await invCard(page, 'Trading212').getByRole('button', { name: 'Sell' }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Sell Index fund' })).toBeVisible();
  await expect(d.getByLabel('Date', { exact: true })).toBeVisible();
  await d.getByLabel('Received', { exact: true }).fill('2400.00');
  await expect(d.getByText('The profit counts as income from this source.')).toBeVisible();
  await d.getByLabel('Source', { exact: true }).selectOption({ label: 'Trading profit' });
  await d.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(d).toBeHidden();

  await expect(page.getByText('Sold', { exact: true })).toBeVisible();
  await expect(page.getByText('Index fund')).toBeVisible();
  const sale = (await txs(page)).find((t) => t.note === 'Sale of Index fund');
  expect(sale, 'a transaction with the note "Sale of Index fund"').toBeTruthy();
  expect(sale!.kind).toBe('income');
  expect(sale!.amountMinor).toBe(30000);
  expect(sale!.sourceId).toBe(src.id);
  expect(sale!.pocketId).toBe(broker.id);
  expect((await holdings(page))[0].soldDate).toBe(todayIso());
  await expect(invCard(page, 'Trading212').getByRole('button', { name: 'Sell' })).toHaveCount(0);
});

test('selling below cost shows the loss hint and records the loss as an expense in the holding\'s subsection', async ({ page, me }) => {
  const { inv, broker } = await seedBroker(page, me, 100000);
  await addHolding(page, { name: 'Dip', pocketId: broker.id, subsectionId: inv.id, paidMinor: 100000 });
  await page.goto('/investments');
  await invCard(page, 'Trading212').getByRole('button', { name: 'Sell' }).click();
  const d = dialog(page);
  await d.getByLabel('Received', { exact: true }).fill('900.00');
  await expect(d.getByText('The loss counts as spending in Long-term investing.')).toBeVisible();
  await expect(d.getByLabel('Source', { exact: true })).toHaveCount(0);
  await d.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(d).toBeHidden();
  const sale = (await txs(page)).find((t) => t.note === 'Sale of Dip');
  expect(sale, 'a transaction with the note "Sale of Dip"').toBeTruthy();
  expect(sale!.kind).toBe('expense');
  expect(sale!.amountMinor).toBe(10000);
  expect(sale!.subsectionId).toBe(inv.id);
  await expect(page.getByText('Sold', { exact: true })).toBeVisible();
});

test('selling at cost records nothing', async ({ page, me }) => {
  const { inv, broker } = await seedBroker(page, me, 100000);
  await addHolding(page, { name: 'Flat', pocketId: broker.id, subsectionId: inv.id, paidMinor: 100000 });
  await page.goto('/investments');
  await invCard(page, 'Trading212').getByRole('button', { name: 'Sell' }).click();
  const d = dialog(page);
  await d.getByLabel('Received', { exact: true }).fill('1000.00');
  await expect(d.getByText('The profit counts as income from this source.')).toHaveCount(0);
  await expect(d.getByText(/The loss counts as spending/)).toHaveCount(0);
  await d.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(d).toBeHidden();
  expect((await txs(page)).filter((t) => t.note === 'Sale of Flat')).toHaveLength(0);
  expect((await holdings(page))[0].soldDate).toBe(todayIso());
});

// ============ criterion 5: Budget note ============
test('the Budget row of a subsection with a held holding reads "paid 1,200.00 · worth 1,260.00"', async ({ page, me }) => {
  const sec = await me.seed.section('Savings');
  const inv = await me.seed.subsection(sec.id, 'Long-term investing', 0);
  const pocket = await me.seed.pocket('Trading212', 500000, 'broker');
  await addHolding(page, { name: 'ETF', pocketId: pocket.id, subsectionId: inv.id, paidMinor: 120000, worthMinor: 126000 });
  await page.goto('/budget');
  await expect(row(page, /Long-term investing/)).toContainText('paid 1,200.00 · worth 1,260.00');
});

// ============ criterion 6: home pocket ============
test('changing the home pocket in Settings moves the untransferred money to that pocket\'s column', async ({ page, me }) => {
  const { bank, fund } = await seedWhere(page, me);
  await page.goto('/pockets');
  expect(await cellText(page, 'Car', 'Bank')).toBe('6,000.00');

  await page.goto('/settings');
  const sel = page.getByLabel('Home pocket');
  await expect(sel).toBeVisible();
  await expect(page.getByText('Money sits here unless you move it with a transfer.')).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().includes('/api/me') && r.request().method() === 'PATCH');
  await selectLike(sel, 'Fund');
  await saved;

  await page.goto('/pockets');
  expect(await cellText(page, 'Car', 'Fund')).toBe('6,000.00');
  await expect(whereTable(page).locator('th').first()).toBeVisible();
  const heads = await whereTable(page).locator('th').allInnerTexts();
  expect(heads.some((h) => /bank/i.test(h)), 'Bank no longer holds any of Car').toBe(false);
  void bank; void fund;
});

test('the home pocket defaults to the oldest pocket and is a select of the person\'s pockets', async ({ page, me }) => {
  await seedWhere(page, me);
  await page.goto('/settings');
  const sel = page.getByLabel('Home pocket');
  await expect(sel.locator('option')).toHaveCount(2);
  const opts = await sel.locator('option').allTextContents();
  expect(opts.some((o) => o.includes('Bank'))).toBe(true);
  expect(opts.some((o) => o.includes('Fund'))).toBe(true);
  await expect(sel.locator('option:checked')).toContainText('Bank');
});

// ============ navigation on phones ============
test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the Pockets header has an Investments button that opens the Investments page', async ({ page, me }) => {
    await seedBroker(page, me);
    await page.goto('/pockets');
    await page.getByRole('button', { name: 'Investments', exact: true }).click();
    await expect(page).toHaveURL(/\/investments$/);
    await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();
  });
});

// ============ isolation ============
test('another person does not see my holdings', async ({ page, me, baseURL, browser }) => {
  const { inv, broker } = await seedBroker(page, me);
  await addHolding(page, { name: 'Mine', pocketId: broker.id, subsectionId: inv.id, paidMinor: 1000 });
  const { createPerson } = await import('../support/fixtures');
  const other = await createPerson(baseURL!, 'Olga');
  const ctx = await browser.newContext({ baseURL });
  const res = await ctx.request.post('/api/auth/login', { data: { username: other.username, password: other.password } });
  expect(res.status()).toBe(200);
  expect((await (await ctx.request.get('/api/holdings')).json()).holdings).toEqual([]);
  await ctx.close();
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`holdings ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('pockets with the where table, investments, the holding dialog and the sell dialog', async ({ page, me }) => {
        const tag = `${size}-${scheme}`;
        const sec = await me.seed.section('Savings');
        const car = await me.seed.subsection(sec.id, 'Car', 600000);
        const inv = await me.seed.subsection(sec.id, 'Long-term investing', 0);
        const bank = await me.seed.pocket('Bank of Cyprus', 1000000);
        const fund = await me.seed.pocket('Daily income fund', 0, 'fund');
        const broker = await currencyPocket(page, 'Trading212', 'USD', 210000, 'broker');
        await me.seed.source('Trading profit');
        await transfer(page, { pocketId: bank.id, toPocketId: fund.id, amountMinor: 200000, toAmountMinor: 200000, subsectionId: car.id });
        await addHolding(page, { name: 'Index fund', pocketId: broker.id, subsectionId: inv.id, paidMinor: 210000, worthMinor: 231000, worthCurrency: 'USD' });
        await addHolding(page, { name: 'Dip', pocketId: bank.id, subsectionId: inv.id, paidMinor: 50000, worthMinor: 47900, worthCurrency: 'EUR' });
        const sold = await addHolding(page, { name: 'Old bond', pocketId: bank.id, subsectionId: inv.id, paidMinor: 10000 });
        expect((await page.request.post(`/api/holdings/${sold.id}/sell`, { data: { date: todayIso(), receivedMinor: 10000 } })).status()).toBe(200);

        await page.goto('/pockets');
        const where = size === 'phone' ? page.getByText('4,000.00 in Bank of Cyprus · 2,000.00 in Daily income fund') : whereTable(page);
        await expect(where).toBeVisible();
        if (size === 'phone') await expect(whereTable(page)).toBeHidden();
        await shot(page, `where-pockets-${tag}`);
        await where.scrollIntoViewIfNeeded();
        await shot(page, `where-table-${tag}`);

        await page.goto('/investments');
        await expect(page.getByText('Index fund')).toBeVisible();
        await shot(page, `investments-${tag}`);

        await invCard(page, 'Trading212').getByRole('button', { name: 'Update value' }).click();
        await expect(dialog(page)).toBeVisible();
        await shot(page, `investments-dialog-edit-${tag}`);
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: 'Add holding' }).first().click();
        await expect(dialog(page)).toBeVisible();
        await shot(page, `investments-dialog-add-${tag}`);
        await page.keyboard.press('Escape');

        await invCard(page, 'Trading212').getByRole('button', { name: 'Sell' }).click();
        await dialog(page).getByLabel('Received', { exact: true }).fill('2400.00');
        await expect(dialog(page).getByLabel('Source', { exact: true })).toBeVisible();
        await shot(page, `investments-dialog-sell-profit-${tag}`);
        await dialog(page).getByLabel('Received', { exact: true }).fill('2000.00');
        await shot(page, `investments-dialog-sell-loss-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/settings');
        await shot(page, `settings-home-pocket-${tag}`);
        void group;
      });
    });
  }
}
