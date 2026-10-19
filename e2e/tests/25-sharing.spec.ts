import type { Browser, BrowserContext, Page, Locator } from '@playwright/test';
import { test as base, expect, createPerson, signInByApi, seed, shot, dialog, toast, row, chip, fillExpense, type Person, type Seed, pocketRow, bsection, openTab, darkWhenSystemIsDark } from '../support/fixtures';

// Spec 20: sharing one budget between partners. Sam (EUR) owns the budget; Alex (USD) is a member and signs in with his own account.
// Two people, two browser contexts. Every test makes its own two (or three) fresh people, so nothing is shared between tests.
const test = base;
test.use({ viewport: { width: 1280, height: 900 } });

type Size = { width: number; height: number };
type Who = { page: Page; person: Person; ctx: BrowserContext; seed: Seed };

async function signedIn(browser: Browser, baseURL: string, person: Person, viewport: Size, colorScheme: 'light' | 'dark' = 'light'): Promise<Who> {
  const ctx = await browser.newContext({ baseURL, viewport, colorScheme, locale: 'en-GB', timezoneId: 'UTC' });
  await ctx.addInitScript(darkWhenSystemIsDark);
  const page = await ctx.newPage();
  await signInByApi(page, person);
  return { page, person, ctx, seed: seed(page) };
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Sam (EUR) and Alex (USD), each signed in on their own page. `share` makes Sam add Alex through the API. */
async function pair(browser: Browser, baseURL: string, o: { share?: boolean; viewport?: Size; scheme?: 'light' | 'dark' } = {}) {
  const vp = o.viewport ?? DESKTOP;
  const samP = await createPerson(baseURL, 'Sam', 'EUR');
  const alexP = await createPerson(baseURL, 'Alex', 'USD');
  const sam = await signedIn(browser, baseURL, samP, vp, o.scheme);
  const alex = await signedIn(browser, baseURL, alexP, vp, o.scheme);
  if (o.share) await shareApi(sam.page, alexP.username);
  return { sam, alex, close: async () => { await sam.ctx.close(); await alex.ctx.close(); } };
}

const shareApi = async (page: Page, username: string) => {
  const r = await page.request.post('/api/sharing/members', { data: { username } });
  expect(r.status()).toBe(201);
  return (await r.json()).member as { id: number; displayName: string };
};
const sharingApi = async (page: Page) =>
  (await (await page.request.get('/api/sharing')).json()) as {
    members: { id: number; displayName: string }[]; sharedWithMe: { ownerId: number; displayName: string }[]; viewing: number | null;
  };
const viewApi = (page: Page, ownerId: number | null) => page.request.post('/api/sharing/view', { data: { ownerId } });
const meApi = async (page: Page) => (await (await page.request.get('/api/me')).json()) as { viewing: { ownerId: number; displayName: string; baseCurrency: string } | null };
const sectionsApi = async (page: Page) => (await (await page.request.get('/api/sections')).json()).sections as { id: number; name: string }[];
const txsApi = async (page: Page) =>
  (await (await page.request.get(`/api/transactions?month=${new Date().toISOString().slice(0, 7)}`)).json()).transactions as { id: number; payee: string; createdBy: number; createdByName: string }[];

/** Sam's budget: Needs > Food, a pocket and one expense he made himself. */
async function samBudget(s: Seed) {
  const needs = await s.section('Needs');
  const food = await s.subsection(needs.id, 'Food', 30000);
  const pocket = await s.pocket('Revolut', 100000);
  await s.expense(pocket.id, food.id, 21240, 'Alphamega');
  return { needs, food, pocket };
}

/** Alex switches to Sam's budget with the switcher in the sidebar (desktop). */
const switcher = (page: Page): Locator => page.locator('.ty-side').getByRole('combobox', { name: 'Budget' });
const sharingCard = (page: Page): Locator => page.locator('.ty-card', { has: page.getByRole('heading', { name: 'Sharing', exact: true }) });
const FOOT_VIEWING = (name: string, owner: string) => new RegExp(`${name}\\s*viewing the budget of ${owner}`);
const NOT_YOURS = 'Only Sam can change this.';

async function switchTo(page: Page, option: string) {
  await switcher(page).selectOption({ label: option });
}

// ============ criterion 5: a person with no share sees no switcher and nothing of anyone else's ============
test('with nothing shared there is no "Budget" switcher on desktop or on the phone Settings page, and /api/sharing is empty', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!);
  await sam.seed.section('Needs');
  await alex.page.goto('/budget');
  await expect(alex.page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(alex.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  await expect(alex.page.getByText(/viewing the budget of/)).toHaveCount(0);
  expect(await sharingApi(alex.page)).toEqual({ members: [], sharedWithMe: [], viewing: null });
  expect((await meApi(alex.page)).viewing).toBeNull();
  expect((await alex.page.request.get('/api/auth/state')).status()).toBe(200);
  await alex.page.setViewportSize(PHONE);
  await openTab(alex.page, '/settings', 'People and sharing');
  await expect(alex.page.getByRole('heading', { name: 'Sharing', exact: true })).toBeVisible();
  await expect(alex.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  await close();
});

test('a person nothing is shared with cannot switch to anyone: 400 "Choose a budget shared with you."', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!);
  // Sam's id is learned from a third person Sam shares with; Alex has no share of his own.
  const carlP = await createPerson(baseURL!, 'Carl');
  const carl = await signedIn(browser, baseURL!, carlP, DESKTOP);
  await shareApi(sam.page, carlP.username);
  const samId = (await sharingApi(carl.page)).sharedWithMe[0].ownerId;
  await carl.ctx.close();
  const r = await viewApi(alex.page, samId);
  expect(r.status()).toBe(400);
  expect(await r.text()).toContain('Choose a budget shared with you.');
  const bad = await viewApi(alex.page, 999999);
  expect(bad.status()).toBe(400);
  expect((await meApi(alex.page)).viewing).toBeNull();
  await close();
});

