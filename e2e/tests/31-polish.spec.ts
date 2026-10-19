import type { Page } from '@playwright/test';
import { test, expect, seedBudget, openTab, selectTab, em, noVs, shot, todayIso, type Seed } from '../support/fixtures';
import { seedRich, RICH_PLAN } from '../support/rich';

// Spec 27, "Polish after review": the top bar lines up with the page, full tab ARIA, avatars in transaction rows,
// the phone "More" sheet, no sideways page scroll on a phone, and the richer data behind the screenshots.
const phone = { width: 390, height: 844 };

// ============ the top bar lines up with the content ============
for (const path of ['/budget', '/transactions', '/pockets', '/reports', '/recurring', '/settings']) {
  test(`${path} at 1600: the title starts where the first card starts, and the actions end where the cards end`, async ({ page, me }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await seedBudget(me.seed);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const h1 = document.querySelector('h1')!.getBoundingClientRect();
      const bar = (() => { let e: Element | null = document.querySelector('h1'); while (e && getComputedStyle(e).position !== 'sticky') e = e.parentElement; return e; })();
      const actions = bar ? [...bar.querySelectorAll('button, a, [role="radiogroup"]')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('[role="tablist"]')) : [];
      const actionsRight = actions.length ? Math.max(...actions.map((b) => b.getBoundingClientRect().right)) : null;
      const cards = [...document.querySelectorAll('main .ty-card, main .ty-statcard, main .ty-btable, main .ty-days')].filter((c) => c.getBoundingClientRect().width > 200);
      const left = Math.min(...cards.map((c) => c.getBoundingClientRect().left));
      const right = Math.max(...cards.map((c) => c.getBoundingClientRect().right));
      return { h1: h1.left, left, right, actionsRight, n: cards.length };
    });
    expect(r.n, 'the page has cards').toBeGreaterThan(0);
    expect(Math.abs(r.h1 - r.left), `title ${r.h1} vs first card ${r.left}`).toBeLessThanOrEqual(1.5);
    if (r.actionsRight !== null) expect(Math.abs(r.actionsRight - r.right), `actions end ${r.actionsRight} vs cards end ${r.right}`).toBeLessThanOrEqual(1.5);
    if (path === '/budget') await shot(page, 'spec27-polish-topbar-1600');
  });
}

// ============ tabs: full ARIA ============
const TABBED = [
  { path: '/reports', tabs: ['Cash flow', 'Spending', 'Net worth'] },
  { path: '/recurring', tabs: ['Upcoming', 'Calendar'] },
  { path: '/settings', tabs: ['Account', 'People and sharing', 'Connections', 'Appearance'] },
] as const;
for (const t of TABBED) {
  test(`${t.path}: every tab has an id and aria-controls, and the panel it controls is labelled by it`, async ({ page, me }) => {
    void me;
    await page.goto(t.path);
    const ids = new Set<string>();
    for (const name of t.tabs) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const id = await tab.getAttribute('id');
      const controls = await tab.getAttribute('aria-controls');
      expect(id, `${name} has an id`).toBeTruthy();
      expect(controls, `${name} has aria-controls`).toBeTruthy();
      ids.add(id!);
      const panel = page.locator(`[id="${controls}"]`);
      await expect(panel, `the panel ${controls} exists`).toHaveCount(1);
      await expect(panel).toHaveAttribute('role', 'tabpanel');
      await expect(panel, 'labelled by the selected tab').toHaveAttribute('aria-labelledby', id!);
      await expect(panel).toBeVisible();
      await expect(page.getByRole('tabpanel', { name })).toBeVisible(); // so its accessible name is the tab's
    }
    expect(ids.size, 'ids are unique').toBe(t.tabs.length);
  });
}

test.describe('phone tabs', () => {
  test.use({ viewport: phone });
  test('the selected tab is kept off the screen edge (scroll-margin-inline)', async ({ page, me }) => {
    void me;
    await page.goto('/settings');
    const tab = page.getByRole('tab', { name: 'Appearance', exact: true });
    await tab.click();
    const css = await tab.evaluate((e) => ({ m: parseFloat(getComputedStyle(e).scrollMarginInlineStart || getComputedStyle(e).scrollMarginLeft || '0'), r: e.getBoundingClientRect() }));
    expect(css.m, 'scroll-margin-inline').toBeGreaterThan(0);
    await expect(tab).toBeInViewport();
    expect(css.r.right, 'not touching the right edge').toBeLessThanOrEqual(phone.width - 1);
  });
});

