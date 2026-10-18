import { test, expect, dialog, toast, row, chip, group, shot, pocketsApi, srow } from '../support/fixtures';
import { openCloseDialog, closeApi, sepDay, stat, notices } from '../support/closing';
import {
  seedImport, rulesApi, unsortedApi, chooseNeedsSorting, sortedPills, importFile, toMapping, sel, checkedText, csv, day1, SORT_MSG, UNSORTED_CLOSE,
} from '../support/importing';

// Spec 15: statement import and rules. Browser acceptance criteria 2 to 7 (fixtures in e2e/fixtures).
const SUMMARY6 = 'Added 6 transactions.';
const phone = { width: 390, height: 844 };

// ============ criterion 2: a semicolon file, guessed, imported ============
test('step two shows the first five rows and a correct guess for a semicolon file with DD.MM.YYYY dates and a comma decimal', async ({ page, me }) => {
  await seedImport(me.seed);
  const d = await toMapping(page, 'lidl-semicolon.csv');
  const table = d.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Date', 'Description', 'Amount', 'Reference']);
  await expect(table.getByRole('row')).toHaveCount(6); // header + 5 of the 7 data rows
  await expect(table.getByText('Netflix')).toBeVisible();
  await expect(table.getByText('ACME Salary')).toHaveCount(0);
  await expect(checkedText(sel(d, 'Date'))).toHaveText('Date');
  await expect(checkedText(sel(d, 'Date format'))).toHaveText(/DD\.MM\.YYYY/);
  await expect(checkedText(sel(d, 'Amount'))).toHaveText('Amount');
  await expect(checkedText(sel(d, 'Payee'))).toHaveText('Description');
  await expect(checkedText(sel(d, 'Note (optional)'))).toHaveText('Reference');
  await expect(checkedText(sel(d, 'Decimal mark'))).toHaveText(',');
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
});

test('importing it shows the summary sentences, then "Done" leaves the six rows in the list as "From a statement"', async ({ page, me }) => {
  await seedImport(me.seed);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await expect(d).toContainText(SUMMARY6);
  await expect(d).not.toContainText('already here');
  await expect(d).not.toContainText('closed month');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /LIDL Limassol.*23\.50/)).toContainText('From a statement');
  await expect(row(page, /Netflix/)).toContainText('From a statement');
  await expect(row(page, /ACME Salary/)).toContainText('2,000.00');
  await expect(row(page, /Bank fee/)).toHaveCount(0); // a zero row is skipped
  await expect(row(page, /Netflix/)).not.toContainText('Entered by hand');
  // the pocket balance counts all of it: 2,000.00 less 61.79
  expect((await pocketsApi(page))[0].balanceMinor).toBe(193821);
});

test('a tab file with debit and credit columns and a quoted payee with a comma imports through "Separate debit and credit columns"', async ({ page, me }) => {
  await seedImport(me.seed);
  const d = await toMapping(page, 'debit-credit-tab.csv');
  await expect(checkedText(sel(d, 'Amount'))).toHaveText('Separate debit and credit columns');
  await expect(checkedText(sel(d, 'Debit'))).toHaveText('Debit');
  await expect(checkedText(sel(d, 'Credit'))).toHaveText('Credit');
  await expect(checkedText(sel(d, 'Payee'))).toHaveText('Merchant');
  await expect(checkedText(sel(d, 'Decimal mark'))).toHaveText('.');
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(d).toContainText('Added 2 transactions.');
  await expect(d).toContainText('2 need a subsection or source.');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(row(page, /Cafe Nero, Limassol/)).toContainText('4.50');
  await expect(row(page, /Refund Shop/)).toContainText('12.00');
  expect((await pocketsApi(page))[0].balanceMinor).toBe(750);
});