// ============ the Sharing card: adding, errors, removing ============
test('Settings > Sharing: the card has "Share this budget with" and "Add"; adding a username lists the member with "Remove"', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!);
  await openTab(sam.page, '/settings', 'People and sharing');
  const c = sharingCard(sam.page);
  await expect(c).toBeVisible();
  await expect(c.getByLabel('Share this budget with')).toBeVisible();
  await expect(c.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await expect(c.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await c.getByLabel('Share this budget with').fill(alex.person.username);
  await c.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(c.getByText('Alex', { exact: true })).toBeVisible();
  await expect(c.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  await sam.page.reload();
  await expect(sharingCard(sam.page).getByText('Alex', { exact: true })).toBeVisible();
  expect((await sharingApi(sam.page)).members.map((m) => m.displayName)).toEqual(['Alex']);
  await close();
});

test('adding someone: an unknown username, yourself and a person already added show the contract\'s sentences', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!);
  await openTab(sam.page, '/settings', 'People and sharing');
  const c = sharingCard(sam.page);
  const add = async (username: string) => {
    await c.getByLabel('Share this budget with').fill(username);
    await c.getByRole('button', { name: 'Add', exact: true }).click();
  };
  await add('nobody-has-this-name');
  await expect(sam.page.getByText('There is no account with this username.')).toBeVisible();
  await add(sam.person.username);
  await expect(sam.page.getByText('You cannot add yourself.')).toBeVisible();
  await add(alex.person.username);
  await expect(c.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  await add(alex.person.username);
  await expect(sam.page.getByText('This person is already a member.')).toBeVisible();
  await expect(c.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  // the same sentences from the API, on `username`
  for (const [username, text] of [['nobody-has-this-name', 'There is no account with this username.'], [sam.person.username, 'You cannot add yourself.'], [alex.person.username, 'This person is already a member.']] as const) {
    const r = await sam.page.request.post('/api/sharing/members', { data: { username } });
    expect(r.status()).toBe(400);
    expect(await r.text()).toContain(text);
  }
  await close();
});

// ============ criterion 2 and 5: the switcher ============
test('once Sam shares, Alex sees "Budget" above the navigation with "Your budget" and "Sam", and Settings lists "Budgets shared with you" with "Leave"', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!);
  await samBudget(sam.seed);
  await alex.page.goto('/budget');
  await expect(switcher(alex.page)).toHaveCount(0);
  await shareApi(sam.page, alex.person.username);
  await alex.page.reload(); // the switcher appears once something is shared
  const sw = switcher(alex.page);
  await expect(sw).toBeVisible();
  const options = (await sw.locator('option').allTextContents()).map((t) => t.trim());
  expect(options).toEqual(['Your budget', 'Sam']);
  await expect(sw.locator('option:checked')).toHaveText('Your budget');
  // above the navigation
  const swBox = (await sw.boundingBox())!;
  const navBox = (await alex.page.locator('.ty-side').getByRole('link', { name: 'Transactions' }).boundingBox())!;
  expect(swBox.y).toBeLessThan(navBox.y);
  await expect(alex.page.getByText(/viewing the budget of/)).toHaveCount(0);

  await openTab(alex.page, '/settings', 'People and sharing');
  const c = sharingCard(alex.page);
  await expect(c.getByText('Budgets shared with you')).toBeVisible();
  await expect(c.getByText('Sam', { exact: true })).toBeVisible();
  await expect(c.getByRole('button', { name: /^Leave/ })).toHaveCount(1);
  await close();
});

