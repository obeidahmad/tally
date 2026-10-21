import { test, expect, dialog, chip, shot, seedPipeline } from '../support/fixtures';
import type { Page } from '@playwright/test';

// Spec 08: "Add income source". Browser acceptance criteria 2 to 7 and the screenshots of 8.
test.use({ viewport: { width: 1280, height: 900 } });

const NO_SOURCE = 'No income sources yet. A source is where money comes from, such as a paycheck.';
const named = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function gotoPipeline(page: Page) {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeVisible();
}

test('the title row has a primary "Add income source" button and no button named "Add source"', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await gotoPipeline(page);
  const add = named(page, 'Add income source');
  await expect(add).toHaveCount(1);
  await expect(add).toHaveClass(/ty-btn--primary/);
  await expect(named(page, 'Add source')).toHaveCount(0);
});

test('with no source the card shows "Add income source" too, and no "Add source"', async ({ page, me }) => {
  await gotoPipeline(page);
  const text = page.getByText(NO_SOURCE);
  await expect(text).toBeVisible();
  await expect(named(page, 'Add source')).toHaveCount(0);
  const adds = named(page, 'Add income source');
  await expect(adds).toHaveCount(2); // title row and card
  const card = await adds.last().boundingBox();
  const t = await text.boundingBox();
  expect(card!.y, 'the card button is under the sentence').toBeGreaterThan(t!.y);
});

for (const which of ['title row', 'card'] as const) {
  test(`the ${which} button opens "Add income source" whose primary button creates the source`, async ({ page, me }) => {
    if (which === 'title row') await me.seed.source('Fund payout');
    await gotoPipeline(page);
    const adds = named(page, 'Add income source');
    await (which === 'title row' ? adds.first() : adds.last()).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Add income source', exact: true })).toBeVisible();
    const primary = d.getByRole('button', { name: 'Add income source', exact: true });
    await expect(primary).toHaveClass(/ty-btn--primary/);
    await expect(d.getByRole('button', { name: 'Add source', exact: true })).toHaveCount(0);
    await d.getByLabel('Name', { exact: true }).fill('Paycheck');
    await primary.click();
    await expect(d).toBeHidden();
    expect((await me.seed.sourcesApi()).map((s) => s.name)).toContain('Paycheck');
  });
}

test('"Edit" on a source opens "Edit income source" with "Save" as its primary button', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await gotoPipeline(page);
  await page.locator('.ty-node').filter({ hasText: 'Paycheck' }).getByRole('button', { name: 'Edit', exact: true }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit income source', exact: true })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Save', exact: true })).toHaveClass(/ty-btn--primary/);
});

test('the income dialog still has the chip "+ Add source" and the field "Source name"', async ({ page, me }) => {
  await me.seed.source('Paycheck');
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add income', exact: true }).click();
  const d = dialog(page);
  const c = chip(d, 'Source', '+ Add source');
  await expect(c).toBeVisible();
  await c.check();
  await expect(d.getByLabel('Source name')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Add income source' })).toHaveCount(0);
});

test('at 1024px the page does not scroll sideways and the title row buttons share one line', async ({ page, me }) => {
  await seedPipeline(me.seed);
  await page.setViewportSize({ width: 1024, height: 800 });
  await gotoPipeline(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const a = (await named(page, 'Add section').boundingBox())!;
  const b = (await named(page, 'Add income source').boundingBox())!;
  expect(Math.abs(a.y - b.y), 'same line').toBeLessThanOrEqual(2);
  expect(b.height, 'label not wrapped').toBeLessThan(60);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`screenshots ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test('Pipeline page with the worked example, and the source dialog when adding', async ({ page, me }) => {
      await seedPipeline(me.seed);
      await gotoPipeline(page);
      await expect(named(page, 'Add income source')).toBeVisible();
      await shot(page, `spec08-pipeline-desktop-${scheme}`);
      await named(page, 'Add income source').click();
      await expect(dialog(page).getByRole('heading', { name: 'Add income source' })).toBeVisible();
      await shot(page, `spec08-source-dialog-add-desktop-${scheme}`);
    });
  });
}
