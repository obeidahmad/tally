import type { Page, Locator } from '@playwright/test';
import { test, expect, shot, seedBudget, openTab, selectTab, chooseAppearance, pageBg, THEME, createPerson, signInByApi, seed, todayIso, em, type Seed } from '../support/fixtures';
import { norm } from '../support/closing';

// Spec 27: the Monarch look. Light by default, the Appearance choice, the page tabs, the stat cards, the Sankey and the donut.
// Screenshots: spec27-<page>-<1280|1600|phone>-<light|dark>.png in e2e/screenshots/.
const phone = { width: 390, height: 844 };
const fmt = (minor: number) => (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthAgo = (n: number) => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
};
const longMonth = (n: number) => new Date(`${monthAgo(n)}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
const COLOURS = {
  light: { ink: 'rgb(31, 30, 28)', muted: 'rgb(110, 106, 100)', positive: 'rgb(30, 142, 78)', negative: 'rgb(210, 59, 48)', brand: 'rgb(242, 106, 50)', hover: 'rgb(239, 237, 232)', bg: 'rgb(246, 245, 242)' },
  dark: { ink: 'rgb(236, 235, 232)', muted: 'rgb(161, 157, 151)', positive: 'rgb(59, 178, 115)', negative: 'rgb(240, 100, 90)', brand: 'rgb(244, 122, 69)', hover: 'rgb(38, 38, 42)', bg: 'rgb(20, 20, 22)' },
} as const;

/** A browser that has not been told anything: no stored choice, and the system prefers `scheme`. */
async function freshPage(browser: import('@playwright/test').Browser, baseURL: string, scheme: 'light' | 'dark', viewport = { width: 1280, height: 800 }) {
  const person = await createPerson(baseURL);
  const ctx = await browser.newContext({ baseURL, colorScheme: scheme, viewport });
  const page = await ctx.newPage();
  await signInByApi(page, person);
  return { ctx, page, person, seed: seed(page) };
}
const stored = (page: Page) => page.evaluate(() => { try { return localStorage.getItem('tally.theme'); } catch { return 'blocked'; } });
const themeAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
/** A choice of the Appearance tab is on: a radio that is checked, or a button that says it is pressed or selected. */
const isOn = async (l: Locator) =>
  (await l.isChecked().catch(() => false)) || ['true'].includes((await l.getAttribute('aria-pressed')) ?? (await l.getAttribute('aria-checked')) ?? (await l.getAttribute('aria-selected')) ?? '');
const choice = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).or(page.getByRole('button', { name, exact: true })).first();

// ============ the default theme ============
test('the app is light by default, even when the system prefers dark', async ({ browser, baseURL }) => {
  const { ctx, page } = await freshPage(browser, baseURL!, 'dark');
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(await pageBg(page)).toBe(THEME.light.bg);
  expect(await themeAttr(page), 'data-theme is applied on <html>').toBe('light');
  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'the system really prefers dark').toBe(true);
  await shot(page, 'spec27-default-light-system-dark');
  await ctx.close();
});

test('with no storage at all (it throws) the app still opens, in light', async ({ browser, baseURL }) => {
  const person = await createPerson(baseURL!);
  const ctx = await browser.newContext({ baseURL, colorScheme: 'dark' });
  await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await signInByApi(page, person);
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(await pageBg(page)).toBe(THEME.light.bg);
  expect(errors).toEqual([]);
  await ctx.close();
});

// ============ the Appearance setting ============
test('Settings > Appearance offers Light, Dark and Match system, with Light chosen at first', async ({ browser, baseURL }) => {
  const { ctx, page } = await freshPage(browser, baseURL!, 'dark');
  await openTab(page, '/settings', 'Appearance');
  for (const c of ['Light', 'Dark', 'Match system']) await expect(choice(page, c)).toBeVisible();
  expect(await isOn(choice(page, 'Light'))).toBe(true);
  expect(await isOn(choice(page, 'Dark'))).toBe(false);
  expect(await isOn(choice(page, 'Match system'))).toBe(false);
  await ctx.close();
});

for (const [name, system, expectedBg] of [
  ['Dark', 'light', THEME.dark.bg],
  ['Light', 'dark', THEME.light.bg],
  ['Match system', 'dark', THEME.dark.bg],
  ['Match system', 'light', THEME.light.bg],
] as const) {
  test(`"${name}" with a ${system} system gives a ${expectedBg === THEME.dark.bg ? 'dark' : 'light'} app that survives a reload`, async ({ browser, baseURL }) => {
    const { ctx, page } = await freshPage(browser, baseURL!, system);
    await chooseAppearance(page, name);
    await expect.poll(() => pageBg(page), 'the choice applies at once').toBe(expectedBg);
    expect(await isOn(choice(page, name))).toBe(true);
    const value = await stored(page);
    expect(value, 'saved in localStorage tally.theme').not.toBeNull();
    await page.reload();
    expect(await pageBg(page), 'still so after a reload').toBe(expectedBg);
    expect(await themeAttr(page)).toBe(expectedBg === THEME.dark.bg ? 'dark' : 'light');
    expect(await stored(page)).toBe(value);
    await selectTab(page, 'Appearance');
    expect(await isOn(choice(page, name)), 'the chosen option is still shown').toBe(true);
    await page.goto('/budget');
    expect(await pageBg(page), 'and on another page').toBe(expectedBg);
    await ctx.close();
  });
}

test('"Match system" follows the system when it changes, "Dark" does not', async ({ browser, baseURL }) => {
  const { ctx, page } = await freshPage(browser, baseURL!, 'light');
  await chooseAppearance(page, 'Match system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => pageBg(page)).toBe(THEME.dark.bg);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => pageBg(page)).toBe(THEME.light.bg);
  await chooseAppearance(page, 'Light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  expect(await pageBg(page), '"Light" ignores the system').toBe(THEME.light.bg);
  await ctx.close();
});

test('the theme is on <html> before the first paint: the stored choice is there when the document has just been parsed', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, colorScheme: 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('tally.theme', 'dark'); } catch { /* blocked */ } });
  const page = await ctx.newPage();
  await page.goto('/sign-in', { waitUntil: 'commit' });
  // read as early as the document exists: no script of the app bundle has had to run for it
  await page.waitForFunction(() => document.documentElement !== null && document.readyState !== 'uninitialized');
  const first = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(first, 'data-theme="dark" set by the inline script').toBe('dark');
  await ctx.close();
});

// ============ the sidebar toggle ============
test('the sidebar button switches light and dark, says what it will do, and each switch survives a reload', async ({ browser, baseURL }) => {
  const { ctx, page } = await freshPage(browser, baseURL!, 'light');
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(await pageBg(page)).toBe(THEME.light.bg);
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect.poll(() => pageBg(page)).toBe(THEME.dark.bg);
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toHaveCount(0);
  await page.reload();
  expect(await pageBg(page), 'dark after a reload').toBe(THEME.dark.bg);
  await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
  await openTab(page, '/settings', 'Appearance');
  expect(await isOn(choice(page, 'Dark')), 'Appearance shows the toggle\'s choice').toBe(true);
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect.poll(() => pageBg(page)).toBe(THEME.light.bg);
  await page.reload();
  expect(await pageBg(page), 'light after a reload').toBe(THEME.light.bg);
  await expect(page.getByRole('button', { name: 'Switch to dark mode', exact: true })).toBeVisible();
  await ctx.close();
});

// ============ the tabs ============
const TABBED = [
  { path: '/reports', tabs: ['Cash flow', 'Spending', 'Net worth'], marker: ['Where ', 'Spending by section', 'Net worth'] },
  { path: '/recurring', tabs: ['Upcoming', 'Calendar'], marker: ['Due in the next 7 days', 'Bills calendar'] },
  { path: '/settings', tabs: ['Account', 'People and sharing', 'Connections', 'Appearance'], marker: ['Change password', 'Sharing', 'Bank connections', 'Match system'] },
] as const;

for (const t of TABBED) {
  test(`${t.path}: a tablist with ${t.tabs.join(', ')}; the first tab is selected and only its content shows`, async ({ page, me }) => {
    void me;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(t.path);
    const list = page.getByRole('tablist');
    await expect(list).toBeVisible();
    expect((await list.getByRole('tab').allInnerTexts()).map(norm)).toEqual([...t.tabs]);
    await expect(list.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();
    // the tabs sit in the top bar, right of the title and above the content
    const h1 = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
    const lb = (await list.boundingBox())!;
    expect(lb.x, 'tabs are right of the title').toBeGreaterThanOrEqual(h1.x + h1.width - 1);
    expect(lb.y, 'tabs are at the top').toBeLessThan(80);
    await expect(page.getByText(t.marker[0]).first()).toBeVisible();
    for (let i = 1; i < t.tabs.length; i++) await expect(page.getByText(t.marker[i], { exact: false })).toHaveCount(0);
  });

  test(`${t.path}: a click selects a tab, puts ?tab= in the URL, and a reload and a shared link open the same tab`, async ({ page, me, browser, baseURL }) => {
    void me;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(t.path);
    for (const [i, name] of t.tabs.entries()) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      for (const other of t.tabs.filter((x) => x !== name)) await expect(page.getByRole('tab', { name: other, exact: true })).toHaveAttribute('aria-selected', 'false');
      await expect(page.getByText(t.marker[i], { exact: false }).first()).toBeVisible();
      if (i === 0) continue;
      await expect(page).toHaveURL(/[?&]tab=/);
      const url = page.url();
      await page.reload();
      await expect(page.getByRole('tab', { name, exact: true }), `${name} after a reload`).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText(t.marker[i], { exact: false }).first()).toBeVisible();
      // the same URL in a new tab of the browser (the session cookie is shared)
      const p2 = await page.context().newPage();
      await p2.goto(url);
      await expect(p2.getByRole('tab', { name, exact: true }), `${name} from the link`).toHaveAttribute('aria-selected', 'true');
      await p2.close();
    }
    void browser; void baseURL;
  });

  test(`${t.path}: the arrow keys move between the tabs (Right, Left, wrapping) and select the one reached`, async ({ page, me }) => {
    void me;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(t.path);
    const tab = (n: string) => page.getByRole('tab', { name: n, exact: true });
    await tab(t.tabs[0]).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(t.tabs[1])).toBeFocused();
    await expect(tab(t.tabs[1])).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(t.marker[1], { exact: false }).first()).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(t.tabs[0])).toBeFocused();
    await expect(tab(t.tabs[0])).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(t.tabs[t.tabs.length - 1]), 'Left from the first tab wraps to the last').toBeFocused();
    await expect(tab(t.tabs[t.tabs.length - 1])).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(t.tabs[0]), 'Right from the last tab wraps to the first').toBeFocused();
    // only the selected tab is a Tab stop; the panel is reached next
    await expect(tab(t.tabs[0])).toHaveAttribute('tabindex', '0');
    await expect(tab(t.tabs[1])).toHaveAttribute('tabindex', '-1');
  });
}

test('an unknown ?tab= opens the first tab', async ({ page, me }) => {
  void me;
  await page.goto('/reports?tab=nonsense');
  await expect(page.getByRole('tab', { name: 'Cash flow', exact: true })).toHaveAttribute('aria-selected', 'true');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the selected tab is ink with a 2px brand underline, the others are muted (${scheme})`, async ({ browser, baseURL }) => {
    const { ctx, page } = await freshPage(browser, baseURL!, scheme);
    await chooseAppearance(page, scheme === 'dark' ? 'Dark' : 'Light');
    await page.goto('/reports');
    const c = COLOURS[scheme];
    const paint = (l: Locator) => l.evaluate((e) => {
      const cs = getComputedStyle(e);
      const after = getComputedStyle(e, '::after');
      return { color: cs.color, weight: cs.fontWeight, size: cs.fontSize, bw: cs.borderBottomWidth, bc: cs.borderBottomColor, shadow: cs.boxShadow, aH: after.height, aBg: after.backgroundColor };
    });
    const on = await paint(page.getByRole('tab', { name: 'Cash flow', exact: true }));
    const off = await paint(page.getByRole('tab', { name: 'Spending', exact: true }));
    expect(on.color).toBe(c.ink);
    expect(off.color).toBe(c.muted);
    expect(on.size).toBe('14px');
    expect(on.weight).toBe('500');
    const underline = (on.bw === '2px' && on.bc === c.brand) || (on.aH === '2px' && on.aBg === c.brand) || on.shadow.includes(c.brand);
    expect(underline, JSON.stringify(on)).toBe(true);
    expect(off.bc === c.brand && off.bw === '2px', 'the other tab has no underline').toBe(false);
    await ctx.close();
  });
}