test('a file that is not a CSV statement is refused in step one with the server\'s sentence', async ({ page, me }) => {
  await seedImport(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Import a statement', exact: true }).first().click();
  const d = dialog(page);
  await chip(d, 'Pocket', 'Revolut').check();
  await d.getByLabel('File').setInputFiles(csv('broken.csv'));
  await d.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(d.getByText('This file does not look like a CSV statement.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
});

test('a mapping that cannot read a row stops the import with its sentence and saves nothing', async ({ page, me }) => {
  await seedImport(me.seed);
  const d = await toMapping(page, 'lidl-semicolon.csv');
  await sel(d, 'Date').selectOption({ label: 'Description' }); // text where a date should be
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(d.getByText(/^Row \d+ has a date or amount this mapping cannot read\.$/)).toBeVisible();
  await expect(d).not.toContainText('Added');
  expect((await unsortedApi(page)).length).toBe(0);
});

// ============ criterion 3: importing the same file again ============
test('importing the same file again adds nothing and says how many were already here', async ({ page, me }) => {
  await seedImport(me.seed);
  let d = await importFile(page, 'lidl-semicolon.csv');
  await expect(d).toContainText(SUMMARY6);
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  d = await importFile(page, 'lidl-semicolon.csv');
  await expect(d).toContainText('6 were already here.');
  await expect(d).not.toContainText('Added');
  await expect(d).not.toContainText('need a subsection or source');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await unsortedApi(page)).length).toBe(6);
  await expect(row(page, /Netflix/)).toHaveCount(1);
});

test('rows that match hand-entered transactions of the pocket (same date, amount, payee) count as already here', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await me.seed.expense(w.pocket.id, w.food.id, 1399, 'Netflix', day1);
  await me.seed.expense(w.pocket.id, w.food.id, 420, 'Kiosk Larnaca', day1);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await expect(d).toContainText('Added 4 transactions.');
  await expect(d).toContainText('2 were already here.');
  await expect(d).toContainText('4 need a subsection or source.');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(row(page, /Netflix/)).toHaveCount(1);
  await expect(row(page, /Netflix/)).not.toContainText('Entered by hand');
});

test('rows dated in a closed month are skipped and the summary says how many were in a closed month', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await me.seed.expense(w.pocket.id, w.food.id, 1000, 'Hand entered', sepDay(3));
  await closeApi(page);
  const d = await importFile(page, 'last-month-semicolon.csv');
  await expect(d).toContainText('2 were in a closed month.');
  await expect(d).not.toContainText('Added');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await unsortedApi(page)).length).toBe(0);
});

// ============ criterion 4: rules ============
test('a rule "LIDL → Food" made before importing sorts the LIDL rows; the others need sorting', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await rulesApi(page, { match: 'LIDL', subsectionId: w.food.id });
  const d = await importFile(page, 'lidl-semicolon.csv');
  await expect(d).toContainText('Added 6 transactions.');
  await expect(d).toContainText('3 need a subsection or source.');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  for (const amount of ['23.50', '11.20', '8.90']) {
    await expect(row(page, new RegExp(`LIDL Limassol.*${amount.replace('.', '\\.')}`))).toContainText('Food');
    await expect(sortedPills(row(page, new RegExp(`LIDL Limassol.*${amount.replace('.', '\\.')}`)))).toHaveCount(0);
  }
  await expect(sortedPills(page)).toHaveCount(3);
  await expect(sortedPills(row(page, /Netflix/))).toHaveCount(1);
  expect((await unsortedApi(page)).map((t) => t.payee).sort()).toEqual(['ACME Salary', 'Kiosk Larnaca', 'Netflix']);
});

test('choosing a subsection and ticking "Always use this for LIDL Limassol" creates a rule on save; the toast says how many others were sorted', async ({ page, me }) => {
  await seedImport(me.seed);
  const d0 = await importFile(page, 'lidl-semicolon.csv');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();
  await row(page, /LIDL Limassol.*23\.50/).click();
  const d = dialog(page);
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await d.getByRole('checkbox', { name: 'Always use this for LIDL Limassol' }).check();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved. 2 more sorted.');
  await expect(sortedPills(page)).toHaveCount(3);
  await expect(sortedPills(row(page, /LIDL Limassol/))).toHaveCount(0);
  await expect(row(page, /LIDL Limassol.*8\.90/)).toContainText('Food');
  const rules = (await (await page.request.get('/api/rules')).json()).rules as { match: string }[];
  expect(rules.map((r) => r.match)).toEqual(['LIDL Limassol']);
});

