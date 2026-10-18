import { expect, type Page, type Locator } from '@playwright/test';
import { seed, monthTitle, type Seed } from './fixtures';

// Spec 09. "September" is the month before the current one and "October" the current month, so the tests pass in any month.
export const MINUS = '−';
const utc = (back: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + back);
  return d;
};
export const SEP = utc(-1);
export const OCT = utc(0);
export const NOV = utc(1);
const longName = (d: Date) => d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
export const sepName = longName(SEP);
export const octName = longName(OCT);
export const novName = longName(NOV);
export const sepTitle = monthTitle(SEP);
export const octTitle = monthTitle(OCT);
export const sepIso = SEP.toISOString().slice(0, 7);
export const octIso = OCT.toISOString().slice(0, 7);
export const sepDay = (day = 10) => `${sepIso}-${String(day).padStart(2, '0')}`;

export const REMINDER = `${sepTitle} has ended. Close it to carry what is left into ${octName}.`;
export const CLOSED_NOTICE = `${sepTitle} is closed.`;
export const CLOSE_BTN = `Close ${sepName}`;
export const IN_CLOSED = 'This date is in a closed month.';
export const TX_CLOSED = 'This transaction is in a closed month. Reopen the month to change it.';
export const USED_IN_PIPELINE = 'This section is used in the pipeline. Remove it from the steps and rest rules first.';
export const LEFTOVERS = "Last month's leftovers";

export const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
export const budgetUrl = (iso: string) => (iso === octIso ? '/budget' : `/budget?month=${iso}`);
export const pipelineUrl = (iso: string) => (iso === octIso ? '/pipeline' : `/pipeline?month=${iso}`);

export const monthsApi = async (page: Page) =>
  (await (await page.request.get('/api/months')).json()) as { lastClosed: string | null; toClose: string | null };
export const closeApi = async (page: Page, iso = sepIso) => {
  const r = await page.request.post(`/api/months/${iso}/close`, { data: {} });
  expect(r.status(), `POST close ${iso}: ${await r.text()}`).toBe(200);
};
export const reopenApi = async (page: Page, iso = sepIso) => {
  const r = await page.request.post(`/api/months/${iso}/reopen`, { data: {} });
  expect(r.status(), 'POST reopen').toBe(200);
};
export const putRest = async (page: Page, sectionId: number, rule: { shares: { sectionId: number | null; basisPoints: number }[]; overspent: 'income' | 'section' }) => {
  const r = await page.request.put(`/api/sections/${sectionId}/rest`, { data: rule });
  expect(r.status(), 'PUT rest').toBe(200);
};
export const getJson = async (page: Page, url: string) => (await page.request.get(url)).json();

/**
 * The spec's worked example, September part: Needs (Rent 800.00, Food 149.99), Wants (Eating out 550.00), Savings;
 * Paycheck (50/30/20 step) and Fund payout in boxes of their own; the rest rules; September income 2,000.00 and 12.40,
 * expenses 800.00, 100.00 and 700.00. Nothing is closed.
 */
export async function seedExample(page: Page, s: Seed = seed(page)) {
  const needs = await s.section('Needs');
  const wants = await s.section('Wants');
  const savings = await s.section('Savings');
  const rent = await s.subsection(needs.id, 'Rent', 80000);
  const food = await s.subsection(needs.id, 'Food', 14999);
  const eating = await s.subsection(wants.id, 'Eating out', 55000);
  const pocket = await s.pocket('Revolut', 0);
  const paycheck = await s.source('Paycheck');
  const fund = await s.source('Fund payout');
  await s.percentStep(paycheck.boxId, [
    { sectionId: needs.id, basisPoints: 5000 }, { sectionId: wants.id, basisPoints: 3000 }, { sectionId: savings.id, basisPoints: 2000 },
  ]);
  await putRest(page, needs.id, { shares: [{ sectionId: savings.id, basisPoints: 6000 }, { sectionId: null, basisPoints: 4000 }], overspent: 'income' });
  await putRest(page, savings.id, { shares: [{ sectionId: savings.id, basisPoints: 10000 }], overspent: 'income' });
  const d = sepDay();
  await s.income(pocket.id, 200000, paycheck.id, d);
  await s.income(pocket.id, 1240, fund.id, d);
  await s.expense(pocket.id, rent.id, 80000, 'Landlord', d);
  await s.expense(pocket.id, food.id, 10000, 'Grocer', d);
  await s.expense(pocket.id, eating.id, 70000, 'Restaurant', d);
  return { needs, wants, savings, rent, food, eating, pocket, paycheck, fund, s };
}

