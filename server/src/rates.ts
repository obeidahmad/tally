import fs from 'node:fs/promises';
import type { Db } from './db';

export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const FRESH = 6 * 3600_000;
const RETRY = 10 * 60_000;
const SCALE = 10 ** 8;

// ECB reference rates: stored per euro, shared by every account.
export function createRates(db: Db, url: string, now: () => number) {
  let lastRead = 0;
  let lastTry = 0;
  let running: Promise<void> | null = null;

  async function read() {
    const text = /^https?:\/\//i.test(url)
      ? await fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
      : await fs.readFile(url, 'utf8');
    const rows: [string, string, string][] = [];
    let date = '';
    for (const [, attrs] of text.matchAll(/<Cube\b([^>]*)>/g)) {
      const a = Object.fromEntries([...attrs!.matchAll(/(\w+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1], m[2]]));
      if (a.time && /^\d{4}-\d{2}-\d{2}$/.test(a.time)) date = a.time;
      else if (date && /^[A-Z]{3}$/.test(a.currency ?? '') && /^\d+(\.\d+)?$/.test(a.rate ?? '') && Number(a.rate) > 0) rows.push([date, a.currency!, a.rate!]);
    }
    if (!rows.length) throw new Error('no rates in the file');
    const put = db.prepare('INSERT OR REPLACE INTO rates (date, currency, per_euro) VALUES (?, ?, ?)');
    db.transaction(() => rows.forEach((r) => put.run(...r)))();
  }

  // Never throws: a failed read keeps the stored rates.
  function ensure(): Promise<void> {
    const t = now();
    if (running) return running;
    if ((lastRead && t - lastRead < FRESH) || (lastTry && t - lastTry < RETRY)) return Promise.resolve();
    lastTry = t;
    running = read()
      .then(() => { lastRead = t; })
      .catch((e) => console.error(`Could not read exchange rates: ${(e as Error).message}`))
      .finally(() => { running = null; });
    return running;
  }

  // Units of `currency` per euro on the latest stored date on or before `date`, else the earliest after it. Scaled by 1e8.
  function perEuro(currency: string, date: string): bigint | null {
    if (currency === 'EUR') return BigInt(SCALE);
    const row = (db.prepare(
      `SELECT per_euro AS v FROM rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1`).get(currency, date)
      ?? db.prepare(`SELECT per_euro AS v FROM rates WHERE currency = ? AND date > ? ORDER BY date LIMIT 1`).get(currency, date)) as { v: string } | undefined;
    return row ? BigInt(Math.round(Number(row.v) * SCALE)) : null;
  }

  // amount x rate to the nearest cent, halves away from zero; null with no rate.
  function convert(amount: number, from: string, to: string, date: string): number | null {
    if (from === to) return amount;
    const x = perEuro(from, date);
    const y = perEuro(to, date);
    if (!x || !y) return null;
    const n = BigInt(Math.abs(amount)) * y;
    const q = Number((2n * n + x) / (2n * x));
    return amount < 0 ? -q : q;
  }

  // Rate of 1 `from` in `to`, as a 4-decimal string.
  function rate(from: string, to: string, date: string): string | null {
    const x = perEuro(from, date);
    const y = perEuro(to, date);
    return x && y ? (Number(y) / Number(x)).toFixed(4) : null;
  }

  // The stored date a rate comes from.
  const storedDate = (date: string): string | null =>
    (db.prepare('SELECT MAX(date) AS d FROM rates WHERE date <= ?').pluck().get(date)
      ?? db.prepare('SELECT MIN(date) AS d FROM rates').pluck().get()) as string | null;

  // The euro, every stored currency with two decimals, and the base currency: base first, the rest alphabetical.
  function offered(base: string): string[] {
    const two = (c: string) => {
      try { return new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits === 2; } catch { return false; }
    };
    const stored = db.prepare('SELECT DISTINCT currency FROM rates').pluck().all() as string[];
    const rest = new Set(['EUR', ...stored.filter(two)]);
    rest.delete(base);
    return [base, ...[...rest].sort()];
  }

  return { ensure, convert, rate, storedDate, offered };
}
export type Rates = ReturnType<typeof createRates>;