test.describe('phone tabs', () => {
  test.use({ viewport: phone });
  test('the page tabs are a row under the title that scrolls sideways inside itself; the page does not', async ({ page, me }) => {
    void me;
    await page.goto('/settings');
    const list = page.getByRole('tablist');
    const h1 = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
    const lb = (await list.boundingBox())!;
    expect(lb.y, 'the tabs are under the title').toBeGreaterThanOrEqual(h1.y + h1.height - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways page scroll').toBe(true);
    const overflow = await list.evaluate((el) => { const s = [el, el.parentElement!].find((e) => e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)); return !!s; });
    expect(overflow, 'four tabs do not fit in 390px, so the row scrolls').toBe(true);
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Appearance', exact: true })).toBeInViewport();
    await expect(page.getByRole('tab', { name: 'Appearance', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
});

// ============ stat cards ============
/** A stat card found by its label: the figure, its colour and size, and where the label sits. */
async function statCard(page: Page, label: string) {
  return page.evaluate((text) => {
    const leaves = [...document.querySelectorAll('main *, [role="main"] *, body *')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().toLowerCase() === text.toLowerCase() && e.getBoundingClientRect().width > 0);
    const l = leaves[0];
    if (!l) return null;
    let card: Element | null = l.parentElement;
    while (card && !(getComputedStyle(card).borderTopLeftRadius === '8px' && card.getBoundingClientRect().width > l.getBoundingClientRect().width + 8)) card = card.parentElement;
    if (!card) return null;
    const fig = [...card.querySelectorAll('*')].find((e) => e.children.length === 0 && e !== l && /\d|—/.test(e.textContent ?? ''));
    if (!fig) return null;
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const fs = getComputedStyle(fig);
    return { figure: (fig.textContent ?? '').replace(/\s+/g, ' ').trim(), color: fs.color, size: fs.fontSize, weight: fs.fontWeight, line: fs.lineHeight, tabular: fs.fontVariantNumeric, align: fs.textAlign, labelTransform: getComputedStyle(l).textTransform, labelSize: getComputedStyle(l).fontSize, card: r(card), label: r(l), fig: r(fig) };
  }, label);
}

/** This month: income 2,000.00 and spending 500.00 (Food), so net 1,500.00 and a savings rate of 75.0%. */
async function seedMonth(s: Seed) {
  const sec = await s.section('Needs');
  const food = await s.subsection(sec.id, 'Food', 60000);
  const pocket = await s.pocket('Bank', 0);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, 200000, src.id);
  await s.amountStep(src.boxId, sec.id, 60000);
  await s.expense(pocket.id, food.id, 50000, 'Alphamega');
}

test('Reports > Cash flow: four stat cards for the month: Total income (positive), Total spending (negative), Net, Savings rate', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedMonth(me.seed);
  await openTab(page, '/reports', 'Cash flow');
  const income = (await statCard(page, 'Total income'))!;
  const spending = (await statCard(page, 'Total spending'))!;
  const net = (await statCard(page, 'Net'))!;
  const rate = (await statCard(page, 'Savings rate'))!;
  for (const [n, c] of [['Total income', income], ['Total spending', spending], ['Net', net], ['Savings rate', rate]] as const) expect(c, `${n} card`).not.toBeNull();
  expect(income.figure).toContain('2,000.00');
  expect(spending.figure).toContain('500.00');
  expect(net.figure).toContain('1,500.00');
  expect(rate.figure).toBe('75.0%');
  expect(income.color, 'income is positive').toBe(COLOURS.light.positive);
  expect(spending.color, 'spending is negative').toBe(COLOURS.light.negative);
  expect(net.color, 'net is ink').toBe(COLOURS.light.ink);
  expect(rate.color, 'rate is ink').toBe(COLOURS.light.ink);
  // equal cards in one row; figure centred above the label; 24px/30px 600
  const cards = [income, spending, net, rate];
  expect(Math.max(...cards.map((c) => c.card.y)) - Math.min(...cards.map((c) => c.card.y)), 'one row').toBeLessThan(2);
  expect(Math.max(...cards.map((c) => Math.round(c.card.width))) - Math.min(...cards.map((c) => Math.round(c.card.width))), 'equal widths').toBeLessThanOrEqual(2);
  for (const c of cards) {
    expect(c.fig.y, 'figure above label').toBeLessThan(c.label.y);
    expect(Math.abs(c.fig.x + c.fig.width / 2 - (c.card.x + c.card.width / 2)), 'figure centred').toBeLessThan(6);
    expect([c.size, c.line, c.weight]).toEqual(['24px', '30px', '600']);
    expect(c.labelSize).toBe('11px');
    expect(c.labelTransform).toBe('uppercase');
  }
  // the figures and the cards agree with the server
  const r = await (await page.request.get('/api/reports?months=3')).json();
  const now = r.cashflow[r.cashflow.length - 1];
  expect(now).toMatchObject({ incomeMinor: 200000, spendingMinor: 50000 });
  await shot(page, 'spec27-reports-stat-cards');
});

test('Reports stat cards follow the month: last month has nothing, so 0.00 and a dash for the rate; back returns the figures', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedMonth(me.seed);
  await openTab(page, '/reports', 'Cash flow');
  await page.getByRole('button', { name: /^(Previous month|‹)$/ }).first().click();
  await expect.poll(async () => (await statCard(page, 'Total income'))?.figure).toContain('0.00');
  expect((await statCard(page, 'Total spending'))!.figure).toContain('0.00');
  expect((await statCard(page, 'Net'))!.figure).toContain('0.00');
  expect((await statCard(page, 'Savings rate'))!.figure, 'no income, no rate').toBe('—');
  await expect(page.getByText(new RegExp(`Where ${longMonth(1)}.s money went`))).toBeVisible();
  await page.getByRole('button', { name: /^(Next month|›)$/ }).first().click();
  await expect.poll(async () => (await statCard(page, 'Total income'))?.figure).toContain('2,000.00');
});

test('a month that spent more than it earned shows a negative Net and a negative rate with one decimal', async ({ page, me }) => {
  const sec = await me.seed.section('Needs');
  const food = await me.seed.subsection(sec.id, 'Food', 0);
  const bank = await me.seed.pocket('Bank', 100000);
  const src = await me.seed.source('Paycheck');
  await me.seed.income(bank.id, 100000, src.id);
  await me.seed.expense(bank.id, food.id, 150000, 'Shop');
  await openTab(page, '/reports', 'Cash flow');
  expect((await statCard(page, 'Net'))!.figure).toMatch(/[−-]500\.00/);
  expect((await statCard(page, 'Savings rate'))!.figure).toMatch(/^[−-]50\.0%$/);
});

test('Budget: the stat cards are Income (positive), Budgeted, Spent (negative) and Left over', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBudget(me.seed);
  await page.goto('/budget');
  const income = (await statCard(page, 'Income'))!;
  const budgeted = (await statCard(page, 'Budgeted'))!;
  const spent = (await statCard(page, 'Spent'))!;
  const left = (await statCard(page, 'Left over'))!;
  expect(income.figure).toContain('2,000.00');
  expect(budgeted.figure).toContain('1,060.00');
  expect(spent.figure).toContain('983.12');
  expect(left.figure).toContain('940.00');
  expect(income.color).toBe(COLOURS.light.positive);
  expect(spent.color).toBe(COLOURS.light.negative);
  expect(budgeted.color).toBe(COLOURS.light.ink);
  expect(left.color).toBe(COLOURS.light.ink);
});

test.describe('phone stat cards', () => {
  test.use({ viewport: phone });
  test('they show two per row', async ({ page, me }) => {
    await seedMonth(me.seed);
    await openTab(page, '/reports', 'Cash flow');
    const cs = [(await statCard(page, 'Total income'))!, (await statCard(page, 'Total spending'))!, (await statCard(page, 'Net'))!, (await statCard(page, 'Savings rate'))!];
    expect(Math.abs(cs[0].card.y - cs[1].card.y)).toBeLessThan(2);
    expect(Math.abs(cs[2].card.y - cs[3].card.y)).toBeLessThan(2);
    expect(cs[2].card.y, 'the second pair is under the first').toBeGreaterThan(cs[0].card.y + cs[0].card.height - 1);
    expect(cs[1].card.x).toBeGreaterThan(cs[0].card.x + cs[0].card.width - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

// ============ the Sankey ============
/** Paycheck 3,000.00 and Side job 500.00 in boxes of their own, 5 sections with 4 to 5 subsections each: 23 subsections, so the busiest column is tall. */
async function seedBigFlow(s: Seed) {
  const pocket = await s.pocket('Revolut', 500000);
  const pay = await s.source('Paycheck');
  const side = await s.source('Side job');
  await s.income(pocket.id, 300000, pay.id);
  await s.income(pocket.id, 50000, side.id);
  const plan: [string, string[]][] = [
    ['Needs', ['Mortgage', 'Food', 'Utilities', 'Transport', 'Insurance']],
    ['Wants', ['Eating out', 'Subscriptions', 'Clothes', 'Hobbies', 'Gifts']],
    ['Savings', ['Emergency', 'Holiday', 'Car', 'Home', 'Retirement']],
    ['Family', ['School', 'Clubs', 'Doctor', 'Toys']],
    ['Fun', ['Cinema', 'Games', 'Books', 'Trips']],
  ];
  let n = 0;
  for (const [name, subs] of plan) {
    const sec = await s.section(name);
    await s.amountStep(pay.boxId, sec.id, 40000);
    for (const sub of subs) {
      const created = await s.subsection(sec.id, sub, 5000);
      if (n % 3 !== 2) await s.expense(pocket.id, created.id, n % 4 === 0 ? 300 : 9000 + n * 100, `${sub} shop`);
      n++;
    }
  }
  return { totalIncome: 350000 };
}
type Flow = { nodes: { id: string | number; label: string; kind: string }[]; links: { from: string | number; to: string | number; minor: number }[] };
const flowCardOf = (page: Page) => page.locator('.ty-card').filter({ has: page.getByText(/money went/) }).first();

/** Every visible label of the diagram: the leaf text elements of the card's drawing, with their boxes. */
const diagramLabels = (card: Locator) => card.evaluate((root) => {
  const drawing = root.querySelector('svg') as Element;
  const holder = drawing.parentElement!;
  const out: { text: string; x: number; y: number; w: number; h: number }[] = [];
  for (const e of [...holder.querySelectorAll('*')]) {
    if (e.children.length > 0 || !(e.textContent ?? '').trim()) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    out.push({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), x: b.x, y: b.y, w: b.width, h: b.height });
  }
  return out;
});
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

test('the Sankey has one "Income" node that equals total income, between the sources and the sections', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { totalIncome } = await seedBigFlow(me.seed);
  await openTab(page, '/reports', 'Cash flow');
  const card = flowCardOf(page);
  await expect(card.locator('svg').first()).toBeVisible();
  const f = (await (await page.request.get('/api/reports/flow')).json()) as Flow;
  const fromSources = f.links.filter((l) => f.nodes.find((n) => n.id === l.from)?.kind === 'source').reduce((a, l) => a + l.minor, 0);
  expect(fromSources, 'the server agrees: all sources add up to the income').toBe(totalIncome);

  const labels = await diagramLabels(card);
  const incomes = labels.filter((l) => l.text === 'Income');
  expect(incomes, 'exactly one Income node label').toHaveLength(1);
  const income = incomes[0];
  const amountLine = labels.find((l) => l !== income && Math.abs(l.x - income.x) < 4 && l.y >= income.y && l.y - income.y < 40 && /\d/.test(l.text));
  expect(amountLine, `an amount line under "Income" in ${JSON.stringify(labels.map((l) => l.text))}`).toBeTruthy();
  expect(amountLine!.text).toMatch(new RegExp(`^${fmt(totalIncome).replace('.', '\\.')} \\(100(\\.0)?%\\)$`));
  // the sources, left of Income, hold the parts: 3,000.00 and 500.00 with their share of the income
  const pay = labels.find((l) => l.text === 'Paycheck')!;
  const side = labels.find((l) => l.text === 'Side job')!;
  expect(pay.x, 'sources are left of Income').toBeLessThan(income.x);
  expect(side.x).toBeLessThan(income.x);
  const text = labels.map((l) => l.text).join(' | ');
  expect(text).toContain('3,000.00 (85.7%)');
  expect(text).toContain('500.00 (14.3%)');
  // sections are right of Income
  for (const name of ['Needs', 'Wants', 'Left over']) {
    const l = labels.find((x) => x.text.endsWith(name));
    expect(l, name).toBeTruthy();
    expect(l!.x, `${name} is right of Income`).toBeGreaterThan(income.x);
  }
  // the table lists the money: the income, the sources into it and the Income into every section
  await card.getByRole('button', { name: /Show as table/ }).or(card.getByRole('checkbox', { name: /Show as table/ })).or(card.getByRole('switch', { name: /Show as table/ })).first().click();
  const rows = (await card.locator('table tbody tr').allInnerTexts()).map(norm);
  expect(rows.some((r) => r.includes('Paycheck') && r.includes('Income') && r.includes('3,000.00')), JSON.stringify(rows)).toBe(true);
  expect(rows.some((r) => r.includes('Side job') && r.includes('Income') && r.includes('500.00'))).toBe(true);
  expect(rows.some((r) => r.includes('Income') && r.includes('Needs') && r.includes('400.00'))).toBe(true);
});

test('with money brought forward the sources include "From last month" and Income still equals everything that came in', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const s = me.seed;
  const sec = await s.section('Needs');
  const food = await s.subsection(sec.id, 'Food', 50000);
  const pocket = await s.pocket('Bank', 0);
  const src = await s.source('Paycheck');
  // last month: income and a rest that is carried over
  const lastMonth = `${monthAgo(1)}-10`;
  await s.income(pocket.id, 100000, src.id, lastMonth);
  await s.amountStep(src.boxId, sec.id, 100000);
  await s.expense(pocket.id, food.id, 20000, 'Early shop', lastMonth);
  await s.income(pocket.id, 200000, src.id, todayIso());
  const close = await page.request.post(`/api/months/${monthAgo(1)}/close`, { data: {} });
  test.skip(close.status() !== 200, 'closing last month is not possible here');
  await openTab(page, '/reports', 'Cash flow');
  const card = flowCardOf(page);
  await expect(card.locator('svg').first()).toBeVisible();
  const f = (await (await page.request.get('/api/reports/flow')).json()) as Flow;
  const sources = f.links.filter((l) => f.nodes.find((n) => n.id === l.from)?.kind === 'source').reduce((a, l) => a + l.minor, 0);
  const labels = await diagramLabels(card);
  const income = labels.find((l) => l.text === 'Income')!;
  const amount = labels.find((l) => l !== income && Math.abs(l.x - income.x) < 4 && l.y > income.y && l.y - income.y < 40 && /\d/.test(l.text))!;
  expect(amount.text).toContain(fmt(sources));
});

for (const [name, viewport] of [['1280', { width: 1280, height: 900 }], ['1600', { width: 1600, height: 900 }], ['phone', phone]] as const) {
  test(`${name}: every visible Sankey label is inside the card and no two labels overlap, with 23 subsections`, async ({ page, me }) => {
    await page.setViewportSize(viewport);
    await seedBigFlow(me.seed);
    await openTab(page, '/reports', 'Cash flow');
    const card = flowCardOf(page);
    const svg = card.locator('svg').first();
    await expect(svg).toBeVisible();
    await page.waitForTimeout(400);
    const cb = (await card.boundingBox())!;
    const sb = (await svg.boundingBox())!;
    const f = (await (await page.request.get('/api/reports/flow')).json()) as Flow;
    const count = (pred: (n: Flow['nodes'][number]) => boolean) => f.nodes.filter(pred).length;
    const busiest = Math.max(
      count((n) => n.kind === 'source'),
      count((n) => n.kind === 'section' || n.label === 'Left over'),
      count((n) => n.kind === 'subsection' || n.label === 'Kept'),
    );
    expect(busiest, 'the seed makes a tall column').toBeGreaterThanOrEqual(23);
    expect(sb.height, 'height = max(480, 34 x nodes in the busiest column)').toBeGreaterThanOrEqual(Math.max(480, 34 * busiest) - 2);
    if (name === 'phone') {
      expect(sb.width, 'at least 720px wide, scrolling sideways inside the card').toBeGreaterThanOrEqual(719);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the page does not scroll sideways').toBe(true);
    } else {
      expect(sb.width, 'the full card width').toBeGreaterThan(cb.width - 60);
    }
    const labels = await diagramLabels(card);
    expect(labels.length, 'the diagram has labels').toBeGreaterThan(8);
    for (const l of labels) {
      if (name === 'phone') {
        expect(l.y, `"${l.text}" is not above the card`).toBeGreaterThanOrEqual(cb.y - 1);
        expect(l.y + l.h, `"${l.text}" is not below the card`).toBeLessThanOrEqual(cb.y + cb.height + 1);
      } else {
        expect(l.x, `"${l.text}" is not left of the card`).toBeGreaterThanOrEqual(cb.x - 1);
        expect(l.x + l.w, `"${l.text}" is not right of the card`).toBeLessThanOrEqual(cb.x + cb.width + 1);
        expect(l.y, `"${l.text}" is not above the card`).toBeGreaterThanOrEqual(cb.y - 1);
        expect(l.y + l.h, `"${l.text}" is not below the card`).toBeLessThanOrEqual(cb.y + cb.height + 1);
      }
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      expect(overlaps(labels[i], labels[j]), `"${labels[i].text}" overlaps "${labels[j].text}"`).toBe(false);
    }
    // a name has its amount and share under it: "{amount} ({pct}%)"
    expect(labels.filter((l) => /^[\d,]+\.\d\d \(\d+(\.\d+)?%\)$/.test(l.text)).length, 'amount lines').toBeGreaterThan(4);
    await card.scrollIntoViewIfNeeded();
    await shot(page, `spec27-sankey-${name}`);
  });
}

test('a node shorter than 30px keeps its label for hover or focus, and every figure is in the table', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBigFlow(me.seed);
  await openTab(page, '/reports', 'Cash flow');
  const card = flowCardOf(page);
  const f = (await (await page.request.get('/api/reports/flow')).json()) as Flow;
  const shown = new Set((await diagramLabels(card)).map((l) => l.text));
  const tiny = f.nodes.filter((n) => n.kind === 'subsection' && ![...shown].some((t) => t.includes(n.label)));
  expect(tiny.length, 'some node is too short for a label').toBeGreaterThan(0);
  // the table has them all
  await card.getByRole('button', { name: /Show as table/ }).or(card.getByRole('checkbox', { name: /Show as table/ })).or(card.getByRole('switch', { name: /Show as table/ })).first().click();
  const text = norm(await card.locator('table').innerText());
  for (const n of tiny) expect(text, n.label).toContain(n.label);
  await card.getByRole('button', { name: /Show as chart/ }).or(card.getByRole('checkbox', { name: /Show as table/ })).or(card.getByRole('switch', { name: /Show as table/ })).first().click();
  // focusing a mark shows the label of its node as a tooltip or a label
  const marks = card.locator('svg [tabindex="0"]');
  const n = await marks.count();
  expect(n).toBeGreaterThan(0);
  await marks.nth(n - 1).focus();
  await expect(page.getByRole('tooltip').filter({ visible: true })).toBeVisible();
});

test('hovering a band shows "{from} → {to}: {amount}", including the new Income node', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBigFlow(me.seed);
  await openTab(page, '/reports', 'Cash flow');
  const card = flowCardOf(page);
  const marks = card.locator('svg [tabindex="0"]');
  const n = await marks.count();
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await marks.nth(i).focus();
    const tip = page.getByRole('tooltip').filter({ visible: true });
    if (await tip.count()) seen.push(norm(await tip.first().innerText()));
  }
  expect(seen, JSON.stringify(seen.slice(0, 8))).toContain('Paycheck → Income: 3,000.00');
  expect(seen).toContain('Side job → Income: 500.00');
  expect(seen).toContain('Income → Needs: 400.00');
});

