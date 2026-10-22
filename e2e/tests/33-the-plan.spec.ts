import type { Page, Locator } from '@playwright/test';
import { test, expect, dialog, shot, chip, selectLike, currencyPocket, todayIso, openTab, srow, group, type Seed } from '../support/fixtures';

// Spec 29: the plan. Which pocket each subsection's money belongs in, and the transfers that put every pocket right.
// Fixture rates: today 1 EUR = 1.0860 USD.
test.use({ viewport: { width: 1280, height: 900 } });

const MINUS = '−';
const card = (scope: Page | Locator) => scope.locator('.ty-card').filter({ has: scope.getByRole('heading', { name: 'Transfers to make' }) }).first();
const moves = (scope: Page | Locator) => scope.locator('.ty-move');
const planTable = (page: Page) => page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Should hold' }) });
const pocketPlanRow = (page: Page, name: string) => planTable(page).locator('.ty-plan__pocket').filter({ hasText: name });
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const goHome = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
};

/** A subsection made through the API, kept in `pocketId` (null for no pocket yet). */
async function sub(page: Page, sectionId: number, name: string, budgetMinor: number, pocketId: number | null) {
  const res = await page.request.post(`/api/sections/${sectionId}/subsections`, { data: { name, budgetMinor, pocketId } });
  expect(res.status()).toBe(201);
  return (await res.json()).subsection as { id: number };
}
/** Sets "Kept in" of a subsection in its dialog on the Budget page. */
async function keepIn(page: Page, subsection: string, pocketText: string) {
  await page.goto('/budget');
  await srow(page, subsection).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
  await selectLike(d.getByLabel('Kept in', { exact: true }), pocketText);
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
}
/** Money lands in `pocketId`, and a box sends all of it to `sectionId`, so the section's subsections are funded. */
async function fund(s: Seed, pocketId: number, sectionId: number, minor: number, source: string) {
  const src = await s.source(source);
  await s.income(pocketId, minor, src.id);
  await s.amountStep(src.boxId, sectionId, minor);
}
const planApi = async (page: Page) => (await (await page.request.get('/api/plan')).json()) as {
  transfers: { fromPocketId: number; toPocketId: number; amountMinor: number }[]; shortMinor: number;
};

/**
 * The spec's worked example, with BOC 2,213.75 from the salary, Revolut and EUR savings empty.
 * Subsections are made in the API unless `viaUi`; their "Kept in" is then set by hand in the dialog.
 */
