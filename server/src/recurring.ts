import { Router } from 'express';
import type { Db } from './db';
import { notFound, parse } from './http';
import { monthQuery } from './schemas';

const DAY = 86400000;
const BANDS = { weekly: [6, 8], monthly: [25, 35], yearly: [355, 375] } as const;
const days = (d: string) => Date.parse(d + 'T00:00:00Z') / DAY;
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
// The k-th occurrence after `from`: 7 days, or calendar months on the same day of the month, clamped to the month's last day.
export const stepDate = (from: string, cadence: keyof typeof BANDS, k: number) => {
  if (cadence === 'weekly') return dayStr(days(from) + 7 * k);
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const n = m - 1 + k * (cadence === 'yearly' ? 12 : 1);
  const last = new Date(Date.UTC(y + Math.floor(n / 12), (n % 12) + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y + Math.floor(n / 12), n % 12, Math.min(d, last))).toISOString().slice(0, 10);
};
export const payeeKey = (p: string) => p.toLowerCase().replace(/[\d\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();

type Row = { date: string; baseAmountMinor: number; subsectionId: number | null; payee: string };

function detect(rows: Row[], today: number) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = payeeKey(r.payee);
    if (k) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const found = new Map<string, any>();
  for (const [key, g] of groups) {
    // rows arrive sorted by date, id: the first expense of a day is the one kept
    const list = g.filter((r, i) => i === 0 || r.date !== g[i - 1]!.date);
    if (list.length < 2) continue;
    const gaps = list.slice(1).map((r, i) => days(r.date) - days(list[i]!.date));
    const cadence = (Object.keys(BANDS) as (keyof typeof BANDS)[]).find((c) => gaps.every((x) => x >= BANDS[c][0] && x <= BANDS[c][1]));
    // yearly payments need only 2: three would not fit in any sane window
    if (!cadence || list.length < (cadence === 'yearly' ? 2 : 3)) continue;
    // The band holds for every payment but the latest, against the median of the others; the latest may rise up to 50%.
    const last = list[list.length - 1]!;
    const before = list.slice(0, -1);
    const usual = median(before.map((r) => r.baseAmountMinor));
    if (!before.every((r) => Math.abs(r.baseAmountMinor - usual) <= usual * 0.15)) continue;
    if (last.baseAmountMinor > usual * 1.5 || last.baseAmountMinor < usual * 0.85) continue;
    const amount = last.baseAmountMinor;
    const nextDate = stepDate(last.date, cadence, 1);
    const t = today;
    const todayD = new Date(t * DAY);
    const cycleStart = cadence === 'weekly' ? t - 6 : cadence === 'yearly' ? t - 29 : Math.floor(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(), 1) / DAY);
    const paid = list.some((r) => days(r.date) >= cycleStart && days(r.date) <= t);
    const next = days(nextDate);
    found.set(key, {
      key, payee: last.payee, cadence, amountMinor: amount, lastDate: last.date,
      nextDate, count: list.length, subsectionId: last.subsectionId,
      monthlyMinor: Math.round(cadence === 'weekly' ? (amount * 52) / 12 : cadence === 'yearly' ? amount / 12 : amount),
      status: paid ? 'paid' : next < t - 3 ? 'missed' : next <= t + 7 ? 'due' : 'upcoming',
      priceChange: amount > usual * 1.02 ? { fromMinor: usual, toMinor: amount, date: last.date } : null,
      payments: list.map((r) => ({ date: r.date, amountMinor: r.baseAmountMinor })),
    });
  }
  return found;
}

export function recurringRouter(db: Db, now: () => number): Router {
  const r = Router();
  const load = (uid: number) => {
    const d = new Date(now());
    const today = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
    const since = dayStr(today - 800);
    const rows = db.prepare(`SELECT date, base_amount_minor AS baseAmountMinor, subsection_id AS subsectionId, payee FROM transactions
      WHERE user_id = ? AND kind = 'expense' AND date >= ? ORDER BY date, id`).all(uid, since) as Row[];
    const dismissed = new Set(db.prepare('SELECT key FROM recurring_dismissed WHERE user_id = ?').pluck().all(uid) as string[]);
    return { found: detect(rows, today), dismissed, today };
  };
  const byNext = (a: any, b: any) => a.nextDate.localeCompare(b.nextDate) || a.key.localeCompare(b.key);

  r.get('/recurring', (req, res) => {
    const { found, dismissed } = load(req.user.id);
    const all = [...found.values()].sort(byNext).map(({ payments, ...x }) => x);
    const items = all.filter((x) => !dismissed.has(x.key));
    res.json({ items, dismissed: all.filter((x) => dismissed.has(x.key)), monthlyMinor: items.reduce((n, x) => n + x.monthlyMinor, 0) });
  });
  r.get('/recurring/calendar', (req, res) => {
    const { month } = parse(monthQuery, req.query);
    const { found, dismissed, today } = load(req.user.id);
    const start = days(month + '-01');
    const end = days(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 1)).toISOString().slice(0, 10)); // first day of the next month
    const out = Array.from({ length: end - start }, (_, i) => ({ date: dayStr(start + i), items: [] as any[] }));
    for (const g of found.values()) {
      if (dismissed.has(g.key)) continue;
      const item = (date: number, amountMinor: number, paid: boolean) => {
        if (date >= start && date < end) out[date - start]!.items.push({ key: g.key, payee: g.payee, amountMinor, subsectionId: g.subsectionId, paid });
      };
      const actual = g.payments.map((x: any) => days(x.date));
      g.payments.forEach((x: any) => item(days(x.date), x.amountMinor, true));
      for (let k = 1, d = days(stepDate(g.lastDate, g.cadence, 1)); d < end; d = days(stepDate(g.lastDate, g.cadence, ++k)))
        if (d >= today && !actual.some((a: number) => Math.abs(a - d) <= 3)) item(d, g.amountMinor, false);
    }
    res.json({ month, days: out });
  });
  // A key is known when it is a current group or was dismissed before.
  const known = (req: any) => {
    const { found, dismissed } = load(req.user.id);
    const key = req.params.key as string;
    if (!found.has(key) && !dismissed.has(key)) throw notFound();
    return key;
  };
  r.post('/recurring/:key/dismiss', (req, res) => {
    db.prepare('INSERT OR IGNORE INTO recurring_dismissed (user_id, key) VALUES (?, ?)').run(req.user.id, known(req));
    res.status(204).end();
  });
  r.delete('/recurring/:key/dismiss', (req, res) => {
    db.prepare('DELETE FROM recurring_dismissed WHERE user_id = ? AND key = ?').run(req.user.id, known(req));
    res.status(204).end();
  });
  return r;
}
