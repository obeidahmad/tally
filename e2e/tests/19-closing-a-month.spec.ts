import { test, expect, dialog, toast, row, pillOf, chip, group, fillExpense, seedBudget } from '../support/fixtures';
import {
  MINUS, sepName, octName, novName, sepTitle, octTitle, sepIso, octIso, sepDay, REMINDER, CLOSED_NOTICE, CLOSE_BTN, IN_CLOSED, TX_CLOSED,
  USED_IN_PIPELINE, LEFTOVERS, norm, budgetUrl, pipelineUrl, monthsApi, closeApi, reopenApi, putRest, getJson, seedExample, titlePill, notices,
  stat, bsection, node, openCloseDialog, nextWireProblems,
} from '../support/closing';
import type { Page } from '@playwright/test';

// Spec 09: closing a month. Browser acceptance criteria 2 to 15.
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };
test.use({ viewport: desktop });

const PCT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';
const gotoPipeline = async (page: Page, iso = octIso) => {
  await page.goto(pipelineUrl(iso));
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
};
/** Closes the dialog's way: through the page, as a person does. */
const closeThroughDialog = async (page: Page) => {
  const d = await openCloseDialog(page);
  await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
  await expect(d).toBeHidden();
};

// ============ criterion 2: the reminder ============
test('with a transaction in September every month shows the reminder and "Close September"; with only October transactions, or none, nothing shows', async ({ page, me }) => {
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(/has ended\. Close it/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Close \w+$/ })).toHaveCount(0);

  await seedBudget(me.seed); // October only
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();
  await expect(page.getByText(/has ended\. Close it/)).toHaveCount(0);

  const pocket = (await me.seed.pocket('Cash', 0, 'cash')).id;
  await me.seed.income(pocket, 1000, 'Gift', sepDay());
  expect((await monthsApi(page)).toClose).toBe(sepIso);
  const earlier = new Date();
  earlier.setUTCDate(1);
  earlier.setUTCMonth(earlier.getUTCMonth() - 2);
  for (const url of ['/budget', budgetUrl(sepIso), `/budget?month=${earlier.toISOString().slice(0, 7)}`]) {
    await page.goto(url);
    const n = notices(page).filter({ hasText: REMINDER });
    await expect(n, url).toBeVisible();
    await expect(n.getByRole('button', { name: CLOSE_BTN, exact: true })).toHaveClass(/ty-btn--sm/);
  }
});

test.describe('phone', () => {
  test.use({ viewport: phone });
  test('the reminder shows on a phone too', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await page.goto('/budget');
    await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
    await expect(page.getByRole('button', { name: CLOSE_BTN, exact: true })).toBeVisible();
  });
});

