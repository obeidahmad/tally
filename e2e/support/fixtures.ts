import { test as base, expect, request, type Page, type Locator } from '@playwright/test';

export { expect };

export const OWNER = { username: 'owner', displayName: 'Sam', password: 'correct horse 42' };

export type Person = { username: string; displayName: string; password: string };

let counter = 0;
const unique = () => `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => todayIso().slice(0, 7);
export const monthTitle = (d = new Date()) => d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayHeading = () => `${new Date().getUTCDate()} ${new Date().toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;

/** The owner adds a new person through POST /api/users, so each test has a fresh account with no data. */
export async function createPerson(baseURL: string, displayName = 'Tess'): Promise<Person> {
  const ctx = await request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', { data: { username: OWNER.username, password: OWNER.password } });
  expect(login.status(), 'owner sign-in (first-run set-up must have happened)').toBe(200);
  const person = { username: unique(), displayName, password: 'a long test password' };
  const res = await ctx.post('/api/users', { data: { ...person, baseCurrency: 'EUR' } });
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
    // `budget` is spec 04's budgetKind / budgetMinor / budgetBasisPoints; left out, the section is on "subsections".
    section: (name: string, budget: { budgetKind?: 'subsections' | 'fixed' | 'percent'; budgetMinor?: number; budgetBasisPoints?: number } = {}) =>
      ok<{ id: number }>(r.post('/api/sections', { data: { name, ...budget } }), 'section'),
    subsection: (sectionId: number, name: string, budgetMinor: number) =>
      ok<{ id: number }>(r.post(`/api/sections/${sectionId}/subsections`, { data: { name, budgetMinor } }), 'subsection'),
    // `emoji` is left out of the request when not given, so the server's default for the kind applies.
    pocket: (name: string, openingBalanceMinor = 0, kind = 'bank', emoji?: string) =>
      ok<{ id: number; emoji: string }>(r.post('/api/pockets', { data: { name, kind, openingBalanceMinor, ...(emoji ? { emoji } : {}) } }), 'pocket'),
    expense: (pocketId: number, subsectionId: number, amountMinor: number, payee: string, date = todayIso()) =>
      ok<{ id: number }>(r.post('/api/transactions', { data: { date, kind: 'expense', amountMinor, pocketId, subsectionId, payee } }), 'transaction'),
    income: (pocketId: number, amountMinor: number, payee: string, date = todayIso()) =>
      ok<{ id: number }>(r.post('/api/transactions', { data: { date, kind: 'income', amountMinor, pocketId, subsectionId: null, payee } }), 'transaction'),
  };
}
export type Seed = ReturnType<typeof seed>;

/** Needs (Food 300, Mortgage 600, Utilities 120) and Wants (Subscriptions 40, Gifts 0), one pocket, income 2,000. */
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
  await s.income(pocket.id, 200000, 'Paycheck');
  return { pocket, food, mortgage, util, subs };
}

type Fixtures = { me: Person & { seed: Seed } };

/** `me` is a brand-new person who is already signed in on `page`. */
export const test = base.extend<Fixtures>({
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
  if (o.pocket) await chip(d, 'Pocket', o.pocket).check();
}
export const pocketsApi = async (page: Page) =>
  (await (await page.request.get('/api/pockets')).json()).pockets as
    { id: number; name: string; kind: string; emoji: string; openingBalanceMinor: number; balanceMinor: number }[];
