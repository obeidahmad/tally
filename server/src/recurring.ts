import { Router } from 'express';
import type { Db } from './db';
import { notFound } from './http';

const DAY = 86400000;
const BANDS = { weekly: [6, 8], monthly: [25, 35], yearly: [355, 375] } as const;
const days = (d: string) => Date.parse(d + 'T00:00:00Z') / DAY;
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
export const payeeKey = (p: string) => p.toLowerCase().replace(/[\d\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();

type Row = { date: string; baseAmountMinor: number; subsectionId: number | null; payee: string };

function detect(rows: Row[]) {
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
    const amount = median(list.map((r) => r.baseAmountMinor));
    if (!list.every((r) => Math.abs(r.baseAmountMinor - amount) <= amount * 0.15)) continue;
    const last = list[list.length - 1]!;
    found.set(key, {
      key, payee: last.payee, cadence, amountMinor: amount, lastDate: last.date,
      nextDate: dayStr(days(last.date) + median(gaps)), count: list.length, subsectionId: last.subsectionId,
      monthlyMinor: Math.round(cadence === 'weekly' ? (amount * 52) / 12 : cadence === 'yearly' ? amount / 12 : amount),
    });
  }
  return found;
}

export function recurringRouter(db: Db, now: () => number): Router {
  const r = Router();
  const load = (uid: number) => {
    const d = new Date(now());
    const since = dayStr(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) - 800);
    const rows = db.prepare(`SELECT date, base_amount_minor AS baseAmountMinor, payee,
      COALESCE(subsection_id, (SELECT subsection_id FROM transaction_splits p WHERE p.transaction_id = transactions.id ORDER BY amount_minor DESC, id LIMIT 1)) AS subsectionId FROM transactions
      WHERE user_id = ? AND kind = 'expense' AND source != 'adjustment' AND date >= ? ORDER BY date, id`).all(uid, since) as Row[];
    const dismissed = new Set(db.prepare('SELECT key FROM recurring_dismissed WHERE user_id = ?').pluck().all(uid) as string[]);
    return { found: detect(rows), dismissed };
  };
  const byNext = (a: any, b: any) => a.nextDate.localeCompare(b.nextDate) || a.key.localeCompare(b.key);

  r.get('/recurring', (req, res) => {
    const { found, dismissed } = load(req.user.id);
    const all = [...found.values()].sort(byNext);
    const items = all.filter((x) => !dismissed.has(x.key));
    res.json({ items, dismissed: all.filter((x) => dismissed.has(x.key)), monthlyMinor: items.reduce((n, x) => n + x.monthlyMinor, 0) });
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