// ============ criterion 3: the close dialog ============
test('"Close September" opens the dialog with the five rows of the worked example, the total and the kept line; "Cancel" closes nothing', async ({ page, me }) => {
  await seedExample(page, me.seed);
  const d = await openCloseDialog(page);
  await expect(d.locator('.ty-cap').first()).toHaveText(`This carries what is left into ${octName}. You can reopen ${sepName} while ${octName} is still open.`);
  const rows = d.locator('.ty-restrow');
  await expect(rows).toHaveCount(5);
  const expected: [string, string][] = [
    ['Rest of Needs, 60% to Savings', '30.01'],
    [`Rest of Needs, 40% to ${octName}'s income`, '20.00'],
    [`Overspent in Wants, taken from ${octName}'s income`, `${MINUS}100.00`],
    ['Rest of Savings to Savings', '400.00'],
    [`Left over to ${octName}'s income`, '12.40'],
  ];
  for (const [i, [words, amount]] of expected.entries()) {
    const r = rows.nth(i);
    expect(norm(await r.locator('.ty-num').innerText()), `row ${i + 1} amount`).toBe(amount);
    expect(norm(await r.innerText()).replace(amount, '').trim(), `row ${i + 1} words`).toBe(words);
  }
  // a section destination shows in a tag with its dot
  await expect(rows.nth(0).locator('.ty-tag .ty-dot')).toHaveCount(1);
  await expect(rows.nth(3).locator('.ty-tag .ty-dot')).toHaveCount(1);
  const sum = d.locator('.ty-sum');
  expect(norm(await sum.innerText())).toBe(`Last month's leftovers in ${octName} ${MINUS}67.60`);
  await expect(d.getByText('Subsections keep what they did not spend: 49.99.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(d).toBeHidden();
  expect((await monthsApi(page)).lastClosed).toBeNull();
  await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
});

// ============ criterion 4: closing ============
test('closing shows the toast, drops the reminder, September reads "Closed" with "Reopen", October reads "Open"', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await page.goto('/budget');
  await expect(titlePill(page)).toHaveText('Open');
  await expect(titlePill(page)).toHaveClass(/ty-pill--positive/);
  await closeThroughDialog(page);
  await expect(toast(page)).toContainText(`${sepTitle} closed`);
  await expect(page.getByText(REMINDER)).toHaveCount(0);
  await expect(page.getByRole('button', { name: CLOSE_BTN })).toHaveCount(0);
  await expect(titlePill(page)).toHaveText('Open');
  expect(await monthsApi(page)).toEqual({ lastClosed: sepIso, toClose: null });

  await page.getByRole('button', { name: 'Previous month' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: sepTitle }).first()).toBeVisible();
  await expect(titlePill(page)).toHaveText('Closed');
  await expect(titlePill(page)).not.toHaveClass(/ty-pill--positive/);
  const n = notices(page).filter({ hasText: CLOSED_NOTICE });
  await expect(n).toBeVisible();
  await expect(n.getByRole('button', { name: 'Reopen', exact: true })).toHaveClass(/ty-btn--sm/);
});

test('closing a month the server refuses (closed elsewhere meanwhile) shows its sentence in the dialog', async ({ page, me }) => {
  await seedExample(page, me.seed);
  const d = await openCloseDialog(page);
  await closeApi(page); // another tab closes it first
  await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
  await expect(d.getByText('This month cannot be closed now.')).toBeVisible();
  await expect(d).toBeVisible();
});

// ============ criterion 5: a closed month is locked ============
for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
  test.describe(`closed September, ${size}`, () => {
    test.use({ viewport });

    test('has no "Add income", "Add transaction", "Edit" or "Add subsection", and its rows open nothing', async ({ page, me }) => {
      await seedExample(page, me.seed);
      await closeApi(page);
      await page.goto(budgetUrl(sepIso));
      await expect(notices(page).filter({ hasText: CLOSED_NOTICE })).toBeVisible();
      await expect(page.getByText('Food').first()).toBeVisible();
      for (const name of ['Add income', 'Add transaction', 'Add', 'Edit', 'Add subsection']) {
        await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
      }
      await page.getByText('Food', { exact: true }).first().click();
      await page.getByText('Rent', { exact: true }).first().click();
      await expect(dialog(page)).toHaveCount(0);
      // October still has them
      await page.goto('/budget');
      await expect((size === 'phone' ? page.locator('.ty-topbar') : page).getByRole('button', { name: 'Add transaction', exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add income', exact: true }).first()).toBeVisible();
    });
  });
}

test('a transaction dated in a closed September is refused under "Date" when added from October or when an October one is moved into it', async ({ page, me }) => {
  const w = await seedExample(page, me.seed);
  await closeApi(page);
  await w.s.expense(w.pocket.id, w.food.id, 500, 'Kiosk'); // today
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).first().click();
  let d = dialog(page);
  await fillExpense(d, { amount: '5', payee: 'Late', subsection: 'Food', pocket: /Revolut/ });
  await d.getByLabel('Date').fill(sepDay(12));
  await d.getByRole('button', { name: 'Add expense' }).click();
  await expect(d.getByText(IN_CLOSED)).toBeVisible();
  await expect(d.getByLabel('Date')).toHaveClass(/ty-input--error/);
  await expect(d).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/transactions');
  await row(page, /Kiosk/).click();
  d = dialog(page);
  await d.getByLabel('Date').fill(sepDay(12));
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByText(IN_CLOSED)).toBeVisible();
  await expect(d.getByLabel('Date')).toHaveClass(/ty-input--error/);
});

