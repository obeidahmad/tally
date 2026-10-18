import { test, expect, dialog, shot, row, seedBudget, selectLike, todayIso, type Seed } from '../support/fixtures';
import { seedImport, importFile, chooseNeedsSorting } from '../support/importing';
import type { Page, Locator } from '@playwright/test';

// Spec 22: search and filters, splits, tags, bulk edits and receipts on the Transactions page.
// Screenshots: spec22-<state>-<desktop|phone>-<light|dark>.png in e2e/screenshots/.
const FILTERS_NONE = 'No transactions match these filters.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const search = (page: Page) => page.getByLabel('Search payee or note').or(page.getByPlaceholder('Search payee or note')).first();
/** The checkbox that starts a row: named after the row, or the only checkbox in the row's nearest container. */
const pick = (page: Page, payee: string | RegExp) =>
  page.getByRole('checkbox', { name: payee }).or(row(page, payee).locator('xpath=ancestor::*[count(.//input[@type="checkbox"] | .//*[@role="checkbox"])=1][1]//*[self::input[@type="checkbox"] or @role="checkbox"]')).first();
const submitOf = (d: Locator, re: RegExp) => d.getByRole('button', { name: re }).last();
const tagsApi = async (page: Page) => (await (await page.request.get('/api/tags')).json()).tags as { id: number; name: string; count: number }[];

/** Needs with three subsections funded by a Paycheck step, and one pocket. */
async function seedSplit(s: Seed) {
  const needs = await s.section('Needs');
  const a = await s.subsection(needs.id, 'Food', 10000);
  const b = await s.subsection(needs.id, 'Fuel', 10000);
  const c = await s.subsection(needs.id, 'Clothes', 10000);
  const pocket = await s.pocket('Revolut', 100000);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, 30000, src.id);
  await s.amountStep(src.boxId, needs.id, 30000);
  return { needs, a, b, c, pocket };
}
const addTx = (page: Page, data: object) => page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'expense', ...data } });