// ============ the donut ============
async function seedDonut(s: Seed) {
  const pocket = await s.pocket('Bank', 1000000);
  const spend = async (section: string, sub: string, minor: number) => {
    const sec = await s.section(section);
    const created = await s.subsection(sec.id, sub, 10000);
    await s.expense(pocket.id, created.id, minor, `${sub} shop`);
  };
  await spend('Needs', 'Food', 30000);
  await spend('Wants', 'Fun', 15000);
  await spend('Savings', 'Holiday', 2500);
  await spend('Family', 'School', 2550);
  return 50050;
}

test('Spending: the donut legend shows each section as "{amount} ({pct}%)" and the table has the same figures', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const total = await seedDonut(me.seed);
  await openTab(page, '/reports', 'Spending');
  const card = page.locator('.ty-card', { has: page.getByRole('heading', { name: 'Spending by section', exact: true }) });
  await expect(card).toBeVisible();
  const legend = card.getByRole('listitem');
  await expect(legend).toHaveCount(4);
  const expected = { Needs: 30000, Wants: 15000, Savings: 2500, Family: 2550 } as const;
  for (const [name, minor] of Object.entries(expected)) {
    const item = legend.filter({ hasText: name });
    await expect(item, name).toHaveCount(1);
    const t = norm(await item.innerText());
    expect(t, `${name}: the amount`).toContain(fmt(minor));
    const m = t.match(/\((\d+(?:\.\d+)?)%\)/);
    expect(m, `${name}: a percentage in "${t}"`).not.toBeNull();
    expect(Math.abs(Number(m![1]) - (minor / total) * 100), `${name}: the share`).toBeLessThanOrEqual(0.51);
    // dot, then name, then the figures under the name
    const nb = (await item.getByText(name, { exact: true }).first().boundingBox())!;
    const fb = (await item.getByText(fmt(minor), { exact: false }).first().boundingBox())!;
    expect(fb.y, `${name}: the figures are under the name`).toBeGreaterThan(nb.y + nb.height / 2);
  }
  // the legend is a grid of at most 3 columns
  const xs = await legend.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x)))]);
  expect(xs.length, 'columns').toBeGreaterThanOrEqual(2);
  expect(xs.length, 'columns').toBeLessThanOrEqual(3);
  // the centre: the total at 22px 600 and "Total" under it
  const centre = await card.evaluate((root) => {
    const leaves = [...root.querySelectorAll('*')].filter((e) => e.children.length === 0);
    const label = leaves.find((e) => (e.textContent ?? '').trim() === 'Total');
    const fig = leaves.find((e) => /^[\d,]+\.\d\d$/.test((e.textContent ?? '').trim()));
    if (!label || !fig) return null;
    const cs = getComputedStyle(fig);
    return { fig: fig.textContent!.trim(), size: cs.fontSize, weight: cs.fontWeight, figY: fig.getBoundingClientRect().y, labelY: label.getBoundingClientRect().y };
  });
  expect(centre, 'the ring shows the total and "Total"').not.toBeNull();
  expect(centre!.fig).toBe(fmt(total));
  expect([centre!.size, centre!.weight]).toEqual(['22px', '600']);
  expect(centre!.labelY).toBeGreaterThan(centre!.figY);
  // the ring is 220px
  const ring = (await card.locator('svg').first().boundingBox())!;
  expect(Math.round(ring.width), 'a 220px ring').toBe(220);
  // the table of the card has the same figures as the legend
  await card.getByRole('button', { name: /Show as table/ }).first().click();
  const rows = (await card.locator('table').first().locator('tbody tr').allInnerTexts()).map(norm);
  for (const [name, minor] of Object.entries(expected)) expect(rows.some((r) => r.includes(name) && r.includes(fmt(minor))), `${name} in ${JSON.stringify(rows)}`).toBe(true);
  const api = await (await page.request.get('/api/reports?months=3')).json();
  const now = api.spending[api.spending.length - 1];
  expect(now.totalMinor).toBe(total);
  await card.getByRole('button', { name: /Show as chart/ }).first().click();
  await shot(page, 'spec27-donut');
});

