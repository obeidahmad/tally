import type { Page, Locator } from '@playwright/test';
import { test, expect, dialog, shot, row, srow, chip, group, em, noVs, cell, titleOf, ruleCell, addSubBtn, type Seed } from '../support/fixtures';
import { octIso, getJson, norm } from '../support/closing';

// Spec 24: subsection emojis and goals with a date. Months are counted from the current one, so the tests pass in any month.
test.use({ viewport: { width: 1280, height: 900 } });
const wide = { width: 1600, height: 1000 }; // the summary aside shows from 1464px
const phone = { width: 390, height: 844 };

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The month `n` months from the current one: its YYYY-MM and the words the page may use for it ("Jun 2027" or "June 2027"). */
const ahead = (n: number) => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
  const iso = d.toISOString().slice(0, 7);
  const y = d.getUTCFullYear();
  return { iso, short: `${SHORT[d.getUTCMonth()]} ${y}`, re: new RegExp(`(${SHORT[d.getUTCMonth()]}|${LONG[d.getUTCMonth()]}) ${y}`) };
};

type SubBody = { name: string; emoji?: string | null; kind?: 'spending' | 'goal'; budgetMinor?: number; keep?: string; capMinor?: number; targetMonth?: string | null };
const addSub = async (page: Page, sectionId: number, body: SubBody) => {
  const r = await page.request.post(`/api/sections/${sectionId}/subsections`, { data: body });
  expect(r.status(), `POST subsection ${body.name}: ${await r.text()}`).toBeLessThan(300);
  return (await r.json()).subsection as { id: number; emoji?: string | null };
};
const goal = (name: string, targetMinor: number, budgetMinor: number, targetMonth?: string): SubBody =>
  ({ name, kind: 'goal', budgetMinor, keep: 'cap', capMinor: targetMinor, ...(targetMonth ? { targetMonth } : {}) });
const findNamed = (v: unknown, name: string): Record<string, any> | undefined => {
  if (Array.isArray(v)) for (const x of v) { const f = findNamed(x, name); if (f) return f; }
  else if (v && typeof v === 'object') {
    if ((v as { name?: unknown }).name === name) return v as Record<string, any>;
    for (const x of Object.values(v)) { const f = findNamed(x, name); if (f) return f; }
  }
  return undefined;
};
const deepKey = (v: unknown, key: string): any => {
  if (v && typeof v === 'object') {
    if (key in (v as object)) return (v as Record<string, unknown>)[key];
    for (const x of Object.values(v)) { const f = deepKey(x, key); if (f !== undefined) return f; }
  }
  return undefined;
};
/** A section that receives `receivedMinor` this month, so a goal in it holds that much. */
async function funded(s: Seed, sectionName: string, receivedMinor: number) {
  const section = await s.section(sectionName);
  const pocket = await s.pocket('Revolut', 0);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, receivedMinor, src.id);
  await s.amountStep(src.boxId, section.id, receivedMinor);
  return { section, pocket };
}
const budgetApi = (page: Page, iso = octIso) => getJson(page, `/api/budget?month=${iso}`);
const openAdd = async (page: Page, sectionName: string) => {
  await addSubBtn(page, sectionName).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add subsection' })).toBeVisible();
  return d;
};
/** Does the element, or a child of it, use the design token as its text colour? */
const usesToken = (l: Locator, token: string) =>
  l.evaluate((el, t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return [el, ...el.querySelectorAll('*')].some((e) => getComputedStyle(e).color === want);
  }, token);

// ============ emoji ============
test('the Add subsection dialog has an "Emoji" picker with "No emoji" chosen; a chosen emoji shows before the name on the Budget page', async ({ page, me }) => {
  await me.seed.section('Needs');
  await page.goto('/budget');
  const d = await openAdd(page, 'Needs');
  const pick = group(d, 'Emoji');
  await expect(pick).toBeVisible();
  await expect(pick.getByRole('button', { name: 'No emoji', exact: true })).toBeDisabled(); // nothing chosen yet
  await expect(pick.getByRole('radio', { name: 'Gem', exact: true })).toBeVisible();
  await d.getByLabel('Name', { exact: true }).fill('Rent');
  await d.getByLabel('Monthly budget').fill('800');
  await pick.getByRole('radio', { name: 'Gem', exact: true }).check();
  await shot(page, 'spec24-dialog-subsection-emoji-desktop-light');
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  expect(findNamed(await budgetApi(page), 'Rent')).toMatchObject({ emoji: em('Gem') });
  const r = srow(page, /Rent/);
  await expect(r).toBeVisible();
  expect(noVs(norm(await r.innerText()))).toMatch(new RegExp(`^${em('Gem')}\\s*Rent`));
});