test('switching to Sam reloads the page with Sam\'s data, the sidebar foot says "viewing the budget of Sam", switching back shows Alex\'s own', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  await alex.seed.section('Alex only');
  await alex.page.goto('/budget');
  await expect(bsection(alex.page, 'Alex only')).toBeVisible();
  await expect(bsection(alex.page, 'Needs')).toHaveCount(0);

  await switchTo(alex.page, 'Sam');
  await expect(bsection(alex.page, 'Needs')).toBeVisible();
  await expect(bsection(alex.page, 'Alex only')).toHaveCount(0);
  await expect(alex.page.locator('.ty-side')).toContainText(FOOT_VIEWING('Alex', 'Sam'));
  await expect(switcher(alex.page).locator('option:checked')).toHaveText('Sam');
  expect((await meApi(alex.page)).viewing).toMatchObject({ displayName: 'Sam', baseCurrency: 'EUR' });
  expect((await sharingApi(alex.page)).viewing).not.toBeNull();

  await alex.page.goto('/transactions');
  await expect(row(alex.page, /Alphamega/)).toBeVisible();
  await alex.page.goto('/pockets');
  await expect(pocketRow(alex.page, 'Revolut')).toBeVisible();

  // the choice sticks across a reload
  await alex.page.reload();
  await expect(alex.page.locator('.ty-side')).toContainText(FOOT_VIEWING('Alex', 'Sam'));

  await switchTo(alex.page, 'Your budget');
  await alex.page.goto('/budget');
  await expect(bsection(alex.page, 'Alex only')).toBeVisible();
  await expect(bsection(alex.page, 'Needs')).toHaveCount(0);
  await expect(alex.page.getByText(/viewing the budget of/)).toHaveCount(0);
  expect((await meApi(alex.page)).viewing).toBeNull();
  await close();
});

test('the base currency is the owner\'s: Alex (USD) viewing Sam (EUR) enters amounts in EUR', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  await alex.page.goto('/transactions');
  await switchTo(alex.page, 'Sam');
  await expect(row(alex.page, /Alphamega/)).not.toContainText('USD'); // no conversion to Alex's own currency
  await alex.page.getByRole('button', { name: 'Add transaction' }).first().click();
  await expect(dialog(alex.page).getByText('EUR', { exact: true })).toBeVisible();
  await expect(dialog(alex.page).getByText('USD', { exact: true })).toHaveCount(0);
  expect((await meApi(alex.page)).viewing!.baseCurrency).toBe('EUR');
  await close();
});