// ============ search and filters ============
test('search finds a payee or a note ignoring case, and survives a reload', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await expect(row(page, /Alphamega/)).toBeVisible();
  await search(page).fill('netfl');
  await expect(row(page, /Netflix/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await expect(page).toHaveURL(/q=netfl/i);
  await page.reload();
  await expect(search(page)).toHaveValue('netfl');
  await expect(row(page, /Netflix/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await search(page).fill('NOTHING LIKE THIS');
  await expect(page.getByText(FILTERS_NONE)).toBeVisible();
});

test('search also matches the note', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const r = await addTx(page, { amountMinor: 500, pocketId: b.pocket.id, subsectionId: b.food.id, payee: 'Bakery', note: 'birthday cake' });
  expect(r.status(), await r.text()).toBe(201);
  await page.goto('/transactions');
  await search(page).fill('BIRTHDAY');
  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
});

test('Subsection, Pocket and Type filters narrow the list, combine, and "Clear filters" resets them', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const wallet = await me.seed.pocket('Wallet', 5000, 'cash');
  await me.seed.expense(wallet.id, b.food.id, 450, 'Bakery');
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  await selectLike(page.getByLabel('Pocket'), 'Wallet');
  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await page.reload();
  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);

  await page.getByLabel('Subsection').selectOption({ label: 'Utilities' });
  await expect(page.getByText(FILTERS_NONE)).toBeVisible(); // Wallet AND Utilities: nothing
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(row(page, /Alphamega/)).toBeVisible();
  await expect(row(page, /Bakery/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  await selectLike(page.getByLabel('Type'), 'Income');
  await expect(row(page, /Paycheck/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  await page.reload();
  await expect(row(page, /Paycheck/)).toBeVisible();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
});

test('From and To bound the list by date, both inclusive', async ({ page, me }) => {
  await seedBudget(me.seed);
  const today = todayIso();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  await page.goto('/transactions');
  await page.getByLabel('From').fill(today);
  await page.getByLabel('To').fill(today);
  await expect(row(page, /Alphamega/)).toBeVisible(); // today is inside both ends
  await page.getByLabel('From').fill(tomorrow);
  await page.getByLabel('To').fill('');
  await expect(page.getByText(FILTERS_NONE)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('From')).toHaveValue(tomorrow);
  await expect(page.getByText(FILTERS_NONE)).toBeVisible();
});

test('"Needs sorting" shows only transactions without a subsection', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await me.seed.expense(w.pocket.id, w.food.id, 999, 'Hand entered coffee');
  await page.reload();
  await expect(row(page, /Hand entered coffee/)).toBeVisible();
  await chooseNeedsSorting(page);
  await expect(row(page, /Netflix/)).toBeVisible();
  await expect(row(page, /Hand entered coffee/)).toHaveCount(0);
  await expect(page).toHaveURL(/unsorted/i);
  await page.reload();
  await expect(row(page, /Netflix/)).toBeVisible();
  await expect(row(page, /Hand entered coffee/)).toHaveCount(0);
});

// ============ splits ============
test('a split of 3 parts: the sum must be exact, the row says so, and the Budget counts each part in its subsection', async ({ page, me }) => {
  await seedSplit(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await d.getByLabel('Amount').fill('90.00');
  await d.getByLabel('Payee').fill('Big shop');
  await d.getByRole('button', { name: 'Split', exact: true }).click();
  // The three parts: subsection, amount, remove. The total's own Amount field is the first "Amount".
  await d.getByRole('button', { name: '+ Add part' }).click();
  const subs = d.getByLabel('Subsection');
  const amounts = d.getByLabel('Amount', { exact: true });
  if ((await subs.count()) < 3) await d.getByRole('button', { name: '+ Add part' }).click();
  await expect(subs).toHaveCount(3);
  await expect(amounts).toHaveCount(4);
  const parts: [string, string][] = [['Food', '50.00'], ['Fuel', '25.00'], ['Clothes', '10.00']];
  for (const [i, [name, amt]] of parts.entries()) {
    await subs.nth(i).selectOption({ label: name });
    await amounts.nth(i + 1).fill(amt);
  }
  await expect(d.getByText(/Left to split\s+5\.00/)).toBeVisible();
  await shot(page, 'spec22-split-dialog-desktop-light');
  await submitOf(d, /^(Add expense|Save)$/).click();
  await expect(d).toBeVisible(); // not saved: the parts do not add up
  await amounts.nth(3).fill('15.00');
  await expect(d.getByText(/Left to split\s+0\.00/)).toBeVisible();
  await submitOf(d, /^(Add expense|Save)$/).click();
  await expect(d).toBeHidden();

  await expect(row(page, /Big shop/)).toContainText('Split · 3 subsections');
  await expect(row(page, /Big shop/)).toContainText('−90.00');

  await page.goto('/budget');
  for (const [name, spent] of [['Food', '50.00'], ['Fuel', '25.00'], ['Clothes', '15.00']]) {
    await expect(page.locator('.ty-btable__row[role="button"]').filter({ hasText: name }).first(), `${name} spent`).toContainText(spent);
  }
});

test('"Left to split" turns negative when the parts overshoot, and "Remove split" goes back to one subsection', async ({ page, me }) => {
  const b = await seedSplit(me.seed);
  const r = await addTx(page, { amountMinor: 6000, pocketId: b.pocket.id, payee: 'Two parts', splits: [{ subsectionId: b.a.id, amountMinor: 2000 }, { subsectionId: b.b.id, amountMinor: 4000 }] });
  expect(r.status(), await r.text()).toBe(201);
  await page.goto('/transactions');
  await expect(row(page, /Two parts/)).toContainText('Split · 2 subsections');
  await row(page, /Two parts/).click();
  const d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).nth(1).fill('30.00');
  await expect(d.locator('.ty-num--neg, .ty-cap .ty-num--neg').filter({ hasText: /Left to split/ })).toBeVisible();
  await expect(d.getByText(/Left to split\s+[−-]10\.00/)).toBeVisible();
  await d.getByRole('button', { name: 'Remove split' }).click();
  await expect(d.getByLabel('Subsection')).toHaveCount(1);
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await submitOf(d, /^Save$/).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Two parts/)).not.toContainText('Split');
  await expect(row(page, /Two parts/)).toContainText('Food');
});

test('the API refuses parts that do not add up, and a split transfer', async ({ page, me }) => {
  const b = await seedSplit(me.seed);
  const other = await me.seed.pocket('Wallet', 0, 'cash');
  const bad = await addTx(page, { amountMinor: 5000, pocketId: b.pocket.id, payee: 'x', splits: [{ subsectionId: b.a.id, amountMinor: 1000 }, { subsectionId: b.b.id, amountMinor: 2000 }] });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.fields.splits).toBe('The parts add up to 30.00; the transaction is 50.00.');
  const tr = await addTx(page, { kind: 'transfer', amountMinor: 1000, pocketId: b.pocket.id, toPocketId: other.id, splits: [{ subsectionId: b.a.id, amountMinor: 500 }, { subsectionId: b.b.id, amountMinor: 500 }] });
  expect(tr.status()).toBe(400);
  expect((await tr.json()).error.fields.splits).toBe('A transfer cannot be split.');
});