test('a transaction of a closed September cannot be deleted: it stays in the list and the server\'s sentence shows', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await closeApi(page);
  await page.goto('/transactions');
  await page.getByLabel('Month').selectOption({ label: sepTitle });
  await row(page, /Landlord/).click();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(TX_CLOSED).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row(page, /Landlord/)).toBeVisible();
  const txs = (await getJson(page, `/api/transactions?month=${sepIso}`)).transactions as { payee: string }[];
  expect(txs.some((t) => t.payee === 'Landlord')).toBe(true);
});

// ============ criterion 6: October after the close ============
test('October shows Food with "+49.99 from September" and 199.98 available, Savings with 430.01 budgeted, and Income −67.60', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await closeApi(page);
  await page.goto('/budget');
  const food = row(page, /Food/);
  await expect(food).toContainText(`+49.99 from ${sepName}`);
  await expect(pillOf(food)).toContainText('199.98');
  await expect(bsection(page, 'Savings')).toContainText('430.01');
  await expect(stat(page, 'Income')).toContainText(`${MINUS}67.60`);
  await expect(stat(page, 'Left over')).toContainText(`${MINUS}67.60`);
  await expect(row(page, /Rent/)).not.toContainText('from');
  await expect(titlePill(page)).toHaveText('Open');
});

