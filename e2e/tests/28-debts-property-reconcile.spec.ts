import { test, expect, dialog, toast, shot, pocketRow, seedBudget, todayIso, type Seed } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 23: credit cards, loans, property and reconciling on the Pockets page.
// Screenshots: spec23-<state>-<desktop|phone>-<light|dark>.png in e2e/screenshots/.
const hero = (page: Page) => page.locator('.num-hero').first();
/** A group card of the Pockets page, found by its title. */
// the SummaryCard (Assets, Debts) is a region with the same name: the group card is the one with buttons in it
const groupCard = (page: Page, title: string): Locator => page.getByRole('region', { name: title, exact: true }).filter({ has: page.getByRole('button') }).first();
const lastDialog = (page: Page) => dialog(page).last();
const MONTH_DAY = (d = new Date()) => `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;

const pocketsApi = async (page: Page) =>
  (await (await page.request.get('/api/pockets')).json()).pockets as { id: number; name: string; kind: string; group: string; balanceMinor: number; reconciledAt?: string | null }[];
const netApi = async (page: Page) => (await (await page.request.get('/api/networth')).json()) as { assetsMinor: number; debtsMinor: number };

async function addPocketUi(page: Page, o: { name: string; kind: string; amountLabel: string; amount: string }) {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  const d = dialog(page);
  await d.getByLabel('Name').fill(o.name);
  await d.getByLabel('Kind').selectOption({ label: o.kind });
  await d.getByLabel(o.amountLabel, { exact: true }).fill(o.amount);
  await d.getByRole('button', { name: 'Add pocket' }).click();
  await expect(d).toBeHidden();
}

async function transfer(page: Page, from: number, to: number, amountMinor: number) {
  const r = await page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'transfer', amountMinor, pocketId: from, toPocketId: to } });
  expect(r.status(), await r.text()).toBe(201);
}

/** A bank with 1,000.00, a card owed 500.00, a loan owed 2,000.00 and a home worth 250,000.00: all four groups. */
async function seedAllGroups(s: Seed, page: Page) {
  const bank = await s.pocket('Revolut', 100000, 'bank');
  const cash = await s.pocket('Wallet', 5000, 'cash');
  const fund = await s.pocket('Index fund', 20000, 'fund');
  const card = (await (await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 50000 } })).json()).pocket as { id: number };
  const loan = (await (await page.request.post('/api/pockets', { data: { name: 'Car loan', kind: 'loan', openingBalanceMinor: 200000 } })).json()).pocket as { id: number };
  const home = (await (await page.request.post('/api/pockets', { data: { name: 'Flat', kind: 'property', valueMinor: 25000000 } })).json()).pocket as { id: number };
  return { bank, cash, fund, card, loan, home };
}

// ============ credit cards ============
test('a credit card owed 500.00: spend on it, pay it from a bank, and the balances and net worth follow', async ({ page, me }) => {
  const bank = await me.seed.pocket('Revolut', 100000, 'bank');
  const sec = await me.seed.section('Needs');
  const food = await me.seed.subsection(sec.id, 'Food', 30000);
  await addPocketUi(page, { name: 'Visa', kind: 'Credit card', amountLabel: 'Owed now', amount: '500.00' });
  const visa = pocketRow(page, 'Visa');
  await expect(visa).toContainText('500.00');
  await expect(visa.locator('.ty-num--neg, .negative, [class*="negative"]').first()).toBeVisible();
  let card = (await pocketsApi(page)).find((p) => p.name === 'Visa')!;
  expect(card.balanceMinor).toBe(-50000); // stored negative
  expect(card.group).toBe('debts');
  await expect(hero(page)).toContainText('500.00'); // 1,000.00 - 500.00

  await me.seed.expense(card.id, food.id, 3000, 'Supermarket'); // owed 530.00
  await page.reload();
  await expect(pocketRow(page, 'Visa')).toContainText('530.00');
  await transfer(page, bank.id, card.id, 20000); // owed 330.00, bank 800.00
  await page.reload();
  await expect(pocketRow(page, 'Visa')).toContainText('330.00');
  await expect(pocketRow(page, 'Revolut')).toContainText('800.00');
  await expect(hero(page)).toContainText('470.00'); // 800.00 - 330.00
  const net = await netApi(page);
  expect(net.assetsMinor).toBe(80000);
  expect(net.debtsMinor).toBe(33000);
  await expect(page.getByText('Assets', { exact: true }).locator('xpath=..')).toContainText('800.00');
  await expect(page.getByText('Debts', { exact: true }).first().locator('xpath=..')).toContainText('330.00');
});

test('a loan asks for "Owed now" and a property asks for "Value" with no opening balance', async ({ page, me }) => {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).last().click();
  const d = dialog(page);
  const kind = d.getByLabel('Kind');
  for (const k of ['Credit card', 'Loan', 'Property']) await expect(kind.locator('option', { hasText: k })).toHaveCount(1);
  await kind.selectOption({ label: 'Loan' });
  await expect(d.getByLabel('Owed now', { exact: true })).toBeVisible();
  await kind.selectOption({ label: 'Property' });
  await expect(d.getByLabel('Value', { exact: true })).toBeVisible();
  await expect(d.getByLabel('Opening balance')).toHaveCount(0);
  await expect(d.getByLabel('Owed now')).toHaveCount(0);
  await kind.selectOption({ label: 'Bank account' });
  await expect(d.getByLabel('Opening balance')).toBeVisible();
});

// ============ property ============
test('a property pocket holds values: create it, add an older value, replace today\'s, remove one', async ({ page, me }) => {
  await addPocketUi(page, { name: 'Flat', kind: 'Property', amountLabel: 'Value', amount: '250000.00' });
  const flat = pocketRow(page, 'Flat');
  await expect(flat).toContainText('250,000.00');
  await expect(hero(page)).toContainText('250,000.00');
  expect((await pocketsApi(page)).find((p) => p.name === 'Flat')!.group).toBe('property');

  await flat.click();
  const d = dialog(page);
  await expect(d.getByText('250,000.00').first()).toBeVisible();
  await expect(d.getByRole('button', { name: 'Reconcile' })).toHaveCount(0); // no balance to reconcile
  await d.getByRole('button', { name: 'Update value' }).click();
  const old = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  await d.getByLabel('Amount').or(d.getByLabel('Value', { exact: true })).last().fill('240000.00');
  await d.getByLabel('Date').last().fill(old);
  await d.getByRole('button', { name: 'Update value' }).last().click();
  await expect(d.getByText('240,000.00')).toBeVisible();
  // today's value is still the latest
  await page.keyboard.press('Escape');
  await expect(pocketRow(page, 'Flat')).toContainText('250,000.00');

  const flatId = (await pocketsApi(page)).find((p) => p.name === 'Flat')!.id;
  // a second value on the same date replaces the first
  const same = await page.request.post(`/api/pockets/${flatId}/values`, { data: { valueMinor: 26000000, date: todayIso() } });
  expect(same.status()).toBe(201);
  const list = (await (await page.request.get(`/api/pockets/${flatId}/values`)).json()).values as { id: number; valueMinor: number; date: string }[];
  expect(list).toHaveLength(2);
  expect(list[0].valueMinor).toBe(26000000);
  await page.reload();
  await expect(pocketRow(page, 'Flat')).toContainText('260,000.00');
  await expect(hero(page)).toContainText('260,000.00');

  await pocketRow(page, 'Flat').click();
  await expect(dialog(page).getByText('240,000.00')).toBeVisible();
  await dialog(page).getByRole('button', { name: /^Remove/ }).last().click();
  await expect(dialog(page).getByText('240,000.00')).toHaveCount(0);
});

test('a transaction or transfer on a property pocket is refused with "A property pocket holds a value, not transactions."', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const home = (await (await page.request.post('/api/pockets', { data: { name: 'Flat', kind: 'property', valueMinor: 1000000 } })).json()).pocket as { id: number };
  const tx = await page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'expense', amountMinor: 100, pocketId: home.id, subsectionId: b.food.id, payee: 'x' } });
  expect(tx.status()).toBe(400);
  expect((await tx.json()).error.fields.pocketId).toBe('A property pocket holds a value, not transactions.');
  const tr = await page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'transfer', amountMinor: 100, pocketId: b.pocket.id, toPocketId: home.id } });
  expect(tr.status()).toBe(400);
  expect((await tr.json()).error.fields.toPocketId).toBe('A property pocket holds a value, not transactions.');
});

// ============ groups and the top card ============
test('the Pockets page groups pockets in the order Cash, Investments, Property, Debts, with totals, and nets assets and debts', async ({ page, me }) => {
  await seedAllGroups(me.seed, page);
  await page.goto('/pockets');
  // 1,000.00 + 50.00 + 200.00 + 250,000.00 assets; 500.00 + 2,000.00 debts
  await expect(hero(page)).toContainText('248,750.00');
  await expect(page.getByText('Net worth', { exact: true })).toBeVisible();
  await expect(page.getByText(/Assets\s*251,250\.00/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Debts', exact: true }).last()).toContainText('2,500.00');
  const titles = ['Cash', 'Investments', 'Property', 'Debts'];
  const ys: number[] = [];
  for (const t of titles) ys.push((await groupCard(page, t).boundingBox())!.y);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  const totals: [string, string, string[]][] = [
    ['Cash', '1,050.00', ['Revolut', 'Wallet']],
    ['Investments', '200.00', ['Index fund']],
    ['Property', '250,000.00', ['Flat']],
    ['Debts', '2,500.00', ['Visa', 'Car loan']],
  ];
  for (const [t, total, names] of totals) {
    const c = groupCard(page, t);
    await expect(c, t).toContainText(total);
    for (const n of names) await expect(c.getByRole('button', { name: new RegExp(n) }), `${n} in ${t}`).toBeVisible();
  }
  await expect(groupCard(page, 'Debts').getByRole('button', { name: /Visa/ })).toContainText('500.00');
});

test('a group with no pockets has no card', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000, 'bank');
  await page.goto('/pockets');
  await expect(groupCard(page, 'Cash')).toBeVisible();
  for (const t of ['Investments', 'Property', 'Debts']) await expect(groupCard(page, t)).toHaveCount(0);
});

test('net worth equals assets minus debts through the API, with property at its latest value', async ({ page, me }) => {
  const { home } = await seedAllGroups(me.seed, page);
  let net = await netApi(page);
  expect(net.assetsMinor).toBe(100000 + 5000 + 20000 + 25000000);
  expect(net.debtsMinor).toBe(250000);
  const r = await page.request.post(`/api/pockets/${home.id}/values`, { data: { valueMinor: 26000000, date: todayIso() } });
  expect(r.status()).toBe(201);
  net = await netApi(page);
  expect(net.assetsMinor).toBe(100000 + 5000 + 20000 + 26000000);
});

// ============ reconciling ============
async function openReconcile(page: Page, name: string) {
  await page.goto('/pockets');
  await pocketRow(page, name).click();
  await dialog(page).getByRole('button', { name: 'Reconcile', exact: true }).click();
  return lastDialog(page);
}

test('reconcile up: an adjustment is added, the balance and the row follow, and Undo takes it back', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000, 'bank');
  const d = await openReconcile(page, 'Revolut');
  await expect(d.getByText('What does Revolut show today?')).toBeVisible();
  await expect(d.getByLabel('Date')).toHaveValue(todayIso());
  await d.getByRole('textbox').first().fill('1050.00');
  await d.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(toast(page)).toContainText('Added an adjustment of +50.00.');
  await expect(pocketRow(page, 'Revolut')).toContainText('1,050.00');
  await expect(pocketRow(page, 'Revolut')).toContainText(`Reconciled ${MONTH_DAY()}`);

  // The adjustment is a transaction that is not budget spending or income.
  const tx = (await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as { payee: string; source?: string; subsectionId: number | null }[];
  const adj = tx.find((t) => t.payee === 'Balance adjustment')!;
  expect(adj.source).toBe('adjustment');
  expect(adj.subsectionId).toBeNull();

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(pocketRow(page, 'Revolut')).toContainText('1,000.00');
  expect(((await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as unknown[]).length).toBe(0);
});

test('reconcile down adds a negative adjustment', async ({ page, me }) => {
  await me.seed.pocket('Wallet', 5000, 'cash');
  const d = await openReconcile(page, 'Wallet');
  await d.getByRole('textbox').first().fill('42.50');
  await d.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(toast(page)).toContainText(/Added an adjustment of [−-]7\.50\./);
  await expect(pocketRow(page, 'Wallet')).toContainText('42.50');
});

test('reconcile with the same figure: "Matches. Reconciled today." and no adjustment', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000, 'bank');
  const d = await openReconcile(page, 'Revolut');
  await d.getByRole('textbox').first().fill('1000.00');
  await d.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(toast(page)).toContainText('Matches. Reconciled today.');
  await expect(toast(page).getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(pocketRow(page, 'Revolut')).toContainText(`Reconciled ${MONTH_DAY()}`);
  expect(((await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as unknown[]).length).toBe(0);
});

test('a credit card is reconciled by what you owe', async ({ page, me }) => {
  await seedAllGroups(me.seed, page);
  const d = await openReconcile(page, 'Visa');
  await expect(d.getByText('How much does Visa say you owe?')).toBeVisible();
  await d.getByRole('textbox').first().fill('450.00');
  await d.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(toast(page)).toContainText('Added an adjustment of +50.00.');
  await expect(pocketRow(page, 'Visa')).toContainText('450.00');
});

test('an adjustment shows an "Adjustment" pill in Transactions and is not income or spending in the Budget', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000, 'bank');
  const d = await openReconcile(page, 'Revolut');
  await d.getByRole('textbox').first().fill('1050.00');
  await d.getByRole('button', { name: 'Reconcile', exact: true }).click();
  await expect(toast(page)).toContainText('Added an adjustment');
  await page.goto('/transactions');
  const r = page.getByRole('button', { name: /Balance adjustment/ });
  await expect(r.locator('.ty-pill:visible', { hasText: 'Adjustment' })).toBeVisible();
  await expect(r).toContainText('+50.00');
  await page.goto('/budget');
  await expect(page.getByText('Balance adjustment')).toHaveCount(0);
});

test('reconciling a property pocket, or a date in the future, is refused', async ({ page, me }) => {
  const { home, bank } = await seedAllGroups(me.seed, page);
  const p = await page.request.post(`/api/pockets/${home.id}/reconcile`, { data: { balanceMinor: 100, date: todayIso() } });
  expect(p.status()).toBe(400);
  expect(JSON.stringify(await p.json())).toContain('A property pocket has no balance to reconcile.');
  const future = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const f = await page.request.post(`/api/pockets/${bank.id}/reconcile`, { data: { balanceMinor: 100, date: future } });
  expect(f.status()).toBe(400);
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`spec 23 screenshots ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const tag = `${size}-${scheme}`;
      await seedAllGroups(me.seed, page);
      await page.goto('/pockets');
      await expect(groupCard(page, 'Debts')).toBeVisible();
      await shot(page, `spec23-pockets-${tag}`);
      await pocketRow(page, 'Revolut').click();
      await dialog(page).getByRole('button', { name: 'Reconcile', exact: true }).click();
      await expect(lastDialog(page).getByText('What does Revolut show today?')).toBeVisible();
      await shot(page, `spec23-reconcile-dialog-${tag}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await pocketRow(page, 'Flat').click();
      await expect(dialog(page).getByRole('button', { name: 'Update value' })).toBeVisible();
      await shot(page, `spec23-property-dialog-${tag}`);
    });
  }
}