// ---- finders ----
export const titlePill = (page: Page) => page.locator('.ty-month__top .ty-pill').first();
export const notices = (page: Page) => page.locator('.ty-inset');
export { stat, bsection } from './fixtures';
/** A node of the Pipeline diagram, by its accessible name. */
export const node = (page: Page, name: string) => page.locator(`.ty-pipe [aria-label="${name}"]`);
export const restGroup = (page: Page, name: string | RegExp) => page.getByRole('button', { name });

export async function openCloseDialog(page: Page, from = budgetUrl(octIso)) {
  await page.goto(from);
  await page.getByRole('button', { name: CLOSE_BTN, exact: true }).first().click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('heading', { name: `Close ${sepTitle}` })).toBeVisible();
  return d;
}

/** Wire problems between months, measured in the page. Empty means all is well. */
export const nextWireProblems = (page: Page, expected: number) =>
  page.evaluate((expectedCount) => {
    const out: string[] = [];
    const svg = document.querySelector('svg.ty-pipe__wires') as SVGSVGElement | null;
    if (!svg) return ['no svg.ty-pipe__wires'];
    const sr = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const k = vb && vb.width ? sr.width / vb.width : 1;
    const paths = [...svg.querySelectorAll('path.ty-wire--next')] as SVGPathElement[];
    if (paths.length !== expectedCount) out.push(`${paths.length} dotted wires, expected ${expectedCount}`);
    const rect = (e: Element) => e.getBoundingClientRect();
    const pts = paths.map((p) => {
      const a = p.getPointAtLength(0);
      const b = p.getPointAtLength(p.getTotalLength());
      return { x1: sr.left + a.x * k, y1: sr.top + a.y * k, x2: sr.left + b.x * k, y2: sr.top + b.y * k };
    });
    const near = (a: number, b: number) => Math.abs(a - b) <= 2;
    const inY = (y: number, r: DOMRect) => y >= r.top - 1 && y <= r.bottom + 1;
    const starts = [
      ...document.querySelectorAll('.ty-pipe .ty-step--rest'),
      ...[...document.querySelectorAll('.ty-pipe .ty-node--next')].filter((n) => rect(n).left < sr.left + 200),
    ];
    // every rest row and every "Rest of ..." box starts one wire at its right edge
    for (const s of starts) {
      const r = rect(s);
      if (!pts.some((w) => near(w.x1, r.right) && inY(w.y1, r))) out.push(`no wire starts at the right edge of "${norm(s.textContent || '')}"`);
    }
    // every box of the third column is reached at its left edge
    const third = [...document.querySelectorAll('.ty-pipe .ty-node--next')].filter((n) => rect(n).left >= sr.left + 200);
    if (third.length === 0) out.push('no box in the third column');
    for (const t of third) {
      const r = rect(t);
      if (!pts.some((w) => near(w.x2, r.left) && inY(w.y2, r))) out.push(`no wire ends at the left edge of "${t.getAttribute('aria-label')}"`);
    }
    // every wire ends at the left edge of a third-column box, or of a section head
    const heads = [...document.querySelectorAll('.ty-pipe .ty-node__head')].filter((h) => h.closest('[aria-label]') && !h.closest('.ty-node--old'));
    for (const w of pts) {
      const ok = [...third, ...heads].some((e) => near(w.x2, rect(e).left) && inY(w.y2, rect(e)));
      if (!ok) out.push(`a wire ends at (${Math.round(w.x2)}, ${Math.round(w.y2)}), at no left edge`);
    }
    function norm(t: string) { return t.replace(/\s+/g, ' ').trim(); }
    return out;
  }, expected);

export const setSizeAndWait = async (page: Page, w: number, h: number, probe?: Locator) => {
  await page.setViewportSize({ width: w, height: h });
  if (probe) await expect(probe.first()).toBeVisible();
};