async function workedExample(page: Page, me: { seed: Seed }, viaUi = false, salaryInto?: number) {
  const boc = await me.seed.pocket('BOC', 0);
  const revolut = await me.seed.pocket('Revolut', 0);
  const savingsPocket = await me.seed.pocket('EUR savings', 0);
  const sec = await me.seed.section('Plan');
  const keep = (p: { id: number }) => (viaUi ? null : p.id);
  const subs = {
    rent: await sub(page, sec.id, 'Rent share', 6000, keep(boc)),
    phone: await sub(page, sec.id, 'Phone', 4000, keep(boc)),
    groceries: await sub(page, sec.id, 'Groceries', 40000, keep(revolut)),
    car: await sub(page, sec.id, 'Car', 166375, keep(revolut)),
    savings: await sub(page, sec.id, 'Savings', 5000, keep(savingsPocket)),
  };
  await fund(me.seed, salaryInto ?? boc.id, sec.id, 221375, 'Salary');
  if (viaUi) {
    for (const [n, p] of [['Rent share', 'BOC'], ['Phone', 'BOC'], ['Groceries', 'Revolut'], ['Car', 'Revolut'], ['Savings', 'EUR savings']]) await keepIn(page, n, p);
  }
  return { boc, revolut, savingsPocket, sec, subs };
}
const rowsOfCard = async (page: Page) => (await moves(card(page)).allInnerTexts()).map(norm);
/** Presses Done on the move that goes from `from` to `to` and saves the dialog as it is filled in. */
async function done(page: Page, from: string, to: string) {
  await card(page).getByRole('button', { name: new RegExp(`^Done: move .* from ${from} to ${to}$`) }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add transfer' })).toBeVisible();
  await expect(chip(d, 'From', new RegExp(from)).first()).toBeChecked();
  await expect(chip(d, 'To', new RegExp(to)).first()).toBeChecked();
  await d.getByRole('button', { name: /^Add transfer$/ }).click();
  await expect(d).toBeHidden();
}

// ============ the worked example ============
test('the worked example, with Kept in set in the dialogs: Home lists 2,063.75 BOC to Revolut, then 50.00 BOC to EUR savings', async ({ page, me }) => {
  await workedExample(page, me, true);
  await goHome(page);
  await expect(card(page).getByRole('heading', { name: 'Transfers to make' })).toBeVisible();
  const rows = await rowsOfCard(page);
  expect(rows, JSON.stringify(rows)).toHaveLength(2);
  expect(rows[0]).toMatch(/BOC\s*(to)?\s*→?\s*.*Revolut.*2,063\.75/);
  expect(rows[1]).toMatch(/BOC.*EUR savings.*50\.00/);
  await expect(card(page).getByRole('button', { name: /^Done: move 2,063\.75 from BOC to Revolut$/ })).toBeVisible();
  await expect(card(page).getByRole('button', { name: /^Done: move 50\.00 from BOC to EUR savings$/ })).toBeVisible();
  await expect(card(page).getByText(/less than your budget plans/)).toHaveCount(0);
  // The card sits above the cards grid, full width
  const box = await card(page).boundingBox();
  const main = await page.locator('main').first().boundingBox();
  expect(box!.width).toBeGreaterThan(main!.width * 0.8);
});

test('Budget lists the same two transfers in the aside when the current month is shown', async ({ page, me }) => {
  await workedExample(page, me);
  await page.goto('/budget');
  await expect(card(page).getByRole('heading', { name: 'Transfers to make' })).toBeVisible();
  const rows = await rowsOfCard(page);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('2,063.75');
  expect(rows[1]).toContain('50.00');
});

test('the Budget aside does not show the card for another month', async ({ page, me }) => {
  await workedExample(page, me);
  await page.goto('/budget');
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: /previous month/i }).first().click();
  await expect(card(page)).toHaveCount(0);
});

test('the plan API gives exactly the two transfers of the worked example and nothing short', async ({ page, me }) => {
  const w = await workedExample(page, me);
  const plan = await planApi(page);
  expect(plan.transfers.map((t) => [t.fromPocketId, t.toPocketId, t.amountMinor])).toEqual([
    [w.boc.id, w.revolut.id, 206375], [w.boc.id, w.savingsPocket.id, 5000],
  ]);
  expect(plan.shortMinor).toBe(0);
});

