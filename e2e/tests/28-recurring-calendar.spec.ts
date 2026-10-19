import type { Page, Locator } from '@playwright/test';
import { test, expect, shot, monthTitle, selectTab, type Seed } from '../support/fixtures';
import { norm } from '../support/closing';

// Spec 25: the bills calendar, paid or due or missed, and price rises. Dates are counted from today (UTC), so the tests pass on any day.
test.use({ viewport: { width: 1280, height: 900 } });
const phone = { width: 390, height: 844 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const at = (offset: number) => new Date(Date.now() + offset * 864e5);
const iso = (offset: number) => at(offset).toISOString().slice(0, 10);
/** "21 Oct" or "21 October" */
const dayMonth = (offset: number) => new RegExp(`\\b${at(offset).getUTCDate()} (${MONTHS[at(offset).getUTCMonth()]}|${LONG[at(offset).getUTCMonth()]})\\b`);
/** Spec 25: a monthly bill's next date is one calendar month on, same day (clamped). */
const nextMonthIso = (offset: number) => { const d = at(offset); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d.getUTCDate(), last)); return t.toISOString().slice(0, 10); };
const EMPTY = 'Nothing recurring yet. Tally finds a payment once it has been paid three times on a regular schedule.';

/** Expenses of one payee, one per offset (days from today, negative for the past), in a subsection of its own. */
async function pays(s: Seed, payee: string, minor: number | number[], offsets: number[]) {
  const sec = await s.section(`Bills ${payee}`);
  const sub = await s.subsection(sec.id, `Bills ${payee}`, 5000);
  const pocket = await s.pocket(`Pocket ${payee}`, 100000);
  for (const [i, o] of offsets.entries()) await s.expense(pocket.id, sub.id, Array.isArray(minor) ? minor[i] : minor, payee, iso(o));
  return sub;
}
type Item = { key: string; payee: string; amountMinor: number; monthlyMinor: number; status: string; priceChange: { fromMinor: number; toMinor: number; date: string } | null; nextDate: string };
const itemsApi = async (page: Page) => {
  const r = await page.request.get('/api/recurring');
  expect(r.status()).toBe(200);
  return ((await r.json()).items as Item[]);
};
const item = async (page: Page, payee: string) => {
  const found = (await itemsApi(page)).find((i) => i.payee === payee);
  expect(found, `${payee} detected`).toBeTruthy();
  return found!;
};
const goto = async (page: Page, tab = 'Upcoming') => {
  await page.goto('/recurring');
  await expect(page.getByRole('heading', { level: 1, name: 'Recurring' })).toBeVisible();
  await selectTab(page, tab);
};
const calendar = (page: Page): Locator => page.locator('.ty-card').filter({ has: page.getByText('Bills calendar', { exact: true }) }).first();
const prev = (c: Locator) => c.getByRole('button', { name: /^(Previous month|‹)$/ });
const next = (c: Locator) => c.getByRole('button', { name: /^(Next month|›)$/ });
/** Pages the calendar forward from the current month to the month of `offset` days from today. */
async function showMonthOf(page: Page, target: string) {
  const c = calendar(page);
  const now = new Date();
  const d = new Date(target + 'T00:00:00Z');
  const steps = (d.getUTCFullYear() - now.getUTCFullYear()) * 12 + d.getUTCMonth() - now.getUTCMonth();
  for (let i = 0; i < Math.abs(steps); i++) await (steps > 0 ? next(c) : prev(c)).click();
  await expect(c).toContainText(monthTitle(d));
  return c;
}
/** A bill chip: the smallest element of the card that holds the payee. */
const chipOf = (c: Locator, payee: string) => c.getByText(payee).first().locator('xpath=ancestor-or-self::*[contains(.,"' + payee + '")][last()]').first();
const allRowOf = (page: Page, payee: string): Locator =>
  page.getByText(payee, { exact: true }).last().locator("xpath=ancestor::*[contains(@class,'ty-trow__who')][1]/..");

test('the Recurring page has a "Bills calendar" card under the headline, with the month title and previous and next buttons', async ({ page, me }) => {
  await pays(me.seed, 'Netflix', 1299, [-60, -30, 0]);
  await goto(page, 'Calendar');
  const c = calendar(page);
  await expect(c).toBeVisible();
  await expect(c).toContainText(monthTitle());
  await expect(prev(c)).toBeVisible();
  await expect(next(c)).toBeVisible();
  const about = (await page.getByText(/^About .* a month in/).boundingBox())!;
  expect((await c.boundingBox())!.y, 'under the headline').toBeGreaterThan(about.y);
  await next(c).click();
  await expect(c).toContainText(monthTitle(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))));
  await prev(c).click();
  await expect(c).toContainText(monthTitle());
});