// ============ criterion 7: October's Pipeline after the close ============
test('the Pipeline page of October shows rest rows, "Left over", the third column, the leftovers box and "Rest of Savings", with dotted wires on the edges, also after a resize', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await closeApi(page);
  await gotoPipeline(page);
  await expect(page.locator('.ty-pipe.ty-pipe--next')).toBeVisible();
  await expect(page.locator('.ty-pipe-frame .ty-pipe--next')).toHaveCount(1);
  await expect(titlePill(page)).toHaveText('Open');
  await expect(page.locator('.ty-pipe > .ty-label, .ty-pipe .ty-label').filter({ hasText: new RegExp(`^${novName}$`) })).toHaveCount(1);

  const needs = node(page, 'Needs');
  const rr = needs.locator('.ty-step--rest');
  await expect(rr).toHaveCount(2);
  expect(norm(await rr.nth(0).innerText()).replace(/^REST/, 'Rest')).toBe(`Rest 60% Savings, ${novName}`);
  expect(norm(await rr.nth(1).innerText()).replace(/^REST/, 'Rest')).toBe(`40% Income, ${novName}`);
  await expect(rr.nth(0).locator('.ty-dot')).toHaveCount(1);
  await expect(node(page, 'Wants').locator('.ty-step--rest')).toHaveCount(1);
  expect(norm(await node(page, 'Wants').locator('.ty-step--rest').innerText()).replace(/^REST/, 'Rest')).toBe(`Rest All Income, ${novName}`);
  expect(norm(await node(page, 'Savings').locator('.ty-step--rest').innerText()).replace(/^REST/, 'Rest')).toBe(`Rest All Savings, ${novName}`);
  const left = node(page, 'Left over');
  expect(norm(await left.locator('.ty-step--rest').innerText()).replace(/^REST/, 'Rest')).toBe(`Rest All Income, ${novName}`);
  await expect(left).toContainText(`${MINUS}67.60`);
  await expect(left.getByRole('button', { name: /Rest/ })).toHaveCount(0);
  await expect(left.locator('[tabindex]')).toHaveCount(0);

  // the groups and their names
  await expect(page.getByRole('button', { name: `Rest of Needs: 60% to Savings, 40% to next month's income`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rest of Wants: /})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rest of Savings: all to Savings', exact: true })).toBeVisible();

  // third column: Savings and the leftovers, nothing else
  const nexts = page.locator('.ty-pipe .ty-node--next');
  await expect(nexts).toHaveCount(3); // two in the third column, "Rest of Savings" in the first
  const sav = node(page, `Savings, ${novName}`);
  await expect(sav).toHaveClass(/ty-node--next/);
  await expect(sav).toContainText('Arrives as extra');
  await expect(sav.locator('.ty-dot')).toHaveCount(1);
  const lo = node(page, `${LEFTOVERS}, ${novName}`);
  await expect(lo).toHaveClass(/ty-node--next/);
  await expect(lo).toContainText('Arrives as income');
  await expect(node(page, `Needs, ${novName}`)).toHaveCount(0);
  await expect(node(page, `Wants, ${novName}`)).toHaveCount(0);

  // the leftovers box and the money that arrived into Savings
  const old = node(page, LEFTOVERS);
  await expect(old).toHaveClass(/ty-node--old/);
  await expect(old).toContainText(`From ${sepName}`);
  await expect(old).toContainText(`${MINUS}67.60`);
  // the amount in the head is not clipped by the box
  const clip = await old.locator('.ty-node__head .ty-num').evaluate((e) => {
    const r = e.getBoundingClientRect(), b = e.closest('.ty-node')!.getBoundingClientRect();
    return { right: r.right, boxRight: b.right, scrollW: e.scrollWidth, clientW: e.clientWidth };
  });
  expect(clip.right, 'the head amount ends inside the box').toBeLessThanOrEqual(clip.boxRight);
  const rest = node(page, `Rest of Savings from ${sepName}`);
  await expect(rest).toHaveClass(/ty-node--next/);
  await expect(rest).toContainText('Rest of Savings');
  await expect(rest).toContainText('430.01');
  await expect(rest).toContainText(`From ${sepName}`);
  await expect(rest.locator('.ty-dot')).toHaveCount(1);
  await expect(page.locator('.ty-pipe svg path.ty-wire--next').first()).toBeAttached();

  // dotted wires: 5 rest rows (2 + 1 + 1 + Left over) and "Rest of Savings" to its section
  await expect.poll(() => nextWireProblems(page, 6)).toEqual([]);
  for (const size of [{ width: 1100, height: 800 }, { width: 1500, height: 1000 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => nextWireProblems(page, 6), `after resizing to ${size.width}x${size.height}`).toEqual([]);
  }
});

// ============ criterion 8: leftovers merged into Paycheck ============
test('moving "Last month\'s leftovers" into Paycheck\'s box and adding 2,000.00 of October Paycheck gives the figures of the example', async ({ page, me }) => {
  const w = await seedExample(page, me.seed);
  await closeApi(page);
  await gotoPipeline(page);
  await node(page, LEFTOVERS).getByRole('button', { name: 'Edit', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit income source' })).toBeVisible();
  await expect(d.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(d.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await d.getByLabel('Box', { exact: true }).selectOption({ label: 'With Paycheck' });
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await w.s.income(w.pocket.id, 200000, w.paycheck.id); // October
  await page.reload();
  const together = page.locator('.ty-pipe .ty-node').filter({ has: page.locator('.ty-node__head--sum') });
  await expect(together).toContainText('Paycheck');
  await expect(together).toContainText(LEFTOVERS);
  await expect(together.locator('.ty-node__head--sum')).toContainText('1,932.40');
  await expect(node(page, 'Needs')).toContainText('966.20');
  await expect(node(page, 'Wants')).toContainText('579.72');
  await expect(node(page, 'Savings')).toContainText('816.49');
  await expect(node(page, 'Left over')).toContainText('0.00');
  await expect(node(page, 'Left over')).not.toContainText(MINUS);
  await page.goto('/budget');
  await expect(stat(page, 'Left over')).toContainText('0.00');
  await expect(stat(page, 'Left over')).not.toContainText(MINUS);
});

// ============ criterion 9: the rest dialog ============
test.describe('rest dialog', () => {
  const needsGroup = (page: Page) => page.getByRole('button', { name: /^Rest of Needs: / });
  const opened = async (page: Page) => {
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Rest of Needs' })).toBeVisible();
    return d;
  };

  test('click, Enter and Space on Needs\' rest rows open "Rest of Needs" with its rule', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await gotoPipeline(page);
    await needsGroup(page).click();
    let d = await opened(page);
    await expect(d.getByText('Where the rest of Needs goes when a month closes: what no subsection claimed, less what subsections overspent.')).toBeVisible();
    await expect(d.getByText('Goes to', { exact: true })).toBeVisible();
    await expect(d.getByText('Percentage', { exact: true })).toBeVisible();
    await expect(d.getByLabel('Goes to 1', { exact: true }).locator('option:checked')).toHaveText('Savings');
    await expect(d.getByLabel('Percentage 1', { exact: true })).toHaveValue('60');
    await expect(d.getByLabel('Goes to 2', { exact: true }).locator('option:checked')).toHaveText("Next month's income");
    await expect(d.getByLabel('Percentage 2', { exact: true })).toHaveValue('40');
    await expect(d.getByLabel('Goes to 1', { exact: true }).locator('option:not([disabled])').first()).toHaveText("Next month's income");
    await expect(d.getByLabel('Goes to 1', { exact: true }).locator('option:not([disabled])')).toHaveText(["Next month's income", 'Needs', 'Wants', 'Savings']);
    await expect(d.getByRole('button', { name: 'Remove destination 1' })).toBeVisible();
    await expect(d.getByRole('button', { name: '+ Add destination', exact: true })).toHaveClass(/ty-btn--sm/);
    await expect(d.getByText('Together the percentages make 100%.')).toBeVisible();
    await expect(chip(d, 'When overspent, take it from', "Next month's income")).toBeChecked();
    await expect(chip(d, 'When overspent, take it from', 'Needs next month')).not.toBeChecked();
    await expect(d.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();

    await needsGroup(page).focus();
    await page.keyboard.press('Enter');
    d = await opened(page);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await expect(needsGroup(page)).toBeFocused();
    await page.keyboard.press('Space');
    d = await opened(page);
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(d).toBeHidden();
  });

  test('saving a new rule updates the rows and the third column without a reload', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await gotoPipeline(page);
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await expect(node(page, `Needs, ${novName}`)).toHaveCount(0);
    await needsGroup(page).click();
    const d = await opened(page);
    await d.getByLabel('Goes to 1', { exact: true }).selectOption({ label: 'Needs' });
    await d.getByLabel('Percentage 1', { exact: true }).fill('70');
    await d.getByLabel('Percentage 2', { exact: true }).fill('30');
    await chip(d, 'When overspent, take it from', 'Needs next month').check();
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(d).toBeHidden();
    await expect(toast(page)).toContainText('Saved');
    const rr = node(page, 'Needs').locator('.ty-step--rest');
    await expect(rr.nth(0)).toContainText('70%');
    await expect(rr.nth(0)).toContainText(`Needs, ${novName}`);
    await expect(rr.nth(1)).toContainText('30%');
    await expect(node(page, `Needs, ${novName}`)).toContainText('Arrives as extra');
    await expect(page.getByRole('button', { name: "Rest of Needs: 70% to Needs, 30% to next month's income", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept === true), 'the page was reloaded').toBe(true);
    const rule = (await getJson(page, '/api/sections')).sections.find((s: { name: string }) => s.name === 'Needs').rest;
    expect(rule.overspent).toBe('section');
    expect(rule.shares.map((s: { basisPoints: number }) => s.basisPoints)).toEqual([7000, 3000]);
  });

  test('a row without a destination, a percentage of 0 and percentages adding up to 90 are refused with their sentences', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await gotoPipeline(page);
    const puts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/rest$/.test(r.url())) puts.push(r.url()); });
    await needsGroup(page).click();
    const d = await opened(page);
    await d.getByRole('button', { name: '+ Add destination', exact: true }).click();
    await expect(d.getByLabel('Goes to 3', { exact: true })).toBeVisible();
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(d.getByText('Choose where every row goes.')).toBeVisible();
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Remove destination 3' }).click();
    await expect(d.getByLabel('Goes to 3', { exact: true })).toHaveCount(0);

    await d.getByLabel('Percentage 1', { exact: true }).fill('0');
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(d.getByText(PCT_ERROR)).toBeVisible();
    await expect(d.getByLabel('Percentage 1', { exact: true })).toHaveClass(/ty-input--error/);
    expect(puts, 'nothing was sent').toEqual([]);

    await d.getByLabel('Percentage 1', { exact: true }).fill('50');
    await d.getByLabel('Percentage 2', { exact: true }).fill('40');
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(d.getByText('The percentages must add up to 100.')).toBeVisible();
    await expect(d).toBeVisible();
    // nothing was saved
    const rule = (await getJson(page, '/api/sections')).sections.find((s: { name: string }) => s.name === 'Needs').rest;
    expect(rule.shares.map((s: { basisPoints: number }) => s.basisPoints)).toEqual([6000, 4000]);
  });
});

// ============ criterion 10: overspent kept in the section ============
test('with Wants set to "Wants next month" the close dialog reads "Overspent in Wants, kept in Wants" with −100.00 and the total 32.40', async ({ page, me }) => {
  const w = await seedExample(page, me.seed);
  await gotoPipeline(page);
  await page.getByRole('button', { name: /^Rest of Wants: / }).click();
  const rd = dialog(page);
  await expect(rd.getByRole('heading', { name: 'Rest of Wants' })).toBeVisible();
  await chip(rd, 'When overspent, take it from', 'Wants next month').check();
  await rd.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rd).toBeHidden();
  const d = await openCloseDialog(page);
  const rows = d.locator('.ty-restrow');
  await expect(rows).toHaveCount(5);
  const wants = rows.filter({ hasText: 'Overspent in Wants' });
  expect(norm(await wants.innerText())).toBe(`Overspent in Wants, kept in Wants ${MINUS}100.00`);
  expect(norm(await d.locator('.ty-sum').innerText())).toBe(`Last month's leftovers in ${octName} 32.40`);
  await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
  await expect(d).toBeHidden();
  const wantsOct = (await getJson(page, `/api/pipeline?month=${octIso}`)).sections.find((s: { id: number }) => s.id === w.wants.id);
  expect(wantsOct.carriedMinor).toBe(-10000);
});

