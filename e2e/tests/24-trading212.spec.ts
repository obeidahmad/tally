import type { Page, Locator } from '@playwright/test';
import { test, expect, shot, selectLike, todayIso, group, createPerson, signInByApi, type Seed, pocketRow, openTab } from '../support/fixtures';
import { sepDay, closeApi } from '../support/closing';
import {
  fakeKey, fakeSet, fakeLog, connectApi, syncApi, connectionApi, holdingsApi, incomesApi, connectBody,
  VUSA, AAPL, MSFT, DIVIDENDS, CASH, type FakeKey, type FakeConfig,
} from '../support/trading212';

// Spec 16: Trading212 through the person's own API key. The broker is a fake started by start-server.mjs (TALLY_T212_URL), so nothing reaches the real API.
// Fixture rates: today 1 EUR = 1.0860 USD. Each test uses its own fake key, so tests never share state.
test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(75_000); // a second sync waits for Trading212's 5 s portfolio limit

const MINUS = '−';
const REFUSED_KEY = 'Trading212 refused this key.';
const ERR_REFUSED = 'Trading212 refused the key.';
const ERR_DOWN = 'Trading212 is not answering. Tally will try again.';
const ERR_SLOW = 'Trading212 asked Tally to slow down. Tally will try again.';
const BROKER_FIGURES = "This holding's figures come from Trading212.";