// ============ criterion 2: the member works on the owner's budget and the owner sees it ============
test('Alex switches, adds a transaction and a section; Sam sees both, the transaction with "· entered by Alex"', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);

  await alex.page.goto('/budget');
  await switchTo(alex.page, 'Sam');
  await expect(bsection(alex.page, 'Needs')).toBeVisible();

  // a transaction through the dialog
  await alex.page.goto('/transactions');
  await alex.page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(alex.page);
  await fillExpense(d, { amount: '12.50', payee: 'Corner bakery', subsection: 'Food', pocket: /Revolut/ });
  await d.getByRole('button', { name: 'Add expense' }).click();
  await expect(d).toBeHidden();
  const mine = row(alex.page, /Corner bakery/);
  await expect(mine).toContainText('−12.50');
  // Alex made it himself, so he is not told "entered by Alex"
  await expect(mine).not.toContainText(/entered by (Sam|Alex)/i);
  // a row Sam made reads "entered by Sam" to Alex
  await expect(row(alex.page, /Alphamega/)).toContainText(/entered by Sam/i);

  // a section through the dialog
  await alex.page.goto('/budget');
  await alex.page.getByRole('button', { name: 'Add section' }).click();
  await dialog(alex.page).getByLabel('Name').fill('Holidays');
  await dialog(alex.page).getByRole('button', { name: 'Add section' }).click();
  await expect(dialog(alex.page)).toBeHidden();
  await expect(bsection(alex.page, 'Holidays')).toBeVisible();

  // Sam sees both
  await sam.page.goto('/budget');
  await expect(bsection(sam.page, 'Holidays')).toBeVisible();
  await sam.page.goto('/transactions');
  const seen = row(sam.page, /Corner bakery/);
  await expect(seen).toContainText('−12.50');
  await expect(seen).toContainText(/entered by Alex/i);
  await expect(row(sam.page, /Alphamega/)).not.toContainText(/entered by (Sam|Alex)/i);

  // Alex's own budget got neither
  await switchTo(alex.page, 'Your budget');
  expect((await sectionsApi(alex.page)).map((s) => s.name)).not.toContain('Holidays');
  expect(await txsApi(alex.page)).toEqual([]);
  await close();
});

test('createdBy and createdByName: Sam\'s transaction names Sam, Alex\'s names Alex, whichever of them reads it', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  const w = await samBudget(sam.seed);
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  const alexId = (await sharingApi(sam.page)).members[0].id;
  expect((await viewApi(alex.page, samId)).status()).toBe(200);
  const made = await alex.page.request.post('/api/transactions', {
    data: { date: new Date().toISOString().slice(0, 10), kind: 'expense', amountMinor: 500, pocketId: w.pocket.id, subsectionId: w.food.id, payee: 'Kiosk' },
  });
  expect(made.status()).toBe(201);
  for (const p of [sam.page, alex.page]) {
    const txs = await txsApi(p);
    expect(txs.find((t) => t.payee === 'Alphamega')).toMatchObject({ createdBy: samId, createdByName: 'Sam' });
    expect(txs.find((t) => t.payee === 'Kiosk')).toMatchObject({ createdBy: alexId, createdByName: 'Alex' });
  }
  await close();
});

test('a member reaches the owner\'s data through the API as if he were the owner: sections, pockets, months, reports', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  const w = await samBudget(sam.seed);
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  await viewApi(alex.page, samId);
  const month = new Date().toISOString().slice(0, 7);
  expect((await sectionsApi(alex.page)).map((s) => s.name)).toEqual(['Needs']);
  const pockets = (await (await alex.page.request.get('/api/pockets')).json()).pockets as { id: number }[];
  expect(pockets.map((p) => p.id)).toEqual([w.pocket.id]);
  for (const url of [`/api/months/${month}`, `/api/sources`, `/api/rules`, `/api/holdings`]) {
    const a = await alex.page.request.get(url);
    const s = await sam.page.request.get(url);
    expect(a.status(), url).toBe(s.status());
    if (a.status() === 200) expect(await a.json(), url).toEqual(await s.json());
  }
  // a write by Alex lands in Sam's budget
  const r = await alex.page.request.post('/api/sections', { data: { name: 'Via API' } });
  expect(r.status()).toBeLessThan(300);
  expect((await sectionsApi(sam.page)).map((s) => s.name)).toContain('Via API');
  await close();
});