test('the grid has seven day columns, Monday first', async ({ page, me }) => {
  await pays(me.seed, 'Netflix', 1299, [-60, -30, 0]);
  await goto(page, 'Calendar');
  await expect(calendar(page)).not.toContainText('Loading');
  const text = norm(await calendar(page).innerText());
  const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => text.toUpperCase().indexOf(d));
  expect(order.every((i) => i >= 0), `weekday names in ${text.slice(0, 200)}`).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('a bill paid today is in this month with "Paid", and the expected next one is in the month it falls in without "Paid", and is not counted twice', async ({ page, me }) => {
  await pays(me.seed, 'Netflix', 1299, [-60, -30, 0]);
  await goto(page, 'Calendar');
  let c = calendar(page);
  await expect(c).toContainText('Netflix');
  await expect(c).toContainText('12.99');
  await expect(c.getByText('Paid', { exact: true })).toHaveCount(1);
  await shot(page, 'spec25-calendar-desktop-light');

  // The expected one is a median gap after the last payment (one calendar month).
  const expected = nextMonthIso(0);
  c = await showMonthOf(page, expected);
  await expect(c).toContainText('Netflix');
  await expect(c).toContainText('12.99');
  if (expected.slice(0, 7) !== iso(0).slice(0, 7)) await expect(c.getByText('Paid', { exact: true })).toHaveCount(0);

  const cal = await (await page.request.get(`/api/recurring/calendar?month=${expected.slice(0, 7)}`)).json();
  const hits = (cal.days as { date: string; items: { payee: string; paid: boolean }[] }[]).flatMap((d) => d.items.map((i) => ({ ...i, date: d.date }))).filter((i) => i.payee.toLowerCase() === 'netflix');
  expect(hits.filter((h) => h.date === expected && !h.paid), JSON.stringify(hits)).toHaveLength(1);
});

test('the calendar API: this month holds the paid payment, a past month only actual ones, a bad month is 400, a dismissed group is left out', async ({ page, me }) => {
  await pays(me.seed, 'Netflix', 1299, [-60, -30, 0]);
  await pays(me.seed, 'Gym Weekly', 500, [-16, -8, 0]);
  const month = iso(0).slice(0, 7);
  const r = await page.request.get(`/api/recurring/calendar?month=${month}`);
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.month).toBe(month);
  const today = (body.days as { date: string; items: { payee: string; paid: boolean; amountMinor: number; subsectionId: number }[] }[]).find((d) => d.date === iso(0))!;
  expect(today.items.find((i) => i.payee === 'Netflix')).toMatchObject({ paid: true, amountMinor: 1299 });

  const past = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1)).toISOString().slice(0, 7);
  const pastBody = await (await page.request.get(`/api/recurring/calendar?month=${past}`)).json();
  for (const d of pastBody.days as { items: { paid: boolean }[] }[]) for (const i of d.items) expect(i.paid).toBe(true);

  expect((await page.request.get('/api/recurring/calendar?month=nope')).status()).toBe(400);
  expect((await page.request.get('/api/recurring/calendar?month=2026-13')).status()).toBe(400);

  const key = (await item(page, 'Gym Weekly')).key;
  const dis = await page.request.post(`/api/recurring/${encodeURIComponent(key)}/dismiss`, { data: {} });
  expect(dis.status(), key + ' ' + await dis.text()).toBe(204);
  const after = await (await page.request.get(`/api/recurring/calendar?month=${month}`)).json();
  const payees = (after.days as { items: { payee: string }[] }[]).flatMap((d) => d.items.map((i) => i.payee));
  expect(payees).not.toContain('Gym Weekly');
  expect(payees).toContain('Netflix');
});

// ---- price rises ----
test('Netflix going from 12.99 to 15.99 stays detected, shows the banner above "All", and counts 15.99 a month', async ({ page, me }) => {
  await pays(me.seed, 'Netflix', [1299, 1299, 1599], [-60, -30, 0]);
  const it = await item(page, 'Netflix');
  expect(it.amountMinor).toBe(1599);
  expect(it.monthlyMinor).toBe(1599);
  expect(it.priceChange).toMatchObject({ fromMinor: 1299, toMinor: 1599, date: iso(0) });
  await goto(page);
  await expect(page.getByText(/About\D*15\.99\D* a month in 1 recurring payment\./)).toBeVisible();
  const banner = page.locator('.ty-inset').filter({ hasText: 'went up' });
  await expect(banner).toHaveCount(1);
  const t = norm(await banner.innerText());
  expect(t).toMatch(/^Netflix went up from 12\.99 to 15\.99 on /);
  expect(t).toMatch(dayMonth(0));
  const all = page.getByText('All', { exact: true });
  expect((await banner.boundingBox())!.y).toBeLessThan((await all.boundingBox())!.y);
  await expect(allRowOf(page, 'Netflix')).toContainText('15.99');
  await shot(page, 'spec25-price-rise-desktop-light');
});