test('the Pockets table "Where your money should be" shows should hold, holds and difference, with the subsections under their pocket', async ({ page, me }) => {
  await workedExample(page, me);
  await page.goto('/pockets');
  await expect(page.getByRole('heading', { name: 'Where your money should be' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Where each subsection's money sits" })).toHaveCount(0);
  const heads = (await planTable(page).locator('th').allInnerTexts()).map(norm);
  expect(heads.map((h) => h.toLowerCase())).toEqual(['pocket', 'should hold', 'holds', 'difference']);
  const cells = async (name: string) => (await pocketPlanRow(page, name).locator('td').allInnerTexts()).map(norm);
  const boc = await cells('BOC');
  expect(boc[1]).toBe('100.00');
  expect(boc[2]).toBe('2,213.75');
  expect(boc[3]).toBe('+2,113.75');
  const rev = await cells('Revolut');
  expect([rev[1], rev[2], rev[3]]).toEqual(['2,063.75', '0.00', `${MINUS}2,063.75`]);
  await expect(pocketPlanRow(page, 'Revolut').locator('.ty-num--neg')).toHaveCount(1);
  const sav = await cells('EUR savings');
  expect([sav[1], sav[2], sav[3]]).toEqual(['50.00', '0.00', `${MINUS}50.00`]);
  // subsection rows, with a section dot, their name and amount under Should hold
  const subRows = planTable(page).locator('.ty-plan__sub');
  await expect(subRows.filter({ hasNotText: /Next month's money/ })).toHaveCount(5);
  const car = subRows.filter({ hasText: 'Car' });
  await expect(car.locator('.ty-dot')).toHaveCount(1);
  expect(norm(await car.locator('td').nth(1).innerText())).toBe('1,663.75');
});

// ============ Done ============
test('Done on each transfer saves the filled-in dialog, the card disappears and every Difference reads "–"', async ({ page, me }) => {
  await workedExample(page, me);
  await goHome(page);
  await card(page).getByRole('button', { name: /^Done: move 2,063\.75 from BOC to Revolut$/ }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add transfer' })).toBeVisible();
  await expect(chip(d, 'From', /BOC/)).toBeChecked();
  await expect(chip(d, 'To', /Revolut/)).toBeChecked();
  await expect(d.getByLabel('Amount', { exact: true })).toHaveValue(/^2,?063\.75$/);
  await expect(d.getByLabel('Amount received')).toHaveCount(0); // same currency
  await expect(d.getByLabel('Date', { exact: true })).toHaveValue(new Date().toISOString().slice(0, 10));
  await d.getByRole('button', { name: /^Add transfer$/ }).click();
  await expect(d).toBeHidden();
  await expect(moves(card(page))).toHaveCount(1);
  await expect(card(page).getByRole('button', { name: /^Done: move 2,063\.75/ })).toHaveCount(0);

  await done(page, 'BOC', 'EUR savings');
  await expect(card(page)).toHaveCount(0);
  expect((await planApi(page)).transfers).toEqual([]);

  await page.goto('/pockets');
  await expect(pocketPlanRow(page, 'BOC')).toBeVisible();
  for (const name of ['BOC', 'Revolut', 'EUR savings']) {
    const diff = norm(await pocketPlanRow(page, name).locator('td').nth(3).innerText());
    expect(diff, name).toBe('–');
  }
  expect(norm(await pocketPlanRow(page, 'BOC').locator('td').nth(2).innerText())).toBe('100.00');
});

test('the user can change the filled-in transfer before saving it', async ({ page, me }) => {
  await workedExample(page, me);
  await goHome(page);
  await card(page).getByRole('button', { name: /^Done: move 50\.00 from BOC to EUR savings$/ }).click();
  const d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).fill('20.00');
  await d.getByRole('button', { name: /^Add transfer$/ }).click();
  await expect(d).toBeHidden();
  await expect(card(page).getByRole('button', { name: /^Done: move 30\.00 from BOC to EUR savings$/ })).toBeVisible();
});

// ============ a short plan ============
test('a plan the pockets cannot cover shows "Your pockets hold 2,213.75 less than your budget plans."', async ({ page, me }) => {
  // the salary lands in a credit card, which is not a plan pocket, so the plan pockets hold nothing
  const visa = (await (await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 0 } })).json()).pocket as { id: number };
  await workedExample(page, me, false, visa.id);
  await goHome(page);
  await expect(card(page).getByText('Your pockets hold 2,213.75 less than your budget plans.')).toBeVisible();
  await expect(moves(card(page))).toHaveCount(0);
  expect((await planApi(page)).shortMinor).toBe(221375);
  await page.goto('/budget');
  await expect(card(page).getByText('Your pockets hold 2,213.75 less than your budget plans.')).toBeVisible();
});

test('the card is hidden when nothing is kept anywhere and there is nothing to move', async ({ page, me }) => {
  const boc = await me.seed.pocket('BOC', 100000);
  const sec = await me.seed.section('Plan');
  await sub(page, sec.id, 'Rent share', 6000, boc.id);
  await goHome(page);
  await expect(card(page)).toHaveCount(0);
});

// ============ between currencies ============
test('a transfer between two currencies: Done fills in Amount received', async ({ page, me }) => {
  const boc = await me.seed.pocket('BOC', 0);
  const usd = await currencyPocket(page, 'Trading212', 'USD', 0, 'broker');
  const sec = await me.seed.section('Invest');
  await sub(page, sec.id, 'Index', 10000, usd.id);
  await fund(me.seed, boc.id, sec.id, 10000, 'Salary');
  await goHome(page);
  // the amount is in the From pocket's currency, which is the base currency: no code
  const b = card(page).getByRole('button', { name: /^Done: move 100\.00 from BOC to Trading212$/ });
  await expect(b).toBeVisible();
  await b.click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add transfer' })).toBeVisible();
  await expect(d.getByLabel('Amount', { exact: true })).toHaveValue(/^100\.00$/);
  await expect(d.getByLabel('Amount received')).toHaveValue(/^108\.60$/);
  await d.getByRole('button', { name: /^Add transfer$/ }).click();
  await expect(d).toBeHidden();
  await expect(card(page)).toHaveCount(0);
});

test('a From pocket in another currency shows its code on the amount', async ({ page, me }) => {
  const usd = await currencyPocket(page, 'Trading212', 'USD', 0, 'broker');
  const boc = await me.seed.pocket('BOC', 0);
  const sec = await me.seed.section('Plan');
  await sub(page, sec.id, 'Rent share', 10000, boc.id);
  // USD money lands in the broker; a section funded in EUR terms: 108.60 USD is 100.00 EUR
  const src = await me.seed.source('Dividends');
  await me.seed.income(usd.id, 10860, src.id);
  await me.seed.amountStep(src.boxId, sec.id, 10000);
  await goHome(page);
  const r = moves(card(page)).first();
  await expect(r).toContainText('108.60');
  await expect(r.locator('.ty-cur')).toHaveText('USD');
});

// ============ Kept in ============
test('the Kept in select lists a placeholder and plan pockets only, has no Any pocket, is required, and saves', async ({ page, me }) => {
  await me.seed.pocket('BOC', 0);
  await me.seed.pocket('Wallet', 0, 'cash');
  await me.seed.pocket('Rainy day', 0, 'fund');
  await currencyPocket(page, 'Trading212', 'USD', 0, 'broker');
  await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 1000 } });
  await page.request.post('/api/pockets', { data: { name: 'Car loan', kind: 'loan', openingBalanceMinor: 1000 } });
  await page.request.post('/api/pockets', { data: { name: 'Flat', kind: 'property', valueMinor: 1000000 } });
  const sec = await me.seed.section('Plan');
  await sub(page, sec.id, 'Rent share', 6000, null);
  await page.goto('/budget');
  await srow(page, 'Rent share').click();
  const d = dialog(page);
  const sel = d.getByLabel('Kept in', { exact: true });
  await expect(sel).toBeVisible();
  const first = sel.locator('option').first();
  await expect(first).toHaveText('Choose a pocket');
  await expect(first).toBeDisabled();
  await expect(sel.locator('option:checked')).toHaveText('Choose a pocket');
  const opts = (await sel.locator('option').allTextContents()).map(norm);
  expect(opts).toHaveLength(5); // the placeholder and the four plan pockets
  expect(opts.some((o) => o.includes('Any pocket'))).toBe(false);
  for (const n of ['BOC', 'Wallet', 'Rainy day', 'Trading212']) expect(opts.some((o) => o.includes(n)), n).toBe(true);
  for (const n of ['Visa', 'Car loan', 'Flat']) expect(opts.some((o) => o.includes(n)), n).toBe(false);
  await expect(d.getByText('Tally lists the transfers that keep this money here.')).toBeVisible();
  // it is the last field
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim());
  expect(labels[labels.length - 1].toLowerCase()).toBe('kept in');
  // required
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.getByText('Choose a pocket.')).toBeVisible();
  await expect(d).toBeVisible();
  await selectLike(sel, 'Wallet');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await srow(page, 'Rent share').click();
  const sel2 = dialog(page).getByLabel('Kept in', { exact: true });
  await expect(sel2.locator('option:checked')).toContainText('Wallet');
  await expect(sel2.locator('option', { hasText: 'Choose a pocket' })).toHaveCount(0); // the placeholder shows only while none is chosen
});

