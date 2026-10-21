import { test, expect, shot, type Seed } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

// Spec 18: recurring bills and subscriptions. Dates are counted back from today (UTC), so the tests pass on any day.
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };
test.use({ viewport: desktop });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const at = (offset: number) => new Date(Date.now() + offset * 864e5);
const iso = (offset: number) => at(offset).toISOString().slice(0, 10);
const short = (offset: number) => `${at(offset).getUTCDate()} ${MONTHS[at(offset).getUTCMonth()]}`;
// Spec 25: monthly bills step one calendar month (same day, clamped), yearly ones one calendar year.
const stepMonth = (offset: number, months: number) => { const d = at(offset); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d.getUTCDate(), last)); return t; };
const shortOf = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
const long = (offset: number) => `${DAYS[at(offset).getUTCDay()]} ${short(offset)}`;

const EMPTY = 'Nothing recurring yet. Tally finds a payment once it has been paid three times on a regular schedule.';
const about = (page: Page, amount: string, count: number) =>
  expect(page.getByText(new RegExp('About\\D*' + amount.replace('.', '\\.') + '\\D* a month in ' + count + ' recurring payments?\\.'))).toBeVisible();

/** Expenses of one payee, one per offset (days from today, negative for the past), all in a new subsection. */
async function pays(s: Seed, payee: string | string[], minor: number | number[], offsets: number[], sub = 'Subscriptions') {
  const wants = await s.section(`Wants ${sub}`);
  const subsection = await s.subsection(wants.id, sub, 5000);
  const pocket = await s.pocket(`Revolut ${sub}`, 100000);
  for (const [i, o] of offsets.entries()) {
    await s.expense(pocket.id, subsection.id, Array.isArray(minor) ? minor[i] : minor, Array.isArray(payee) ? payee[i] : payee, iso(o));
  }
  return { subsection };
}
const monthly = (s: Seed) => pays(s, ['NETFLIX.COM 4471', 'Netflix.com 4472', 'Netflix.com'], 1299, [-65, -35, -5]);
const weekly = (s: Seed) => pays(s, 'Gym Weekly', 500, [-17, -10, -3], 'Fitness');

/** The "All" row of a payee: the nearest ancestor of its name that also holds a "last paid" line. */
const allRow = (page: Page, payee: string): Locator =>
  page.getByText(payee, { exact: true }).last().locator("xpath=ancestor::*[contains(@class,'ty-trow__who')][1]/..");
const goto = async (page: Page) => {
  await page.goto('/recurring');
  await expect(page.getByRole('heading', { level: 1, name: 'Recurring' })).toBeVisible();
};

