import { expect, type Page } from '@playwright/test';
import { em, selectLike, toast, todayIso, type Seed } from './fixtures';
import { fakeApp, register, connectBank, connectionsApi, accountPocket, txApi } from './banking';

/** A date in the current month, `k` days before today but never before the 1st. */
const inMonth = (k: number) => {
  const d = new Date();
  const day = Math.max(1, d.getUTCDate() - k);
  return `${d.toISOString().slice(0, 8)}${String(day).padStart(2, '0')}`;
};

type Sub = [name: string, emoji: string, budgetMinor: number, spentMinor: number];
/** 5 sections with 3 to 5 subsections each, an emoji on each subsection, and spending in most of them (Spec 27's richer data). */
export const RICH_PLAN: [string, Sub[]][] = [
  ['Needs', [['Rent', 'House', 120000, 120000], ['Groceries', 'Shopping cart', 40000, 32140], ['Utilities', 'Tools', 15000, 13875], ['Transport', 'Car', 8000, 6420], ['Insurance', 'Umbrella', 6000, 6000]]],
  ['Wants', [['Eating out', 'Star', 12000, 14850], ['Subscriptions', 'Phone', 4000, 3897], ['Clothes', 'Gem', 8000, 5200], ['Hobbies', 'Target', 6000, 2500]]],
  ['Savings', [['Emergency fund', 'Coin', 30000, 30000], ['Holiday', 'Plane', 20000, 20000], ['Retirement', 'Seedling', 25000, 25000]]],
  ['Family', [['School', 'Graduation cap', 15000, 15000], ['Kids', 'Baby', 9000, 7260], ['Doctor', 'Heart', 5000, 4500]]],
  ['Fun', [['Games', 'Target', 5000, 3999], ['Books', 'Receipt', 3000, 2450], ['Trips', 'Beach', 10000, 8700], ['Concerts', 'Globe', 6000, 0]]],
];

/**
 * Everything a screenshot of real use needs: pockets (one reconciled), 5 sections of 3 to 5 subsections with emojis,
 * income from two sources, spending in most subsections (so the Sankey and the donut are full), and some last-month spending.
 * Returns what the tests may want to find again.
 */
export async function seedRich(page: Page, s: Seed) {
  const bank = await s.pocket('Revolut', 250000, 'bank', em('Bank'));
  const wallet = await s.pocket('Wallet', 4000, 'cash', em('Banknote'));
  await s.pocket('Savings pot', 150000, 'fund', em('Seedling'));
  const pay = await s.source('Paycheck');
  const side = await s.source('Side job');
  await s.income(bank.id, 420000, pay.id, inMonth(15));
  await s.income(bank.id, 60000, side.id, inMonth(8));
  let k = 0;
  const subs: Record<string, { id: number }> = {};
  for (const [name, list] of RICH_PLAN) {
    const sec = await s.section(name);
    await s.amountStep(pay.boxId, sec.id, list.reduce((a, x) => a + x[2], 0));
    for (const [sub, emoji, budget, spent] of list) {
      const r = await page.request.post(`/api/sections/${sec.id}/subsections`, { data: { name: sub, budgetMinor: budget, emoji: em(emoji) } });
      expect(r.status(), await r.text()).toBeLessThan(300);
      const created = (await r.json()).subsection as { id: number };
      subs[sub] = created;
      if (spent > 0) {
        // two payments for the bigger ones, on different days, so the lists and the calendar look lived in
        const parts = spent > 10000 ? [Math.round(spent * 0.6), spent - Math.round(spent * 0.6)] : [spent];
        for (const [i, p] of parts.entries()) await s.expense(i % 3 === 2 ? wallet.id : bank.id, created.id, p, `${sub} ${['shop', 'store', 'market'][(k + i) % 3]}`, inMonth(k++ % 14 + i));
      }
    }
  }
  // last month, so the charts have a past
  const last = new Date(); last.setUTCDate(1); last.setUTCMonth(last.getUTCMonth() - 1);
  const lm = last.toISOString().slice(0, 8) + '12';
  await s.expense(bank.id, subs['Groceries'].id, 38000, 'Last month groceries', lm);
  await s.expense(bank.id, subs['Rent'].id, 120000, 'Last month rent', lm);
  // a reconciled pocket
  const rec = await page.request.post(`/api/pockets/${wallet.id}/reconcile`, { data: { balanceMinor: 3500, date: todayIso() } });
  expect(rec.status(), await rec.text()).toBeLessThan(300);
  return { bank, wallet, subs };
}

/** Links Revolut to the fake bank and syncs, so its card reads "Synced … from Bank of Cyprus". */
export async function syncRevolut(page: Page) {
  const app = await fakeApp({ balanceMinor: 251234 });
  await register(page, app);
  await connectBank(page);
  await expect(toast(page)).toHaveText('Bank connected.');
  await accountPocket(page).waitFor();
  await selectLike(accountPocket(page), 'Revolut');
  await expect.poll(async () => (await connectionsApi(page))[0]?.accounts[0].pocketId).not.toBeNull();
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect.poll(async () => (await txApi(page)).length).toBeGreaterThan(0);
}