// ============ criterion 3: bank, broker and sharing settings stay the owner's ============
test('Alex viewing Sam sees "Only Sam can change this." on the bank, Trading212 and sharing cards, with no controls', async ({ browser, baseURL }) => {
  const { alex, close } = await pair(browser, baseURL!, { share: true });
  const A = alex.page;
  const tab = (name: string) => A.getByRole('tab', { name, exact: true }).click();
  await A.goto('/settings');
  // while viewing his own budget the cards have their controls
  await tab('Connections');
  await expect(A.getByLabel('Application ID')).toBeVisible();
  await tab('People and sharing');
  await expect(A.getByLabel('Share this budget with')).toBeVisible();
  await expect(A.getByText(NOT_YOURS)).toHaveCount(0);
  await tab('Connections');
  await expect(A.getByText(NOT_YOURS)).toHaveCount(0);

  await switchTo(A, 'Sam');
  await tab('Connections');
  await expect(A.getByText(NOT_YOURS)).toHaveCount(2);
  for (const heading of ['Bank connections', 'Trading212']) {
    const c = A.locator('.ty-card', { has: A.getByRole('heading', { name: heading, exact: true }) });
    await expect(c, heading).toContainText(NOT_YOURS);
  }
  await expect(A.getByLabel('Application ID')).toHaveCount(0);
  await expect(A.getByLabel('Private key')).toHaveCount(0);
  await expect(A.getByLabel('API key', { exact: true })).toHaveCount(0);
  await expect(A.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
  await expect(A.getByRole('button', { name: 'Connect a bank' })).toHaveCount(0);
  await tab('People and sharing');
  await expect(A.getByText(NOT_YOURS)).toHaveCount(1);
  await expect(sharingCard(A)).toContainText(NOT_YOURS);
  await expect(A.getByLabel('Share this budget with')).toHaveCount(0);
  await expect(sharingCard(A).getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(sharingCard(A).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await close();
});

test('the owner-only routes answer 403 owner_only "Only Sam can change this." to a member viewing the budget', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  const third = await createPerson(baseURL!, 'Carl');
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  expect((await viewApi(alex.page, samId)).status()).toBe(200);
  const p = alex.page.request;
  const attempts = [
    await p.post('/api/sharing/members', { data: { username: third.username } }),
    await p.put('/api/banks/registration', { data: { applicationId: '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23', privateKey: 'nope' } }),
    await p.put('/api/brokers/trading212', { data: { pocketId: 1, apiKey: 'a-key-that-is-long-enough', environment: 'live', subsectionId: 1 } }),
  ];
  for (const r of attempts) {
    expect(r.status()).toBe(403);
    const body = await r.text();
    expect(body).toContain('owner_only');
    expect(body).toContain('Only Sam can change this.');
  }
  // nothing was added to Sam's members
  expect((await sharingApi(sam.page)).members.map((m) => m.displayName)).toEqual(['Alex']);
  // /api/me and the password routes stay Alex's own
  expect((await alex.page.request.get('/api/me')).status()).toBe(200);
  const mine = await (await alex.page.request.get('/api/me')).json();
  expect(JSON.stringify(mine)).toContain('Alex');
  await close();
});

test('a member\'s own Sharing, bank and broker settings still work on his own budget', async ({ browser, baseURL }) => {
  const { alex, close } = await pair(browser, baseURL!, { share: true });
  const carl = await createPerson(baseURL!, 'Carl');
  expect((await viewApi(alex.page, null)).status()).toBe(200);
  const r = await alex.page.request.post('/api/sharing/members', { data: { username: carl.username } });
  expect(r.status()).toBe(201);
  expect((await sharingApi(alex.page)).members.map((m) => m.displayName)).toEqual(['Carl']);
  await close();
});

// ============ criterion 4: removing or leaving takes effect on the next request ============
test('Sam removes Alex: Alex\'s next page load shows his own budget, no "viewing" in the foot and no switcher', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  await alex.seed.section('Alex only');
  await alex.page.goto('/budget');
  await switchTo(alex.page, 'Sam');
  await expect(bsection(alex.page, 'Needs')).toBeVisible();

  await openTab(sam.page, '/settings', 'People and sharing');
  const c = sharingCard(sam.page);
  await expect(c.getByText('Alex', { exact: true })).toBeVisible();
  await c.getByRole('button', { name: /^Remove/ }).click();
  const confirm = sam.page.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Remove/ }).click();
  await expect(c.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  expect((await sharingApi(sam.page)).members).toEqual([]);

  await alex.page.reload();
  await expect(bsection(alex.page, 'Alex only')).toBeVisible();
  await expect(bsection(alex.page, 'Needs')).toHaveCount(0);
  await expect(alex.page.getByText(/viewing the budget of/)).toHaveCount(0);
  await expect(alex.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  expect(await sharingApi(alex.page)).toEqual({ members: [], sharedWithMe: [], viewing: null });
  expect((await meApi(alex.page)).viewing).toBeNull();
  // and the transaction list no longer carries Sam's rows
  expect(await txsApi(alex.page)).toEqual([]);
  await close();
});

test('removing a member takes effect at once, without a reload: the member\'s next API request acts on his own budget', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  const member = (await sharingApi(sam.page)).members[0];
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  await viewApi(alex.page, samId);
  expect((await sectionsApi(alex.page)).map((s) => s.name)).toEqual(['Needs']);
  expect((await sam.page.request.delete(`/api/sharing/members/${member.id}`, { data: {} })).status()).toBe(204);
  expect(await sectionsApi(alex.page)).toEqual([]);
  expect((await alex.page.request.post('/api/sections', { data: { name: 'Mine now' } })).status()).toBeLessThan(300);
  expect((await sectionsApi(sam.page)).map((s) => s.name)).toEqual(['Needs']);
  expect((await sharingApi(alex.page)).viewing).toBeNull();
  await close();
});