// ============ transaction rows start with an avatar ============
async function seedAvatars(page: Page, s: Seed) {
  const sec = await s.section('Needs');
  const gift = await page.request.post(`/api/sections/${sec.id}/subsections`, { data: { name: 'Gifts', budgetMinor: 5000, emoji: em('Gift') } });
  const withEmoji = (await gift.json()).subsection as { id: number };
  const plain = await s.subsection(sec.id, 'Plain', 5000); // no emoji
  const other = await s.subsection(sec.id, 'Other', 5000);
  const bank = await s.pocket('Bank', 100000);
  await s.expense(bank.id, withEmoji.id, 1500, 'Toy shop');
  await s.expense(bank.id, plain.id, 2500, 'lidl');
  const split = await page.request.post('/api/transactions', { data: { date: todayIso(), kind: 'expense', amountMinor: 6000, pocketId: bank.id, payee: 'Big shop', splits: [{ subsectionId: plain.id, amountMinor: 2000 }, { subsectionId: other.id, amountMinor: 4000 }] } });
  expect(split.status(), await split.text()).toBeLessThan(300);
}
const avatarOf = (page: Page, payee: string) =>
  page.getByRole('button', { name: new RegExp(payee, 'i') }).first().evaluate((row) => {
    const rb = row.getBoundingClientRect();
    const hit = [...row.querySelectorAll('*')].find((e) => {
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return Math.round(b.width) === 28 && Math.round(b.height) === 28 && parseFloat(cs.borderTopLeftRadius) >= 14;
    });
    if (!hit) return null;
    const b = hit.getBoundingClientRect(); const cs = getComputedStyle(hit);
    return { text: (hit.textContent ?? '').trim(), bg: cs.backgroundColor, firstOnRow: b.left - rb.left < 24, fontSize: cs.fontSize, x: b.left };
  });

for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', phone]] as const) {
  test(`${label}: each transaction row starts with a 28px round avatar: the subsection's emoji, the payee's first letter, or ⋯ for a split`, async ({ page, me }) => {
    await page.setViewportSize(vp);
    await seedAvatars(page, me.seed);
    await page.goto('/transactions');
    await expect(page.getByRole('button', { name: /Toy shop/ })).toBeVisible();
    const emoji = (await avatarOf(page, 'Toy shop'))!;
    expect(emoji, 'an avatar on the Toy shop row').not.toBeNull();
    expect(noVs(emoji.text)).toBe(noVs(em('Gift')));
    expect(emoji.firstOnRow, 'the avatar starts the row').toBe(true);
    expect(emoji.bg, 'on a tint, not transparent').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(emoji.bg, 'not plain white').not.toBe('rgb(255, 255, 255)');
    const letter = (await avatarOf(page, 'lidl'))!;
    expect(letter, 'an avatar on the lidl row').not.toBeNull();
    expect(letter.text.toLowerCase(), "the payee's first letter").toBe('l');
    const split = (await avatarOf(page, 'Big shop'))!;
    expect(split, 'an avatar on the split row').not.toBeNull();
    expect(split.text).toBe('⋯');
    await shot(page, `spec27-polish-avatars-${label}`);
  });
}