// ============ criterion 11: reopening ============
test('"Reopen" brings back "Open", the buttons and the reminder; October loses the note and the "Rest of Savings" box; the leftovers bring 0.00', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await closeApi(page);
  await page.goto(budgetUrl(sepIso));
  await expect(titlePill(page)).toHaveText('Closed');
  await notices(page).filter({ hasText: CLOSED_NOTICE }).getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(toast(page)).toContainText(`${sepTitle} reopened`);
  await expect(titlePill(page)).toHaveText('Open');
  await expect(page.getByText(CLOSED_NOTICE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add income', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible();
  await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
  expect(await monthsApi(page)).toEqual({ lastClosed: null, toClose: sepIso });

  await page.goto('/budget');
  await expect(row(page, /Food/)).not.toContainText('from');
  await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
  await expect(stat(page, 'Income')).toContainText('0.00');
  await expect(stat(page, 'Income')).not.toContainText(MINUS);
  await gotoPipeline(page);
  await expect(node(page, `Rest of Savings from ${sepName}`)).toHaveCount(0);
  const old = node(page, LEFTOVERS);
  await expect(old).toContainText('0.00');
  await expect(old).not.toContainText(MINUS);
});

// ============ criterion 12: a closed month's Pipeline page ============
test('a closed September\'s Pipeline page reads "Closed", offers nothing, and a change in October does not change its figures', async ({ page, me }) => {
  const w = await seedExample(page, me.seed);
  await closeApi(page);
  await gotoPipeline(page, sepIso);
  await expect(titlePill(page)).toHaveText('Closed');
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled();
  for (const name of ['Add section', 'Add income source', 'Add step', 'Edit']) {
    await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
  }
  await expect(node(page, 'Needs')).toContainText('1,000.00');
  await expect(page.getByRole('button', { name: /^Step \d/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Rest of / })).toHaveCount(0);
  await expect(page.locator('.ty-pipe [tabindex]:not([tabindex="-1"])')).toHaveCount(0);
  const reached = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    reached.add(await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return e && e.closest('.ty-pipe') ? (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40) : '';
    }));
  }
  reached.delete('');
  expect([...reached], 'Tab reaches nothing inside the diagram').toEqual([]);

  const before = [await getJson(page, `/api/pipeline?month=${sepIso}`), await getJson(page, `/api/budget?month=${sepIso}`)];
  const box = await w.s.sourcesApi();
  await w.s.amountStep(box.find((x) => x.name === 'Fund payout')!.boxId, w.needs.id, 500);
  await w.s.subsection(w.needs.id, 'Gym', 7000);
  await putRest(page, w.needs.id, { shares: [{ sectionId: null, basisPoints: 10000 }], overspent: 'section' });
  const after = [await getJson(page, `/api/pipeline?month=${sepIso}`), await getJson(page, `/api/budget?month=${sepIso}`)];
  expect(after).toEqual(before);
  expect(before[0].closed).toBe(true);
  expect(before[1].closed).toBe(true);
  await gotoPipeline(page, sepIso);
  await expect(node(page, 'Needs')).toContainText('1,000.00');
});

