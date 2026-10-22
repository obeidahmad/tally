import { test as base, expect, request, type Page, type Locator } from '@playwright/test';

export { expect };

export const OWNER = { username: 'owner', displayName: 'Sam', password: 'correct horse 42' };

export type Person = { username: string; displayName: string; password: string };

let counter = 0;
const unique = () => `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The server dates things by its own local day, so this is the local date, not the UTC one. */
export const localIso = (offsetDays = 0) => { const d = new Date(Date.now() + offsetDays * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const todayIso = () => localIso();
export const thisMonth = () => todayIso().slice(0, 7);
export const monthTitle = (d = new Date()) => d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayHeading = () => `${new Date().getUTCDate()} ${new Date().toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;

/** The owner adds a new person through POST /api/users, so each test has a fresh account with no data. */
export async function createPerson(baseURL: string, displayName = 'Tess', baseCurrency = 'EUR'): Promise<Person> {
  const ctx = await request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', { data: { username: OWNER.username, password: OWNER.password } });
  expect(login.status(), 'owner sign-in (first-run set-up must have happened)').toBe(200);
  const person = { username: unique(), displayName, password: 'a long test password' };
  const res = await ctx.post('/api/users', { data: { ...person, baseCurrency } });
  expect(res.status()).toBe(201);
  await ctx.dispose();
  return person;
}

export async function signInByApi(page: Page, who: { username: string; password: string }) {
  const res = await page.request.post('/api/auth/login', { data: { username: who.username, password: who.password } });
  expect(res.status()).toBe(200);
}

/** Seeds data as the signed-in person through the API. */
export function seed(page: Page) {
  const r = page.request;
  const ok = async <T>(p: Promise<import('@playwright/test').APIResponse>, key: string): Promise<T> => {
    const res = await p;
    expect(res.status(), key).toBeLessThan(300);
    return (await res.json())[key] as T;
  };
  return {
    section: (name: string) => ok<{ id: number }>(r.post('/api/sections', { data: { name } }), 'section'),
    subsection: (sectionId: number, name: string, budgetMinor: number) =>
      ok<{ id: number }>(r.post(`/api/sections/${sectionId}/subsections`, { data: { name, budgetMinor } }), 'subsection'),
    // `emoji` is left out of the request when not given, so the server's default for the kind applies.
    pocket: (name: string, openingBalanceMinor = 0, kind = 'bank', emoji?: string) =>
      ok<{ id: number; emoji: string }>(r.post('/api/pockets', { data: { name, kind, openingBalanceMinor, ...(emoji ? { emoji } : {}) } }), 'pocket'),
    expense: (pocketId: number, subsectionId: number, amountMinor: number, payee: string, date = todayIso()) =>
      ok<{ id: number }>(r.post('/api/transactions', { data: { date, kind: 'expense', amountMinor, pocketId, subsectionId, payee } }), 'transaction'),
    // A source of the pipeline; without `boxId` it gets a box of its own.
    source: (name: string, boxId?: number) =>
      ok<{ id: number; boxId: number }>(r.post('/api/sources', { data: { name, ...(boxId ? { boxId } : {}) } }), 'source'),
    // `source` is a source's name (made in a box of its own the first time it is used) or its id.
    income: async (pocketId: number, amountMinor: number, source: string | number, date = todayIso()) => {
      let sourceId = source;
      if (typeof source === 'string') {
        const list = (await (await r.get('/api/sources')).json()).sources as { id: number; name: string }[];
        sourceId = list.find((x) => x.name.toLowerCase() === source.toLowerCase())?.id ?? (await ok<{ id: number }>(r.post('/api/sources', { data: { name: source } }), 'source')).id;
      }
      return ok<{ id: number }>(r.post('/api/transactions', { data: { date, kind: 'income', amountMinor, pocketId, subsectionId: null, sourceId } }), 'transaction');
    },
    // The steps of a box, each added last.
    amountStep: (boxId: number, sectionId: number, amountMinor: number) =>
      ok<{ id: number }>(r.post(`/api/boxes/${boxId}/steps`, { data: { kind: 'amount', sectionId, amountMinor } }), 'step'),
    percentStep: (boxId: number, shares: { sectionId: number; basisPoints: number }[]) =>
      ok<{ id: number }>(r.post(`/api/boxes/${boxId}/steps`, { data: { kind: 'percent', shares } }), 'step'),
    sourcesApi: async () => (await (await r.get('/api/sources')).json()).sources as { id: number; name: string; boxId: number }[],
  };
}
export type Seed = ReturnType<typeof seed>;

/**
 * Needs (Food 300, Mortgage 600, Utilities 120) and Wants (Subscriptions 40, Gifts 0), one pocket, income 2,000 from "Paycheck".
 * The Paycheck box sends 1,020.00 to Needs and 40.00 to Wants, so each section receives what its subsections claim:
 * Budgeted 1,060.00, Left over 940.00.
 */
export async function seedBudget(s: Seed) {
  const needs = await s.section('Needs');
  const food = await s.subsection(needs.id, 'Food', 30000);
  const mortgage = await s.subsection(needs.id, 'Mortgage', 60000);
  const util = await s.subsection(needs.id, 'Utilities', 12000);
  const wants = await s.section('Wants');
  const subs = await s.subsection(wants.id, 'Subscriptions', 4000);
  await s.subsection(wants.id, 'Gifts', 0);
  const pocket = await s.pocket('Revolut', 100000);
  await s.expense(pocket.id, food.id, 21240, 'Alphamega');
  await s.expense(pocket.id, mortgage.id, 60000, 'Bank mortgage');
  await s.expense(pocket.id, util.id, 13175, 'EAC electricity');
  await s.expense(pocket.id, subs.id, 3897, 'Netflix');
  const paycheck = await s.source('Paycheck');
  await s.income(pocket.id, 200000, paycheck.id);
  await s.amountStep(paycheck.boxId, needs.id, 102000);
  await s.amountStep(paycheck.boxId, wants.id, 4000);
  return { pocket, food, mortgage, util, subs, needs, wants, paycheck };
}

type Fixtures = { me: Person & { seed: Seed } };

/**
 * Spec 27: the app is light unless the person chose Dark (localStorage tally.theme), whatever the system prefers.
 * Most tests only want "dark" to mean a dark app, so a browser that prefers dark gets the Dark choice stored before the page loads.
 * The theme tests open their own context without this script.
 */
export const darkWhenSystemIsDark = () => {
  try { if (matchMedia('(prefers-color-scheme: dark)').matches) localStorage.setItem('tally.theme', 'dark'); } catch { /* storage blocked */ }
};

/** Spec 12: a pocket in another currency, made through the API. */
export async function currencyPocket(page: Page, name: string, currency: string, openingBalanceMinor = 0, kind = 'bank') {
  const res = await page.request.post('/api/pockets', { data: { name, kind, currency, openingBalanceMinor } });
  expect(res.status()).toBe(201);
  return (await res.json()).pocket as { id: number };
}

/** `me` is a brand-new person who is already signed in on `page`. */
export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await context.addInitScript(darkWhenSystemIsDark);
    await use(context);
  },
  me: async ({ page, baseURL }, use) => {
    const person = await createPerson(baseURL!);
    await signInByApi(page, person);
    await use({ ...person, seed: seed(page) });
  },
});

