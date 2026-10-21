import { test, expect, dialog, toast, shot, row, group, em, EMOJI, DEFAULT_EMOJI, KIND_LABEL, noVs, checkedEmoji, pocketsApi, pocketRow, pocketRows } from '../support/fixtures';
import type { Page, Locator } from '@playwright/test';

const sizes = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
const picker = (d: Locator) => group(d, 'Emoji').getByRole('radio');

async function openAddPocket(page: Page) {
  await page.goto('/pockets');
  await page.getByRole('button', { name: 'Add pocket' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Add pocket' })).toBeVisible();
  return d;
}

// ---- criterion 8: the picker ----
test('the picker offers exactly the 32 listed emoji, each named, in the listed order', async ({ page, me }) => {
  const d = await openAddPocket(page);
  await expect(picker(d)).toHaveCount(32);
  for (const [, name] of EMOJI) await expect(group(d, 'Emoji').getByRole('radio', { name, exact: true }), name).toHaveCount(1);
  const shown = await picker(d).evaluateAll((rs) =>
    rs.map((r) => ({ name: r.getAttribute('aria-label') ?? '', text: (r.closest('label')?.textContent ?? '').trim() })));
  expect(shown.map((s) => s.name)).toEqual(EMOJI.map(([, n]) => n));
  expect(shown.map((s) => noVs(s.text))).toEqual(EMOJI.map(([cp]) => String.fromCodePoint(cp)));
  await shot(page, 'dialog-emoji-picker-desktop-light');
});

test('the picker starts on the default for the kind, with exactly one emoji chosen, and follows the kind until one is picked', async ({ page, me }) => {
  const d = await openAddPocket(page);
  await expect(d.getByLabel('Kind').locator('option:checked')).toHaveText('Bank account');
  expect(await checkedEmoji(d)).toEqual(['Bank']);
  for (const [label, name] of [['Cash', 'Banknote'], ['Fund', 'Seedling'], ['Broker', 'Chart'], ['Bank account', 'Bank']]) {
    await d.getByLabel('Kind').selectOption({ label });
    expect(await checkedEmoji(d), `kind ${label}`).toEqual([name]);
  }
  // Once the person picks one, a change of kind leaves it alone.
  await group(d, 'Emoji').getByRole('radio', { name: 'Star', exact: true }).check();
  for (const label of ['Cash', 'Fund']) {
    await d.getByLabel('Kind').selectOption({ label });
    expect(await checkedEmoji(d), `after picking, kind ${label}`).toEqual(['Star']);
  }
  await d.getByLabel('Name').fill('Starry');
  await d.getByRole('button', { name: 'Add pocket' }).click();
  await expect(d).toBeHidden();
  expect((await pocketsApi(page))[0]).toMatchObject({ name: 'Starry', kind: 'fund', emoji: em('Star') });
});

test('the picker works from the keyboard: Tab enters it on the chosen emoji, arrows move the choice, Tab leaves to Kind', async ({ page, me }) => {
  const d = await openAddPocket(page);
  const pick = (name: string) => group(d, 'Emoji').getByRole('radio', { name, exact: true });
  await d.getByLabel('Name').focus();
  await page.keyboard.type('Keyboard pocket');
  await page.keyboard.press('Tab');
  await expect(pick('Bank')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pick('Card')).toBeChecked();
  await expect(pick('Card')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(pick('Banknote')).toBeChecked();
  await expect(pick('Card')).not.toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(pick('Card')).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(pick('Banknote')).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(d.getByLabel('Kind')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(pick('Banknote')).toBeFocused();
  // The ring is drawn on the emoji's label, 2px solid.
  const ring = await pick('Banknote').evaluate((e) => { const cs = getComputedStyle(e.closest('label')!); return [cs.outlineStyle, cs.outlineWidth]; });
  expect(ring).toEqual(['solid', '2px']);
  await shot(page, 'dialog-emoji-picker-focus-desktop-light');
  await d.getByRole('button', { name: 'Add pocket' }).click();
  await expect(d).toBeHidden();
  expect((await pocketsApi(page))[0]).toMatchObject({ name: 'Keyboard pocket', kind: 'bank', emoji: em('Banknote') });
});

test('the transaction dialog has no emoji picker; a pocket made there gets the default emoji of its kind', async ({ page, me }) => {
  const s = await me.seed.section('Needs');
  await me.seed.subsection(s.id, 'Food', 10000);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  const d = dialog(page);
  await expect(group(d, 'Emoji')).toHaveCount(0);
  await d.getByLabel('Kind').selectOption({ label: 'Fund' });
  await expect(group(d, 'Emoji')).toHaveCount(0);
  await d.getByLabel('Paid from', { exact: true }).fill('Rainy day');
  await d.getByLabel('Amount').fill('9');
  await d.getByLabel('Payee').fill('Umbrella shop');
  await d.getByLabel('Subsection').selectOption({ label: 'Food' });
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toBeHidden();
  expect((await pocketsApi(page))[0]).toMatchObject({ name: 'Rainy day', kind: 'fund', emoji: em('Seedling') });
});

test('a pocket added with no pick takes the default emoji of its kind', async ({ page, me }) => {
  for (const kind of ['Bank account', 'Cash', 'Fund', 'Broker'] as const) {
    const d = await openAddPocket(page);
    await d.getByLabel('Name').fill(`Pocket ${kind}`);
    await d.getByLabel('Kind').selectOption({ label: kind });
    await d.getByRole('button', { name: 'Add pocket' }).click();
    await expect(d).toBeHidden();
  }
  const byKind = Object.fromEntries((await pocketsApi(page)).map((p) => [p.kind, p.emoji]));
  expect(byKind).toEqual({ bank: em('Bank'), cash: em('Banknote'), fund: em('Seedling'), broker: em('Chart') });
  await page.goto('/pockets');
  for (const kind of ['bank', 'cash', 'fund', 'broker'] as const) {
    const card = pocketRow(page, KIND_LABEL[kind]);
    await expect(card.locator('.ty-emoji').first(), kind).toHaveText(em(DEFAULT_EMOJI[kind]));
  }
});

// ---- editing a pocket's emoji ----
test('Edit pocket shows the pocket\'s own emoji, and a new one changes the card, the chip and the stored value', async ({ page, me }) => {
  await me.seed.pocket('Revolut', 100000, 'bank', em('Car'));
  await page.goto('/pockets');
  await row(page, /Revolut/).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Edit pocket' })).toBeVisible();
  expect(await checkedEmoji(d)).toEqual(['Car']);
  const labels = (await d.locator('label.ty-label, legend').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const at = (s: string) => labels.findIndex((l) => l.startsWith(s));
  const order = ['name', 'emoji', 'kind', 'opening balance'].map(at);
  expect(order.every((i) => i >= 0), JSON.stringify(labels)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await shot(page, 'dialog-edit-pocket-emoji-desktop-light');
  await group(d, 'Emoji').getByRole('radio', { name: 'Gem', exact: true }).check();
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(toast(page)).toContainText('Saved');
  const card = pocketRow(page, 'Revolut');
  await expect(card.locator('.ty-emoji').first()).toHaveText(em('Gem'));
  expect((await pocketsApi(page))[0].emoji).toBe(em('Gem'));
  // reopen: the new one is shown as chosen
  await row(page, /Revolut/).click();
  expect(await checkedEmoji(d)).toEqual(['Gem']);
  await page.keyboard.press('Escape');
});

// ---- criterion 7: the emoji before the name, everywhere, at both widths, in Noto Emoji ----
for (const [size, viewport] of Object.entries(sizes)) {
  test.describe(`emoji before the pocket's name, ${size}`, () => {
    test.use({ viewport });

    test('on its card, on its chip and in its transaction rows, drawn in Noto Emoji', async ({ page, me }) => {
      const sec = await me.seed.section('Needs');
      const food = await me.seed.subsection(sec.id, 'Food', 30000);
      const revolut = await me.seed.pocket('Revolut', 100000, 'bank', em('Card'));
      const wallet = await me.seed.pocket('Wallet', 5000, 'cash'); // default emoji for cash
      await me.seed.expense(revolut.id, food.id, 4820, 'Alphamega');
      await me.seed.income(wallet.id, 4100, 'Fund payout');
      const shown = [['Revolut', em('Card')], ['Wallet', em('Banknote')]] as const;

      // Cards.
      await page.goto('/pockets');
      for (const [name, e] of shown) {
        const r = pocketRow(page, name);
        await expect(r.locator('.ty-emoji').first()).toHaveText(e);
        // the emoji sits right before the name
        expect((await r.innerText()).replace(/\s+/g, ' ').trim(), `row ${name}`).toMatch(new RegExp(`^${e}\\s*${name}`));
      }
      await expect(pocketRows(page).first().locator('.ty-emoji').first()).toHaveClass(/ty-emoji/);
      await shot(page, `pockets-emoji-cards-${size}-light`);

      // Rows: every visible emoji in a row sits right before the pocket's name.
      await page.goto('/transactions');
      for (const [who, name, e] of [['Alphamega', 'Revolut', em('Card')], ['Fund payout', 'Wallet', em('Banknote')]]) {
        const r = row(page, new RegExp(who));
        await expect(r).toBeVisible();
        const spots = await r.evaluate((el, [n, ch]) => {
          const vis = (x: Element) => x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden';
          return [...el.querySelectorAll('.ty-emoji')].filter(vis).map((x) => ({
            text: x.textContent, before: (x.parentElement!.textContent ?? '').replace(/\s+/g, ' ').includes(`${ch} ${n}`),
          }));
        }, [name, e]);
        expect(spots.length, `${who}: a visible emoji in the row (${size})`).toBeGreaterThan(0);
        for (const sp of spots) {
          expect(sp.text).toBe(e);
          expect(sp.before, `${who}: the emoji comes right before "${name}"`).toBe(true);
        }
      }
      await shot(page, `transactions-emoji-rows-${size}-light`);

      // The Pocket filter is a native select with the emoji as plain text before the name.
      const opts = await page.getByLabel('Pocket').locator('option').allTextContents();
      expect(opts.map((o) => noVs(o).replace(/\s+/g, ' '))).toEqual(expect.arrayContaining([`${em('Card')} Revolut`, `${em('Banknote')} Wallet`]));

      // Chips.
      await page.getByRole('button', { name: 'Add transaction' }).first().click();
      const d = dialog(page);
      for (const [name, e] of shown) {
        const label = group(d, 'Paid from').locator('label.ty-chip', { hasText: name });
        await expect(label.locator('.ty-emoji')).toHaveText(e);
        expect((await label.innerText()).replace(/\s+/g, ' ').trim(), `chip ${name}`).toBe(`${e} ${name}`);
      }
      await page.waitForTimeout(300);
      await shot(page, `dialog-pocket-chips-emoji-${size}-light`);

      // Noto Emoji: the face the emoji are drawn in, at weight 700, and it was loaded.
      const faces = await page.evaluate(async () => {
        await document.fonts.ready;
        const marks = [...document.querySelectorAll('.ty-emoji')].filter((x) => x.getClientRects().length > 0);
        return {
          count: marks.length,
          families: [...new Set(marks.map((x) => getComputedStyle(x).fontFamily))],
          weights: [...new Set(marks.map((x) => getComputedStyle(x).fontWeight))],
          loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
        };
      });
      expect(faces.count).toBeGreaterThan(0);
      for (const f of faces.families) expect(f, 'emoji font-family').toMatch(/Noto Emoji/);
      expect(faces.weights).toEqual(['700']);
      expect(faces.loaded.join(' | '), 'Noto Emoji loaded').toMatch(/Noto Emoji/);
    });
  });
}

test('the page text uses the display face and the emoji face by their variable family names, and the picker is drawn in Noto Emoji', async ({ page, me }) => {
  const d = await openAddPocket(page);
  const fam = async (loc: Locator) => loc.first().evaluate((e) => getComputedStyle(e).fontFamily);
  expect(await fam(group(d, 'Emoji').locator('.ty-emojis, label').first())).toMatch(/Noto Emoji/);
  await page.keyboard.press('Escape');
  // Spec 27: IBM Plex Sans everywhere; Bricolage Grotesque is gone.
  await page.goto('/budget');
  expect(await fam(page.getByRole('heading', { level: 1 }))).toMatch(/IBM Plex Sans/);
  expect(await fam(page.getByRole('heading', { level: 1 }))).not.toMatch(/Bricolage/);
  const loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
  expect(loaded.join(' | ')).toMatch(/IBM Plex Sans/);
  expect(loaded.join(' | ')).not.toMatch(/Bricolage/);
});