// ============ tags ============
test('add tags in the dialog (Enter and comma, matched ignoring case), see them on the row, and filter by one', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  await me.seed.expense(b.pocket.id, b.food.id, 1000, 'Cafe');
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  let d = dialog(page);
  const tags = d.getByLabel('Tags');
  await tags.fill('Holiday');
  await tags.press('Enter');
  await tags.fill('work,');
  await expect(d.getByText('Holiday', { exact: true })).toBeVisible();
  await expect(d.getByText('work', { exact: true })).toBeVisible();
  await submitOf(d, /^Save$/).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Alphamega/)).toContainText('Holiday');
  await expect(row(page, /Alphamega/).locator('.ty-pill:visible', { hasText: 'work' })).toBeVisible();

  // The second transaction types the same tag in other case: the existing tag is used and suggested.
  await row(page, /Cafe/).click();
  d = dialog(page);
  await d.getByLabel('Tags').fill('holi');
  await expect(d.getByText('Holiday', { exact: true })).toBeVisible(); // a suggestion
  await d.getByLabel('Tags').fill('HOLIDAY');
  await d.getByLabel('Tags').press('Enter');
  await submitOf(d, /^Save$/).click();
  await expect(d).toBeHidden();
  const all = await tagsApi(page);
  expect(all.map((t) => t.name.toLowerCase()).sort()).toEqual(['holiday', 'work']);
  expect(all.find((t) => t.name.toLowerCase() === 'holiday')!.count).toBe(2);

  await selectLike(page.getByLabel('Tag'), 'work');
  await expect(row(page, /Alphamega/)).toBeVisible();
  await expect(row(page, /Cafe/)).toHaveCount(0);
  await expect(page).toHaveURL(/tag=work/i);
  await page.reload();
  await expect(row(page, /Alphamega/)).toBeVisible();
  await expect(row(page, /Cafe/)).toHaveCount(0);
});

test('a tag longer than 30 characters is refused with "A tag is 1 to 30 characters."', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  const d = dialog(page);
  await d.getByLabel('Tags').fill('x'.repeat(31));
  await d.getByLabel('Tags').press('Enter');
  await submitOf(d, /^Save$/).click();
  await expect(d.getByText('A tag is 1 to 30 characters.')).toBeVisible();
});

// ============ many at once ============
test('select many and change their subsection; the bar counts, and Cancel leaves selecting', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await pick(page, /Alphamega/).check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await pick(page, /Netflix/).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await shot(page, 'spec22-selection-bar-desktop-light');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/\d selected/)).toHaveCount(0);
  await expect(search(page)).toBeVisible();

  await pick(page, /Alphamega/).check();
  await pick(page, /Netflix/).check();
  await page.getByRole('button', { name: 'Change subsection' }).click();
  const d = dialog(page);
  await d.getByLabel('Subsection').selectOption({ label: 'Gifts' });
  await submitOf(d, /^(Change subsection|Change|Apply|Save|Move)$/).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Alphamega/)).toContainText('Gifts');
  await expect(row(page, /Netflix/)).toContainText('Gifts');
  await expect(row(page, /EAC electricity/)).toContainText('Utilities');
  await expect(page.getByText(/\d selected/)).toHaveCount(0);
});