type Me = { seed: Seed };
/** An EUR broker pocket "Trading212" and a subsection "Long-term investing" for the holdings. */
async function seedT212(me: Me) {
  const sec = await me.seed.section('Savings');
  const sub = await me.seed.subsection(sec.id, 'Long-term investing', 0);
  const pocket = await me.seed.pocket('Trading212', 0, 'broker');
  return { sub, pocket };
}
/** Seeded, connected through the API and synced once, so the page-load sync does not race the test. */
async function synced(page: Page, me: Me, k?: FakeKey) {
  const w = await seedT212(me);
  const key = k ?? (await fakeKey());
  await connectApi(page, key, w.pocket.id, w.sub.id);
  await syncApi(page);
  return { ...w, key };
}
const card = (page: Page): Locator => page.locator('.ty-card', { has: page.getByRole('heading', { name: 'Trading212', exact: true }) });
const invCard = (page: Page, name = 'Trading212') => page.locator('.ty-card', { hasText: name }).filter({ hasText: /paid|No holdings/ }).first();
/** The row of one holding on the Investments page: the nearest ancestor of its name that also shows a worth. */
const hrow = (page: Page, name: string) => page.getByText(name, { exact: true }).first().locator('xpath=ancestor::*[contains(., "worth ")][1]');
const pocketCard = (page: Page, name: string) => pocketRow(page, name);
const monthTxs = async (page: Page) => (await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as { sourceId: number | null }[];
const sourcesApi = async (page: Page) => (await (await page.request.get('/api/sources')).json()).sources as { id: number; name: string; boxId: number }[];

async function pickIn(scope: Page | Locator, label: string, text: string) {
  const sel = scope.getByLabel(label, { exact: true });
  await expect(scope.getByLabel(label, { exact: true }).or(group(scope, label)).first()).toBeVisible();
  if ((await sel.count()) && (await sel.first().evaluate((e) => e.tagName)) === 'SELECT') await selectLike(sel.first(), text);
  else await group(scope, label).getByRole('radio', { name: text }).check();
}
/** Fills the unconnected Settings card. */
async function fillCard(page: Page, o: { key: string; secret?: string; pocket?: string; sub?: string; env?: 'Live' | 'Demo' }) {
  await openTab(page, '/settings', 'Connections');
  const c = card(page);
  await pickIn(c, 'Pocket', o.pocket ?? 'Trading212');
  if (o.env) await group(c, 'Environment').getByRole('radio', { name: o.env }).check();
  await c.getByLabel('API key', { exact: true }).fill(o.key);
  if (o.secret) await c.getByLabel('API secret (optional)', { exact: true }).fill(o.secret);
  await pickIn(c, 'Holdings go to', o.sub ?? 'Long-term investing');
  return c;
}

// ============ criterion 2: connecting checks the key and the pocket's currency, the key never comes back ============
test('Settings > Trading212: an unconnected card shows its fields, Live / Demo and "Connect"; the pocket choice is broker pockets only', async ({ page, me }) => {
  await seedT212(me);
  await me.seed.pocket('Everyday bank', 0, 'bank');
  await openTab(page, '/settings', 'Connections');
  const c = card(page);
  await expect(c).toBeVisible();
  for (const l of ['Pocket', 'API key', 'API secret (optional)', 'Holdings go to']) await expect(c.getByLabel(l, { exact: true })).toBeVisible();
  const env = group(c, 'Environment');
  await expect(env.getByRole('radio', { name: 'Live' })).toBeChecked();
  await expect(env.getByRole('radio', { name: 'Demo' })).not.toBeChecked();
  await expect(c.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await expect(c.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
  const sel = c.getByLabel('Pocket', { exact: true });
  if ((await sel.evaluate((e) => e.tagName)) === 'SELECT') expect((await sel.locator('option').allTextContents()).join('|')).not.toContain('Everyday bank');
  else await expect(group(c, 'Pocket').getByRole('radio', { name: /Everyday bank/ })).toHaveCount(0);
});

test('connecting with a good key shows "Connected to Trading212 · key ending K9x2 · synced …" with Sync now and Disconnect; the key never comes back', async ({ page, me }) => {
  const w = await seedT212(me);
  const k = await fakeKey();
  const c = await fillCard(page, { key: k.key, env: 'Demo' });
  await c.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(card(page)).toContainText(/Connected to Trading212\s*·\s*key ending K9x2\s*·\s*(not )?synced/);
  await expect(card(page).getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await expect(card(page).getByLabel('API key', { exact: true })).toHaveCount(0);
  const r = await page.request.get('/api/brokers/trading212');
  const body = await r.json();
  expect(body.connection).toMatchObject({ pocketId: w.pocket.id, environment: 'demo', subsectionId: w.sub.id, keyEnd: 'K9x2' });
  expect(await r.text()).not.toContain(k.key);
  expect(body.connection).not.toHaveProperty('apiKey');
  expect(body.connection).not.toHaveProperty('apiSecret');
  await page.reload();
  await expect(card(page)).toContainText(/Connected to Trading212\s*·\s*key ending K9x2/);
  expect(await page.content()).not.toContain(k.key);
  expect((await fakeLog(k)).errors).toEqual([]);
});

test('a key with a secret is sent as Basic auth, a key without one is sent as it is; saving checks GET /equity/account/info', async ({ page, me }) => {
  const w = await seedT212(me);
  const plain = await fakeKey();
  await connectApi(page, plain, w.pocket.id, w.sub.id);
  const pl = await fakeLog(plain);
  expect(pl.calls[0].path).toBe('/equity/account/info');
  expect(pl.calls.every((c) => c.authorization === 'key')).toBe(true);
  const withSecret = await fakeKey({ secret: 'shh-its-a-secret' });
  const r = await page.request.put('/api/brokers/trading212', { data: connectBody(withSecret, w.pocket.id, w.sub.id) });
  expect(r.status()).toBe(200);
  const sl = await fakeLog(withSecret);
  expect(sl.errors).toEqual([]);
  expect(sl.calls.length).toBeGreaterThan(0);
  expect(sl.calls.every((c) => c.authorization === 'basic')).toBe(true);
  expect(await r.text()).not.toContain('shh-its-a-secret');
  expect(JSON.stringify(await connectionApi(page))).not.toContain('shh-its-a-secret');
});

test('a refused key shows "Trading212 refused this key." and connects nothing', async ({ page, me }) => {
  await seedT212(me);
  const k = await fakeKey({ mode: 'refuse' });
  const c = await fillCard(page, { key: k.key });
  await c.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText(REFUSED_KEY)).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(await connectionApi(page)).toBeNull();
  expect(await holdingsApi(page)).toEqual([]);
});

test('an unknown key through the API: 400 on apiKey with the same sentence', async ({ page, me }) => {
  const w = await seedT212(me);
  const r = await page.request.put('/api/brokers/trading212', { data: { pocketId: w.pocket.id, apiKey: 'a-key-the-fake-never-heard-of', environment: 'live', subsectionId: w.sub.id } });
  expect(r.status()).toBe(400);
  expect(await r.text()).toContain(REFUSED_KEY);
  expect(await connectionApi(page)).toBeNull();
});

test('an account in another currency than the pocket: "This Trading212 account is in USD. Choose a pocket in USD."', async ({ page, me }) => {
  await seedT212(me); // an EUR pocket
  const k = await fakeKey({ currencyCode: 'USD' });
  const c = await fillCard(page, { key: k.key });
  await c.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('This Trading212 account is in USD. Choose a pocket in USD.')).toBeVisible();
  expect(await connectionApi(page)).toBeNull();
});

test('the API refuses an empty key, a short key, a pocket that is not a broker and a subsection that is not mine, with the spec\'s sentences', async ({ page, me }) => {
  const w = await seedT212(me);
  const bank = await me.seed.pocket('Everyday bank', 0, 'bank');
  const k = await fakeKey();
  const put = (data: object) => page.request.put('/api/brokers/trading212', { data: { environment: 'live', ...data } });
  for (const apiKey of ['', 'short']) {
    const r = await put({ pocketId: w.pocket.id, apiKey, subsectionId: w.sub.id });
    expect(r.status(), `key "${apiKey}"`).toBe(400);
    expect(await r.text()).toContain('Paste your Trading212 API key.');
  }
  const notBroker = await put({ pocketId: bank.id, apiKey: k.key, subsectionId: w.sub.id });
  expect(notBroker.status()).toBe(400);
  expect(await notBroker.text()).toContain('Choose a broker pocket.');
  const noSub = await put({ pocketId: w.pocket.id, apiKey: k.key, subsectionId: 999999 });
  expect(noSub.status()).toBe(400);
  expect(await noSub.text()).toContain('Choose a subsection.');
  expect(await connectionApi(page)).toBeNull();
});

test('Connect with no key shows "Paste your Trading212 API key."', async ({ page, me }) => {
  await seedT212(me);
  await openTab(page, '/settings', 'Connections');
  await card(page).getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Paste your Trading212 API key.')).toBeVisible();
  expect(await connectionApi(page)).toBeNull();
});

// ============ criterion 3: a sync fills the Investments page and the pocket's cash, and records dividends once ============
test('Sync now fills the Investments page: holdings named after their instruments with paid, worth and change, "from Trading212", no Update value or Sell', async ({ page, me }) => {
  const w = await seedT212(me);
  const k = await fakeKey();
  await connectApi(page, k, w.pocket.id, w.sub.id);
  await openTab(page, '/settings', 'Connections');
  await card(page).getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(async () => (await holdingsApi(page)).length, { timeout: 30_000 }).toBe(3);
  await expect(card(page)).toContainText(/synced/);

  await page.goto('/investments');
  const c = invCard(page);
  await expect(c).toContainText('Trading212');
  const vusa = hrow(page, 'Vanguard S&P 500');
  await expect(vusa).toContainText('Long-term investing');
  await expect(vusa).toContainText('paid 450.00 EUR');
  await expect(vusa).toContainText('worth 500.00 EUR');
  await expect(vusa).toContainText('from Trading212');
  await expect(vusa).not.toContainText('updated');
  const vp = vusa.locator('.ty-pill').filter({ hasText: '%' });
  await expect(vp).toHaveText('+11.1%');
  await expect(vp).toHaveClass(/ty-pill--positive/);

  const apple = hrow(page, 'Apple');
  await expect(apple).toContainText('worth 300.00 USD');
  await expect(apple).toContainText(/paid 25[78]\.\d\d EUR/); // 300.00 USD at 1.0860 is 276.24 EUR, minus 20 and minus -1.5
  const ap = apple.locator('.ty-pill').filter({ hasText: '%' });
  await expect(ap).toHaveText(/^\+7\.[0-3]%$/);
  await expect(ap).toHaveClass(/ty-pill--positive/);

  const msft = hrow(page, 'Microsoft');
  await expect(msft).toContainText('worth 400.00 USD');
  await expect(msft).toContainText(/paid 37[78]\.\d\d EUR/);
  const mp = msft.locator('.ty-pill').filter({ hasText: '%' });
  await expect(mp).toHaveText(new RegExp(`^${MINUS}2\\.[5-7]%$`));
  await expect(mp).toHaveClass(/ty-pill--negative/);

  await expect(c.getByRole('button', { name: 'Update value' })).toHaveCount(0);
  await expect(c.getByRole('button', { name: 'Sell' })).toHaveCount(0);
  await expect(c).toContainText(/Synced .* from Trading212/);
  await expect(page.getByText(/^updated /)).toHaveCount(0);

  const hs = await holdingsApi(page);
  expect(hs.map((h) => h.name).sort()).toEqual(['Apple', 'Microsoft', 'Vanguard S&P 500']);
  expect(hs.every((h) => h.pocketId === w.pocket.id && h.subsectionId === w.sub.id && h.source === 'trading212' && h.soldDate === null)).toBe(true);
  const v = hs.find((h) => h.name === 'Vanguard S&P 500')!;
  expect([v.paidMinor, v.worthMinor, v.worthCurrency]).toEqual([45000, 50000, 'EUR']);
  const a = hs.find((h) => h.name === 'Apple')!;
  expect(a.worthMinor).toBe(30000);
  expect(a.worthCurrency).toBe('USD');
  expect(Math.abs(a.paidMinor - 25774)).toBeLessThanOrEqual(2);
});

test('the pocket\'s cash is Trading212\'s free cash, and its card says "Synced … from Trading212"', async ({ page, me }) => {
  const w = await synced(page, me);
  const pockets = (await (await page.request.get('/api/pockets')).json()).pockets as { id: number; syncedBalanceMinor: number | null; syncedAt: string | null }[];
  const p = pockets.find((x) => x.id === w.pocket.id)!;
  expect(p.syncedBalanceMinor).toBe(Math.round(CASH * 100));
  expect(p.syncedAt).not.toBeNull();
  await page.goto('/pockets');
  const c = pocketCard(page, 'Trading212');
  await expect(c).toContainText(/2,379.1[0-4]/); // free cash 1,234.56 plus holdings worth 500.00 + 276.24 + 368.32
  await expect(c).not.toContainText('Tally counts');
  await expect(page.locator('.num-hero').first()).toContainText(/2,379.1[0-4]/); // net worth uses the value too
  await expect(c).toContainText(/Synced .* from Trading212/);
});

test('a sync records each dividend once as income into the pocket from "Trading212 dividends", payee the ticker', async ({ page, me }) => {
  const w = await synced(page, me);
  const src = (await sourcesApi(page)).filter((s) => s.name === 'Trading212 dividends');
  expect(src).toHaveLength(1);
  const divs = async () => (await incomesApi(page)).filter((t) => t.sourceId === src[0].id);
  expect((await divs()).map((t) => [t.payee, t.amountMinor, t.date, t.pocketId]).sort()).toEqual(
    [['AAPL_US_EQ', 150, todayIso(), w.pocket.id], ['MSFT_US_EQ', 75, todayIso(), w.pocket.id], ['VUSAl_EQ', 225, todayIso(), w.pocket.id]].sort(),
  );
  await syncApi(page); // the same dividends again: no new rows
  expect(await divs()).toHaveLength(3);
  expect((await sourcesApi(page)).filter((s) => s.name === 'Trading212 dividends')).toHaveLength(1);
  // a new one on the next sync is added, the old ones are not
  await fakeSet(w.key, { dividends: [...DIVIDENDS, { reference: 'div-4', ticker: 'VUSAl_EQ', amount: 3, paidOn: `${todayIso()}T10:00:00.000Z` }] });
  await syncApi(page);
  expect(await divs()).toHaveLength(4);
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: /^Trading212 dividends/ })).toHaveCount(4);
});

