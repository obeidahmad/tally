import { test, expect, dialog, shot, row, seedBudget, chip } from '../support/fixtures';
import type { Page } from '@playwright/test';

type Focus = { id: string; name: string; inDialog: boolean; isRow: boolean; style: string; width: string; offset: string; color: string };

const focused = (page: Page): Promise<Focus> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    // A chip or emoji radio is invisible; the ring is drawn on its label (design: .ty-chip:has(input:focus-visible)).
    const ringed = (e.matches('input[type=radio]') && e.closest('label')) || e;
    const cs = getComputedStyle(ringed);
    const labelled = (e as HTMLInputElement).labels?.[0]?.textContent;
    const name = e.getAttribute('aria-label') || labelled || e.textContent || e.tagName;
    const all = [...document.querySelectorAll('*')];
    return {
      id: `${e.tagName}#${all.indexOf(e)}`,
      name: name.trim().slice(0, 40),
      inDialog: !!e.closest('dialog'),
      isRow: !!e.closest('tr, [role=row]') || e.matches('.ty-trow'), // a control inside a table row, or a transaction row
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      offset: cs.outlineOffset,
      color: cs.outlineColor,
    };
  });

test('Tab moves through every control of a dialog, each with a visible 2px focus ring, and stays inside it', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await expect(dialog(page)).toBeVisible();

  const visited: Focus[] = [];
  const onOpen = await focused(page); // the dialog may focus its first control when it opens; that is not a keyboard focus, so it shows no ring
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.id.startsWith('BODY') && visited.length) break; // past the last control the browser takes focus out of the modal
    if (f.id === onOpen.id && !visited.length) continue;
    if (visited.some((v) => v.id === f.id) || (f.id === onOpen.id)) {
      if (visited.length && visited[visited.length - 1].id === f.id) continue; // a date input has several stops
      break; // came round again
    }
    visited.push(f);
  }
  const names = [onOpen, ...visited].map((v) => v.name.toLowerCase());
  expect(visited.length).toBeGreaterThan(5);
  // A radio group is one tab stop: the Pocket group is reached on its checked chip, or on the first one if none is checked.
  for (const want of ['expense', 'date', 'amount', 'payee', 'subsection', '🏦', 'note', 'cancel', 'add expense']) {
    expect(names.some((n) => n.startsWith(want)), `${want} is reachable by Tab; saw ${JSON.stringify(names)}`).toBe(true);
  }
  for (const f of visited) {
    expect(f.inDialog, `${f.name} keeps focus inside the dialog`).toBe(true);
    expect(f.style, `${f.name} outline style`).toBe('solid');
    expect(f.width, `${f.name} outline width`).toBe('2px');
    expect(f.offset, `${f.name} outline offset`).toBe('2px');
    expect(f.color, `${f.name} outline colour`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  }
  await shot(page, 'dialog-focus-ring-desktop-light');
});

test('page controls (navigation, buttons, rows) show the focus ring when reached by Tab', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/budget');
  await expect(row(page, /Food/)).toBeVisible();
  const seen: Focus[] = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focused(page));
  }
  const trail = JSON.stringify(seen.map((f) => f.name.slice(0, 12)));
  for (const f of seen) {
    expect(f.id, `Tab left the page controls; trail ${trail}`).not.toMatch(/^BODY/);
    expect(f.style, `${f.name} outline style`).toBe('solid');
    expect(f.width, `${f.name} outline width`).toBe('2px');
  }
  const offsets = seen.map((f) => `${f.name.slice(0, 14)}=${f.offset}`);
  // Buttons, links and inputs keep the 2px offset outside; a row inside a section draws it 2px inside its edge.
  expect(seen.filter((f) => !f.isRow && f.offset !== '2px').map((f) => f.name.slice(0, 14)), `outside offset must be 2px; got ${offsets.join(', ')}`).toEqual([]);
  // Spec 21: the table puts the section controls and the subsection buttons in rows; the spec fixes only the ring's presence there (solid, 2px, coloured).
  for (const f of seen.filter((x) => x.isRow)) expect(f.color, `${f.name} row ring colour`).not.toMatch(/rgba(0, 0, 0, 0)|transparent/);
});


test('a budget row, a transaction row and a pocket row draw a 2px focus ring; budget and transaction rows keep it 2px inside their edge', async ({ page, me }) => {
  await seedBudget(me.seed);
  for (const [path, target, inside] of [
    ['/budget', /Food/, true],
    ['/transactions', /Alphamega/, true],
    ['/pockets', /Revolut/, null],
  ] as const) {
    await page.goto(path);
    const r = row(page, target);
    await expect(r).toBeVisible();
    await page.keyboard.press('Tab'); // keyboard modality, so :focus-visible applies
    await r.focus();
    const f = await focused(page);
    expect(f.style, `${path} ring style`).toBe('solid');
    expect(f.width, `${path} ring width`).toBe('2px');
    if (inside !== null) expect(f.offset, `${path} ring offset`).toBe(inside ? '-2px' : '2px');
    expect(f.color, `${path} ring colour`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    if (path === '/budget') await shot(page, 'budget-row-focus-ring-desktop-light');
  }
});

test('a transaction can be added from the keyboard: Enter on the field submits', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  const opener = page.getByRole('button', { name: 'Add transaction' }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('Amount').focus();
  await page.keyboard.type('4.20');
  await d.getByLabel('Subsection').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await chip(d, 'Pocket', /Revolut/).focus();
  await page.keyboard.press('Space');
  await expect(chip(d, 'Pocket', /Revolut/)).toBeChecked();
  await d.getByLabel('Payee').focus();
  await page.keyboard.type('Keyboard cafe');
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();
  await expect(row(page, /Keyboard cafe/)).toContainText('−4.20');
});

test('Escape closes a dialog and focus returns to the control that opened it (Add transaction, a row, Add pocket)', async ({ page, me }) => {
  await seedBudget(me.seed);
  await page.goto('/transactions');
  const add = page.getByRole('button', { name: 'Add transaction' }).first();
  await add.click();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();

  const r = row(page, /Netflix/);
  await r.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(r).toBeFocused();

  await page.getByRole('link', { name: 'Pockets' }).first().click();
  const addPocket = page.getByRole('button', { name: 'Add pocket' }).first();
  await addPocket.click();
  await page.keyboard.press('Escape');
  await expect(addPocket).toBeFocused();
});

// The first run failed now and then, so the same flow runs several times, each on a fresh account.
for (let n = 1; n <= 8; n++) {
  test(`after saving from the Pockets empty card, focus lands on the page heading every time (run ${n} of 8)`, async ({ page, me }) => {
    await page.goto('/pockets');
    await page.getByRole('button', { name: 'Add pocket' }).last().click();
    await dialog(page).getByLabel('Name').fill('Cash jar');
    await dialog(page).getByRole('button', { name: 'Add pocket' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, /Cash jar/)).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 }).first();
    try {
      await expect(heading).toBeFocused();
      // and it stays there once the list and the toast have settled
      await page.waitForTimeout(400);
      await expect(heading).toBeFocused();
    } catch (e) {
      const where = await page.evaluate(() => { const a = document.activeElement!; return `${a.tagName}.${a.className} "${(a.textContent ?? '').slice(0, 30)}"`; });
      throw new Error(`focus did not move to the page heading; it is on ${where}`, { cause: e });
    }
  });
}