export const dialog = (page: Page) => page.getByRole('dialog');
export const toast = (page: Page) => page.getByRole('status');
// Waits out the 150ms dialog fade so the picture shows the settled state.
export const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: false });
};
export const row = (page: Page, text: string | RegExp): Locator => page.getByRole('button', { name: text });
export const pillOf = (r: Locator) => r.locator('.ty-pill');

// ---- spec 02 helpers ----

/** The 32 emoji of the contract, in the order the picker shows them. Built from code points, as the spec says. */
export const EMOJI: [number, string][] = [
  [0x1f3e6, 'Bank'], [0x1f4b3, 'Card'], [0x1f4b5, 'Banknote'], [0x1f4b6, 'Euro note'], [0x1f4b7, 'Pound note'], [0x1f4b0, 'Money bag'],
  [0x1fa99, 'Coin'], [0x1f45b, 'Purse'], [0x1f437, 'Piggy bank'], [0x1f4c8, 'Chart'], [0x1f331, 'Seedling'], [0x1f48e, 'Gem'],
  [0x1f512, 'Lock'], [0x1f3e0, 'House'], [0x1f697, 'Car'], [0x2708, 'Plane'], [0x1f381, 'Gift'], [0x1f393, 'Graduation cap'],
  [0x1f476, 'Baby'], [0x2764, 'Heart'], [0x2b50, 'Star'], [0x2602, 'Umbrella'], [0x1f6d2, 'Shopping cart'], [0x1f4bc, 'Briefcase'],
  [0x1f4f1, 'Phone'], [0x1f30d, 'Globe'], [0x1f3d6, 'Beach'], [0x1f6e0, 'Tools'], [0x1f3af, 'Target'], [0x1f9fe, 'Receipt'],
  [0x1f932, 'Open hands'], [0x1f54c, 'Mosque'],
];
export const em = (name: string) => String.fromCodePoint(EMOJI.find(([, n]) => n === name)![0]);
export const DEFAULT_EMOJI = { bank: 'Bank', cash: 'Banknote', fund: 'Seedling', broker: 'Chart' } as const;
export const KIND_LABEL = { bank: 'Bank account', cash: 'Cash', fund: 'Fund', broker: 'Broker' } as const;
export const noVs = (t: string) => t.replace(/\uFE0F/g, '').trim();

