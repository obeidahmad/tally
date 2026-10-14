import type { Page } from '@playwright/test';
import { test, expect, dialog, toast, shot, pocketsApi, selectLike, currencyPocket, type Seed } from '../support/fixtures';
import { seedImport, rulesApi, unsortedApi } from '../support/importing';
import { notices } from '../support/closing';
import {
  fakeApp, fakeLog, register, connectBank, connectionsApi, txApi, accountPocket, pick, inDays, dayAgo, longDate, longDateYear, TALLY_FIGURE, TEST_BASE, type FakeApp,
} from '../support/banking';

// Spec 17: bank connections through Enable Banking. The bank is a fake started by start-server.mjs; its "bank page" redirects straight back.
const BANK = 'Bank of Cyprus';
const BAD_ID = 'Enter the application ID from Enable Banking.';
const BAD_KEY = "Paste the private key file's contents.";

/** Registered, connected, with Revolut (EUR) linked to the account. */
async function linked(page: Page, me: { seed: Seed }, app: FakeApp) {
  const w = await seedImport(me.seed);
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await accountPocket(page).waitFor();
  await selectLike(accountPocket(page), 'Revolut');
  await expect.poll(async () => (await connectionsApi(page))[0]?.accounts[0].pocketId).toBe(w.pocket.id);
  return w;
}

// ============ criterion 2: a registration saves, its key never comes back ============
test('Settings > Bank connections: a new person sees the two fields, the hint and "Save"; wrong values show the spec\'s sentences', async ({ page, me }) => {
  expect((await (await page.request.get('/api/banks/registration')).json()).configured).toBe(false);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Bank connections' })).toBeVisible();
  await expect(page.getByText('From your own registration at enablebanking.com. Its redirect URL must be', { exact: false })).toBeVisible();
  await expect(page.getByText(`${TEST_BASE}/api/banks/callback`, { exact: false })).toBeVisible();
  await expect(page.getByLabel('Private key')).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(page.getByRole('button', { name: 'Connect a bank' })).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await page.getByLabel('Application ID').fill('not-a-uuid');
  await page.getByLabel('Private key').fill('not a key');
  await save.click();
  await expect(page.getByText(BAD_ID)).toBeVisible();
  await expect(page.getByText(BAD_KEY)).toBeVisible();
  expect((await (await page.request.get('/api/banks/registration')).json()).configured).toBe(false);
  // a good id with a bad key
  await page.getByLabel('Application ID').fill('3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23');
  await save.click();
  await expect(page.getByText(BAD_KEY)).toBeVisible();
  await expect(page.getByText(BAD_ID)).toHaveCount(0);
});

test('saving a registration shows "Connect a bank"; the server answers with the application ID only, never the key', async ({ page, me }) => {
  const app = await fakeApp();
  await page.goto('/settings');
  await page.getByLabel('Application ID').fill(app.applicationId);
  await page.getByLabel('Private key').fill(app.privateKey);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect a bank', exact: true })).toBeVisible();
  await expect(page.getByLabel('Private key')).toHaveCount(0);
  const r = await page.request.get('/api/banks/registration');
  const body = await r.json();
  expect(body).toMatchObject({ applicationId: app.applicationId, configured: true });
  expect(body).not.toHaveProperty("privateKey");
  expect(await r.text()).not.toContain('PRIVATE KEY');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect a bank', exact: true })).toBeVisible();
  expect(await page.content()).not.toContain('BEGIN PRIVATE KEY');
});

test('the API refuses a bad application ID or key with the spec\'s sentences and saves nothing', async ({ page, me }) => {
  const app = await fakeApp();
  const bad = await page.request.put('/api/banks/registration', { data: { applicationId: 'nope', privateKey: app.privateKey } });
  expect(bad.status()).toBe(400);
  expect(await bad.text()).toContain(BAD_ID);
  const badKey = await page.request.put('/api/banks/registration', { data: { applicationId: app.applicationId, privateKey: 'nope' } });
  expect(badKey.status()).toBe(400);
  expect(await badKey.text()).toContain(BAD_KEY);
  expect((await (await page.request.get('/api/banks/registration')).json()).configured).toBe(false);
});