test('a steady price shows no banner; a rise of more than 50% hides the subscription, a rise of 20% does not', async ({ page, me }) => {
  await pays(me.seed, 'Steady', 1000, [-60, -30, 0]);
  await goto(page);
  await expect(page.getByText('Steady', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.ty-inset').filter({ hasText: 'went up' })).toHaveCount(0);
  expect((await item(page, 'Steady')).priceChange).toBeNull();

  await pays(me.seed, 'Jumper', [1000, 1000, 1600], [-60, -30, 0]);
  await pays(me.seed, 'Riser', [1000, 1000, 1200], [-60, -30, 0]);
  const payees = (await itemsApi(page)).map((i) => i.payee);
  expect(payees).toContain('Riser');
  expect(payees).not.toContain('Jumper');
  await page.reload();
  await expect(page.locator('.ty-inset').filter({ hasText: 'Riser went up from 10.00 to 12.00' })).toHaveCount(1);
});

test('a rise under 2% is not announced', async ({ page, me }) => {
  await pays(me.seed, 'Tiny', [10000, 10000, 10100], [-60, -30, 0]);
  expect((await item(page, 'Tiny')).priceChange).toBeNull();
  await goto(page);
  await expect(page.locator('.ty-inset').filter({ hasText: 'went up' })).toHaveCount(0);
});

test('with a 60% rise and nothing else, the page shows the empty message', async ({ page, me }) => {
  await pays(me.seed, 'Jumper', [1000, 1000, 1600], [-60, -30, 0]);
  await goto(page);
  await expect(page.getByText(EMPTY)).toBeVisible();
});

// ---- statuses ----
test('each item shows its status: Paid (positive), Due <weekday> (warning), Missed (negative), and none when upcoming', async ({ page, me }) => {
  await pays(me.seed, 'Paid Item', 1000, [-60, -30, 0]); // paid in the current calendar month
  await pays(me.seed, 'Missed Item', 2000, [-100, -70, -40]); // next date 10 days ago, not paid this month
  await pays(me.seed, 'Due Item', 3000, [-725, -360]); // yearly, next in 5 days
  await pays(me.seed, 'Later Item', 4000, [-565, -200]); // yearly, next in 165 days
  const by = Object.fromEntries((await itemsApi(page)).map((i) => [i.payee, i.status]));
  expect(by).toMatchObject({ 'Paid Item': 'paid', 'Missed Item': 'missed', 'Due Item': 'due', 'Later Item': 'upcoming' });

  await goto(page);
  const pill = (payee: string, text: RegExp) => allRowOf(page, payee).locator('.ty-pill').filter({ hasText: text });
  await expect(pill('Paid Item', /^Paid$/)).toHaveClass(/ty-pill--positive/);
  await expect(pill('Missed Item', /^Missed$/)).toHaveClass(/ty-pill--negative/);
  const weekday = DAYS[at(5).getUTCDay()];
  await expect(pill('Due Item', new RegExp(`^Due (${weekday}|${weekday.slice(0, 3)})$`))).toHaveClass(/ty-pill--warning/);
  await expect(allRowOf(page, 'Later Item').locator('.ty-pill')).toHaveCount(0);
  await shot(page, 'spec25-statuses-desktop-light');
});

test('the Due row in "Due in the next 7 days" carries its warning Pill too', async ({ page, me }) => {
  await pays(me.seed, 'Due Item', 3000, [-725, -360]);
  await goto(page);
  await expect(page.getByText('Due in the next 7 days')).toBeVisible();
  await expect(page.locator('.ty-pill--warning').filter({ hasText: /^Due / }).first()).toBeVisible();
  await expect(page.locator('.ty-pill--warning').filter({ hasText: /^Due / })).not.toHaveCount(0);
});

// ---- phone and screenshots ----
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot: Recurring with the calendar, ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await pays(me.seed, 'Netflix', [1299, 1299, 1599], [-60, -30, 0]);
      await pays(me.seed, 'Rent Storage', 4500, [-100, -70, -40]);
      await pays(me.seed, 'Due Item', 3000, [-725, -360]);
      await pays(me.seed, 'Gym Weekly', 500, [-16, -8, 0]);
      await goto(page, 'Calendar');
      await expect(calendar(page)).toContainText('Netflix');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
      await shot(page, `spec25-recurring-${size}-${scheme}`);
      await calendar(page).scrollIntoViewIfNeeded();
      await calendar(page).screenshot({ path: `screenshots/spec25-calendar-${size}-${scheme}.png` });
    });
  }
}

test('on a phone the calendar lists the days that have bills, with the payee, the amount and "Paid"', async ({ page, me }) => {
  await page.setViewportSize(phone);
  await pays(me.seed, 'Netflix', 1299, [-60, -30, 0]);
  await goto(page, 'Calendar');
  const c = calendar(page);
  await expect(c).toContainText('Netflix');
  await expect(c).toContainText('12.99');
  await expect(c.getByText('Paid', { exact: true })).toHaveCount(1);
  // a list of days with items, not a seven-column grid: a month with one bill is short
  expect((await c.boundingBox())!.height).toBeLessThan(500);
  void chipOf;
});