test('a new subsection dialog has Kept in on the placeholder "Choose a pocket"', async ({ page, me }) => {
  await me.seed.pocket('BOC', 0);
  await me.seed.section('Plan');
  await page.goto('/budget');
  await page.getByRole('button', { name: /^Add subsection/ }).first().click();
  await expect(dialog(page).getByLabel('Kept in', { exact: true }).locator('option:checked')).toHaveText('Choose a pocket');
});

test('with no pocket at all, Kept in stays empty and a subsection saves without it', async ({ page, me }) => {
  await me.seed.section('Plan');
  await page.goto('/budget');
  await page.getByRole('button', { name: /^Add subsection/ }).first().click();
  const d = dialog(page);
  await d.getByLabel('Name', { exact: true }).fill('Rent share');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(srow(page, 'Rent share')).toBeVisible();
});

test('subsections made before any pocket show "2 subsections have no pocket yet." with a Choose link to Budget; one reads "1 subsection"', async ({ page, me }) => {
  const sec = await me.seed.section('Plan');
  await sub(page, sec.id, 'Rent share', 6000, null);
  await sub(page, sec.id, 'Phone', 4000, null);
  await goHome(page);
  await expect(card(page).getByText('2 subsections have no pocket yet.')).toBeVisible();
  await card(page).getByRole('link', { name: 'Choose' }).click();
  await expect(page).toHaveURL(/\/budget/);
  await me.seed.pocket('BOC', 0);
  await keepIn(page, 'Phone', 'BOC');
  await goHome(page);
  await expect(card(page).getByText('1 subsection has no pocket yet.')).toBeVisible();
  await keepIn(page, 'Rent share', 'BOC');
  await goHome(page);
  await expect(card(page)).toHaveCount(0);
});