export const group = (scope: Page | Locator, name: string) => scope.getByRole('group', { name, exact: true });
/** A chip of a Chips group (a radio inside the fieldset with that legend), found by the text it shows. */
export const chip = (scope: Page | Locator, legend: string, text: string | RegExp) => group(scope, legend).getByRole('radio', { name: text });
/** The names of the checked emoji radios of the Emoji group in scope (one expected). */
export const checkedEmoji = async (scope: Page | Locator) => {
  const radios = group(scope, 'Emoji').getByRole('radio');
  const n = await radios.count();
  const on: string[] = [];
  for (let i = 0; i < n; i++) if (await radios.nth(i).isChecked()) on.push((await radios.nth(i).getAttribute('aria-label')) ?? '');
  return on;
};
/** Selects the option of a native select whose text contains `text` (options may start with an emoji). */
export async function selectLike(select: Locator, text: string) {
  const labels = await select.locator('option').allTextContents();
  const i = labels.findIndex((l) => l.includes(text));
  expect(i, `option ${text} in ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(0);
  await select.selectOption({ index: i });
}
/** Fills an expense in an open transaction dialog; subsection and pocket are picked by text. */
export async function fillExpense(d: Locator, o: { amount: string; payee: string; subsection?: string; pocket?: string | RegExp }) {
  await d.getByLabel('Amount').fill(o.amount);
  await d.getByLabel('Payee').fill(o.payee);
  if (o.subsection) await d.getByLabel('Subsection').selectOption({ label: o.subsection });
  if (o.pocket) await chip(d, 'Paid from', o.pocket).check();
}
export const pocketsApi = async (page: Page) =>
  (await (await page.request.get('/api/pockets')).json()).pockets as
    { id: number; name: string; kind: string; emoji: string; openingBalanceMinor: number; balanceMinor: number }[];

// ---- spec 06 helpers ----

/** The spec's worked example: Paycheck 2,000.00 and Second job 600.00 share a box, Fund payout 12.40 has a box of its own. */
export const WORKED = {
  zakat: '65.00', family: '500.00', needs: '1,017.50', wants: '610.50', savings: '407.00', leftOver: '12.40', together: '2,600.00',
  lefts: ['2,535.00 left', '2,035.00 left', '0.00 left'],
} as const;

/**
 * The worked example, seeded through the API, with its three steps in the first box:
 * 2.5% Zakat, 500.00 Family, then 50% Needs / 30% Wants / 20% Savings. Sections are made in that order (Zakat first).
 */
export async function seedPipeline(s: Seed) {
  const zakat = await s.section('Zakat');
  const family = await s.section('Family');
  const needs = await s.section('Needs');
  const wants = await s.section('Wants');
  const savings = await s.section('Savings');
  const pocket = await s.pocket('Revolut', 0);
  const paycheck = await s.source('Paycheck');
  const second = await s.source('Second job', paycheck.boxId);
  const fund = await s.source('Fund payout');
  await s.income(pocket.id, 200000, paycheck.id);
  await s.income(pocket.id, 60000, second.id);
  await s.income(pocket.id, 1240, fund.id);
  const s1 = await s.percentStep(paycheck.boxId, [{ sectionId: zakat.id, basisPoints: 250 }]);
  const s2 = await s.amountStep(paycheck.boxId, family.id, 50000);
  const s3 = await s.percentStep(paycheck.boxId, [
    { sectionId: needs.id, basisPoints: 5000 }, { sectionId: wants.id, basisPoints: 3000 }, { sectionId: savings.id, basisPoints: 2000 },
  ]);
  return { zakat, family, needs, wants, savings, pocket, paycheck, second, fund, steps: [s1, s2, s3] };
}

// ---- spec 21: the Budget table, the summary and the Pockets rows ----
// The table is the design's BudgetTable (design/components/BudgetTable): a card with a header row (ty-btable__head), then per section
// a section row (ty-btable__sec, with a chevron button that has aria-expanded), subsection rows (ty-btable__row, role=button),
// a Rest row (a ty-btable__row that is not a button) and an Add subsection row (ty-btable__add). Cells are the children of a row, in column order.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A pocket's row on the Pockets page: the tappable row that holds its name. */
export const pocketRow = (scope: Page | Locator, name: string) =>
  scope.getByRole('button', { name: new RegExp(esc(name), 'i') }).filter({ has: ('page' in scope && typeof (scope as Locator).page === 'function' ? (scope as Locator).page() : (scope as Page)).locator('.ty-emoji') }).first(); // the group heading is a button too: a pocket row holds an emoji
/** Every pocket row of the Pockets page (a button that holds a pocket emoji). */
export const pocketRows = (page: Page) => page.getByRole('button').filter({ has: page.locator('.ty-emoji') });

export const btable = (page: Page) => page.locator('.ty-btable').first();
/** The row of a subsection in the Budget table (the rows that open a dialog), found by the text it holds. */
export const srow = (page: Page, name: string | RegExp): Locator => page.locator('.ty-btable__row[role="button"]').filter({ hasText: name }).first();
/** The row of a section: the table's section row that holds the section's name. */
export const bsection = (page: Page, name: string): Locator =>
  page.locator('.ty-btable__sec').filter({ has: page.getByText(name, { exact: true }) }).first();
/** The "Rest" row that closes a section: the first row after the section row that is not a button. */
export const restRow = (page: Page, sectionName: string): Locator =>
  bsection(page, sectionName).locator('xpath=following::*[contains(@class,"ty-btable__row") and not(@role="button")][1]');
/** The chevron button of a section row. */
export const collapse = (page: Page, sectionName: string) => bsection(page, sectionName).locator('button[aria-expanded]');
/** The "Add subsection" button that closes a section (the first one after the section row). */
export const addSubBtn = (page: Page, sectionName: string): Locator =>
  bsection(page, sectionName).getByRole('button', { name: `Add subsection to ${sectionName}` });

/** All header labels in column order (also the ones a narrow table hides). */
export const allHeads = async (page: Page) => (await page.locator('.ty-btable__head > *').first().waitFor(), await page.locator('.ty-btable__head > *').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
/** The header labels that are shown. */
export const shownHeads = async (page: Page) => {
  await page.locator('.ty-btable__head > *').first().waitFor();
  return page.locator('.ty-btable__head > *').evaluateAll((els) =>
    els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}
/** The cell of `r` under the column header `column` ("Rule", "From last month", "Moved", "Budgeted", "Spent", "Available"). */
export async function cell(page: Page, r: Locator, column: string): Promise<Locator> {
  const heads = await allHeads(page);
  const want = column.toLowerCase() === 'from last month' ? 'carried' : column.toLowerCase();
  const i = heads.findIndex((h) => h.toLowerCase() === want || h.toLowerCase() === column.toLowerCase());
  expect(i, `column "${column}" in ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  return r.locator(':scope > *').nth(i);
}
export const ruleCell = (page: Page, name: string | RegExp) => cell(page, srow(page, name), 'Rule');
/** The text a cell carries as a tooltip, on itself or on a child. */
export const titleOf = (c: Locator) => c.evaluate((el) => el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '');
/** Names of the subsection rows of a section, in order. */
export const subNames = (page: Page, sectionName: string) =>
  page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.ty-btable__sec, .ty-btable__row[role="button"]')];
    const start = rows.findIndex((r) => r.matches('.ty-btable__sec') && (r.textContent ?? '').includes(name));
    const out: string[] = [];
    for (const r of rows.slice(start + 1)) {
      if (r.matches('.ty-btable__sec')) break;
      out.push(((r.querySelector('.ty-btable__text') ?? r.firstElementChild)?.textContent ?? '').trim());
    }
    return out;
  }, sectionName);