// ============ criterion 13: the income dialog ============
test('the leftovers source is not offered as a chip in the income dialog', async ({ page, me }) => {
  await seedExample(page, me.seed);
  await closeApi(page);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).first().click();
  const d = dialog(page);
  await expect(group(d, 'Source')).toBeVisible();
  await expect(chip(d, 'Source', 'Paycheck')).toBeVisible();
  await expect(chip(d, 'Source', 'Fund payout')).toBeVisible();
  await expect(group(d, 'Source').getByRole('radio', { name: /leftovers/i })).toHaveCount(0);
  await expect(d.getByText(LEFTOVERS)).toHaveCount(0);
});

// ============ criterion 14: width and keyboard ============
test.describe('1024px wide', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  test('neither page scrolls sideways, the Pipeline page\'s frame may', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await closeApi(page);
    await page.goto('/budget');
    await expect(row(page, /Food/)).toBeVisible();
    expect(await noSideScroll(page), 'Budget').toBe(true);
    await gotoPipeline(page);
    await expect(node(page, 'Needs')).toBeVisible();
    expect(await noSideScroll(page), 'Pipeline').toBe(true);
    await expect(page.locator('.ty-pipe-frame')).toHaveCount(1);
    await page.goto(budgetUrl(sepIso));
    expect(await noSideScroll(page), 'Budget, closed month').toBe(true);
    await gotoPipeline(page, sepIso);
    expect(await noSideScroll(page), 'Pipeline, closed month').toBe(true);
  });

  const ring = (page: Page) => page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const cs = getComputedStyle(e);
    return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 50), style: cs.outlineStyle, width: cs.outlineWidth };
  });

  test('Tab reaches the notice buttons and every rest group, each with the focus ring', async ({ page, me }) => {
    await seedExample(page, me.seed);
    await page.goto('/budget');
    await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      const f = await ring(page);
      if (f.name === CLOSE_BTN) {
        found = true;
        expect(f.style).toBe('solid');
        expect(f.width).toBe('2px');
      }
    }
    expect(found, `Tab reached "${CLOSE_BTN}"`).toBe(true);

    await closeApi(page);
    await page.goto(budgetUrl(sepIso));
    await expect(notices(page).filter({ hasText: CLOSED_NOTICE })).toBeVisible();
    found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      const f = await ring(page);
      if (f.name === 'Reopen') {
        found = true;
        expect(f.style).toBe('solid');
        expect(f.width).toBe('2px');
      }
    }
    expect(found, 'Tab reached "Reopen"').toBe(true);

    await gotoPipeline(page);
    const groups = new Set<string>();
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press('Tab');
      const f = await ring(page);
      if (/^Rest of (Needs|Wants|Savings): /.test(f.name)) {
        groups.add(f.name.split(':')[0]);
        expect(f.style, `${f.name}: ring style`).toBe('solid');
        expect(f.width, `${f.name}: ring width`).toBe('2px');
      }
    }
    expect([...groups].sort()).toEqual(['Rest of Needs', 'Rest of Savings', 'Rest of Wants']);
  });
});