test('a dividend paid in a closed month is skipped', async ({ page, me }) => {
  const w = await seedT212(me);
  await me.seed.income(w.pocket.id, 1000, 'Salary', sepDay(10));
  await closeApi(page); // the month before this one
  const k = await fakeKey({ dividends: [{ reference: 'old-1', ticker: 'AAPL_US_EQ', amount: 9, paidOn: `${sepDay(10)}T09:00:00.000Z` }, DIVIDENDS[1]] });
  await connectApi(page, k, w.pocket.id, w.sub.id);
  await syncApi(page);
  const id = (await sourcesApi(page)).find((s) => s.name === 'Trading212 dividends')!.id;
  const prev = await page.request.get(`/api/transactions?month=${sepDay(10).slice(0, 7)}`);
  expect(((await prev.json()).transactions as { sourceId: number | null }[]).filter((t) => t.sourceId === id)).toEqual([]);
  expect((await incomesApi(page)).filter((t) => t.sourceId === id).map((t) => t.payee)).toEqual(['VUSAl_EQ']);
});

test('syncing again changes a worth in place, keeps one holding per ticker and updates the cash', async ({ page, me }) => {
  const w = await synced(page, me);
  await fakeSet(w.key, { positions: [{ ...VUSA, currentPrice: 55, ppl: 100 }, AAPL, MSFT], free: 2000 });
  await syncApi(page);
  const hs = await holdingsApi(page);
  expect(hs).toHaveLength(3);
  const v = hs.find((h) => h.name === 'Vanguard S&P 500')!;
  expect([v.paidMinor, v.worthMinor]).toEqual([45000, 55000]);
  await page.goto('/investments');
  await expect(hrow(page, 'Vanguard S&P 500')).toContainText('worth 550.00 EUR');
  await expect(hrow(page, 'Vanguard S&P 500').locator('.ty-pill').filter({ hasText: '%' })).toHaveText('+22.2%');
  await page.goto('/pockets');
  await expect(pocketCard(page, 'Trading212')).toContainText(/3,194\.[5-6]\d/); // 2,000.00 cash plus 550.00 + 276.24 + 368.32
});