test('without the checkbox, saving a chosen subsection sorts only that transaction and makes no rule', async ({ page, me }) => {
  await seedImport(me.seed);
  const d0 = await importFile(page, 'lidl-semicolon.csv');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();
  await row(page, /Netflix/).click();
  const d = dialog(page);
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await expect(d.getByRole('checkbox', { name: 'Always use this for Netflix' })).not.toBeChecked();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(sortedPills(page)).toHaveCount(5);
  expect(((await (await page.request.get('/api/rules')).json()).rules as unknown[]).length).toBe(0);
});

test('Settings > Rules: "Add rule" makes a rule that sorts waiting rows, its row reads "Payee contains \'LIDL\' → Food", and "Delete" removes it', async ({ page, me }) => {
  await seedImport(me.seed);
  const d0 = await importFile(page, 'lidl-semicolon.csv');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  const d = dialog(page);
  await expect(d.getByLabel('Payee contains')).toBeVisible();
  await expect(group(d, 'Put in').getByRole('radio').or(group(d, 'Put in').getByRole('button'))).toHaveCount(2);
  // refused: no text, then no subsection
  const save = d.getByRole('button', { name: /^(Add rule|Save)$/ });
  await save.click();
  await expect(d.getByText('Choose a subsection or a source.')).toBeVisible();
  await d.getByLabel('Payee contains').fill('LIDL');
  await save.click();
  await expect(d.getByText('Choose a subsection or a source.')).toBeVisible();
  await expect(d).toBeVisible();
  await d.getByLabel('Payee contains').fill('');
  await d.getByRole('combobox').selectOption({ label: 'Food' });
  await save.click();
  await expect(d.getByText('Enter the text to look for.')).toBeVisible();
  await d.getByLabel('Payee contains').fill('LIDL');
  await save.click();
  await expect(d).toBeHidden();
  const line = page.getByText(/Payee contains .LIDL. → Food/);
  await expect(line).toBeVisible();

  await page.goto('/transactions');
  await expect(sortedPills(page)).toHaveCount(3);
  await expect(row(page, /LIDL Limassol.*23\.50/)).toContainText('Food');

  await page.goto('/settings');
  await expect(line).toBeVisible();
  await line.locator('xpath=ancestor::*[.//button[normalize-space()="Delete"]][1]').getByRole('button', { name: 'Delete' }).click();
  await expect(line).toHaveCount(0);
  expect(((await (await page.request.get('/api/rules')).json()).rules as unknown[]).length).toBe(0);
});

test('a rule for a source sorts an imported income', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  const d0 = await importFile(page, 'lidl-semicolon.csv');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();
  const r = await rulesApi(page, { match: 'acme', sourceId: w.paycheck.id }); // ignoring case
  expect(r.sorted).toBe(1);
  await page.reload();
  await expect(sortedPills(page)).toHaveCount(5);
  await expect(row(page, /Paycheck.*2,000.00/)).toContainText(/from a statement/i);
});