// ============ criterion 3: connecting goes to the bank and back, and lists the accounts ============
test('Connect a bank: Cyprus is the first country, the dialog lists the country\'s banks, Continue goes through the bank and back with "Bank connected."', async ({ page, me }) => {
  const app = await fakeApp({ validUntils: [inDays(100)] });
  await register(page, app);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect a bank', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByLabel('Country', { exact: true }).or(d.getByRole('group', { name: 'Country', exact: true }))).toBeVisible();
  // Cyprus comes first
  const country = d.getByLabel('Country', { exact: true });
  if ((await country.count()) && (await country.first().evaluate((e) => e.tagName)) === 'SELECT') {
    expect((await country.first().locator('option').allTextContents())[0]).toContain('Cyprus');
  } else {
    await expect(d.getByRole('group', { name: 'Country', exact: true }).getByRole('radio').first()).toHaveAccessibleName(/Cyprus/);
  }
  await expect(d.getByLabel('Bank', { exact: true }).or(d.getByRole('group', { name: 'Bank', exact: true }))).toContainText(BANK);
  await expect(d.getByLabel('Bank', { exact: true }).or(d.getByRole('group', { name: 'Bank', exact: true }))).not.toContainText('Piraeus');
  await shot(page, 'dialog-connect-bank-desktop-light');
  await pick(d, 'Bank', BANK);
  await d.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(toast(page)).toHaveText('Bank connected.');
  await expect(dialog(page)).toBeHidden();
  // the connection row: the bank, when it ends, its account with a Pocket select and the two buttons
  await expect(page.getByText(BANK, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`until ${longDateYear(inDays(100))}`)).toBeVisible();
  await expect(page.getByText('Everyday account')).toBeVisible();
  await expect(accountPocket(page)).toBeVisible();
  await expect(accountPocket(page).locator('option')).toHaveText(['Not linked']);
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  // the fake bank saw a correctly signed request and the callback address the registration needs
  const log = await fakeLog(app);
  expect(log.errors).toEqual([]);
  expect(log.auths).toEqual([{ bank: BANK, redirect_url: `${TEST_BASE}/api/banks/callback` }]);
  const [c] = await connectionsApi(page);
  expect(c.bank).toBe(BANK);
  expect(c.accounts).toEqual([{ uid: app.account.uid, name: 'Everyday account', iban: app.account.iban, currency: 'EUR', pocketId: null }]);
  expect(new Date(c.validUntil).getTime()).toBeGreaterThan(Date.now() + 99 * 864e5);
});

test('the bank refusing the session shows "The bank did not connect. Try again." and no connection', async ({ page, me }) => {
  const app = await fakeApp({ failSessions: true });
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('The bank did not connect. Try again.');
  expect(await connectionsApi(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toHaveCount(0);
});

test('a callback with an unknown state answers 400 and changes nothing', async ({ page, me }) => {
  const app = await fakeApp();
  await register(page, app);
  const r = await page.request.get('/api/banks/callback?code=abc&state=never-issued', { maxRedirects: 0 });
  expect(r.status()).toBe(400);
  expect(await connectionsApi(page)).toEqual([]);
});

// ============ criterion 4: linking, sync, rules, balance ============
test('an account links to a pocket in its currency: the select offers those pockets and "Not linked", and the choice sticks', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await currencyPocket(page, 'Dollars', 'USD');
  const app = await fakeApp();
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  const options = await accountPocket(page).locator('option').allTextContents();
  expect(options.some((o) => o.includes('Revolut'))).toBe(true);
  expect(options.some((o) => o.includes('Dollars'))).toBe(false);
  expect(options.some((o) => o.trim() === 'Not linked')).toBe(true);
  await selectLike(accountPocket(page), 'Revolut');
  await expect.poll(async () => (await connectionsApi(page))[0].accounts[0].pocketId).toBe(w.pocket.id);
  await page.reload();
  await expect(accountPocket(page).locator('option:checked')).toContainText('Revolut');
  await accountPocket(page).selectOption({ label: 'Not linked' });
  await expect.poll(async () => (await connectionsApi(page))[0].accounts[0].pocketId).toBeNull();
});

test('linking an account to a pocket in another currency is refused with "Choose a pocket in EUR."', async ({ page, me }) => {
  await seedImport(me.seed);
  const usd = await currencyPocket(page, 'Dollars', 'USD');
  const app = await fakeApp();
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  const r = await page.request.patch(`/api/banks/accounts/${app.account.uid}`, { data: { pocketId: usd.id } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(r.status()).toBeLessThan(500);
  expect(await r.text()).toContain('Choose a pocket in EUR.');
  expect((await connectionsApi(page))[0].accounts[0].pocketId).toBeNull();
});

test('"Sync now" imports the booked transactions once: the rule sorts LIDL, the rest need sorting, payees follow the spec, pending and older than 90 days stay out', async ({ page, me }) => {
  const app = await fakeApp();
  const w = await linked(page, me, app);
  await rulesApi(page, { match: 'LIDL', subsectionId: w.food.id });
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(toast(page)).toHaveText('Synced. 4 added, 3 need sorting.');
  await expect.poll(async () => (await txApi(page)).length).toBe(4);
  const txs = await txApi(page);
  const byPayee = Object.fromEntries(txs.map((t) => [t.payee, t]));
  expect(Object.keys(byPayee).sort()).toEqual(['ACME Ltd', 'Kiosk Larnaca', 'LIDL Limassol', 'Netflix']); // creditor for spending, debtor for income, else first remittance line
  expect(byPayee['LIDL Limassol']).toMatchObject({ kind: 'expense', amountMinor: 2350, subsectionId: w.food.id });
  expect(byPayee['ACME Ltd']).toMatchObject({ kind: 'income', amountMinor: 200000 });
  expect(byPayee['Netflix'].subsectionId).toBeNull();
  expect(txs.every((t) => t.source === 'bank')).toBe(true);
  expect((await unsortedApi(page)).map((t) => t.payee).sort()).toEqual(['ACME Ltd', 'Kiosk Larnaca', 'Netflix']);
  expect((await pocketsApi(page))[0].balanceMinor).toBe(195801);
  // the transactions list shows them, the unsorted ones flagged
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: /LIDL Limassol/ })).toContainText('23.50');
  await expect(page.getByRole('button', { name: /Netflix/ })).toContainText('Needs sorting');
  await expect(page.getByRole('button', { name: /Pending Shop|Ancient Shop/ })).toHaveCount(0);
  expect((await fakeLog(app)).errors).toEqual([]);
});