// ============ the phone "More" sheet ============
test.describe('phone More sheet', () => {
  test.use({ viewport: phone });
  const MORE = ['Pipeline', 'Recurring', 'Investments', 'Reports', 'Settings'];
  const moreButton = (page: Page) => page.locator('.ty-tabbar').getByRole('button', { name: 'More', exact: true });

  test('the bar is Home, Budget, Transactions, Pockets and More; More opens a sheet with the five other pages, each with an icon', async ({ page, me }) => {
    void me;
    await page.goto('/budget');
    await expect(page.locator('.ty-tabbar').locator('a, button')).toHaveText(['Home', 'Budget', 'Transactions', 'Pockets', 'More']);
    await moreButton(page).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    for (const n of MORE) {
      const link = sheet.getByRole('link', { name: n, exact: true });
      await expect(link, n).toBeVisible();
      await expect(link.locator('svg').first(), `${n} has an icon`).toBeVisible();
    }
    expect(await sheet.getByRole('link').count()).toBe(MORE.length);
    await page.waitForTimeout(400);
    await shot(page, 'spec27-polish-more-sheet');
  });

  test('every page is reachable from the sheet, and the sheet closes when a page opens', async ({ page, me }) => {
    void me;
    await page.goto('/budget');
    for (const n of MORE) {
      await moreButton(page).click();
      await page.getByRole('dialog').getByRole('link', { name: n, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${n.toLowerCase()}`));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  test('Escape closes the sheet and focus goes back to More; so does a tap outside', async ({ page, me }) => {
    void me;
    await page.goto('/budget');
    await moreButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('link').first(), 'focus moves into the sheet').toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(moreButton(page)).toBeFocused();
    // opened again, a tap on the page behind closes it
    await moreButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(phone.width / 2, 60);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// ============ no sideways scroll on a phone, on every page and every tab ============
const PAGES: [string, string | null][] = [
  ['/home', null], ['/budget', null], ['/pipeline', null], ['/transactions', null], ['/recurring', 'Upcoming'], ['/recurring', 'Calendar'], ['/pockets', null], ['/investments', null],
  ['/reports', 'Cash flow'], ['/reports', 'Spending'], ['/reports', 'Net worth'],
  ['/settings', 'Account'], ['/settings', 'People and sharing'], ['/settings', 'Connections'], ['/settings', 'Appearance'],
];
for (const width of [390, 360]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });
    test('no page scrolls sideways, on any page or tab (the Sankey card scrolls inside itself)', async ({ page, me }) => {
      test.setTimeout(120_000);
      await seedRich(page, me.seed);
      const bad: string[] = [];
      for (const [path, tab] of PAGES) {
        await page.goto(path);
        await expect(page.locator('h1').first()).toBeAttached();
        if (tab) await selectTab(page, tab);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: innerWidth, b: document.body.scrollWidth }));
        if (w.s > w.i) bad.push(`${path}${tab ? ` > ${tab}` : ''}: scrollWidth ${w.s} > ${w.i}`);
      }
      expect(bad, bad.join('\n')).toEqual([]);
      // the diagram scrolls inside its card instead (min width 720px)
      await openTab(page, '/reports', 'Cash flow');
      const inner = await page.locator('.ty-card', { has: page.getByText(/money went/) }).first().evaluate((el) => [el, ...el.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)));
      expect(inner, 'a scroller inside the Sankey card').toBe(true);
    });
  });
}

// ============ the screenshot data is rich ============
test('the screenshot seed has 5+ sections of 3 to 5 subsections with emojis, spending in most of them, and a reconciled pocket', async ({ page, me }) => {
  await seedRich(page, me.seed);
  const sections = ((await (await page.request.get('/api/sections')).json()).sections as { id: number; name: string }[]);
  expect(sections.length).toBeGreaterThanOrEqual(5);
  const total = RICH_PLAN.reduce((a, [, l]) => a + l.length, 0);
  const spending = RICH_PLAN.reduce((a, [, l]) => a + l.filter((x) => x[3] > 0).length, 0);
  expect(spending / total, 'spending in most subsections').toBeGreaterThan(0.8);
  for (const [, list] of RICH_PLAN) expect(list.length).toBeGreaterThanOrEqual(3), expect(list.length).toBeLessThanOrEqual(5);
  await page.goto('/budget');
  await expect(page.locator('.ty-btable__row[role="button"]').first()).toBeVisible();
  expect(await page.locator('.ty-btable__row[role="button"] .ty-emoji').count(), 'emojis on subsections').toBeGreaterThanOrEqual(total - 2);
  const pockets = ((await (await page.request.get('/api/pockets')).json()).pockets as { name: string; reconciledAt?: string | null }[]);
  expect(pockets.find((p) => p.name === 'Wallet')?.reconciledAt, 'a reconciled pocket').toBeTruthy();
});