test('the donut shows a tooltip on hover and on focus, and follows the month', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedDonut(me.seed);
  await openTab(page, '/reports', 'Spending');
  const card = page.locator('.ty-card', { has: page.getByRole('heading', { name: 'Spending by section', exact: true }) });
  const seg = card.locator('svg [tabindex="0"]').first();
  await seg.hover();
  await expect(page.getByRole('tooltip').filter({ visible: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await seg.focus();
  await expect(page.getByRole('tooltip').filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Previous month|‹)$/ }).first().click();
  await expect(card.getByText('Nothing to show yet.')).toBeVisible();
});

// ============ top bars and the look ============
const outlineAndPrimary = async (page: Page, outline: string, primary: string) => {
  const o = page.getByRole('button', { name: outline, exact: true }).first();
  const p = page.getByRole('button', { name: primary, exact: true }).first();
  await expect(o).toBeVisible();
  await expect(p).toBeVisible();
  const paint = (l: Locator) => l.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, h: e.getBoundingClientRect().height, fg: cs.color, weight: cs.fontWeight }; });
  const po = await paint(o);
  const pp = await paint(p);
  expect(po.border, `${outline} has an outline`).toBe('1px');
  expect(po.radius, 'a 6px radius, no pills').toBe('6px');
  expect(pp.radius).toBe('6px');
  expect(Math.round(po.h)).toBe(32);
  expect(Math.round(pp.h)).toBe(32);
  expect(pp.fg, 'white text').toBe('rgb(255, 255, 255)');
  expect(pp.weight).toBe('600');
  const [r, g, b] = pp.bg.match(/\d+/g)!.map(Number);
  expect(r > g && g > b, `primary is orange, got ${pp.bg}`).toBe(true);
  const ob = (await o.boundingBox())!;
  const pb = (await p.boundingBox())!;
  expect(pb.x, 'the primary button is rightmost').toBeGreaterThan(ob.x);
};