test('a subsection without an emoji shows its name alone, and "No emoji" clears a chosen one', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await addSub(page, s.id, { name: 'Plain', budgetMinor: 1000 });
  await addSub(page, s.id, { name: 'Marked', budgetMinor: 1000, emoji: em('Star') });
  await page.goto('/budget');
  expect(noVs(norm(await srow(page, /Plain/).innerText()))).toMatch(/^Plain/);
  expect(noVs(norm(await srow(page, /Marked/).innerText()))).toMatch(new RegExp(`^${em('Star')}\\s*Marked`));
  await row(page, /Marked/).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit subsection' })).toBeVisible();
  await expect(group(d, 'Emoji').getByRole('radio', { name: 'Star', exact: true })).toBeChecked();
  await group(d, 'Emoji').getByRole('button', { name: 'No emoji', exact: true }).click();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  expect(noVs(norm(await srow(page, /Marked/).innerText()))).toMatch(/^Marked/);
  expect(findNamed(await budgetApi(page), 'Marked')!.emoji ?? null).toBeNull();
});

test('the API takes an emoji on POST and PATCH, null clears it, and a text that is not one of the emoji is refused', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  const made = await addSub(page, s.id, { name: 'Food', budgetMinor: 1000, emoji: em('Gift') });
  expect(made.emoji).toBe(em('Gift'));
  const patched = await page.request.patch(`/api/subsections/${made.id}`, { data: { emoji: em('Car') } });
  expect(patched.status(), await patched.text()).toBe(200);
  expect(findNamed(await budgetApi(page), 'Food')!.emoji).toBe(em('Car'));
  const cleared = await page.request.patch(`/api/subsections/${made.id}`, { data: { emoji: null } });
  expect(cleared.status()).toBe(200);
  expect(findNamed(await budgetApi(page), 'Food')!.emoji ?? null).toBeNull();
  const bad = await page.request.patch(`/api/subsections/${made.id}`, { data: { emoji: 'abc' } });
  expect(bad.status()).toBe(400);
});

test('the emoji shows before the subsection name in a transaction row, the transaction dialog\'s Subsection choice, Recurring and the flow table', async ({ page, me }) => {
  const s = await me.seed.section('Wants');
  const sub = await addSub(page, s.id, { name: 'Streaming', budgetMinor: 5000, emoji: em('Gem') });
  const pocket = await me.seed.pocket('Revolut', 100000);
  const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  for (const n of [-60, -30, 0]) await me.seed.expense(pocket.id, sub.id, 1299, 'Netflix', d(n));
  const withGem = new RegExp(`${em('Gem')}\\s*Streaming`);

  await page.goto('/transactions');
  const r = row(page, /Netflix/).first();
  await expect(r).toBeVisible();
  expect(noVs(norm(await r.innerText()))).toMatch(withGem);
  await shot(page, 'spec24-transactions-emoji-desktop-light');

  await page.getByRole('button', { name: 'Add transaction' }).last().click();
  const dlg = dialog(page);
  const options = await dlg.getByLabel('Subsection').locator('option').allTextContents();
  expect(options.map((o) => noVs(norm(o))).some((o) => withGem.test(o)), JSON.stringify(options)).toBe(true);
  await page.keyboard.press('Escape');

  await page.goto('/recurring');
  await expect(page.getByText('Netflix').first()).toBeVisible();
  expect(noVs(norm(await page.locator('body').innerText()))).toMatch(withGem);

  // Spec 26's flow table (Reports) lists the subsection as a node.
  await page.goto('/reports');
  const flow = page.locator('.ty-card').filter({ hasText: /money went/ }).first();
  await flow.getByRole('button', { name: /Show as table/ }).or(flow.getByRole('checkbox', { name: /Show as table/ })).or(flow.getByRole('switch', { name: /Show as table/ })).first().click();
  const t = flow.locator('table');
  await expect(t).toBeVisible();
  expect(noVs(norm(await t.innerText()))).toMatch(withGem);
});