test('Alex leaves: "Leave" removes the budget from his list and Sam no longer lists him', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  await openTab(alex.page, '/settings', 'People and sharing');
  const c = sharingCard(alex.page);
  await c.getByRole('button', { name: /^Leave/ }).click();
  const confirm = alex.page.getByRole('dialog');
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Leave/ }).click();
  await expect(c.getByRole('button', { name: /^Leave/ })).toHaveCount(0);
  await alex.page.reload();
  await expect(alex.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  expect((await sharingApi(alex.page)).sharedWithMe).toEqual([]);
  expect((await sharingApi(sam.page)).members).toEqual([]);
  await close();
});

test('Alex leaves while viewing Sam: the next request acts on his own budget', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  await viewApi(alex.page, samId);
  expect((await alex.page.request.delete(`/api/sharing/shared/${samId}`, { data: {} })).status()).toBe(204);
  expect(await sectionsApi(alex.page)).toEqual([]);
  expect((await meApi(alex.page)).viewing).toBeNull();
  await close();
});

// ============ a third person sees neither budget ============
test('a third person sees nothing of Sam\'s or Alex\'s budget, no switcher, and cannot switch to either', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await samBudget(sam.seed);
  await alex.seed.section('Alex only');
  const samId = (await sharingApi(alex.page)).sharedWithMe[0].ownerId;
  const alexId = (await sharingApi(sam.page)).members[0].id;
  const carlP = await createPerson(baseURL!, 'Carl');
  const carl = await signedIn(browser, baseURL!, carlP, DESKTOP);
  await carl.page.goto('/budget');
  await expect(carl.page.getByRole('button', { name: 'Add section' })).toBeVisible();
  await expect(bsection(carl.page, 'Needs')).toHaveCount(0);
  await expect(bsection(carl.page, 'Alex only')).toHaveCount(0);
  await expect(carl.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  expect(await sharingApi(carl.page)).toEqual({ members: [], sharedWithMe: [], viewing: null });
  for (const id of [samId, alexId]) expect((await viewApi(carl.page, id)).status()).toBe(400);
  expect(await sectionsApi(carl.page)).toEqual([]);
  expect(await txsApi(carl.page)).toEqual([]);
  await carl.ctx.close();
  await close();
});