// ============ criterion 5: rows needing sorting ============
test('rows needing sorting show the "Needs sorting" Pill, and the "Needs sorting" filter lists only them, with the count', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await me.seed.expense(w.pocket.id, w.food.id, 999, 'Hand entered coffee', day1);
  await page.reload();
  await expect(sortedPills(page)).toHaveCount(6);
  await expect(sortedPills(page).first()).toHaveClass(/ty-pill--warning/);
  await expect(row(page, /Hand entered coffee/)).not.toContainText('Entered by hand');
  await expect(row(page, /Hand entered coffee/)).toContainText('Food');
  await rulesApi(page, { match: 'LIDL Limassol', subsectionId: w.food.id }); // 3 sorted, 3 left
  await page.reload();
  const control = await chooseNeedsSorting(page);
  if ((await control.evaluate((e) => e.tagName)) === "INPUT") await expect(control).toHaveAccessibleName(/\b3\b/); else await expect(control).toContainText(/\b3\b/); // a checkbox chip carries its count in its name
  await expect(row(page, /Netflix/)).toBeVisible();
  await expect(row(page, /Kiosk Larnaca/)).toBeVisible();
  await expect(row(page, /ACME Salary/)).toBeVisible();
  await expect(row(page, /LIDL Limassol/)).toHaveCount(0);
  await expect(row(page, /Hand entered coffee/)).toHaveCount(0);
});

test('the Budget page shows the notice and its "Sort them" link opens the Transactions page on "Needs sorting"', async ({ page, me }) => {
  await seedImport(me.seed);
  await page.goto('/budget');
  await expect(page.getByText(SORT_MSG)).toHaveCount(0);
  const d = await importFile(page, 'lidl-semicolon.csv');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('/budget');
  const n = notices(page).filter({ hasText: SORT_MSG });
  await expect(n).toHaveText(new RegExp(`^6 ${SORT_MSG.replace(/\./g, '\\.')}\\s*Sort them$`));
  await n.getByRole('link', { name: 'Sort them', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await expect(sortedPills(page)).toHaveCount(6);
});

test('unsorted transactions count in no budget figure until sorted; the pocket balance counts them', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();
  const foodBefore = (await srow(page, /Food/).innerText()).replace(/\s+/g, ' ');
  const incomeBefore = (await stat(page, 'Income').innerText()).replace(/\s+/g, ' ');
  const d = await importFile(page, 'lidl-semicolon.csv');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('/budget');
  expect((await srow(page, /Food/).innerText()).replace(/\s+/g, ' ')).toBe(foodBefore);
  expect((await stat(page, 'Income').innerText()).replace(/\s+/g, ' ')).toBe(incomeBefore);
  await expect(page.getByText('2,000.00')).toHaveCount(0);
  expect((await pocketsApi(page))[0].balanceMinor).toBe(193821);
  // sorted: the three LIDL rows (43.60) count in Food
  await rulesApi(page, { match: 'LIDL', subsectionId: w.food.id });
  await rulesApi(page, { match: 'ACME', sourceId: w.paycheck.id });
  await page.goto('/budget');
  await expect(srow(page, /Food/)).toContainText('43.60');
  await expect(stat(page, 'Income')).toContainText('2,000.00');
  await expect(page.getByText(SORT_MSG)).toBeVisible(); // Netflix and Kiosk are still waiting
});

// ============ criterion 6: what an imported transaction keeps ============
test('an imported transaction\'s Type, Date, Amount and Pocket are disabled, Payee and Note are not, and the caption says why', async ({ page, me }) => {
  await seedImport(me.seed);
  const d0 = await importFile(page, 'lidl-semicolon.csv');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();
  await row(page, /Netflix/).click();
  const d = dialog(page);
  await expect(d.getByLabel('Date')).toBeDisabled();
  await expect(d.getByLabel('Amount')).toBeDisabled();
  for (const legend of ['Type', 'Pocket']) {
    const radios = group(d, legend).getByRole('radio');
    expect(await radios.count(), legend).toBeGreaterThan(0);
    for (let i = 0; i < (await radios.count()); i++) await expect(radios.nth(i), `${legend} ${i}`).toBeDisabled();
  }
  await expect(d.getByLabel('Payee')).toBeEnabled();
  await expect(d.getByLabel('Note')).toBeEnabled();
  await expect(d.getByLabel('Subsection')).toBeEnabled();
  await expect(d.locator('.ty-cap').filter({ hasText: 'Imported from a statement: only its subsection or source, payee and note can change.' })).toBeVisible();
  await d.getByLabel('Payee').fill('Netflix UK');
  await d.getByLabel('Note').fill('Family plan');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d).toBeHidden();
  await expect(row(page, /Netflix UK/)).toContainText('13.99');
});

