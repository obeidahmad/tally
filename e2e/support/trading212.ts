import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { todayIso } from './fixtures';

// Spec 16. The fake Trading212 runs next to the test server (see start-server.mjs), two ports up.
export const T212_BASE = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? '3210') + 2}`;

export type Position = { ticker: string; quantity: number; currentPrice: number; ppl: number; fxPpl?: number | null };
export type Instrument = { ticker: string; name: string; currencyCode: string };
export type Dividend = { reference: string; ticker: string; amount: number; paidOn: string };
export type FakeConfig = { currencyCode?: string; free?: number; positions?: Position[]; instruments?: Instrument[]; dividends?: Dividend[]; mode?: 'ok' | 'refuse' | 'down' | 'slow' };
export type FakeKey = { key: string; secret: string | null; keyEnd: string };

// Amounts are decimals in major units, as the real API sends them. Fixture rates: 1 EUR = 1.0860 USD.
export const VUSA: Position = { ticker: 'VUSAl_EQ', quantity: 10, currentPrice: 50, ppl: 50, fxPpl: 0 }; // worth 500.00 EUR, paid 450.00 EUR, +11.1%
export const AAPL: Position = { ticker: 'AAPL_US_EQ', quantity: 2, currentPrice: 150, ppl: 20, fxPpl: -1.5 }; // worth 300.00 USD = about 276.24 EUR, paid about 257.74 EUR, about +7.2%
export const MSFT: Position = { ticker: 'MSFT_US_EQ', quantity: 1, currentPrice: 400, ppl: -10, fxPpl: null }; // worth 400.00 USD = about 368.32 EUR, paid about 378.32 EUR, about -2.6%
export const INSTRUMENTS: Instrument[] = [
  { ticker: 'VUSAl_EQ', name: 'Vanguard S&P 500', currencyCode: 'EUR' },
  { ticker: 'AAPL_US_EQ', name: 'Apple', currencyCode: 'USD' },
  { ticker: 'MSFT_US_EQ', name: 'Microsoft', currencyCode: 'USD' },
];
export const DIVIDENDS: Dividend[] = [
  { reference: 'div-1', ticker: 'AAPL_US_EQ', amount: 1.5, paidOn: `${todayIso()}T09:00:00.000Z` },
  { reference: 'div-2', ticker: 'VUSAl_EQ', amount: 2.25, paidOn: `${todayIso()}T09:00:00.000Z` },
  { reference: 'div-3', ticker: 'MSFT_US_EQ', amount: 0.75, paidOn: `${todayIso()}T09:00:00.000Z` },
];
export const CASH = 1234.56;

/** A new fake account with its own API key (ending "K9x2"). */
export async function fakeKey(o: FakeConfig & { secret?: string } = {}): Promise<FakeKey> {
  const key = `key-${randomUUID()}-K9x2`;
  const { secret, ...config } = o;
  const res = await fetch(`${T212_BASE}/__fake/keys`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, secret, config: { currencyCode: 'EUR', free: CASH, positions: [VUSA, AAPL, MSFT], instruments: INSTRUMENTS, dividends: DIVIDENDS, ...config } }),
  });
  expect(res.status, 'the fake Trading212 must be running').toBe(204);
  return { key, secret: secret ?? null, keyEnd: 'K9x2' };
}
export const fakeSet = async (k: FakeKey, patch: FakeConfig) => {
  const res = await fetch(`${T212_BASE}/__fake/keys/${k.key}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  expect(res.status).toBe(204);
};
export const fakeLog = async (k: FakeKey) =>
  (await (await fetch(`${T212_BASE}/__fake/keys/${k.key}/log`)).json()) as { calls: { at: number; path: string; authorization: 'key' | 'basic' }[]; errors: string[]; limitHits: number };

export const connectBody = (k: FakeKey, pocketId: number, subsectionId: number, environment = 'live') => ({ pocketId, apiKey: k.key, ...(k.secret ? { apiSecret: k.secret } : {}), environment, subsectionId });
export async function connectApi(page: Page, k: FakeKey, pocketId: number, subsectionId: number) {
  const r = await page.request.put('/api/brokers/trading212', { data: connectBody(k, pocketId, subsectionId) });
  expect(r.status(), `PUT trading212: ${await r.text()}`).toBe(200);
}
export async function syncApi(page: Page) {
  const r = await page.request.post('/api/brokers/trading212/sync', { data: {}, timeout: 60_000 });
  expect(r.status(), `POST sync: ${await r.text()}`).toBe(200);
  return r.json();
}
export type Connection = { pocketId: number; environment: string; subsectionId: number; keyEnd: string; syncedAt: string | null; error: string | null };
export const connectionApi = async (page: Page) => (await (await page.request.get('/api/brokers/trading212')).json()).connection as Connection | null;

export type BrokerHolding = { id: number; name: string; pocketId: number; subsectionId: number; paidMinor: number; worthMinor: number; worthCurrency: string; soldDate: string | null; source?: string };
export const holdingsApi = async (page: Page) => (await (await page.request.get('/api/holdings')).json()).holdings as BrokerHolding[];
export const incomesApi = async (page: Page) =>
  ((await (await page.request.get(`/api/transactions?month=${todayIso().slice(0, 7)}`)).json()).transactions as
    { date: string; kind: string; amountMinor: number; payee: string; pocketId: number; sourceId: number | null; source?: string }[]).filter((t) => t.kind === 'income');