test('two syncs back to back wait for Trading212\'s limits and never fail', async ({ page, me }) => {
  const w = await synced(page, me);
  const t0 = Date.now();
  await syncApi(page);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(4000); // one portfolio read per 5 s
  const log = await fakeLog(w.key);
  expect(log.limitHits).toBe(0);
  expect(log.errors).toEqual([]);
  expect((await connectionApi(page))!.error).toBeNull();
});

// ============ criterion 4: broker holdings cannot be edited or sold by hand; a disappeared position is sold ============
test('a position that disappears is marked sold: it moves under "Sold" with no transaction', async ({ page, me }) => {
  const w = await synced(page, me);
  const before = (await monthTxs(page)).length;
  await fakeSet(w.key, { positions: [VUSA, AAPL] });
  await openTab(page, '/settings', 'Connections');
  await card(page).getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(async () => (await holdingsApi(page)).find((h) => h.name === 'Microsoft')?.soldDate, { timeout: 30_000 }).toBe(new Date().toLocaleDateString('en-CA'));
  await page.goto('/investments');
  await expect(page.getByRole('heading', { name: 'Sold', exact: true })).toBeVisible();
  await expect(page.getByText('Microsoft').first()).toBeVisible();
  await expect(invCard(page)).not.toContainText('Microsoft');
  await expect(invCard(page)).toContainText('Apple');
  expect((await monthTxs(page)).length).toBe(before);
  expect((await holdingsApi(page)).filter((h) => h.soldDate === null)).toHaveLength(2);
});

