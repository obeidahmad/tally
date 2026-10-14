import { test, expect, dialog, toast, shot, row, selectLike, type Seed } from '../support/fixtures';
import { MINUS, octIso, octTitle, sepIso, seedExample, closeApi, bsection, getJson, norm } from '../support/closing';
import type { Page, Locator } from '@playwright/test';

// Spec 13: moving money. Browser acceptance criteria 2 to 5.
const desktop = { width: 1280, height: 900 };
const phone = { width: 390, height: 844 };
test.use({ viewport: desktop });

const note = (r: Locator) => r.locator('.ty-brow__title .ty-cap');
const movesApi = async (page: Page, month = octIso) => (await getJson(page, `/api/moves?month=${month}`)).moves as { id: number; reason: string; amountMinor: number }[];
const MOVE_BTN = 'Move money';

/** Savings receives 2,700.00: Emergencies (goal, target 3,000.00, budget 2,400.00), Car (goal, budget 300.00) and Empty (budget 0). */
async function seedSavings(page: Page, s: Seed) {
  const savings = await s.section('Savings');
  const pocket = await s.pocket('Revolut', 0);
  const src = await s.source('Paycheck');
  await s.income(pocket.id, 270000, src.id);
  await s.amountStep(src.boxId, savings.id, 270000);
  const post = async (body: object) => {
    const r = await page.request.post(`/api/sections/${savings.id}/subsections`, { data: body });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return (await r.json()).subsection as { id: number };
  };
  const emergencies = await post({ name: 'Emergencies', kind: 'goal', budgetMinor: 240000, keep: 'cap', capMinor: 300000 });
  const car = await post({ name: 'Car', kind: 'goal', budgetMinor: 30000, keep: 'cap', capMinor: 1500000 });
  const empty = await post({ name: 'Empty', budgetMinor: 0 });
  return { savings, emergencies, car, empty, src, pocket };
}
const addMove = async (page: Page, body: object) => {
  const r = await page.request.post('/api/moves', { data: body });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).move as { id: number };
};
const openMoveFromSub = async (page: Page, name: RegExp | string) => {
  await page.goto('/budget');
  await row(page, name).click();
  const d = dialog(page);
  await d.getByRole('button', { name: MOVE_BTN, exact: true }).click();
  await expect(d.getByRole('heading', { name: `Move money in ${octTitle}` })).toBeVisible();
  return d;
};
const fromTo = (d: Locator) => ({ from: d.getByLabel('From', { exact: true }), to: d.getByLabel('To', { exact: true }) });