test('a hand-entered transaction keeps every field editable and has no imported caption', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  await me.seed.expense(w.pocket.id, w.food.id, 500, 'Corner shop', day1);
  await page.goto('/transactions');
  await row(page, /Corner shop/).click();
  const d = dialog(page);
  await expect(d.getByLabel('Date')).toBeEnabled();
  await expect(d.getByLabel('Amount')).toBeEnabled();
  await expect(d.getByText('Imported from a statement', { exact: false })).toHaveCount(0);
});

// ============ criterion 7: closing with unsorted transactions ============
test('closing a month with unsorted imported transactions shows "Sort this month\'s imported transactions first." in the dialog; once sorted it closes', async ({ page, me }) => {
  const w = await seedImport(me.seed);
  const d0 = await importFile(page, 'last-month-semicolon.csv');
  await expect(d0).toContainText('Added 2 transactions.');
  await expect(d0).toContainText('2 need a subsection or source.');
  await d0.getByRole('button', { name: 'Done', exact: true }).click();
  const d = await openCloseDialog(page);
  const closeBtn = d.getByRole('button', { name: /^Close \w+$/ });
  await closeBtn.click();
  await expect(d.getByText(UNSORTED_CLOSE)).toBeVisible();
  await expect(d).toBeVisible();
  await rulesApi(page, { match: 'Gym', subsectionId: w.food.id });
  await rulesApi(page, { match: 'Refund', sourceId: w.paycheck.id });
  await closeBtn.click();
  await expect(d).toBeHidden();
});

// ============ screenshots ============
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', phone]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`screenshots, ${size} ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      test('import dialog, mapping, summary, Transactions, notice, transaction dialog, rules', async ({ page, me }) => {
        const w = await seedImport(me.seed);
        const tag = `${size}-${scheme}`;
        await page.goto('/transactions');
        await page.getByRole('button', { name: 'Import a statement', exact: true }).first().click();
        await chip(dialog(page), 'Pocket', 'Revolut').check();
        await shot(page, `spec15-import-step1-${tag}`);
        const d = dialog(page);
        await d.getByLabel('File').setInputFiles(csv('lidl-semicolon.csv'));
        await d.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(sel(d, 'Date format')).toBeVisible();
        await shot(page, `spec15-import-mapping-${tag}`);
        await d.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(d).toContainText('Added 6 transactions.');
        await shot(page, `spec15-import-summary-${tag}`);
        await d.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(sortedPills(page).first()).toBeVisible();
        await shot(page, `spec15-transactions-needs-sorting-${tag}`);
        await chooseNeedsSorting(page);
        await shot(page, `spec15-transactions-filter-${tag}`);
        await page.goto('/budget');
        await expect(page.getByText(SORT_MSG)).toBeVisible();
        await shot(page, `spec15-budget-notice-${tag}`);
        await page.goto('/transactions');
        await row(page, /LIDL Limassol.*23\.50/).click();
        await dialog(page).getByLabel('Subsection').selectOption({ label: 'Food' });
        await expect(dialog(page).getByRole('checkbox', { name: 'Always use this for LIDL Limassol' })).toBeVisible();
        await shot(page, `spec15-transaction-dialog-imported-${tag}`);
        await page.keyboard.press('Escape');
        await rulesApi(page, { match: 'Netflix', subsectionId: w.food.id });
        await page.goto('/settings');
        await expect(page.getByText(/Payee contains .Netflix. → Food/)).toBeVisible();
        await shot(page, `spec15-settings-rules-${tag}`);
        await page.getByRole('button', { name: 'Add rule', exact: true }).click();
        await expect(dialog(page).getByLabel('Payee contains')).toBeVisible();
        await shot(page, `spec15-add-rule-dialog-${tag}`);
      });
    });
  }
}