test('hand-editing a broker holding\'s figures is refused; its name and subsection can change', async ({ page, me }) => {
  await synced(page, me);
  const sec2 = await me.seed.section('Fun');
  const sub2 = await me.seed.subsection(sec2.id, 'Gadgets', 0);
  const h = (await holdingsApi(page)).find((x) => x.name === 'Apple')!;
  for (const patch of [{ paidMinor: 1 }, { worthMinor: 1 }, { worthCurrency: 'GBP' }]) {
    const r = await page.request.patch(`/api/holdings/${h.id}`, { data: patch });
    expect(r.status(), JSON.stringify(patch)).toBe(400);
    expect(await r.text()).toContain(BROKER_FIGURES);
  }
  const ok = await page.request.patch(`/api/holdings/${h.id}`, { data: { name: 'Apple shares', subsectionId: sub2.id } });
  expect(ok.status()).toBe(200);
  const after = (await holdingsApi(page)).find((x) => x.id === h.id)!;
  expect([after.name, after.subsectionId, after.paidMinor, after.worthMinor]).toEqual(['Apple shares', sub2.id, h.paidMinor, h.worthMinor]);
});

test('a renamed broker holding stays one holding after the next sync (the ticker is the key)', async ({ page, me }) => {
  await synced(page, me);
  const h = (await holdingsApi(page)).find((x) => x.name === 'Apple')!;
  expect((await page.request.patch(`/api/holdings/${h.id}`, { data: { name: 'My Apple' } })).status()).toBe(200);
  await syncApi(page);
  const hs = await holdingsApi(page);
  expect(hs).toHaveLength(3);
  expect(hs.find((x) => x.id === h.id)!.name).toBe('My Apple');
});