// ============ goal date ============
test('the dialog of a savings goal has "Reach it by" under "Target"; a spending subsection has none', async ({ page, me }) => {
  await me.seed.section('Savings');
  await page.goto('/budget');
  const d = await openAdd(page, 'Savings');
  await expect(d.getByLabel('Reach it by')).toHaveCount(0);
  await chip(d, 'Kind', 'Savings goal').check();
  const reach = d.getByLabel('Reach it by');
  await expect(reach).toBeVisible();
  await expect(reach).toHaveValue('');
  const tb = (await d.getByRole('textbox', { name: 'Target', exact: true }).boundingBox())!;
  const rb = (await reach.boundingBox())!;
  expect(rb.y, '"Reach it by" is under "Target"').toBeGreaterThan(tb.y);
  await chip(d, 'Kind', 'Spending').check();
  await expect(d.getByLabel('Reach it by')).toHaveCount(0);
});

test('adding a goal of 15,000.00 reached by a month shows "15,000.00 by <Mon YYYY>" in its Rule, and editing can clear the date', async ({ page, me }) => {
  await me.seed.section('Savings');
  const m = ahead(8);
  await page.goto('/budget');
  const d = await openAdd(page, 'Savings');
  await d.getByLabel('Name', { exact: true }).fill('Car');
  await chip(d, 'Kind', 'Savings goal').check();
  await d.getByLabel('Monthly budget').fill('300');
  await d.getByRole('textbox', { name: 'Target', exact: true }).fill('15000');
  await d.getByLabel('Reach it by').fill(m.iso);
  await d.getByRole('button', { name: 'Add subsection', exact: true }).click();
  await expect(d).toBeHidden();
  const rule = await ruleCell(page, /Car/);
  await expect(rule).toContainText('15,000.00 by');
  await expect(rule).toContainText(m.re);
  expect(findNamed(await budgetApi(page), 'Car')).toMatchObject({ targetMonth: m.iso });

  await row(page, /Car/).click();
  const e = dialog(page);
  await expect(e.getByLabel('Reach it by')).toHaveValue(m.iso);
  await e.getByLabel('Reach it by').fill('');
  await e.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(e).toBeHidden();
  await expect(await ruleCell(page, /Car/)).not.toContainText(' by ');
  expect(findNamed(await budgetApi(page), 'Car')!.targetMonth ?? null).toBeNull();
});

test('the target month rules: a spending subsection refuses one, a past month is refused, this month is accepted', async ({ page, me }) => {
  const s = await me.seed.section('Savings');
  const spending = await page.request.post(`/api/sections/${s.id}/subsections`, { data: { name: 'Food', budgetMinor: 1000, targetMonth: ahead(2).iso } });
  expect(spending.status()).toBe(400);
  expect(await spending.text()).toContain('Only a savings goal has a target date.');
  const past = await page.request.post(`/api/sections/${s.id}/subsections`, { data: goal('Old', 10000, 1000, ahead(-1).iso) });
  expect(past.status()).toBe(400);
  expect(await past.text()).toContain('Choose this month or later.');
  const now = await page.request.post(`/api/sections/${s.id}/subsections`, { data: goal('Now', 10000, 1000, ahead(0).iso) });
  expect(now.status(), await now.text()).toBe(201);
});

test('a goal of 1,200.00 to reach in 12 months from 0 needs 100.00 a month; 1,000.00 in 3 months rounds up to 333.34; 1 month left needs it all', async ({ page, me }) => {
  const s = await me.seed.section('Savings');
  await addSub(page, s.id, goal('Year', 120000, 10000, ahead(11).iso));
  await addSub(page, s.id, goal('Quarter', 100000, 10000, ahead(2).iso));
  await addSub(page, s.id, goal('Now', 5000, 1000, ahead(0).iso));
  await addSub(page, s.id, goal('Undated', 5000, 1000));
  const api = await budgetApi(page);
  expect(findNamed(api, 'Year')).toMatchObject({ neededMinor: 10000, goalStatus: 'on_track' });
  expect(findNamed(api, 'Quarter')).toMatchObject({ neededMinor: 33334, goalStatus: 'behind' });
  expect(findNamed(api, 'Now')).toMatchObject({ neededMinor: 5000, goalStatus: 'behind' });
  const undated = findNamed(api, 'Undated')!;
  expect(undated.neededMinor ?? null).toBeNull();
  expect(undated.goalStatus ?? null).toBeNull(); // null for a goal without a date, unless it is done
});