test('the API refuses a debt pocket with "Choose a pocket." and a kind change sends the subsection back to no pocket', async ({ page, me }) => {
  const card2 = (await (await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 1000 } })).json()).pocket as { id: number };
  const boc = await me.seed.pocket('BOC', 0);
  const sec = await me.seed.section('Plan');
  const bad = await page.request.post(`/api/sections/${sec.id}/subsections`, { data: { name: 'X', budgetMinor: 100, pocketId: card2.id } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.fields.pocketId).toBe('Choose a pocket.');
  await sub(page, sec.id, 'Rent share', 6000, boc.id);
  const planIds = async () => ((await (await page.request.get('/api/plan')).json()).pockets as { id: number }[]).map((p) => p.id);
  expect(await planIds()).toContain(boc.id);
  expect(await planIds()).not.toContain(card2.id);
  expect((await page.request.patch('/api/pockets/' + boc.id, { data: { kind: 'credit' } })).status()).toBeLessThan(300);
  expect(await planIds()).not.toContain(boc.id);
  await me.seed.pocket('Wallet', 0, 'cash');
  await page.goto('/budget');
  await srow(page, 'Rent share').click();
  await expect(dialog(page).getByLabel('Kept in', { exact: true }).locator('option:checked')).toHaveText('Choose a pocket');
});

// ============ overspending ============
test('an expense beyond a subsection lowers its pocket\'s Should hold and the row shows the negative', async ({ page, me }) => {
  const boc = await me.seed.pocket('BOC', 0);
  const sec = await me.seed.section('Plan');
  const g = await sub(page, sec.id, 'Groceries', 40000, boc.id);
  await fund(me.seed, boc.id, sec.id, 40000, 'Salary');
  await me.seed.expense(boc.id, g.id, 50000, 'Alphamega');
  await page.goto('/pockets');
  const gr = planTable(page).locator('.ty-plan__sub').filter({ hasText: 'Groceries' });
  expect(norm(await gr.locator('td').nth(1).innerText())).toBe(`${MINUS}100.00`);
  await expect(gr.locator('.ty-num--neg')).toHaveCount(1);
  expect(norm(await pocketPlanRow(page, 'BOC').locator('td').nth(1).innerText())).toBe(`${MINUS}100.00`);
  await goHome(page);
  await expect(card(page)).toHaveCount(0); // spending from the subsection's own pocket creates no transfer
});

