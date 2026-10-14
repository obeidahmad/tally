import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, type Locator } from '@playwright/test';
import { chip, dialog, selectLike, type Seed } from './fixtures';

// Spec 15. Fixture CSVs live in e2e/fixtures; {YYYY} {MM} are the current month and {PY} {PM} the month before (UTC).
const now = new Date();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const two = (n: number) => String(n).padStart(2, '0');
export const YYYY = String(now.getUTCFullYear());
export const MM = two(now.getUTCMonth() + 1);
export const day1 = `${YYYY}-${MM}-01`;

export const csv = (name: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(
    readFileSync(resolve('fixtures', name), 'utf8')
      .replace(/\{YYYY\}/g, YYYY).replace(/\{MM\}/g, MM)
      .replace(/\{PY\}/g, String(prev.getUTCFullYear())).replace(/\{PM\}/g, two(prev.getUTCMonth() + 1)),
  ),
});

export const MINUS = '−';
export const SORT_MSG = 'imported transactions need a subsection or source.';
export const UNSORTED_CLOSE = "Sort this month's imported transactions first.";

/** A person with Needs > Food, a pocket "Revolut" (bank, 0.00) and an income source "Paycheck". */
export async function seedImport(s: Seed) {
  const needs = await s.section('Needs');
  const food = await s.subsection(needs.id, 'Food', 30000);
  const pocket = await s.pocket('Revolut', 0);
  const paycheck = await s.source('Paycheck');
  return { needs, food, pocket, paycheck };
}

export const rulesApi = async (page: Page, data: { match: string; subsectionId?: number; sourceId?: number }) => {
  const r = await page.request.post('/api/rules', { data });
  expect(r.status(), `POST rule: ${await r.text()}`).toBe(201);
  return (await r.json()) as { rule: { id: number }; sorted: number };
};
export const unsortedApi = async (page: Page) =>
  ((await (await page.request.get('/api/transactions?unsorted=1')).json()).transactions as { payee: string }[]);

/** The select or button the person uses to filter to "Needs sorting" (the spec allows a chip or a select choice). */
export async function chooseNeedsSorting(page: Page) {
  const sel = page.locator('select').filter({ hasText: 'Needs sorting' });
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await expect(page.getByLabel('Subsection').first()).toBeVisible();
  if (await sel.count()) {
    await selectLike(sel.first(), 'Needs sorting');
    return sel.first();
  }
  const c = page.getByRole('radio', { name: /^Needs sorting/ }).or(page.getByRole('button', { name: /^Needs sorting/ })).or(page.getByRole('checkbox', { name: /^Needs sorting/ })).first();
  await c.click();
  return c;
}

export const importButton = (page: Page) => page.getByRole('button', { name: 'Import a statement', exact: true }).first();
export const sortedPills = (page: Page) => page.locator('.ty-pill--warning').filter({ hasText: 'Needs sorting', visible: true });
export const sel = (d: Locator, label: string) => d.getByLabel(label, { exact: true });
export const checkedText = (select: Locator) => select.locator('option:checked');

/** Opens the Import dialog from the Transactions page and takes step one to step two. */
export async function toMapping(page: Page, file: string, pocket = 'Revolut') {
  await page.goto('/transactions');
  await importButton(page).click();
  const d = dialog(page);
  await expect(d.getByRole('heading', { name: 'Import a statement' })).toBeVisible();
  await chip(d, 'Pocket', pocket).check();
  await d.getByLabel('File').setInputFiles(csv(file));
  await d.getByRole('button', { name: 'Next', exact: true }).click();
  return d;
}

/** The whole flow with the guessed mapping; returns the dialog showing the summary. */
export async function importFile(page: Page, file: string, pocket = 'Revolut') {
  const d = await toMapping(page, file, pocket);
  await expect(sel(d, 'Date')).toBeVisible();
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  return d;
}