test('top bars: Budget, Transactions and Pockets have an outline action and one primary action on the right', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1, name: 'Budget' })).toBeVisible();
  await outlineAndPrimary(page, 'Add income', 'Add transaction');
  await expect(page.getByRole('button', { name: /^(Previous month|‹)$/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Next month|›)$/ }).first()).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await outlineAndPrimary(page, 'Import a statement', 'Add transaction');
  await page.goto('/pockets');
  await expect(page.getByRole('heading', { level: 1, name: 'Pockets' })).toBeVisible();
  await outlineAndPrimary(page, 'Transfer', 'Add pocket');
  const bar = await page.evaluate(() => { let e: Element | null = document.querySelector('h1'); while (e && getComputedStyle(e).position !== 'sticky') e = e.parentElement; return e ? { h: e.getBoundingClientRect().height, bg: getComputedStyle(e).backgroundColor } : null; });
  expect(bar!.h).toBe(56);
  expect(bar!.bg, 'the top bar is on --bg').toBe(THEME.light.bg);
});

test('Reports has the month ‹ › in the top bar, and Recurring and Settings have a top bar with tabs', async ({ page, me }) => {
  void me;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/reports');
  const prev = page.getByRole('button', { name: /^(Previous month|‹)$/ }).first();
  const h1 = (await page.getByRole('heading', { level: 1, name: 'Reports' }).boundingBox())!;
  const pb = (await prev.boundingBox())!;
  expect(Math.abs(pb.y + pb.height / 2 - (h1.y + h1.height / 2)), 'on the title line').toBeLessThan(20);
  expect(pb.x, 'right of the title').toBeGreaterThan(h1.x + h1.width);
  await expect(page.getByRole('button', { name: /^(Next month|›)$/ }).first()).toBeDisabled(); // this month is the last one
});