test('"Select all shown" selects every row of the list; Delete asks "Delete {n} transactions?" and removes them', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await search(page).fill('netflix');
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  // Show everything again, then take it all.
  await search(page).fill('');
  await expect(row(page, /Alphamega/)).toBeVisible();
  const total = ((await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as unknown[]).length;
  await page.getByRole('checkbox', { name: 'Select all shown' }).check();
  await expect(page.getByText(`${total} selected`)).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByText(`Delete ${total} transactions?`)).toBeVisible();
  await d.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Alphamega/)).toHaveCount(0);
  const left = (await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as unknown[];
  expect(left).toHaveLength(0);
});

test('a bulk change that includes a transfer is refused in the dialog and changes nothing', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const wallet = await me.seed.pocket('Wallet', 0, 'cash');
  const t = await addTx(page, { kind: 'transfer', amountMinor: 1000, pocketId: b.pocket.id, toPocketId: wallet.id, payee: 'Move to wallet' });
  expect(t.status(), await t.text()).toBe(201);
  await page.goto('/transactions');
  await page.getByRole('checkbox', { name: 'Select all shown' }).check(); // the transfer is among them
  await page.getByRole('button', { name: 'Change subsection' }).click();
  const d = dialog(page);
  await d.getByLabel('Subsection').selectOption({ label: 'Gifts' });
  await submitOf(d, /^(Change subsection|Change|Apply|Save|Move)$/).click();
  await expect(d).toBeVisible();
  await expect(d.locator('.ty-error, [role="alert"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  const ids = (await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as { id: number }[];
  const res = await page.request.post('/api/transactions/bulk', { data: { ids: ids.map((x) => x.id), action: 'subsection', subsectionId: b.food.id } });
  expect(res.status()).toBe(400);
  await page.reload();
  await expect(row(page, /EAC electricity/)).toContainText('Utilities');
});

test('bulk Add tag and Remove tag work, and a 31-character tag shows the error in the dialog', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await pick(page, /Alphamega/).check();
  await pick(page, /Netflix/).check();
  await page.getByRole('button', { name: 'Add tag' }).click();
  let d = dialog(page);
  await d.getByLabel('Tag').fill('x'.repeat(31));
  await submitOf(d, /^(Add tag|Add|Apply|Save)$/).click();
  await expect(d).toBeVisible();
  await expect(d.locator('.ty-error, [role="alert"]').first()).toBeVisible();
  await d.getByLabel('Tag').fill('shared');
  await submitOf(d, /^(Add tag|Add|Apply|Save)$/).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Alphamega/)).toContainText('shared');
  await expect(row(page, /Netflix/)).toContainText('shared');
  await expect(row(page, /EAC electricity/)).not.toContainText('shared');
  expect((await tagsApi(page)).find((t) => t.name === 'shared')!.count).toBe(2);

  await pick(page, /Alphamega/).check();
  await pick(page, /Netflix/).check();
  await page.getByRole('button', { name: 'Remove tag' }).click();
  d = dialog(page);
  await d.getByLabel('Tag').selectOption({ label: 'shared' }).catch(async () => { await d.getByLabel('Tag').fill('shared'); });
  await submitOf(d, /^(Remove tag|Remove|Apply|Save)$/).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Alphamega/)).not.toContainText('shared');
  await expect(row(page, /Netflix/)).not.toContainText('shared');
});

test('on a narrow screen the "Select" button enters selection mode and "Cancel" leaves it', async ({ page, me }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(pick(page, /Alphamega/)).toBeVisible();
  await pick(page, /Alphamega/).check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/d selected/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
});

test('a search finds a transaction from another month and disables the Month filter', async ({ page, me }) => {
  const b = await seedBudget(me.seed);
  const prev = new Date(); prev.setUTCDate(15); prev.setUTCMonth(prev.getUTCMonth() - 1);
  await me.seed.expense(b.pocket.id, b.food.id, 999, 'Old bakery', prev.toISOString().slice(0, 10));
  await page.goto('/transactions');
  await expect(row(page, /Old bakery/)).toHaveCount(0);
  await search(page).fill('old bakery');
  await expect(row(page, /Old bakery/)).toBeVisible();
  await expect(page.getByLabel('Month')).toBeDisabled();
  await search(page).fill('');
  await expect(page.getByLabel('Month')).toBeEnabled();
  await expect(row(page, /Old bakery/)).toHaveCount(0);
});