// ============ criterion 15: deleting a section a rest rule uses ============
test('deleting a section that only a rest rule uses shows the new sentence in the dialog', async ({ page, me }) => {
  const a = await me.seed.section('Home');
  const b = await me.seed.section('Fun');
  await putRest(page, a.id, { shares: [{ sectionId: b.id, basisPoints: 10000 }], overspent: 'income' });
  await page.goto('/budget');
  await bsection(page, 'Fun').getByRole('button', { name: 'Edit', exact: true }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(d.getByText(USED_IN_PIPELINE)).toBeVisible();
  await expect(d).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bsection(page, 'Fun')).toBeVisible();
});

// ============ screenshots (criterion 18) ============
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`screenshots, ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    const snap = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `screenshots/${name}.png` }); };

    test('desktop', async ({ page, me }) => {
      await seedExample(page, me.seed);
      await page.goto('/budget');
      await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
      await snap(page, `spec09-budget-reminder-desktop-${scheme}`);
      const d = await openCloseDialog(page);
      await expect(d.locator('.ty-restrow')).toHaveCount(5);
      await snap(page, `spec09-close-dialog-desktop-${scheme}`);
      await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
      await expect(d).toBeHidden();
      await page.goto(budgetUrl(sepIso));
      await expect(titlePill(page)).toHaveText('Closed');
      await snap(page, `spec09-budget-closed-desktop-${scheme}`);
      await page.goto('/budget');
      await expect(row(page, /Food/)).toContainText('from');
      await snap(page, `spec09-budget-after-close-desktop-${scheme}`);
      await gotoPipeline(page);
      await expect(node(page, `Savings, ${novName}`)).toBeVisible();
      await snap(page, `spec09-pipeline-desktop-${scheme}`);
      await gotoPipeline(page, sepIso);
      await expect(titlePill(page)).toHaveText('Closed');
      await snap(page, `spec09-pipeline-closed-desktop-${scheme}`);
      await gotoPipeline(page);
      await page.getByRole('button', { name: /^Rest of Needs: / }).click();
      await expect(dialog(page).getByRole('heading', { name: 'Rest of Needs' })).toBeVisible();
      await snap(page, `spec09-rest-dialog-desktop-${scheme}`);
    });

    test.describe('phone', () => {
      test.use({ viewport: phone });
      test('budget with the reminder, the close dialog and a closed month', async ({ page, me }) => {
        await seedExample(page, me.seed);
        await page.goto('/budget');
        await expect(notices(page).filter({ hasText: REMINDER })).toBeVisible();
        await snap(page, `spec09-budget-reminder-phone-${scheme}`);
        const d = await openCloseDialog(page);
        await snap(page, `spec09-close-dialog-phone-${scheme}`);
        await d.getByRole('button', { name: CLOSE_BTN, exact: true }).click();
        await expect(d).toBeHidden();
        await page.goto(budgetUrl(sepIso));
        await expect(notices(page).filter({ hasText: CLOSED_NOTICE })).toBeVisible();
        await snap(page, `spec09-budget-closed-phone-${scheme}`);
      });
    });
  });
}