test('the sidebar: 220px, an icon and a label for each of the nine pages, the active one on --surface-hover', async ({ page, me }) => {
  void me;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/budget');
  const links = page.getByRole('navigation').first().getByRole('link');
  await expect(links).toHaveText(['Home', 'Budget', 'Pipeline', 'Transactions', 'Recurring', 'Pockets', 'Investments', 'Reports', 'Settings']);
  for (const l of await links.all()) {
    const svg = l.locator('svg').first();
    await expect(svg).toBeVisible();
    const b = (await svg.boundingBox())!;
    expect(Math.round(b.width), 'an 18px icon').toBe(18);
  }
  const active = page.getByRole('navigation').first().getByRole('link', { name: 'Budget' });
  const css = await active.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, h: e.getBoundingClientRect().height, size: cs.fontSize, weight: cs.fontWeight }; });
  expect(css.bg).toBe(COLOURS.light.hover);
  expect(css.radius).toBe('6px');
  expect(Math.round(css.h)).toBe(36);
  expect([css.size, css.weight]).toEqual(['14px', '500']);
  const side = (await active.evaluate((e) => { let s: Element | null = e; while (s && s.getBoundingClientRect().height < 600) s = s.parentElement; return s ? { w: s.getBoundingClientRect().width, bg: getComputedStyle(s).backgroundColor } : null; }))!;
  expect(Math.round(side.w)).toBe(220);
  expect(side.bg).toBe(COLOURS.light.bg);
  const name = page.locator('body');
  await expect(name).toContainText('Tally');
});