test('the sidebar lists "Recurring" right after "Transactions" and opens the page', async ({ page, me }) => {
  await page.goto('/transactions');
  const links = await page.locator('.ty-side').getByRole('link').allInnerTexts();
  const names = links.map((l) => l.trim());
  expect(names.indexOf('Recurring'), JSON.stringify(names)).toBe(names.indexOf('Transactions') + 1);
  await page.getByRole('link', { name: 'Recurring', exact: true }).click();
  await expect(page).toHaveURL(/\/recurring$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Recurring' })).toBeVisible();
});

test('with no recurring payment the page shows the empty message and no sections', async ({ page, me }) => {
  await goto(page);
  await expect(page.getByText(EMPTY)).toBeVisible();
  await expect(page.getByText('Due in the next 7 days')).toHaveCount(0);
  await expect(page.getByText(/^Hidden \(/)).toHaveCount(0);
});

test('only two payments, a gap outside every band and a latest amount more than 50% above the others are not found', async ({ page, me }) => {
  await pays(me.seed, 'Two Only', 1000, [-40, -10]);
  await pays(me.seed, 'Gap Of Forty', 1000, [-100, -60, -20], 'Gaps');
  await pays(me.seed, 'Amount Jumps', [1000, 1000, 1600], [-65, -35, -5], 'Jumps');
  await goto(page);
  await expect(page.getByText(EMPTY)).toBeVisible();
  for (const p of ['Two Only', 'Gap Of Forty', 'Amount Jumps']) await expect(page.getByText(p)).toHaveCount(0);
});

test('three monthly Netflix expenses of 12.99 show as Monthly with last, next date and the monthly total', async ({ page, me }) => {
  await monthly(me.seed);
  await goto(page);
  // "NETFLIX.COM 4471" and "Netflix.com" share a key, so there is one item, named as the latest was written
  await about(page, '12.99', 1);
  const r = allRow(page, 'Netflix.com');
  await expect(r).toContainText(`Monthly · last paid ${short(-5)} · next ${shortOf(stepMonth(-5, 1))}`);
  await expect(r).toContainText('Subscriptions');
  await expect.poll(() => r.locator('.ty-dot').evaluateAll((d) => d.filter((e) => e.getBoundingClientRect().width > 0).length)).toBeGreaterThan(0);
  await expect(r).toContainText('12.99');
  await expect(r.getByRole('button', { name: 'Not recurring', exact: true })).toBeVisible();
  await expect(page.getByText('Netflix.com 4472')).toHaveCount(0);
  await expect(page.getByText('NETFLIX.COM 4471')).toHaveCount(0);
  await expect(page.getByText('All', { exact: true })).toBeVisible();
  await expect(page.getByText('Due in the next 7 days')).toHaveCount(0); // next one is 25 days away
  await expect(page.getByText(EMPTY)).toHaveCount(0);
});

test('a weekly payment shows as Weekly, is due within 7 days, and counts weekly x 52 / 12 a month', async ({ page, me }) => {
  await weekly(me.seed);
  await goto(page);
  await about(page, '21.67', 1); // 5.00 x 52 / 12 = 21.666...
  await expect(allRow(page, 'Gym Weekly')).toContainText(`Weekly · last paid ${short(-3)} · next ${short(4)}`);
  await expect(page.getByText('Due in the next 7 days')).toBeVisible();
  await expect(page.getByText(`due ${long(4)}`)).toBeVisible();
  // the due row has the payee, the subsection with its dot and the amount
  const due = page.locator('.ty-trow__who').filter({ hasText: 'Gym Weekly' }).first().locator('xpath=..');
  await expect(due).toContainText('Fitness');
  await expect.poll(() => due.locator('.ty-dot').evaluateAll((d) => d.filter((e) => e.getBoundingClientRect().width > 0).length)).toBeGreaterThan(0);
  await expect(due).toContainText('5.00');
});

test('a yearly payment shows as Yearly and counts one twelfth a month', async ({ page, me }) => {
  // Yearly needs only two payments, 355 to 375 days apart.
  await pays(me.seed, 'Domain Renewal', 12000, [-375, -10], 'Domains');
  await goto(page);
  await about(page, '10.00', 1);
  await expect(allRow(page, 'Domain Renewal')).toContainText(`Yearly · last paid ${short(-10)} · next ${shortOf(stepMonth(-10, 12))}`);
});

test('the monthly total adds every item: monthly 12.99 and weekly 5.00 make 34.66 in 2 payments, listed by next date', async ({ page, me }) => {
  await monthly(me.seed);
  await weekly(me.seed);
  await goto(page);
  await about(page, '34.66', 2);
  const all = page.getByText(/last paid/);
  await expect(all).toHaveCount(2);
  await expect(all.first()).toContainText('Weekly'); // next in 4 days, before Netflix in 25
  await expect(all.last()).toContainText('Monthly');
});

test('"Not recurring" hides an item and takes it out of the total; "Show again" brings it back', async ({ page, me }) => {
  await monthly(me.seed);
  await weekly(me.seed);
  await goto(page);
  await about(page, '34.66', 2);
  await allRow(page, 'Netflix.com').getByRole('button', { name: 'Not recurring', exact: true }).click();
  await about(page, '21.67', 1);
  await expect(page.getByText(/Monthly · last paid/)).toHaveCount(0);
  // listed collapsed at the end
  await expect(page.getByText('Hidden (1)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show again', exact: true })).toBeHidden();
  await page.reload();
  await about(page, '21.67', 1); // it stays hidden
  await page.getByText('Hidden (1)').click();
  await expect(page.getByText('Netflix.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show again', exact: true }).click();
  await about(page, '34.66', 2);
  await expect(page.getByText(/^Hidden \(/)).toHaveCount(0);
  await expect(page.getByText(/Monthly · last paid/)).toBeVisible();
});

test('hiding the only item leaves the empty message and "Hidden (1)"', async ({ page, me }) => {
  await monthly(me.seed);
  await goto(page);
  await allRow(page, 'Netflix.com').getByRole('button', { name: 'Not recurring', exact: true }).click();
  await about(page, "0.00", 0); // spec is silent on the text when everything is hidden; the app shows "Nothing is recurring right now."
  await expect(page.getByText('Hidden (1)')).toBeVisible();
  await page.getByText('Hidden (1)').click();
  await page.getByRole('button', { name: 'Show again', exact: true }).click();
  await expect(page.getByText(EMPTY)).toHaveCount(0);
  await about(page, '12.99', 1);
});

test.describe('phone', () => {
  test.use({ viewport: phone });
  test('the Transactions page header has a full-width "Recurring" button that opens the page', async ({ page, me }) => {
    await page.goto('/transactions');
    const b = page.getByRole('button', { name: 'Recurring', exact: true }).or(page.getByRole('link', { name: 'Recurring', exact: true })).first();
    await expect(b).toBeVisible();
    await b.click();
    await expect(page).toHaveURL(/\/recurring$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Recurring' })).toBeVisible();
  });
  test('rows fit the screen without sideways scrolling', async ({ page, me }) => {
    await monthly(me.seed);
    await weekly(me.seed);
    await goto(page);
    await about(page, '34.66', 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await allRow(page, 'Netflix.com').scrollIntoViewIfNeeded(); // the calendar card now sits above the list
    await expect(allRow(page, 'Netflix.com').getByRole('button', { name: 'Not recurring', exact: true })).toBeInViewport();
  });
});

// Screenshots: recurring-<state>-<desktop|phone>-<light|dark>.png
for (const [size, viewport] of Object.entries({ desktop, phone })) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshots ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const tag = `${size}-${scheme}`;
      await goto(page);
      await expect(page.getByText(EMPTY)).toBeVisible();
      await shot(page, `recurring-empty-${tag}`);
      await monthly(me.seed);
      await weekly(me.seed);
      await page.reload();
      await about(page, '34.66', 2);
      await shot(page, `recurring-items-${tag}`);
      await page.getByRole('button', { name: 'Not recurring' }).first().click();
      await page.getByText('Hidden (1)').click();
      await shot(page, `recurring-hidden-${tag}`);
    });
  }
}