test('syncing reads from 90 days ago at first and follows the bank\'s continuation; syncing again adds nothing and counts every transaction as a duplicate', async ({ page, me }) => {
  const app = await fakeApp();
  await linked(page, me, app);
  const [c] = await connectionsApi(page);
  const first = await page.request.post(`/api/banks/connections/${c.id}/sync`, { data: {} });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ added: 4, duplicates: 0, unsorted: 4 });
  const log1 = await fakeLog(app);
  expect(log1.txCalls.length, 'continuation_key was followed').toBeGreaterThanOrEqual(2);
  expect(log1.txCalls.some((t) => t.continuation_key)).toBe(true);
  const from1 = new Date(log1.txCalls[log1.txCalls.length - 1].date_from!).getTime();
  expect(Math.abs(from1 - new Date(dayAgo(90)).getTime())).toBeLessThanOrEqual(864e5);
  const again = await page.request.post(`/api/banks/connections/${c.id}/sync`, { data: {} });
  expect(await again.json()).toEqual({ added: 0, duplicates: 4, unsorted: 0 });
  // the second window starts a week before the last sync
  const log2 = await fakeLog(app);
  const last = log2.txCalls[log2.txCalls.length - 1];
  expect(Math.abs(new Date(last.date_from!).getTime() - new Date(dayAgo(7)).getTime())).toBeLessThanOrEqual(864e5);
  expect((await txApi(page)).length).toBe(4);
});

test('a linked pocket\'s card shows the bank\'s balance, "Tally counts ..." when it differs, and "Synced ... from Bank of Cyprus"', async ({ page, me }) => {
  const app = await fakeApp({ balanceMinor: 123456 });
  await linked(page, me, app);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await txApi(page)).length).toBe(4);
  await page.goto('/pockets');
  const card = page.locator('.ty-pocket', { hasText: 'Revolut' });
  await expect(card).toContainText('1,234.56');
  await expect(card.locator('.ty-cap', { hasText: `Tally counts ${TALLY_FIGURE}.` })).toBeVisible();
  await expect(card.locator('.ty-cap', { hasText: /^Synced .+ from Bank of Cyprus$/ })).toBeVisible();
  await expect(card).not.toContainText('Entered by hand');
  await shot(page, 'pockets-synced-desktop-light');
});

test('when the bank\'s balance equals Tally\'s own figure, the card does not say "Tally counts"', async ({ page, me }) => {
  const app = await fakeApp({ balanceMinor: 195801 });
  await linked(page, me, app);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await txApi(page)).length).toBe(4);
  await page.goto('/pockets');
  const card = page.locator('.ty-pocket', { hasText: 'Revolut' });
  await expect(card).toContainText(TALLY_FIGURE);
  await expect(card).toContainText(/Synced .+ from Bank of Cyprus/);
  await expect(card).not.toContainText('Tally counts');
});

test('a pocket that is not linked stays "Entered by hand" and an unlinked account imports nothing', async ({ page, me }) => {
  await seedImport(me.seed);
  const app = await fakeApp();
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await page.goto('/pockets');
  await expect(page.locator('.ty-pocket', { hasText: 'Revolut' })).toContainText('Entered by hand');
  expect((await txApi(page)).length).toBe(0);
});

