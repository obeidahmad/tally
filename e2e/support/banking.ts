import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { dialog, group, selectLike } from './fixtures';

// Spec 17. The fake Enable Banking runs next to the test server (see start-server.mjs), on the next port.
export const BANK_BASE = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? '3210') + 1}`;
export const TEST_BASE = `http://localhost:${process.env.E2E_PORT ?? '3210'}`;

export type FakeTx = { ref: string; type: 'DBIT' | 'CRDT'; minor: number; daysAgo: number; creditor?: string; debtor?: string; remittance?: string[]; status?: 'BOOK' | 'PDNG' };
export type FakeAccount = { uid: string; iban: string; currency: string; name: string; balanceMinor: number; transactions: FakeTx[] };
export type FakeApp = { applicationId: string; privateKey: string; account: FakeAccount };

export const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
export const dayAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const longDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const longDateYear = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Today's four booked transactions of the sync tests, plus a pending one and one older than 90 days (neither may be imported). */
export const sampleTransactions = (): FakeTx[] => [
  { ref: 'r1', type: 'DBIT', minor: 2350, daysAgo: 0, creditor: 'LIDL Limassol', debtor: 'Me' },
  { ref: 'r2', type: 'DBIT', minor: 1399, daysAgo: 0, creditor: 'Netflix' },
  { ref: 'r3', type: 'CRDT', minor: 200000, daysAgo: 0, debtor: 'ACME Ltd', creditor: 'Me' },
  { ref: 'r4', type: 'DBIT', minor: 450, daysAgo: 0, remittance: ['Kiosk Larnaca', 'card 1234'] },
  { ref: 'r5', type: 'DBIT', minor: 999, daysAgo: 0, creditor: 'Pending Shop', status: 'PDNG' },
  { ref: 'r6', type: 'DBIT', minor: 777, daysAgo: 120, creditor: 'Ancient Shop' },
];
/** What the four booked ones do to a pocket that starts at 0.00: 2,000.00 - 23.50 - 13.99 - 4.50. */
export const TALLY_FIGURE = '1,958.01';

/** A new fake registration with its own key pair. `validUntils` is the end of access for the first session, then the second, and so on. */
export async function fakeApp(o: { validUntils?: string[]; balanceMinor?: number; currency?: string; failSessions?: boolean; transactions?: FakeTx[] } = {}): Promise<FakeApp> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const applicationId = randomUUID();
  const account: FakeAccount = {
    uid: randomUUID(), iban: 'CY17002001280000001200527600', currency: o.currency ?? 'EUR', name: 'Everyday account',
    balanceMinor: o.balanceMinor ?? 123456, transactions: o.transactions ?? sampleTransactions(),
  };
  const res = await fetch(`${BANK_BASE}/__fake/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ applicationId, publicKeyPem: publicKey, config: { accounts: [account], validUntils: o.validUntils ?? [inDays(100)], failSessions: !!o.failSessions } }),
  });
  expect(res.status, 'the fake Enable Banking must be running').toBe(204);
  return { applicationId, privateKey, account };
}

export const fakeLog = async (app: FakeApp) =>
  (await (await fetch(`${BANK_BASE}/__fake/apps/${app.applicationId}/log`)).json()) as {
    errors: string[]; auths: { bank: string; redirect_url: string }[]; sessions: number; txCalls: { uid: string; date_from: string | null; continuation_key: string | null }[];
  };

export async function register(page: Page, app: FakeApp) {
  const r = await page.request.put('/api/banks/registration', { data: { applicationId: app.applicationId, privateKey: app.privateKey } });
  expect(r.status(), `PUT registration: ${await r.text()}`).toBe(204);
}

export type Connection = { id: number; bank: string; validUntil: string; accounts: { uid: string; name: string; iban: string; currency: string; pocketId: number | null }[] };
export const connectionsApi = async (page: Page) => ((await (await page.request.get('/api/banks/connections')).json()).connections as Connection[]);
export const txApi = async (page: Page) =>
  ((await (await page.request.get(`/api/transactions?month=${new Date().toISOString().slice(0, 7)}`)).json()).transactions as { payee: string; kind: string; amountMinor: number; source?: string; subsectionId: number | null; sourceId?: number | null }[]);

/** Picks a value in a labelled control of a dialog, whether the design made it a select or a Chips group. */
export async function pick(scope: ReturnType<typeof dialog>, label: string, text: string) {
  const sel = scope.getByLabel(label, { exact: true });
  if ((await sel.count()) && (await sel.first().evaluate((e) => e.tagName)) === 'SELECT') await selectLike(sel.first(), text);
  else await group(scope, label).getByRole('radio', { name: text }).check();
}

/** Settings > Connect a bank > Continue, through the fake bank and back. Ends with the success toast. */
export async function connectBank(page: Page, bank = 'Bank of Cyprus', country = 'Cyprus') {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect a bank', exact: true }).click();
  const d = dialog(page);
  await pick(d, 'Country', country);
  await pick(d, 'Bank', bank);
  await d.getByRole('button', { name: 'Continue', exact: true }).click();
}

/** The Pocket select of the (only) account on the Settings card. */
export const accountPocket = (page: Page) => page.getByLabel(/^Pocket/);