// ============ criterion 2 ============
test('"Move money" in Emergencies\' dialog opens the move dialog with From on Emergencies and the spec\'s words', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  const d = await openMoveFromSub(page, /Emergencies/);
  await expect(d.getByText('Moving money changes your plan for the month. Do it when you have to, and say why.')).toBeVisible();
  await expect(d.getByText('Moving money changes your plan for the month. Do it when you have to, and say why.')).toHaveClass(/ty-cap/);
  const { from, to } = fromTo(d);
  await expect(from.locator('option:checked')).toContainText('Emergencies');
  await expect(d.getByLabel('Amount', { exact: true })).toBeVisible();
  await expect(d.getByText('EUR').first()).toBeVisible();
  await expect(d.getByLabel('Why', { exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Move', exact: true })).toBeVisible();
  // options: per section "Rest of Savings" first, then its subsections by position
  const labels = (await to.locator('option').allTextContents()).map((t) => t.trim());
  const at = ['Rest of Savings', 'Emergencies', 'Car', 'Empty'].map((n) => labels.findIndex((l) => l.includes(n)));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join(), JSON.stringify(labels)).toBe(true);
});

test('moving 200.00 from Emergencies to Car shows 2,200.00 and 500.00, their notes and the move in "Moved this month"', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  const d = await openMoveFromSub(page, /Emergencies/);
  await selectLike(fromTo(d).to, 'Car');
  await d.getByLabel('Amount', { exact: true }).fill('200');
  await d.getByLabel('Why', { exact: true }).fill('Car repair');
  await expect(d.getByText('Emergencies has 2,400.00. After the move: 2,200.00.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Move 200.00', exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Move 200.00', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Moved 200.00');
  await expect(row(page, /Emergencies/)).toContainText('2,200.00');
  await expect(row(page, /Car/)).toContainText('500.00');
  await expect(note(row(page, /Emergencies/))).toContainText(`${MINUS}200.00 moved`);
  await expect(note(row(page, /Car/))).toContainText('+200.00 moved');
  await expect(page.getByText('Moved this month', { exact: true })).toBeVisible();
  await expect(page.getByText('200.00 from Emergencies to Car', { exact: true })).toBeVisible();
  await expect(page.getByText('Car repair', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  const moves = await movesApi(page);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({ amountMinor: 20000, reason: 'Car repair' });
});

test('the move survives a reload, and the card is absent when the month has no moves', async ({ page, me }) => {
  const s = await seedSavings(page, me.seed);
  await page.goto('/budget');
  await expect(row(page, /Emergencies/)).toBeVisible();
  await expect(page.getByText('Moved this month', { exact: true })).toHaveCount(0);
  await expect(note(row(page, /Emergencies/))).not.toContainText('moved');
  await addMove(page, { month: octIso, from: { subsectionId: s.emergencies.id }, to: { subsectionId: s.car.id }, amountMinor: 20000, reason: 'Car repair' });
  await page.reload();
  await expect(row(page, /Emergencies/)).toContainText('2,200.00');
  await expect(page.getByText('200.00 from Emergencies to Car', { exact: true })).toBeVisible();
});

test('the section dialog has "Move money" with From on the section\'s rest, and the money lands on a subsection', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  const rent = await me.seed.subsection(s.id, 'Rent', 60000);
  const pocket = await me.seed.pocket('Revolut', 0);
  const src = await me.seed.source('Paycheck');
  await me.seed.income(pocket.id, 100000, src.id);
  await me.seed.amountStep(src.boxId, s.id, 100000); // rest 400.00
  await page.goto('/budget');
  await bsection(page, 'Needs').getByRole('button', { name: 'Edit', exact: true }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: MOVE_BTN, exact: true }).click();
  await expect(d.getByRole('heading', { name: `Move money in ${octTitle}` })).toBeVisible();
  const { from, to } = fromTo(d);
  await expect(from.locator('option:checked')).toContainText('Rest of Needs');
  await selectLike(to, 'Rent');
  await d.getByLabel('Amount', { exact: true }).fill('100');
  await d.getByLabel('Why', { exact: true }).fill('Rent went up');
  await d.getByRole('button', { name: 'Move 100.00', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Moved 100.00');
  await expect(row(page, /Rent/)).toContainText('700.00');
  await expect(note(row(page, /Rent/))).toContainText('+100.00 moved');
  await expect(bsection(page, 'Needs')).toContainText(`${MINUS}100.00 moved`);
  await expect(page.getByText('100.00 from Rest of Needs to Rent', { exact: true })).toBeVisible();
  const moves = await movesApi(page);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({ amountMinor: 10000 });
  expect(rent.id).toBeGreaterThan(0);
});

// ============ criterion 3 ============
test('an empty reason, too much and the same place twice are refused with their sentences, and nothing moves', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  const d = await openMoveFromSub(page, /Emergencies/);
  const { to } = fromTo(d);
  const go = d.getByRole('button', { name: /^Move/ });

  // empty reason
  await selectLike(to, 'Car');
  await d.getByLabel('Amount', { exact: true }).fill('200');
  await go.click();
  await expect(d.getByText('Say why you are moving this money.')).toBeVisible();
  await expect(d).toBeVisible();

  // more than is available
  await d.getByLabel('Why', { exact: true }).fill('Because');
  await d.getByLabel('Amount', { exact: true }).fill('3000');
  await go.click();
  await expect(d.getByText('Emergencies has only 2,400.00 to move.')).toBeVisible();
  await expect(d).toBeVisible();

  // no amount
  await d.getByLabel('Amount', { exact: true }).fill('');
  await go.click();
  await expect(d.getByText('Enter an amount above zero.')).toBeVisible();

  // the same place twice
  await d.getByLabel('Amount', { exact: true }).fill('200');
  await selectLike(to, 'Emergencies');
  await go.click();
  await expect(d.getByText('Choose a different place.')).toBeVisible();
  await expect(d).toBeVisible();

  expect(await movesApi(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(row(page, /Emergencies/)).toContainText('2,400.00');
  await expect(row(page, /Car/)).toContainText('300.00');
  await expect(page.getByText('Moved this month', { exact: true })).toHaveCount(0);
});

test('a place with nothing available says "<name> has nothing to move."', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  const d = await openMoveFromSub(page, /Empty/);
  await selectLike(fromTo(d).to, 'Car');
  await d.getByLabel('Amount', { exact: true }).fill('10');
  await d.getByLabel('Why', { exact: true }).fill('Hope');
  await d.getByRole('button', { name: /^Move/ }).click();
  await expect(d.getByText('Empty has nothing to move.')).toBeVisible();
  expect(await movesApi(page)).toEqual([]);
});

// ============ criterion 4 ============
test('"Undo" on the move puts both figures back and removes the card', async ({ page, me }) => {
  const s = await seedSavings(page, me.seed);
  await addMove(page, { month: octIso, from: { subsectionId: s.emergencies.id }, to: { subsectionId: s.car.id }, amountMinor: 20000, reason: 'Car repair' });
  await page.goto('/budget');
  await expect(row(page, /Emergencies/)).toContainText('2,200.00');
  await expect(row(page, /Car/)).toContainText('500.00');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row(page, /Emergencies/)).toContainText('2,400.00');
  await expect(row(page, /Car/)).toContainText('300.00');
  await expect(note(row(page, /Emergencies/))).not.toContainText('moved');
  await expect(note(row(page, /Car/))).not.toContainText('moved');
  await expect(page.getByText('Moved this month', { exact: true })).toHaveCount(0);
  expect(await movesApi(page)).toEqual([]);
});

// ============ criterion 5 ============
test('a closed month shows no "Move money" and no "Undo", and refuses a move with the closed sentence', async ({ page, me }) => {
  const ex = await seedExample(page, me.seed);
  // Food has 49.99 left in the month, Rent 0.00; move 20.00 from Food to Rent while September is open.
  await addMove(page, { month: sepIso, from: { subsectionId: ex.food.id }, to: { subsectionId: ex.rent.id }, amountMinor: 2000, reason: 'Rent is short' });
  await closeApi(page, sepIso);
  await page.goto(`/budget?month=${sepIso}`);
  await expect(page.getByText('Moved this month', { exact: true })).toBeVisible();
  await expect(page.getByText('20.00 from Food to Rent', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);

  // Rows and sections of a closed month cannot be opened, so no dialog can offer "Move money".
  await expect(page.getByRole("button", { name: MOVE_BTN })).toHaveCount(0);
  await expect(row(page, /Food/)).toHaveCount(0);

  const r = await page.request.post('/api/moves', { data: { month: sepIso, from: { subsectionId: ex.food.id }, to: { subsectionId: ex.rent.id }, amountMinor: 100, reason: 'Late' } });
  expect(r.status()).toBe(409);
  expect(norm(await r.text())).toContain('This month is closed. Reopen it to change it.');
  expect(await movesApi(page, sepIso)).toHaveLength(1);
});

test('an open month does show "Move money" in both dialogs', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  await page.goto('/budget');
  await row(page, /Car/).click();
  await expect(dialog(page).getByRole('button', { name: MOVE_BTN, exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await bsection(page, 'Savings').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: MOVE_BTN, exact: true })).toBeVisible();
});

test('a person cannot see another person\'s moves', async ({ page, me }) => {
  const s = await seedSavings(page, me.seed);
  await addMove(page, { month: octIso, from: { subsectionId: s.emergencies.id }, to: { subsectionId: s.car.id }, amountMinor: 20000, reason: 'Car repair' });
  const r = await page.request.get(`/api/moves?month=${octIso}`);
  expect((await r.json()).moves).toHaveLength(1);
  await page.context().clearCookies();
  const anon = await page.request.get(`/api/moves?month=${octIso}`);
  expect(anon.status()).toBe(401);
});

// ============ screenshots, criterion 7 ============
for (const scheme of ['light', 'dark'] as const) {
  for (const [size, viewport] of [['desktop', desktop], ['phone', phone]] as const) {
    test.describe(`screenshots, ${size} ${scheme}`, () => {
      test.use({ colorScheme: scheme, viewport });
      const tag = `${size}-${scheme}`;

      test('the move dialog and the Budget page with a move', async ({ page, me }) => {
        const s = await seedSavings(page, me.seed);
        const d = await openMoveFromSub(page, /Emergencies/);
        await selectLike(fromTo(d).to, 'Car');
        await d.getByLabel('Amount', { exact: true }).fill('200');
        await d.getByLabel('Why', { exact: true }).fill('Car repair');
        await expect(d.getByText('After the move: 2,200.00.', { exact: false })).toBeVisible();
        await shot(page, `spec13-dialog-move-${tag}`);
        await d.getByRole('button', { name: 'Move 200.00', exact: true }).click();
        await expect(d).toBeHidden();
        await expect(page.getByText('200.00 from Emergencies to Car', { exact: true })).toBeVisible();
        await page.waitForTimeout(3500); // let the toast go
        await page.getByText('Moved this month', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `screenshots/spec13-budget-moved-${tag}.png`, fullPage: true });
        expect(s.car.id).toBeGreaterThan(0);
      });
    });
  }
}

// Reviewer's point: a section mixing goals and a spending subsection uses the Budgeted, Spent and Available columns, not the goal layout.
test('in Savings (goals and a spending subsection) a goal row shows its "fills to" note under Budgeted, Spent and Available', async ({ page, me }) => {
  await seedSavings(page, me.seed);
  await page.goto('/budget');
  const sec = bsection(page, 'Savings');
  const tots = sec.locator('.ty-shead__tot .ty-label');
  await expect(tots).toHaveText(['Budgeted', 'Spent', 'Available']);
  await expect(sec).not.toContainText('This month');
  await expect(sec).not.toContainText('Saved');
  await expect(sec).not.toContainText('Target');
  await expect(note(row(page, /Emergencies/))).toHaveText('fills to 3,000.00');
  await expect(note(row(page, /Car/))).toHaveText('fills to 15,000.00');
  await expect(row(page, /Emergencies/).locator('.ty-meter')).not.toHaveClass(/ty-meter--goal/);
});