test('the look: IBM Plex Sans, tinted Available pills, small radii, positive income with a plus sign', async ({ page, me }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(page.locator('.ty-btable__row[role="button"]').first()).toBeVisible();
  const fam = await page.evaluate(() => [document.body, document.querySelector('h1')!, document.querySelector('button')!].map((e) => getComputedStyle(e).fontFamily));
  for (const f of fam) {
    expect(f).toMatch(/IBM Plex Sans/);
    expect(f).not.toMatch(/Bricolage/);
  }
  const pill = (name: RegExp) => page.locator('.ty-btable__row[role="button"]').filter({ hasText: name }).first().locator('.ty-pill').evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, fg: cs.color, radius: parseFloat(cs.borderTopLeftRadius) }; });
  const pos = await pill(/Food/);
  expect(pos.fg).toBe(COLOURS.light.positive);
  expect(pos.bg).toMatch(/^rgba\(30, 142, 78, 0\.12\d*\)$/);
  expect(pos.radius, 'a pill is fully round').toBeGreaterThanOrEqual(9);
  const neg = await pill(/Utilities/);
  expect(neg.fg).toBe(COLOURS.light.negative);
  expect(neg.bg).toMatch(/^rgba\(210, 59, 48, 0\.12\d*\)$/);
  const zero = await pill(/Mortgage/);
  expect(zero.bg, 'neutral grey at 0').not.toMatch(/^rgba\((30, 142, 78|210, 59, 48)/);
  await page.goto('/transactions');
  const pay = page.getByRole('button', { name: /Paycheck/ }).first();
  await expect(pay).toBeVisible();
  const amount = pay.getByText(/\+?2,000\.00/).first();
  expect(norm(await amount.innerText())).toMatch(/^\+2,000\.00/);
  expect(await amount.evaluate((e) => getComputedStyle(e).color)).toBe(COLOURS.light.positive);
  expect(await pay.locator('svg').count(), 'a chevron closes the row').toBeGreaterThan(0);
  const radius = await page.getByRole('button', { name: 'Add transaction', exact: true }).first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
  expect(radius).toBe('6px');
});