test('a linked connection that never synced syncs on its own when the Transactions page loads', async ({ page, me }) => {
  const app = await fakeApp();
  await linked(page, me, app);
  expect((await txApi(page)).length).toBe(0);
  await page.goto('/transactions');
  await expect.poll(async () => (await txApi(page)).length, { timeout: 15_000 }).toBe(4);
  await expect(page.getByRole('button', { name: /LIDL Limassol/ })).toBeVisible();
});

test('a linked connection that never synced syncs on its own when the Pockets page loads and shows the bank\'s balance', async ({ page, me }) => {
  const app = await fakeApp({ balanceMinor: 123456 });
  await linked(page, me, app);
  await page.goto('/pockets');
  await expect(page.locator('.ty-pocket', { hasText: 'Revolut' })).toContainText('1,234.56', { timeout: 15_000 });
});

test('Disconnect forgets the connection and keeps the imported transactions', async ({ page, me }) => {
  const app = await fakeApp();
  await linked(page, me, app);
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await txApi(page)).length).toBe(4);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  // a confirmation may ask first; the spec does not say
  const d = dialog(page);
  if (await d.isVisible().catch(() => false)) await d.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toHaveCount(0);
  expect(await connectionsApi(page)).toEqual([]);
  expect((await txApi(page)).length).toBe(4);
});

// ============ criterion 5: the reminder ============
const REMIND = (d: string) => `Your connection to ${BANK} ends on ${longDate(d)}. Reconnect it to keep importing.`;

test('two weeks before the end the Budget page shows the notice with "Reconnect"', async ({ page, me }) => {
  const until = inDays(10);
  const app = await fakeApp({ validUntils: [until] });
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await page.goto('/budget');
  const n = notices(page).filter({ hasText: BANK });
  await expect(n).toContainText(REMIND(until));
  await expect(n.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await shot(page, 'budget-bank-reminder-desktop-light');
});

test('more than 14 days before the end there is no notice', async ({ page, me }) => {
  const app = await fakeApp({ validUntils: [inDays(20)] });
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(`Your connection to ${BANK}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
});

test('after the end the notice says "Your connection to Bank of Cyprus has ended." with "Reconnect"', async ({ page, me }) => {
  const app = await fakeApp({ validUntils: [inDays(-1)] });
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await page.goto('/budget');
  const n = notices(page).filter({ hasText: BANK });
  await expect(n).toContainText(`Your connection to ${BANK} has ended.`);
  await expect(n.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
});

test('"Reconnect" goes through the bank again, replaces the session, keeps the pocket link and clears the notice', async ({ page, me }) => {
  const app = await fakeApp({ validUntils: [inDays(10), inDays(170)] });
  const w = await linked(page, me, app);
  await page.goto('/budget');
  await notices(page).filter({ hasText: BANK }).getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(toast(page)).toHaveText('Bank connected.');
  const conns = await connectionsApi(page);
  expect(conns).toHaveLength(1);
  expect(conns[0].accounts[0]).toMatchObject({ uid: app.account.uid, pocketId: w.pocket.id });
  expect(new Date(conns[0].validUntil).getTime()).toBeGreaterThan(Date.now() + 169 * 864e5);
  expect((await fakeLog(app)).sessions).toBe(2);
  await expect(page.getByText(`until ${longDateYear(inDays(170))}`)).toBeVisible();
  await expect(accountPocket(page).locator('option:checked')).toContainText('Revolut');
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(`Your connection to ${BANK}`)).toHaveCount(0);
});

// ============ screenshots ============
for (const [size, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshots: Settings card with a connection, connect dialog, synced pocket and reminder (${size}, ${scheme})`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const app = await fakeApp({ validUntils: [inDays(10)] });
      await linked(page, me, app);
      await page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect.poll(async () => (await txApi(page)).length).toBe(4);
      await page.goto('/settings');
      await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeVisible();
      await page.getByRole('heading', { name: 'Bank connections' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await shot(page, `settings-bank-connections-${size}-${scheme}`);
      await page.getByRole('button', { name: 'Connect a bank', exact: true }).click();
      await expect(dialog(page)).toBeVisible();
      await shot(page, `dialog-connect-bank-${size}-${scheme}`);
      await page.keyboard.press('Escape');
      await page.goto('/pockets');
      await expect(page.locator('.ty-pocket', { hasText: 'Revolut' })).toContainText('1,234.56');
      await shot(page, `pockets-synced-${size}-${scheme}`);
      await page.goto('/budget');
      await expect(notices(page).filter({ hasText: BANK })).toBeVisible();
      await shot(page, `budget-bank-reminder-${size}-${scheme}`);
    });
  }
}

test('screenshots: the registration form (desktop and phone, light and dark)', async ({ page, me }) => {
  for (const [size, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/settings');
      await page.getByRole('heading', { name: 'Bank connections' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await shot(page, `settings-bank-registration-${size}-${scheme}`);
    }
  }
});