// ============ receipts ============
test('attach a PNG, see it listed and on the row, open it in a new tab, and remove it', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await expect(row(page, /Alphamega/).getByLabel('Has receipt')).toHaveCount(0);
  await row(page, /Alphamega/).click();
  const d = dialog(page);
  await expect(d.getByText('Receipts', { exact: true })).toBeVisible();
  await d.locator('input[type="file"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(d.getByText('receipt.png')).toBeVisible();
  const link = d.getByRole('link', { name: /receipt\.png/ });
  await expect(link).toHaveAttribute('target', '_blank');
  const href = (await link.getAttribute('href'))!;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(row(page, /Alphamega/).getByLabel('Has receipt').or(row(page, /Alphamega/).getByTitle('Has receipt')).first()).toBeVisible();

  await row(page, /Alphamega/).click();
  await dialog(page).getByRole('button', { name: /remove.*receipt|remove receipt\.png|^Remove$/i }).first().click();
  await expect(dialog(page).getByText('receipt.png')).toHaveCount(0);
});

test('a file that is not a JPEG, PNG, WebP or PDF is refused with a message', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  const d = dialog(page);
  await d.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(d.getByText('Attach a JPEG, PNG, WebP or PDF.')).toBeVisible();
  await expect(d.getByText('notes.txt')).toHaveCount(0);
});

test('a text file renamed .png is refused: the bytes are checked', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  const d = dialog(page);
  await d.locator('input[type="file"]').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') });
  await expect(d.getByText('Attach a JPEG, PNG, WebP or PDF.')).toBeVisible();
});

test('the file input accepts the four types', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await row(page, /Alphamega/).click();
  const accept = (await dialog(page).locator('input[type="file"]').getAttribute('accept')) ?? '';
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) expect(accept).toContain(t);
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) test.describe(`spec 22 ${size} ${scheme}`, () => {
    test.use({ hasTouch: size === 'phone' });
    test(`spec 22 screenshots ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const tag = `${size}-${scheme}`;
      const b = await seedSplit(me.seed);
      await addTx(page, { amountMinor: 9000, pocketId: b.pocket.id, payee: 'Big shop', tags: ['holiday', 'work'], splits: [{ subsectionId: b.a.id, amountMinor: 5000 }, { subsectionId: b.b.id, amountMinor: 2500 }, { subsectionId: b.c.id, amountMinor: 1500 }] });
      await addTx(page, { amountMinor: 1200, pocketId: b.pocket.id, subsectionId: b.a.id, payee: 'Cafe' });
      await page.goto('/transactions');
      await expect(row(page, /Big shop/)).toBeVisible();
      await shot(page, `spec22-filter-row-${tag}`);
      await search(page).fill('shop');
      await shot(page, `spec22-filtered-${tag}`);
      await search(page).fill('');
      await row(page, /Big shop/).click();
      await expect(dialog(page).getByRole('button', { name: 'Remove split' })).toBeVisible();
      await shot(page, `spec22-split-dialog-${tag}`);
      await dialog(page).getByRole('button', { name: 'Attach receipt' }).scrollIntoViewIfNeeded();
      await expect(dialog(page).getByRole('button', { name: 'Attach receipt' })).toBeVisible();
      await dialog(page).evaluate((e) => { const sc = [e, ...e.querySelectorAll('*')].filter((x) => x.scrollHeight > x.clientHeight + 4); sc.forEach((x) => (x.scrollTop = x.scrollHeight)); });
      await shot(page, `spec22-split-dialog-end-${tag}`);
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      if (size === 'phone') {
        // Synthetic touch pointer events: a CDP touch hold did not start selecting (see the report).
        await (await row(page, /Big shop/).elementHandle())!.evaluate(async (e) => {
          const r = e.getBoundingClientRect();
          const o = { bubbles: true, pointerType: 'touch', clientX: r.x + 60, clientY: r.y + r.height / 2, pointerId: 5, isPrimary: true, button: 0 };
          e.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }));
          await new Promise((res) => setTimeout(res, 800));
          e.dispatchEvent(new PointerEvent('pointerup', o));
        });
      } else await pick(page, /Big shop/).check();
      await expect(page.getByText('1 selected')).toBeVisible();
      await shot(page, `spec22-selection-bar-${tag}`);
      await expect(page.getByText('1 selected')).toBeVisible();
      await shot(page, `spec22-selection-bar-${tag}`);
    });
  });
}