test('sharing is one way: Sam sharing with Alex does not give Sam a switcher or Alex\'s data', async ({ browser, baseURL }) => {
  const { sam, alex, close } = await pair(browser, baseURL!, { share: true });
  await alex.seed.section('Alex only');
  await sam.page.goto('/budget');
  await expect(sam.page.getByRole('combobox', { name: 'Budget' })).toHaveCount(0);
  await expect(sam.page.getByText('Alex only')).toHaveCount(0);
  const alexId = (await sharingApi(sam.page)).members[0].id;
  expect((await viewApi(sam.page, alexId)).status()).toBe(400);
  await close();
});

// ============ the phone: the switcher sits at the top of Settings ============
test.describe('phone', () => {
  test.use({ viewport: PHONE });
  test('on a phone the "Budget" select is at the top of Settings and switching works', async ({ browser, baseURL }) => {
    const { sam, alex, close } = await pair(browser, baseURL!, { share: true, viewport: PHONE });
    await samBudget(sam.seed);
    await openTab(alex.page, '/settings', 'People and sharing');
    const sw = alex.page.getByRole('combobox', { name: 'Budget' });
    await expect(sw).toBeVisible();
    const swBox = (await sw.boundingBox())!;
    const cardBox = (await sharingCard(alex.page).boundingBox())!;
    expect(swBox.y).toBeLessThan(cardBox.y);
    await sw.selectOption({ label: 'Sam' });
    await expect(alex.page.getByText(NOT_YOURS).first()).toBeVisible();
    await alex.page.getByRole('link', { name: 'Budget', exact: true }).last().click();
    await expect(bsection(alex.page, 'Needs')).toBeVisible();
    const hasOverflow = await alex.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow).toBe(false);
    await close();
  });
});

// ============ screenshots: the Sharing card and the switcher, light and dark, desktop and phone ============
const sizes = { desktop: DESKTOP, phone: PHONE } as const;
for (const [size, viewport] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`sharing screenshots ${size} ${scheme}`, async ({ browser, baseURL }) => {
      const tag = `${size}-${scheme}`;
      const { sam, alex, close } = await pair(browser, baseURL!, { viewport, scheme });
      await samBudget(sam.seed);
      await openTab(sam.page, '/settings', 'People and sharing');
      await sharingCard(sam.page).scrollIntoViewIfNeeded();
      await shot(sam.page, `sharing-card-empty-${tag}`);
      await sharingCard(sam.page).getByLabel('Share this budget with').fill(alex.person.username);
      await sharingCard(sam.page).getByRole('button', { name: 'Add', exact: true }).click();
      await expect(sharingCard(sam.page).getByRole('button', { name: /^Remove/ })).toHaveCount(1);
      await sharingCard(sam.page).scrollIntoViewIfNeeded();
      await shot(sam.page, `sharing-card-owner-${tag}`);

      await openTab(alex.page, '/settings', 'People and sharing');
      await expect(sharingCard(alex.page).getByRole('button', { name: /^Leave/ })).toBeVisible();
      await sharingCard(alex.page).scrollIntoViewIfNeeded();
      await shot(alex.page, `sharing-card-member-${tag}`);
      await alex.page.goto('/budget');
      await shot(alex.page, `sharing-switcher-own-${tag}`);
      if (size === 'desktop') await switchTo(alex.page, 'Sam');
      else {
        await openTab(alex.page, '/settings', 'People and sharing');
        // the phone select has no accessible name (reported as a finding), so the screenshot run finds it as the select in main
        await alex.page.locator('main select').first().selectOption({ label: 'Sam' });
      }
      await shot(alex.page, `sharing-switcher-viewing-${tag}`);
      await openTab(alex.page, '/settings', 'People and sharing');
      await expect(alex.page.getByText(NOT_YOURS).first()).toBeVisible();
      await alex.page.getByRole('link', { name: 'Transactions' }).first().click();
      await expect(row(alex.page, /Alphamega/)).toContainText(/entered by Sam/i);
      await shot(alex.page, `sharing-transactions-entered-by-${tag}`);
      await openTab(alex.page, '/settings', 'People and sharing');
      await alex.page.getByText(NOT_YOURS).first().scrollIntoViewIfNeeded();
      await shot(alex.page, `sharing-owner-only-cards-${tag}`);
      await close();
    });
  }
}

void toast; void chip;