// ============ next month's money ============
test('income that no step takes shows as "Next month\'s money" under the oldest pocket; choosing another pocket in Settings moves it and lists a transfer', async ({ page, me }) => {
  const boc = await me.seed.pocket('BOC', 0);
  await me.seed.pocket('Revolut', 0);
  await me.seed.section('Plan');
  await me.seed.income(boc.id, 50000, 'Gift');
  const nm = (name: string) => pocketPlanRow(page, name).locator('xpath=following-sibling::tr[1]');
  await page.goto('/pockets');
  await expect(planTable(page).locator('.ty-plan__sub').filter({ hasText: "Next month's money" })).toHaveCount(1);
  await expect(nm('BOC')).toContainText("Next month's money");
  await expect(nm('BOC')).toContainText('500.00');
  await expect(card(page)).toHaveCount(0);

  await openTab(page, '/settings', 'Account');
  const sel = page.getByLabel("Next month's money");
  await expect(sel.locator('option:checked')).toContainText('BOC');
  const saved = page.waitForResponse((r) => r.url().includes('/api/me') && r.request().method() === 'PATCH');
  await selectLike(sel, 'Revolut');
  await saved;

  await page.goto('/pockets');
  await expect(nm('Revolut')).toContainText("Next month's money");
  await expect(nm('Revolut')).toContainText('500.00');
  await goHome(page);
  await expect(card(page).getByRole('button', { name: /^Done: move 500\.00 from BOC to Revolut$/ })).toBeVisible();
});

test('the API refuses a debt pocket as the pocket for next month\'s money', async ({ page, me }) => {
  await me.seed.pocket('BOC', 0);
  const visa = (await (await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 0 } })).json()).pocket as { id: number };
  const res = await page.request.patch('/api/me', { data: { nextMonthPocketId: visa.id } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.fields.nextMonthPocketId).toBe('Choose a pocket.');
});

// ============ removed ============
test('the transfer dialog has no Subsection, and Settings has next month money in place of Home pocket', async ({ page, me }) => {
  await me.seed.pocket('BOC', 100000);
  await me.seed.pocket('Wallet', 0, 'cash');
  await me.seed.section('Plan');
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add/ }).first().click();
  const d = dialog(page);
  await chip(d, 'Type', 'Transfer').check();
  await expect(d.getByRole('heading', { name: 'Add transfer' })).toBeVisible();
  await expect(d.getByLabel(/Subsection/)).toHaveCount(0);
  await expect(d.getByText(/Subsection/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openTab(page, '/settings', 'Account');
  await expect(page.getByLabel('Home pocket')).toHaveCount(0);
  await expect(page.getByText('Home pocket')).toHaveCount(0);
  await expect(page.getByLabel("Next month's money")).toBeVisible();
  await expect(page.getByText("Left over and sections' rests are kept here until next month.")).toBeVisible();
  await expect(page.getByLabel("Next month's money").locator('option:checked')).toContainText('BOC'); // the oldest plan pocket
});

test('the API refuses a transfer with a subsection, and the old where route is gone', async ({ page, me }) => {
  const boc = await me.seed.pocket('BOC', 100000);
  const w = await me.seed.pocket('Wallet', 0, 'cash');
  const sec = await me.seed.section('Plan');
  const s = await sub(page, sec.id, 'Rent share', 6000, null);
  const res = await page.request.post('/api/transactions', {
    data: { date: todayIso(), kind: 'transfer', pocketId: boc.id, toPocketId: w.id, amountMinor: 1000, toAmountMinor: 1000, subsectionId: s.id },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.fields.subsectionId).toBe('A transfer has no subsection.');
  expect((await page.request.get('/api/where')).status()).toBe(404);
});

test('the Pockets table is hidden with no plan pockets, and phones hide the subsection rows', async ({ page, me }) => {
  await page.request.post('/api/pockets', { data: { name: 'Visa', kind: 'credit', openingBalanceMinor: 1000 } });
  await page.goto('/pockets');
  await expect(page.getByRole('heading', { name: 'Visa' }).or(page.getByText('Visa').first())).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where your money should be' })).toHaveCount(0);
  void me;
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the Pockets table keeps Should hold, Holds and Difference and hides the subsection rows', async ({ page, me }) => {
    await workedExample(page, me);
    await page.goto('/pockets');
    await expect(page.getByRole('heading', { name: 'Where your money should be' })).toBeVisible();
    await expect(pocketPlanRow(page, 'Revolut')).toBeVisible();
    await expect(planTable(page).locator('.ty-plan__sub:visible')).toHaveCount(0);
    // nothing is clipped: every cell fits its box
    const clipped = await planTable(page).locator('th, td').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent ?? '').trim()));
    expect(clipped, 'clipped cells').toEqual([]);
    const tb = await planTable(page).boundingBox();
    expect(tb!.x + tb!.width).toBeLessThanOrEqual(390);
    for (const h of ['Should hold', 'Holds', 'Difference']) await expect(planTable(page).getByRole('columnheader', { name: h })).toBeVisible();
  });
});