test('a goal that is on track shows no warning; one that is behind has its Budgeted in the warning colour with the tooltip, and the summary lists the shortfall', async ({ page, me }) => {
  const { section } = await funded(me.seed, 'Savings', 15000);
  const m = ahead(11);
  await addSub(page, section.id, goal('Holiday', 120000, 10000, m.iso)); // needs 100.00, has 100.00
  await addSub(page, section.id, goal('House', 120000, 5000, m.iso)); // needs 100.00, has 50.00
  const api = await budgetApi(page);
  expect(findNamed(api, 'Holiday')).toMatchObject({ goalStatus: 'on_track' });
  expect(findNamed(api, 'House')).toMatchObject({ goalStatus: 'behind', neededMinor: 10000 });
  expect(deepKey(api, 'underfundedMinor')).toBe(5000);

  await page.setViewportSize(wide);
  await page.goto('/budget');
  const ok = await cell(page, srow(page, /Holiday/), 'Budgeted');
  const bad = await cell(page, srow(page, /House/), 'Budgeted');
  expect(await usesToken(ok, '--warning')).toBe(false);
  expect(await usesToken(bad, '--warning')).toBe(true);
  expect(await titleOf(bad)).toMatch(new RegExp(`^Needs 100\\.00 a month to reach 1,200\\.00 by ${m.re.source}$`));
  await expect(await ruleCell(page, /House/)).toContainText('1,200.00 by');

  const line = page.getByText('Goals need 50.00 more this month');
  await expect(line).toBeVisible();
  const aside = line.locator('xpath=ancestor::*[.//text()[contains(.,"House")]][1]');
  await expect(aside).toContainText('House');
  await expect(aside).toContainText('50.00');
  await expect(aside).not.toContainText('Holiday');
  await shot(page, 'spec24-budget-goals-behind-desktop-light');
});

test('with every goal on track there is no "Goals need" line', async ({ page, me }) => {
  const { section } = await funded(me.seed, 'Savings', 10000);
  await addSub(page, section.id, goal('Holiday', 120000, 10000, ahead(11).iso));
  expect(deepKey(await budgetApi(page), 'underfundedMinor')).toBe(0);
  await page.setViewportSize(wide);
  await page.goto('/budget');
  await expect(srow(page, /Holiday/)).toBeVisible();
  await expect(page.getByText(/Goals need/)).toHaveCount(0);
});

test('a goal that holds its target shows a positive "Reached" Pill in Available', async ({ page, me }) => {
  const { section } = await funded(me.seed, 'Savings', 10000);
  await addSub(page, section.id, goal('Laptop', 10000, 10000));
  expect(findNamed(await budgetApi(page), 'Laptop')).toMatchObject({ goalStatus: 'done' });
  await page.goto('/budget');
  const available = await cell(page, srow(page, /Laptop/), 'Available');
  const pill = available.locator('.ty-pill', { hasText: 'Reached' });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveClass(/ty-pill--positive/);
});

test('a goal whose date has passed and is not reached shows a warning "Date passed" Pill in the next month', async ({ page, me }) => {
  const s = await me.seed.section('Savings');
  await addSub(page, s.id, goal('Late', 120000, 1000, ahead(0).iso));
  const next = ahead(1).iso;
  expect(findNamed(await budgetApi(page, next), 'Late')).toMatchObject({ goalStatus: 'past' });
  await page.goto(`/budget?month=${next}`);
  const available = await cell(page, srow(page, /Late/), 'Available');
  const pill = available.locator('.ty-pill', { hasText: 'Date passed' });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveClass(/ty-pill--warning/);
});

// ============ screenshots ============
for (const [size, viewport] of [['desktop', wide], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot: Budget with emojis and goals, ${size} ${scheme}`, async ({ page, me }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const needs = await me.seed.section('Needs');
      await addSub(page, needs.id, { name: 'Rent', budgetMinor: 80000, emoji: em('House') });
      await addSub(page, needs.id, { name: 'Groceries', budgetMinor: 30000, emoji: em('Shopping cart') });
      await addSub(page, needs.id, { name: 'Phone bill', budgetMinor: 3000 });
      const { section } = await funded(me.seed, 'Savings', 20000);
      await addSub(page, section.id, { ...goal('Holiday', 120000, 10000, ahead(11).iso), emoji: em('Plane') });
      await addSub(page, section.id, { ...goal('New car', 1500000, 5000, ahead(20).iso), emoji: em('Car') });
      await addSub(page, section.id, { ...goal('Laptop', 10000, 10000), emoji: em('Phone') });
      await page.goto('/budget');
      await expect(srow(page, /New car/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, `spec24-budget-${size}-${scheme}`);
    });
  }
}