test('Home cards have a quiet "View all" link where a page exists', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/home');
  const links = page.getByRole('link', { name: 'View all' });
  await expect(links.first()).toBeVisible();
  const href = await links.first().getAttribute('href');
  expect(href).toMatch(/^\/(transactions|budget|pockets|recurring|reports|investments|pipeline)/);
  await links.first().click();
  await expect(page).toHaveURL(new RegExp(href!.replace(/[?]/g, '\\?').split('?')[0]));
});

// ============ Pockets ============
test('Pockets: a net worth card with 3M, 6M, 12M and 24M (6M at first), the change line, group cards and the Assets and Debts summary', async ({ page, me }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await seedBudget(me.seed);
  await me.seed.pocket('Wallet', 2500, 'cash');
  await page.goto('/pockets');
  await expect(page.getByRole('heading', { level: 1, name: 'Pockets' })).toBeVisible();
  const seg = (n: string) => page.getByRole('radio', { name: n, exact: true }).or(page.getByRole('button', { name: n, exact: true })).first();
  for (const n of ['3M', '6M', '12M', '24M']) await expect(seg(n)).toBeVisible();
  expect(await isOn(seg('6M')), '6M is the default').toBe(true);
  await seg('12M').click();
  expect(await isOn(seg('12M'))).toBe(true);
  await expect(page.getByText(/[↑↓]\s*[\d,.]+\s*\(.+\)\s*since\s+\w+/).first()).toBeVisible();
  await expect(page.getByText('Assets', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Debts', { exact: true }).first()).toBeVisible();
  // at 1100px and wider the summary is right of the groups
  const assets = (await page.getByText('Assets', { exact: true }).first().boundingBox())!;
  const rev = (await page.getByRole('button', { name: /Revolut/ }).first().boundingBox())!;
  expect(assets.x, 'summary on the right').toBeGreaterThan(rev.x + rev.width - 1);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(async () => (await page.getByText('Assets', { exact: true }).first().boundingBox())!.y).toBeLessThan(rev.y);
});

// ============ screenshots ============
async function richData(page: Page, s: Seed) {
  const b = await seedBudget(s);
  await s.pocket('Wallet', 2500, 'cash');
  await s.pocket('Savings pot', 150000, 'fund', em('Seedling'));
  await s.expense(b.pocket.id, b.subs.id, 999, 'Spotify', new Date(Date.now() - 80 * 864e5).toISOString().slice(0, 10));
  await s.expense(b.pocket.id, b.subs.id, 999, 'Spotify', new Date(Date.now() - 50 * 864e5).toISOString().slice(0, 10));
  await s.expense(b.pocket.id, b.subs.id, 999, 'Spotify', new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10));
  await s.expense(b.pocket.id, b.food.id, 4500, 'Lidl', new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10));
  return b;
}
const PAGES: [string, string, string | null][] = [
  ['home', '/home', null], ['budget', '/budget', null], ['pipeline', '/pipeline', null], ['transactions', '/transactions', null],
  ['recurring-upcoming', '/recurring', 'Upcoming'], ['recurring-calendar', '/recurring', 'Calendar'], ['pockets', '/pockets', null], ['investments', '/investments', null],
  ['reports-cash-flow', '/reports', 'Cash flow'], ['reports-spending', '/reports', 'Spending'], ['reports-net-worth', '/reports', 'Net worth'],
  ['settings-account', '/settings', 'Account'], ['settings-people', '/settings', 'People and sharing'], ['settings-connections', '/settings', 'Connections'], ['settings-appearance', '/settings', 'Appearance'],
];
for (const [size, viewport] of [['1280', { width: 1280, height: 800 }], ['1600', { width: 1600, height: 900 }], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`screenshots ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('every page and the dialogs', async ({ page, me }) => {
        test.setTimeout(120_000);
        const tag = `${size}-${scheme}`;
        await richData(page, me.seed);
        for (const [name, path, tab] of PAGES) {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          if (tab) await selectTab(page, tab);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(400);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways page scroll`).toBe(true);
          expect(await pageBg(page), `${name}: the ${scheme} theme`).toBe(THEME[scheme].bg);
          await page.screenshot({ path: `screenshots/spec27-${name}-${tag}.png`, fullPage: true });
        }
        // dialogs
        await page.goto('/budget');
        await page.getByRole('button', { name: 'Add transaction', exact: true }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `spec27-dialog-add-transaction-${tag}`);
        await page.keyboard.press('Escape');
        await page.locator('.ty-btable__row[role="button"]').filter({ hasText: 'Food' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `spec27-dialog-subsection-${tag}`);
        await page.keyboard.press('Escape');
        await page.goto('/pockets');
        await page.getByRole('button', { name: 'Add pocket', exact: true }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `spec27-dialog-add-pocket-${tag}`);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Transfer', exact: true }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await shot(page, `spec27-dialog-transfer-${tag}`);
      });
    });
  }
}