// ============ isolation ============
test.describe('phone Home', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the Done buttons keep the 44px touch height and the row does not stretch them', async ({ page, me }) => {
    await workedExample(page, me);
    await goHome(page);
    const buttons = card(page).getByRole('button', { name: /^Done: move/ });
    await expect(buttons).toHaveCount(2);
    for (let i = 0; i < 2; i++) expect((await buttons.nth(i).boundingBox())!.height).toBeLessThanOrEqual(44);
  });
});

test('on desktop the Done buttons are at most 32px tall', async ({ page, me }) => {
  await workedExample(page, me);
  await goHome(page);
  const buttons = card(page).getByRole('button', { name: /^Done: move/ });
  await expect(buttons).toHaveCount(2);
  for (let i = 0; i < 2; i++) expect((await buttons.nth(i).boundingBox())!.height).toBeLessThanOrEqual(32);
});

test('another person has no plan of mine', async ({ page, me, baseURL, browser }) => {
  await workedExample(page, me);
  const { createPerson } = await import('../support/fixtures');
  const other = await createPerson(baseURL!, 'Olga');
  const ctx = await browser.newContext({ baseURL });
  expect((await ctx.request.post('/api/auth/login', { data: { username: other.username, password: other.password } })).status()).toBe(200);
  const plan = await (await ctx.request.get('/api/plan')).json();
  expect(plan.transfers).toEqual([]);
  expect(plan.pockets).toEqual([]);
  await ctx.close();
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`plan ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('home with the card, the Done dialog, the Kept in dialog, budget and the Pockets table', async ({ page, me }) => {
        const tag = `${size}-${scheme}`;
        await workedExample(page, me);
        await goHome(page);
        await expect(card(page)).toBeVisible();
        await shot(page, `plan-home-${tag}`);
        await card(page).scrollIntoViewIfNeeded();
        await card(page).getByRole('button', { name: /^Done: move 2,063\.75/ }).click();
        await expect(dialog(page)).toBeVisible();
        await shot(page, `plan-done-dialog-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/budget');
        await expect(card(page)).toBeVisible();
        await shot(page, `plan-budget-${tag}`);
        await srow(page, 'Car').click();
        await dialog(page).getByLabel('Kept in', { exact: true }).scrollIntoViewIfNeeded();
        await expect(dialog(page).getByLabel('Kept in', { exact: true })).toBeVisible();
        await shot(page, `plan-kept-in-dialog-${tag}`);
        await page.keyboard.press('Escape');

        await page.goto('/pockets');
        await expect(planTable(page)).toBeVisible();
        await planTable(page).scrollIntoViewIfNeeded();
        await shot(page, `plan-pockets-table-${tag}`);
        void group;
      });
    });
  }
}

// ============ criterion 5: every dollar has a place ============
test('with everything recorded, every subsection placed and no opening balances, the Should hold column adds up to the Holds column', async ({ page, me }) => {
  const w = await workedExample(page, me);
  await me.seed.expense(w.boc.id, w.subs.groceries.id, 12000, 'Alphamega'); // spent from another pocket than the one it is kept in
  await me.seed.income(w.boc.id, 30000, 'Gift'); // next month's money
  await page.goto('/pockets');
  await expect(pocketPlanRow(page, 'BOC')).toBeVisible();
  const n = (t: string) => Math.round(parseFloat(t.replace(/[^0-9.−-]/g, '').replace('−', '-')) * 100);
  const col = async (i: number) => {
    let sum = 0;
    const rows = planTable(page).locator('.ty-plan__pocket');
    for (let r = 0; r < await rows.count(); r++) sum += n(await rows.nth(r).locator('td').nth(i).innerText());
    return sum;
  };
  expect(await col(1)).toBe(await col(2));
});