/** One figure of the month summary (Income, Budgeted, Spent, Left over): the row or tile of its label. */
export const stat = (page: Page, label: string): Locator =>
  page.locator('.ty-statcard').filter({ has: page.getByText(label === 'Spent' ? /^Spent( so far)?$/ : label, { exact: label !== 'Spent' }) }).first();
/** The whole month summary: the nearest block that holds both "Income" and "Left over". */
export const summary = (page: Page): Locator => page.locator('.ty-statcards').first();

/** A date header of the Transactions list, e.g. "Sunday, 18 October" (spec 27). */
export const dayHeadingRe = (d = new Date()) =>
  new RegExp(`${d.toLocaleString('en-GB', { weekday: 'long', timeZone: 'UTC' })},?\\s+${d.getUTCDate()}\\s+${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`, 'i');

// ---- spec 27: page tabs ----
/** Opens `path` and selects the tab with that name (the page's Tabs component: role=tablist, role=tab). */
export async function openTab(page: Page, path: string, tab: string) {
  await page.goto(path);
  await selectTab(page, tab);
}
export async function selectTab(page: Page, tab: string) {
  const t = page.getByRole('tab', { name: tab, exact: true });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
}
/** Settings > Appearance: picks "Light", "Dark" or "Match system" (the spec names the choices, not the control). */
export async function chooseAppearance(page: Page, choice: 'Light' | 'Dark' | 'Match system') {
  await openTab(page, '/settings', 'Appearance');
  const c = page.getByRole('radio', { name: choice, exact: true }).or(page.getByRole('button', { name: choice, exact: true })).first();
  await c.click();
}
/** The page's background colour as the browser reports it, and the --bg token for comparison. */
export const pageBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
export const THEME = {
  light: { bg: 'rgb(246, 245, 242)', surface: 'rgb(255, 255, 255)' },
  dark: { bg: 'rgb(20, 20, 22)', surface: 'rgb(29, 29, 32)' },
} as const;

/** The sticky ancestor of the page title: the top bar (spec 27: 56px, sticky). Null when there is none. */
export const stickyBar = (page: Page) => page.evaluate(() => {
  let e: Element | null = document.querySelector('h1');
  while (e) {
    if (getComputedStyle(e).position === 'sticky') { const r = e.getBoundingClientRect(); return { y: r.y, height: r.height, width: r.width }; }
    e = e.parentElement;
  }
  return null;
});

/** Spec 29: "Kept in" is required once a plan pocket exists; picks the first real option of the dialog's select, if it has one. */
export async function pickKeptIn(d: Locator) {
  const s = d.getByLabel('Kept in', { exact: true });
  if (!(await s.count())) return;
  const first = s.locator('option:not([disabled])').first();
  if (await s.locator('option:checked:not([disabled])').count()) return;
  await s.selectOption({ label: ((await first.textContent()) ?? '').trim() });
}