// ============ a failure keeps everything as it was ============
test('a failed sync keeps the holdings, shows the error in the card as a warning, and a good sync clears it', async ({ page, me }) => {
  const w = await synced(page, me);
  const before = await holdingsApi(page);
  const cases: [FakeConfig['mode'], string][] = [['refuse', ERR_REFUSED], ['down', ERR_DOWN], ['slow', ERR_SLOW]];
  for (const [mode, text] of cases) {
    await fakeSet(w.key, { mode, positions: [], free: 1 });
    await page.request.post('/api/brokers/trading212/sync', { data: {}, timeout: 60_000 }); // the status of a failed sync is up to the server
    await expect.poll(async () => (await connectionApi(page))?.error, { timeout: 40_000 }).toBe(text);
    expect(await holdingsApi(page)).toEqual(before);
  }
  await openTab(page, '/settings', 'Connections');
  await expect(card(page).locator('.ty-pill--warning').filter({ hasText: ERR_SLOW })).toBeVisible();
  await fakeSet(w.key, { mode: 'ok', positions: [VUSA, AAPL, MSFT], free: CASH });
  await card(page).getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(async () => (await connectionApi(page))?.error, { timeout: 40_000 }).toBeNull();
  await page.reload();
  await expect(card(page).getByText(ERR_SLOW)).toHaveCount(0);
});

// ============ disconnecting ============
test('Disconnect keeps the holdings and from then on they are typed by hand', async ({ page, me }) => {
  await synced(page, me);
  await openTab(page, '/settings', 'Connections');
  await card(page).getByRole('button', { name: 'Disconnect' }).click();
  const confirm = page.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Disconnect' }).click();
  await expect(card(page).getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(await connectionApi(page)).toBeNull();
  const hs = await holdingsApi(page);
  expect(hs).toHaveLength(3);
  expect(hs.every((h) => h.source !== 'trading212')).toBe(true);
  const h = hs.find((x) => x.name === 'Apple')!;
  expect((await page.request.patch(`/api/holdings/${h.id}`, { data: { paidMinor: 20000 } })).status()).toBe(200);
  await page.goto('/investments');
  await expect(hrow(page, 'Apple')).toContainText('paid 200.00');
  await expect(hrow(page, 'Apple').getByRole('button', { name: 'Update value' })).toBeVisible();
  await expect(hrow(page, 'Apple').getByRole('button', { name: 'Sell' })).toBeVisible();
});

test('DELETE /api/brokers/trading212 answers 204', async ({ page, me }) => {
  await synced(page, me);
  expect((await page.request.delete('/api/brokers/trading212', { data: {} })).status()).toBe(204);
  expect(await connectionApi(page)).toBeNull();
});

// ============ isolation ============
test('another person does not see my connection or holdings', async ({ page, me, baseURL, browser }) => {
  await synced(page, me);
  const other = await createPerson(baseURL!, 'Omar');
  const ctx = await browser.newContext({ baseURL });
  const p2 = await ctx.newPage();
  await signInByApi(p2, other);
  expect((await (await p2.request.get('/api/brokers/trading212')).json()).connection).toBeNull();
  expect((await (await p2.request.get('/api/holdings')).json()).holdings).toEqual([]);
  await ctx.close();
});

// ============ screenshots ============
const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`trading212 ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('settings card (empty, connected, with an error), investments with broker holdings, the pockets page', async ({ page, me }) => {
        const tag = `${size}-${scheme}`;
        const w = await seedT212(me);
        await openTab(page, '/settings', 'Connections');
        await card(page).scrollIntoViewIfNeeded();
        await shot(page, `trading212-settings-empty-${tag}`);
        const k = await fakeKey();
        await connectApi(page, k, w.pocket.id, w.sub.id);
        await syncApi(page);
        await openTab(page, '/settings', 'Connections');
        await expect(card(page)).toContainText('key ending K9x2');
        await card(page).scrollIntoViewIfNeeded();
        await shot(page, `trading212-settings-connected-${tag}`);
        await fakeSet(k, { mode: 'down' });
        await page.request.post('/api/brokers/trading212/sync', { data: {}, timeout: 60_000 });
        await page.reload();
        await expect(card(page).getByText(ERR_DOWN)).toBeVisible();
        await card(page).scrollIntoViewIfNeeded();
        await shot(page, `trading212-settings-error-${tag}`);
        await page.goto('/investments');
        await expect(page.getByText('Vanguard S&P 500')).toBeVisible();
        await shot(page, `trading212-investments-${tag}`);
        await page.goto('/pockets');
        await expect(pocketCard(page, 'Trading212')).toContainText(/2,379.1[0-4]/);
        await shot(page, `trading212-pockets-${tag}`);
      });
    });
  }
}
