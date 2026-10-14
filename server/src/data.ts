import { Router, type Request } from 'express';
import type { Db } from './db';
import type { Rates } from './rates';
import { HttpError, fieldError, notFound, parse } from './http';
import * as s from './schemas';
import { bankRouter, type BankConfig } from './banks';
import { guessMapping, readAmount, readCsv, readDate } from './csv';

const POCKET = `SELECT p.id, p.name, p.kind, p.emoji, p.currency, p.opening_balance_minor AS openingBalanceMinor,
  p.opening_balance_minor + COALESCE((SELECT SUM(
      CASE WHEN t.pocket_id = p.id THEN (CASE t.kind WHEN 'income' THEN t.amount_minor ELSE -t.amount_minor END) ELSE 0 END
      + CASE WHEN t.to_pocket_id = p.id THEN t.to_amount_minor ELSE 0 END)
    FROM transactions t WHERE (t.pocket_id = p.id OR t.to_pocket_id = p.id) AND t.user_id = p.user_id), 0)
    - COALESCE((SELECT SUM(h.paid_minor) FROM holdings h WHERE h.pocket_id = p.id AND h.sold_date IS NULL), 0) AS balanceMinor,
  p.synced_balance_minor AS syncedBalanceMinor, p.synced_at AS syncedAt,
  EXISTS (SELECT 1 FROM transactions x WHERE (x.pocket_id = p.id OR x.to_pocket_id = p.id) AND x.user_id = p.user_id) AS hasTransactions
  FROM pockets p`;
const SUB = `SELECT id, section_id AS sectionId, name, position, kind, budget_kind AS budgetKind,
  CASE WHEN budget_kind = 'amount' THEN budget_minor END AS budgetMinor, budget_basis_points AS budgetBasisPoints,
  keep, cap_minor AS capMinor FROM subsections`;
const TX = `SELECT id, date, kind, amount_minor AS amountMinor, pocket_id AS pocketId, subsection_id AS subsectionId, source_id AS sourceId,
  base_amount_minor AS baseAmountMinor, to_pocket_id AS toPocketId, to_amount_minor AS toAmountMinor,
  payee, note, source FROM transactions`;

const HOLD = `SELECT id, name, pocket_id AS pocketId, subsection_id AS subsectionId, paid_minor AS paidMinor, worth_minor AS worthMinor,
  worth_currency AS worthCurrency, worth_date AS worthDate, sold_date AS soldDate FROM holdings`;
const UNSORTED = `source IN ('import', 'bank') AND ((kind = 'expense' AND subsection_id IS NULL) OR (kind = 'income' AND source_id IS NULL))`;

type Rule = { shares: { sectionId: number | null; basisPoints: number }[]; overspent: 'income' | 'section' };
const idOf = (req: Request): number => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id as string) || !Number.isSafeInteger(id)) throw notFound();
  return id;
};
const inUse = (what: string) => new HttpError(409, 'in_use', `This ${what} has transactions. Delete them first.`);

const noRate = (currency: string) => new HttpError(409, 'no_rate', `There is no exchange rate for ${currency} yet.`);
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function dataRouter(db: Db, rates: Rates, now: () => number, bank: BankConfig): Router {
  const r = Router();
  // Rates are read when stale before any route runs; a failed read keeps the old ones.
  r.use(async (_req, _res, next) => { await rates.ensure(); next(); });
  const today = () => localDay(now());
  const one = (sql: string, ...args: unknown[]): any => db.prepare(sql).get(...args);
  const all = <T = any>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];
  const must = (row: any): any => {
    if (!row) throw notFound();
    return row;
  };
  // A holding's worth in the pocket's currency at today's rate; with no rate it stays at what was paid.
  const worthIn = (h: { worthMinor: number; worthCurrency: string; paidMinor: number }, currency: string) =>
    rates.convert(h.worthMinor, h.worthCurrency, currency, today()) ?? h.paidMinor;
  const withBase = (p: any, base: string) => {
    const held = all<any>(`${HOLD} WHERE pocket_id = ? AND sold_date IS NULL`, p.id);
    const valueMinor = p.balanceMinor + held.reduce((a, h) => a + worthIn(h, p.currency), 0);
    return { ...p, hasTransactions: !!p.hasTransactions, valueMinor, baseValueMinor: rates.convert(valueMinor, p.currency, base, today()) };
  };
  const pocketOf = (user: { id: number; baseCurrency: string }, id: number) =>
    withBase(must(one(`${POCKET} WHERE p.id = ? AND p.user_id = ?`, id, user.id)), user.baseCurrency);
  const hasTx = (uid: number, id: number) => !!one('SELECT 1 FROM transactions WHERE (pocket_id = ? OR to_pocket_id = ?) AND user_id = ?', id, id, uid);
  const hasHoldings = (uid: number, id: number) => !!one('SELECT 1 FROM holdings WHERE pocket_id = ? AND user_id = ?', id, uid);
  const currencyOf = (user: { baseCurrency: string }, c: unknown) => {
    if (typeof c !== 'string' || !rates.offered(user.baseCurrency).includes(c)) throw fieldError('currency', 'Choose a currency.');
    return c;
  };
  const subOf = (uid: number, id: number) => must(one(`${SUB} WHERE id = ? AND user_id = ?`, id, uid));
  const txOf = (uid: number, id: number) => must(one(`${TX} WHERE id = ? AND user_id = ?`, id, uid));
  const ruleOf = (id: number): Rule => {
    const shares = all('SELECT to_section_id AS sectionId, basis_points AS basisPoints FROM rest_shares WHERE section_id = ? ORDER BY id', id);
    return {
      shares: shares.length ? shares : [{ sectionId: null, basisPoints: 10000 }],
      overspent: one('SELECT overspent FROM sections WHERE id = ?', id).overspent,
    };
  };
  const sectionOf = (uid: number, id: number) => {
    const sec = must(one('SELECT id, name, color_slot AS colorSlot, position FROM sections WHERE id = ? AND user_id = ?', id, uid));
    return { ...sec, subsections: all(`${SUB} WHERE section_id = ? AND user_id = ? ORDER BY position, id`, id, uid), rest: ruleOf(id) };
  };

  // Months. A month is closed when it is the last closed one or earlier.
  const nextMonth = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  };
  const lastClosedOf = (uid: number): string | null => one('SELECT MAX(month) AS m FROM closed_months WHERE user_id = ?', uid).m ?? null;
  const monthsOf = (uid: number) => {
    const lastClosed = lastClosedOf(uid);
    const first: string | null = lastClosed ? nextMonth(lastClosed) : one(`SELECT MIN(substr(date, 1, 7)) AS m FROM transactions WHERE user_id = ? AND kind != 'transfer'`, uid).m;
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { lastClosed, toClose: first && first < current ? first : null };
  };
  const isClosed = (uid: number, month: string) => {
    const last = lastClosedOf(uid);
    return last !== null && month <= last;
  };
  const monthParam = (req: Request) => {
    const m = req.params.month as string;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw fieldError('month', 'Choose a month.');
    return m;
  };

  // Pockets
  r.get('/pockets', (req, res) => {
    res.json({ pockets: all(`${POCKET} WHERE p.user_id = ? ORDER BY p.id`, req.user.id).map((p) => withBase(p, req.user.baseCurrency)) });
  });
  r.post('/pockets', (req, res) => {
    const b = parse(s.pocket, req.body);
    const currency = b.currency === undefined ? req.user.baseCurrency : currencyOf(req.user, b.currency);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO pockets (user_id, name, kind, emoji, currency, opening_balance_minor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, b.name, b.kind, b.emoji ?? String.fromCodePoint(s.DEFAULT_EMOJI[b.kind]), currency, b.openingBalanceMinor);
    res.status(201).json({ pocket: pocketOf(req.user, Number(lastInsertRowid)) });
  });
  r.patch('/pockets/:id', (req, res) => {
    const cur = pocketOf(req.user, idOf(req));
    const b = parse(s.pocket, { ...cur, ...req.body });
    if (b.currency !== cur.currency) {
      currencyOf(req.user, b.currency);
      if (hasTx(req.user.id, cur.id) || hasHoldings(req.user.id, cur.id)) throw fieldError('currency', 'A pocket with transactions keeps its currency.');
      if (one('SELECT 1 FROM bank_accounts WHERE pocket_id = ?', cur.id)) throw fieldError('currency', 'A pocket linked to a bank account keeps its currency.');
    }
    db.prepare('UPDATE pockets SET name = ?, kind = ?, emoji = ?, currency = ?, opening_balance_minor = ? WHERE id = ? AND user_id = ?').run(
      b.name, b.kind, b.emoji, b.currency, b.openingBalanceMinor, cur.id, req.user.id,
    );
    res.json({ pocket: pocketOf(req.user, cur.id) });
  });
  r.delete('/pockets/:id', (req, res) => {
    const cur = pocketOf(req.user, idOf(req));
    if (hasTx(req.user.id, cur.id)) throw inUse('pocket');
    if (hasHoldings(req.user.id, cur.id)) throw new HttpError(409, 'in_use', 'This pocket has holdings. Delete them first.');
    db.prepare('DELETE FROM pockets WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Currencies
  r.get('/rates', (req, res) => {
    const base = req.user.baseCurrency;
    const date = parse(s.rateQuery, req.query).date ?? today();
    const currencies = rates.offered(base).flatMap((currency) => {
      const rate = rates.rate(base, currency, date);
      return rate ? [{ currency, rate }] : [];
    });
    res.json({ date: rates.storedDate(date) ?? date, base, currencies });
  });
  r.get('/networth', (req, res) => {
    const base = req.user.baseCurrency;
    const sums = new Map<string, number>([[base, 0]]);
    for (const p of all<any>(`${POCKET} WHERE p.user_id = ?`, req.user.id).map((x) => withBase(x, base)))
      sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.valueMinor);
    const missingRates: string[] = [];
    const byCurrency = [...sums].sort(([a], [b]) => (a === base ? -1 : b === base ? 1 : a < b ? -1 : 1)).map(([currency, amountMinor]) => {
      const baseMinor = rates.convert(amountMinor, currency, base, today());
      if (baseMinor === null) missingRates.push(currency);
      return { currency, amountMinor, baseMinor, rate: currency === base ? null : rates.rate(currency, base, today()) };
    });
    res.json({ currency: base, totalMinor: byCurrency.reduce((a, x) => a + (x.baseMinor ?? 0), 0), byCurrency, missingRates });
  });

  r.get('/reports', (req, res) => {
    const uid = req.user.id;
    const base = req.user.baseCurrency;
    const q = req.query.months;
    if (q !== undefined && !(typeof q === 'string' && ['3', '6', '12', '24'].includes(q))) throw fieldError('months', 'Choose 3, 6, 12 or 24 months.');
    const n = Number(q ?? 12);
    const [y, m] = today().split('-').map(Number) as [number, number];
    const months = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
      return d.toISOString().slice(0, 7);
    });
    const sections = all<{ id: number }>('SELECT id FROM sections WHERE user_id = ? ORDER BY position, id', uid);
    const bySub = new Map<string, number>();
    for (const x of all<{ month: string; sectionId: number; v: number }>(
      `SELECT substr(t.date, 1, 7) AS month, s.section_id AS sectionId, SUM(t.base_amount_minor) AS v
       FROM (SELECT * FROM transactions WHERE user_id = ? AND kind = 'expense' AND NOT (${UNSORTED})) t
       JOIN subsections s ON s.id = t.subsection_id GROUP BY 1, 2`, uid))
      bySub.set(`${x.month}/${x.sectionId}`, x.v);
    const flow = new Map<string, number>();
    for (const x of all<{ month: string; kind: string; v: number }>(
      `SELECT substr(date, 1, 7) AS month, kind, SUM(base_amount_minor) AS v FROM transactions
       WHERE user_id = ? AND kind IN ('income', 'expense') AND NOT (${UNSORTED}) GROUP BY 1, 2`, uid))
      flow.set(`${x.month}/${x.kind}`, x.v);

    // Past months: opening balance plus transactions up to the month's last day. A held holding's cost is deducted from the
    // balance and added back, so it cancels out; no purchase date is stored, so it is never left out of a month.
    const pockets = all<{ id: number; currency: string; opening: number }>('SELECT id, currency, opening_balance_minor AS opening FROM pockets WHERE user_id = ?', uid);
    const moved = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN pocket_id = ? THEN (CASE kind WHEN 'income' THEN amount_minor ELSE -amount_minor END) ELSE 0 END
         + CASE WHEN to_pocket_id = ? THEN to_amount_minor ELSE 0 END), 0) FROM transactions
       WHERE user_id = ? AND (pocket_id = ? OR to_pocket_id = ?) AND date <= ?`).pluck();
    const current = months[n - 1]!;
    const missing = new Set<string>();
    const networth = months.map((month) => {
      const day = month === current ? today() : `${month}-${new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate()}`;
      const sums = new Map<string, number>();
      if (month === current)
        for (const p of all<any>(`${POCKET} WHERE p.user_id = ?`, uid).map((x) => withBase(x, base))) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.valueMinor);
      else for (const p of pockets) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.opening + (moved.get(p.id, p.id, uid, p.id, p.id, day) as number));
      let minor = 0;
      for (const [currency, amount] of sums) {
        const c = rates.convert(amount, currency, base, day);
        if (c === null) missing.add(currency);
        else minor += c;
      }
      return { month, minor };
    });
    res.json({
      currency: base,
      months,
      spending: months.map((month) => {
        const bySection = sections.map(({ id }) => ({ sectionId: id, minor: bySub.get(`${month}/${id}`) ?? 0 }));
        return { month, bySection, totalMinor: bySection.reduce((a, x) => a + x.minor, 0) };
      }),
      cashflow: months.map((month) => ({ month, incomeMinor: flow.get(`${month}/income`) ?? 0, spendingMinor: flow.get(`${month}/expense`) ?? 0 })),
      networth,
      missingRates: [...missing].sort(),
    });
  });

  // Sections and subsections
  r.get('/sections',(req, res) => {
    const ids = all<{ id: number }>('SELECT id FROM sections WHERE user_id = ? ORDER BY position, id', req.user.id);
    res.json({ sections: ids.map((x) => sectionOf(req.user.id, x.id)) });
  });
  r.post('/sections', (req, res) => {
    const b = parse(s.section, req.body);
    const used = new Set(all<{ c: number }>('SELECT color_slot AS c FROM sections WHERE user_id = ?', req.user.id).map((x) => x.c));
    const slot = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !used.has(n)) ?? 0;
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO sections (user_id, name, color_slot, position)
                VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM sections WHERE user_id = ?))`)
      .run(req.user.id, b.name, slot, req.user.id);
    res.status(201).json({ section: sectionOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/sections/:id', (req, res) => {
    const cur = sectionOf(req.user.id, idOf(req));
    const b = parse(s.section, { ...cur, ...req.body });
    db.prepare('UPDATE sections SET name = ? WHERE id = ? AND user_id = ?').run(b.name, cur.id, req.user.id);
    res.json({ section: sectionOf(req.user.id, cur.id) });
  });
  r.delete('/sections/:id', (req, res) => {
    const cur = sectionOf(req.user.id, idOf(req));
    const used = one(
      `SELECT 1 FROM transactions t JOIN subsections x ON x.id = t.subsection_id
       WHERE x.section_id = ? AND t.user_id = ?`, cur.id, req.user.id);
    if (used) throw inUse('section');
    if (one('SELECT 1 FROM holdings WHERE user_id = ? AND subsection_id IN (SELECT id FROM subsections WHERE section_id = ?)', req.user.id, cur.id))
      throw new HttpError(409, 'in_use', 'This section has holdings. Delete them first.');
    if (one(`SELECT 1 FROM steps WHERE section_id = ? AND user_id = ?
             UNION SELECT 1 FROM step_shares h JOIN steps p ON p.id = h.step_id WHERE h.section_id = ? AND p.user_id = ?
             UNION SELECT 1 FROM rest_shares h JOIN sections o ON o.id = h.section_id WHERE h.to_section_id = ? AND h.section_id != ? AND o.user_id = ?`,
      cur.id, req.user.id, cur.id, req.user.id, cur.id, cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This section is used in the pipeline. Remove it from the steps and rest rules first.');
    if (one('SELECT 1 FROM carries WHERE user_id = ? AND (section_id = ? OR subsection_id IN (SELECT id FROM subsections WHERE section_id = ?))', req.user.id, cur.id, cur.id))
      throw new HttpError(409, 'in_use', 'This section has money carried between months.');
    if (one(`SELECT 1 FROM moves WHERE user_id = ? AND (from_section_id = ? OR to_section_id = ?
             OR from_subsection_id IN (SELECT id FROM subsections WHERE section_id = ?) OR to_subsection_id IN (SELECT id FROM subsections WHERE section_id = ?))`,
      req.user.id, cur.id, cur.id, cur.id, cur.id))
      throw new HttpError(409, 'in_use', 'This section has money moved this month.');
    db.prepare('DELETE FROM sections WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });
  // Checks a subsection's body, including the rules that need the database, then saves it at `position` among its section's subsections.
  const saveSub = (uid: number, sectionId: number, id: number | null, input: any, keepPosition?: number) => {
    const b = parse(s.subsection, input);
    const others = all<{ id: number; bp: number | null }>(
      'SELECT id, budget_basis_points AS bp FROM subsections WHERE section_id = ? AND user_id = ? AND id IS NOT ? ORDER BY position, id', sectionId, uid, id);
    if (b.budgetKind === 'percent' && others.reduce((a, x) => a + (x.bp ?? 0), 0) + b.budgetBasisPoints! > 10000)
      throw fieldError('budgetBasisPoints', 'The percentages in one section can add up to at most 100.');
    const pos = input.position ?? keepPosition ?? others.length + 1;
    if (!s.subsectionPosition.safeParse(pos).success || pos < 1 || pos > others.length + 1) throw fieldError('position', 'Choose a position.');
    return db.transaction(() => {
      const cols = [b.name, b.kind, b.budgetKind, b.budgetMinor, b.budgetBasisPoints, b.keep, b.capMinor];
      if (id === null)
        id = Number(db.prepare(`INSERT INTO subsections (user_id, section_id, name, kind, budget_kind, budget_minor, budget_basis_points, keep, cap_minor, position)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(uid, sectionId, ...cols).lastInsertRowid);
      else
        db.prepare('UPDATE subsections SET name = ?, kind = ?, budget_kind = ?, budget_minor = ?, budget_basis_points = ?, keep = ?, cap_minor = ? WHERE id = ? AND user_id = ?')
          .run(...cols, id, uid);
      const order = others.map((x) => x.id);
      order.splice(pos - 1, 0, id);
      order.forEach((x, i) => db.prepare('UPDATE subsections SET position = ? WHERE id = ?').run(i + 1, x));
      return subOf(uid, id);
    })();
  };
  // A goal always keeps up to its target, so a body that makes a subsection a goal without saying so gets that.
  const withDefaults = (base: any, body: any) => {
    const m = { ...base, ...body };
    if (body.keep === undefined && m.kind === 'goal') m.keep = 'cap';
    return m;
  };
  r.post('/sections/:id/subsections', (req, res) => {
    const sec = sectionOf(req.user.id, idOf(req));
    res.status(201).json({ subsection: saveSub(req.user.id, sec.id, null, withDefaults({ kind: 'spending', budgetKind: 'amount', keep: 'all' }, req.body ?? {})) });
  });
  r.patch('/subsections/:id', (req, res) => {
    const cur = subOf(req.user.id, idOf(req)) as any;
    const { position, ...base } = cur;
    res.json({ subsection: saveSub(req.user.id, cur.sectionId, cur.id, withDefaults(base, req.body ?? {}), position) });
  });
  r.delete('/subsections/:id', (req, res) => {
    const cur = subOf(req.user.id, idOf(req)) as any;
    if (one('SELECT 1 FROM transactions WHERE subsection_id = ? AND user_id = ?', cur.id, req.user.id)) throw inUse('subsection');
    if (one('SELECT 1 FROM holdings WHERE subsection_id = ? AND user_id = ?', cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This subsection has holdings. Delete them first.');
    if (one('SELECT 1 FROM carries WHERE subsection_id = ? AND user_id = ?', cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This subsection has money carried between months.');
    if (one('SELECT 1 FROM moves WHERE (from_subsection_id = ? OR to_subsection_id = ?) AND user_id = ?', cur.id, cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This subsection has money moved this month.');
    db.prepare('DELETE FROM subsections WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  r.put('/sections/:id/rest', (req, res) => {
    const cur = sectionOf(req.user.id, idOf(req));
    const b = parse(s.restRule, req.body) as Rule;
    if (!b.shares.every((x) => x.sectionId === null || one('SELECT 1 FROM sections WHERE id = ? AND user_id = ?', x.sectionId, req.user.id)))
      throw fieldError('shares', 'Choose a different destination in every row.');
    db.transaction(() => {
      db.prepare('UPDATE sections SET overspent = ? WHERE id = ?').run(b.overspent, cur.id);
      db.prepare('DELETE FROM rest_shares WHERE section_id = ?').run(cur.id);
      for (const x of b.shares) db.prepare('INSERT INTO rest_shares (section_id, to_section_id, basis_points) VALUES (?, ?, ?)').run(cur.id, x.sectionId, x.basisPoints);
    })();
    res.json({ section: sectionOf(req.user.id, cur.id) });
  });

  // Transactions
  const LEFTOVERS = "Last month's leftovers";
  const checked = (user: { id: number; baseCurrency: string }, body: unknown, unsorted = false) => {
    const uid = user.id;
    const t = parse(s.transaction, body);
    if (isClosed(uid, t.date.slice(0, 7))) throw fieldError('date', 'This date is in a closed month.');
    const from = one('SELECT currency FROM pockets WHERE id = ? AND user_id = ?', t.pocketId, uid);
    if (!from) throw fieldError('pocketId', 'Choose a pocket.');
    let toAmountMinor = t.toAmountMinor;
    if (t.kind === 'transfer') {
      const to = one('SELECT currency FROM pockets WHERE id = ? AND user_id = ?', t.toPocketId, uid);
      if (!to) throw fieldError('toPocketId', 'Choose a different pocket.');
      if (to.currency === from.currency) {
        if (toAmountMinor !== null && toAmountMinor !== t.amountMinor) throw fieldError('toAmountMinor', 'Both pockets use the same currency, so the amount that arrived is the same.');
        toAmountMinor = t.amountMinor;
      } else if (toAmountMinor === null) throw fieldError('toAmountMinor', 'Enter the amount that arrived.');
    }
    if (!unsorted && t.subsectionId !== null && !one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', t.subsectionId, uid))
      throw fieldError('subsectionId', 'Choose a subsection.');
    if (!unsorted && t.sourceId !== null && !one('SELECT 1 FROM sources WHERE id = ? AND user_id = ? AND is_leftovers = 0', t.sourceId, uid)) throw fieldError('sourceId', 'Choose a source.');
    return { ...t, toAmountMinor, currency: from.currency as string };
  };
  // The amount in the base currency at the date's rate.
  const baseOf = (user: { baseCurrency: string }, t: { amountMinor: number; currency: string; date: string }) => {
    const v = rates.convert(t.amountMinor, t.currency, user.baseCurrency, t.date);
    if (v === null) throw noRate(t.currency);
    return v;
  };
  const lockedTx = (uid: number, cur: { date: string }) => {
    if (isClosed(uid, cur.date.slice(0, 7))) throw new HttpError(409, 'closed', 'This transaction is in a closed month. Reopen the month to change it.');
  };
  r.get('/transactions', (req, res) => {
    const q = parse(s.txQuery, req.query);
    if (!q.month && q.unsorted !== '1') throw fieldError('month', 'Use a month like 2026-10.');
    let sql = `${TX} WHERE user_id = ?`;
    const args: unknown[] = [req.user.id];
    if (q.month) { sql += ' AND substr(date, 1, 7) = ?'; args.push(q.month); }
    if (q.unsorted === '1') sql += ` AND ${UNSORTED}`;
    if (q.pocketId !== undefined) { sql += ' AND (pocket_id = ? OR to_pocket_id = ?)'; args.push(q.pocketId, q.pocketId); }
    if (q.subsectionId !== undefined) { sql += ' AND subsection_id = ?'; args.push(q.subsectionId); }
    res.json({ transactions: all(`${sql} ORDER BY date DESC, id DESC`, ...args) });
  });
  r.post('/transactions', (req, res) => {
    const t = checked(req.user, req.body);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, subsection_id, source_id, to_pocket_id, to_amount_minor, payee, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, t.date, t.kind, t.amountMinor, baseOf(req.user, t), t.pocketId, t.subsectionId, t.sourceId, t.toPocketId, t.toAmountMinor, t.payee, t.note);
    res.status(201).json({ transaction: txOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/transactions/:id', (req, res) => {
    const cur = txOf(req.user.id, idOf(req)) as any;
    lockedTx(req.user.id, cur);
    const imported = cur.source === 'import' || cur.source === 'bank';
    if (imported)
      for (const k of ['date', 'kind', 'amountMinor', 'pocketId', 'toPocketId', 'toAmountMinor'])
        if (req.body && k in req.body && req.body[k] !== cur[k]) throw fieldError(k, 'An imported transaction keeps this.');
    const merged = { ...cur, ...req.body };
    // An imported transaction may stay unsorted: null is checked with a stand-in id, then kept as null.
    const open = imported && ((merged.kind === 'expense' && merged.subsectionId == null) || (merged.kind === 'income' && merged.sourceId == null));
    const t = checked(req.user, open ? { ...merged, [merged.kind === 'expense' ? 'subsectionId' : 'sourceId']: -1 } : merged, open);
    if (open) { t.subsectionId = null; t.sourceId = null; }
    // An imported income keeps its payee, which rules match on.
    if (imported) t.payee = String({ ...cur, ...req.body }.payee).trim();
    // The base amount is worked out again only when its date, amount or pocket changes.
    const same = t.date === cur.date && t.amountMinor === cur.amountMinor && t.pocketId === cur.pocketId;
    db.prepare(`UPDATE transactions SET date = ?, kind = ?, amount_minor = ?, base_amount_minor = ?, pocket_id = ?, subsection_id = ?, source_id = ?,
                  to_pocket_id = ?, to_amount_minor = ?, payee = ?, note = ? WHERE id = ? AND user_id = ?`)
      .run(t.date, t.kind, t.amountMinor, same ? cur.baseAmountMinor : baseOf(req.user, t), t.pocketId, t.subsectionId, t.sourceId,
        t.toPocketId, t.toAmountMinor, t.payee, t.note, cur.id, req.user.id);
    res.json({ transaction: txOf(req.user.id, cur.id) });
  });
  r.delete('/transactions/:id', (req, res) => {
    const cur = txOf(req.user.id, idOf(req)) as any;
    lockedTx(req.user.id, cur);
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Sources and steps
  const SRC = 'SELECT id, name, box_id AS boxId, is_leftovers AS isLeftovers FROM sources';
  const src = (x: any) => ({ ...x, isLeftovers: !!x.isLeftovers });
  const srcOf = (uid: number, id: number) => src(must(one(`${SRC} WHERE id = ? AND user_id = ?`, id, uid)));
  const newBox = () => one('SELECT COALESCE(MAX(box_id), 0) + 1 AS v FROM sources').v as number;
  const boxExists = (uid: number, id: number) => !!one('SELECT 1 FROM sources WHERE box_id = ? AND user_id = ?', id, uid);
  const checkName = (uid: number, name: string, exceptId: number) => {
    if (name.toLowerCase() === LEFTOVERS.toLowerCase()) throw fieldError('name', 'This name is kept for money carried from last month.');
    if (all<{ id: number; name: string }>('SELECT id, name FROM sources WHERE user_id = ?', uid).some((x) => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase()))
      throw fieldError('name', 'You already have a source with this name.');
  };
  const checkBox = (uid: number, boxId: unknown): number | null => {
    if (boxId === undefined || boxId === null) return null;
    if (typeof boxId !== 'number' || !boxExists(uid, boxId)) throw fieldError('boxId', 'Choose a box.');
    return boxId;
  };
  // A box with no source left takes its steps with it.
  const dropEmptyBox = (uid: number, boxId: number) => {
    if (!boxExists(uid, boxId)) db.prepare('DELETE FROM steps WHERE box_id = ? AND user_id = ?').run(boxId, uid);
  };

  r.get('/sources', (req, res) => {
    res.json({ sources: all(`${SRC} WHERE user_id = ? ORDER BY id`, req.user.id).map(src) });
  });
  r.post('/sources', (req, res) => {
    const b = parse(s.source, req.body);
    checkName(req.user.id, b.name, 0);
    const boxId = checkBox(req.user.id, req.body?.boxId) ?? newBox();
    const { lastInsertRowid } = db.prepare('INSERT INTO sources (user_id, name, box_id) VALUES (?, ?, ?)').run(req.user.id, b.name, boxId);
    res.status(201).json({ source: srcOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/sources/:id', (req, res) => {
    const cur = srcOf(req.user.id, idOf(req));
    const b = parse(s.source, { name: cur.name, ...req.body });
    if (cur.isLeftovers) {
      if (b.name !== cur.name) throw fieldError('name', 'This source keeps its name.');
    } else checkName(req.user.id, b.name, cur.id);
    const boxId = req.body && 'boxId' in req.body ? (checkBox(req.user.id, req.body.boxId) ?? newBox()) : cur.boxId;
    db.transaction(() => {
      db.prepare('UPDATE sources SET name = ?, box_id = ? WHERE id = ? AND user_id = ?').run(b.name, boxId, cur.id, req.user.id);
      dropEmptyBox(req.user.id, cur.boxId);
    })();
    res.json({ source: srcOf(req.user.id, cur.id) });
  });
  r.delete('/sources/:id', (req, res) => {
    const cur = srcOf(req.user.id, idOf(req));
    if (cur.isLeftovers) throw new HttpError(409, 'in_use', 'This source carries money between months.');
    if (one('SELECT 1 FROM transactions WHERE source_id = ? AND user_id = ?', cur.id, req.user.id)) throw inUse('source');
    db.transaction(() => {
      db.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
      dropEmptyBox(req.user.id, cur.boxId);
    })();
    res.status(204).end();
  });

  type StepRow = { id: number; boxId: number; position: number; kind: 'amount' | 'percent'; sectionId: number | null; amountMinor: number | null };
  const stepRows = (uid: number, where = '', ...args: unknown[]) =>
    all<StepRow>(`SELECT id, box_id AS boxId, position, kind, section_id AS sectionId, amount_minor AS amountMinor
                  FROM steps WHERE user_id = ? ${where} ORDER BY box_id, position, id`, uid, ...args);
  const sharesOf = (id: number) =>
    all<{ sectionId: number; basisPoints: number }>('SELECT section_id AS sectionId, basis_points AS basisPoints FROM step_shares WHERE step_id = ? ORDER BY id', id);
  const stepOf = (uid: number, id: number) => {
    const st = stepRows(uid, 'AND id = ?', id)[0];
    if (!st) throw notFound();
    return st.kind === 'amount'
      ? { id: st.id, boxId: st.boxId, position: st.position, kind: 'amount', sectionId: st.sectionId, amountMinor: st.amountMinor }
      : { id: st.id, boxId: st.boxId, position: st.position, kind: 'percent', shares: sharesOf(st.id) };
  };
  // Reads and checks a step body; a position must be from 1 to `count`.
  const stepBody = (uid: number, body: unknown, count: number) => {
    const { kind } = parse(s.stepKind, body);
    const b: any = kind === 'amount' ? parse(s.amountStep, body) : parse(s.percentStep, body);
    const owned = (id: number) => !!one('SELECT 1 FROM sections WHERE id = ? AND user_id = ?', id, uid);
    if (kind === 'amount' && !owned(b.sectionId)) throw fieldError('sectionId', 'Choose a section.');
    if (kind === 'percent' && !b.shares.every((x: any) => owned(x.sectionId)))
      throw fieldError('shares', 'Choose a different section in every row.');
    if (b.position !== undefined && (b.position < 1 || b.position > count)) throw fieldError('position', 'Choose a position.');
    return { kind, ...b } as { kind: 'amount' | 'percent'; sectionId: number; amountMinor: number; shares: { sectionId: number; basisPoints: number }[]; position?: number };
  };
  const writeStep = (id: number, b: ReturnType<typeof stepBody>) => {
    db.prepare('UPDATE steps SET kind = ?, section_id = ?, amount_minor = ? WHERE id = ?')
      .run(b.kind, b.kind === 'amount' ? b.sectionId : null, b.kind === 'amount' ? b.amountMinor : null, id);
    db.prepare('DELETE FROM step_shares WHERE step_id = ?').run(id);
    if (b.kind === 'percent')
      for (const x of b.shares) db.prepare('INSERT INTO step_shares (step_id, section_id, basis_points) VALUES (?, ?, ?)').run(id, x.sectionId, x.basisPoints);
  };
  // Puts the steps in the given order and numbers them 1 to n.
  const renumber = (ids: number[]) => ids.forEach((id, i) => db.prepare('UPDATE steps SET position = ? WHERE id = ?').run(i + 1, id));
  const boxIds = (uid: number, boxId: number) => stepRows(uid, 'AND box_id = ?', boxId).map((x) => x.id);

  r.post('/boxes/:id/steps', (req, res) => {
    const boxId = idOf(req);
    if (!boxExists(req.user.id, boxId)) throw notFound();
    const ids = boxIds(req.user.id, boxId);
    const b = stepBody(req.user.id, req.body, ids.length + 1);
    const id = db.transaction(() => {
      const { lastInsertRowid } = db.prepare("INSERT INTO steps (user_id, box_id, position, kind) VALUES (?, ?, 0, 'amount')").run(req.user.id, boxId);
      const sid = Number(lastInsertRowid);
      writeStep(sid, b);
      ids.splice((b.position ?? ids.length + 1) - 1, 0, sid);
      renumber(ids);
      return sid;
    })();
    res.status(201).json({ step: stepOf(req.user.id, id) });
  });
  r.put('/steps/:id', (req, res) => {
    const cur = stepOf(req.user.id, idOf(req));
    const ids = boxIds(req.user.id, cur.boxId);
    const b = stepBody(req.user.id, req.body, ids.length);
    db.transaction(() => {
      writeStep(cur.id, b);
      if (b.position !== undefined) {
        ids.splice(ids.indexOf(cur.id), 1);
        ids.splice(b.position - 1, 0, cur.id);
        renumber(ids);
      }
    })();
    res.json({ step: stepOf(req.user.id, cur.id) });
  });
  r.delete('/steps/:id', (req, res) => {
    const cur = stepOf(req.user.id, idOf(req));
    db.transaction(() => {
      db.prepare('DELETE FROM steps WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
      renumber(boxIds(req.user.id, cur.boxId));
    })();
    res.status(204).end();
  });


  // What closing the month before put into `month`.
  const carriesOf = (uid: number, month: string) => {
    const c = { income: 0, sections: new Map<number, number>(), subs: new Map<number, number>() };
    for (const x of all<{ sec: number | null; sub: number | null; v: number }>(
      'SELECT section_id AS sec, subsection_id AS sub, SUM(amount_minor) AS v FROM carries WHERE user_id = ? AND month = ? GROUP BY section_id, subsection_id', uid, month)) {
      if (x.sub !== null) c.subs.set(x.sub, x.v);
      else if (x.sec !== null) c.sections.set(x.sec, x.v);
      else c.income = x.v;
    }
    return c;
  };

  type End = { subsectionId: number } | { sectionId: number };
  const MOVE = 'SELECT id, month, from_subsection_id AS fs, from_section_id AS fc, to_subsection_id AS ts, to_section_id AS tc, amount_minor AS amountMinor, reason FROM moves';
  const moveOf = (x: any) => ({
    id: x.id, month: x.month, from: (x.fs !== null ? { subsectionId: x.fs } : { sectionId: x.fc }) as End,
    to: (x.ts !== null ? { subsectionId: x.ts } : { sectionId: x.tc }) as End, amountMinor: x.amountMinor, reason: x.reason,
  });
  const movesOf = (uid: number, month: string) => all(`${MOVE} WHERE user_id = ? AND month = ? ORDER BY id`, uid, month).map(moveOf);

  // What the month's income does: boxes, steps, what each section receives from them, what is left.
  const flow = (uid: number, month: string, carry: ReturnType<typeof carriesOf>) => {
    const income = new Map(
      all<{ id: number; v: number }>(
        `SELECT source_id AS id, SUM(base_amount_minor) AS v FROM transactions
         WHERE user_id = ? AND kind = 'income' AND substr(date, 1, 7) = ? GROUP BY source_id`, uid, month,
      ).map((x) => [x.id, x.v]),
    );
    const sources = all(`${SRC} WHERE user_id = ? ORDER BY id`, uid).map(src) as { id: number; name: string; boxId: number; isLeftovers: boolean }[];
    const steps = stepRows(uid);
    const received = new Map<number, number>();
    const give = (sectionId: number, v: number) => received.set(sectionId, (received.get(sectionId) ?? 0) + v);
    const boxes = [...new Set(sources.map((x) => x.boxId))].sort((a, b) => a - b).map((id) => {
      const mine = sources.filter((x) => x.boxId === id).map(({ boxId, ...x }) => ({ ...x, incomeMinor: x.isLeftovers ? carry.income : income.get(x.id) ?? 0 }));
      const incomeMinor = mine.reduce((a, x) => a + x.incomeMinor, 0);
      let left = incomeMinor;
      const out = steps.filter((x) => x.boxId === id).map((st) => {
        if (st.kind === 'amount') {
          const takenMinor = Math.max(0, Math.min(left, st.amountMinor!));
          left -= takenMinor;
          give(st.sectionId!, takenMinor);
          return { id: st.id, position: st.position, kind: 'amount', sectionId: st.sectionId, amountMinor: st.amountMinor, takenMinor, leftMinor: left };
        }
        const reach = BigInt(Math.max(0, left)); // BigInt: the product can pass 2^53
        const shares = sharesOf(st.id).map((x) => ({ ...x, takenMinor: Number((reach * BigInt(x.basisPoints)) / 10000n) }));
        for (const x of shares) { left -= x.takenMinor; give(x.sectionId, x.takenMinor); }
        return { id: st.id, position: st.position, kind: 'percent', leftMinor: left, shares };
      });
      return { id, incomeMinor, leftOverMinor: left, sources: mine, steps: out };
    });
    return { boxes, received, leftOverMinor: boxes.reduce((a, x) => a + x.leftOverMinor, 0) };
  };

  type Who = { id: number; baseCurrency: string };
  // The month worked out from today's data: the one place the budget, the pipeline and the close get their figures.
  const live = (user: Who, month: string) => {
    const uid = user.id;
    const carry = carriesOf(uid, month);
    const f = flow(uid, month, carry);
    const spent = new Map(
      all<{ id: number; v: number }>(
        `SELECT subsection_id AS id, SUM(base_amount_minor) AS v FROM transactions
         WHERE user_id = ? AND kind = 'expense' AND substr(date, 1, 7) = ? GROUP BY subsection_id`, uid, month,
      ).map((x) => [x.id, x.v]),
    );
    const txIncome = one(
      `SELECT COALESCE(SUM(base_amount_minor), 0) AS v FROM transactions
       WHERE user_id = ? AND kind = 'income' AND source_id IS NOT NULL AND substr(date, 1, 7) = ?`, uid, month).v as number;
    // What moves gave (+) and took (-), per subsection and per section's rest.
    const movedSub = new Map<number, number>(), movedSec = new Map<number, number>();
    for (const x of movesOf(uid, month)) {
      for (const [e, sign] of [[x.from, -1], [x.to, 1]] as const) {
        const [map, key] = 'subsectionId' in e ? [movedSub, e.subsectionId] : [movedSec, e.sectionId];
        map.set(key, (map.get(key) ?? 0) + sign * x.amountMinor);
      }
    }
    const secs = all<{ id: number }>('SELECT id FROM sections WHERE user_id = ? ORDER BY position, id', uid).map(({ id }) => sectionOf(uid, id));
    const closed = isClosed(uid, month);

    const pipeline = {
      month, currency: user.baseCurrency, closed, boxes: f.boxes,
      sections: secs.map((x) => ({
        id: x.id, name: x.name, colorSlot: x.colorSlot,
        receivedMinor: (f.received.get(x.id) ?? 0) + (carry.sections.get(x.id) ?? 0),
        carriedMinor: carry.sections.get(x.id) ?? 0, rest: x.rest,
      })),
      leftOverMinor: f.leftOverMinor,
    };

    const sections = secs.map((sec) => {
      let claimed = 0, overspent = 0, carried = 0, moved = 0;
      const budgetedMinor = pipeline.sections.find((x) => x.id === sec.id)!.receivedMinor;
      // Fixed amounts first; percentages share what remains, each rounded down to the cent.
      const remains = BigInt(Math.max(0, budgetedMinor - sec.subsections.reduce((a: number, x: any) => a + (x.budgetMinor ?? 0), 0)));
      const subsections: any[] = sec.subsections.map((x: any) => {
        const budgetMinor: number = x.budgetKind === 'amount' ? x.budgetMinor : Number((remains * BigInt(x.budgetBasisPoints)) / 10000n);
        const spentMinor = spent.get(x.id) ?? 0;
        const carriedMinor = carry.subs.get(x.id) ?? 0;
        const movedMinor = movedSub.get(x.id) ?? 0;
        claimed += budgetMinor;
        carried += carriedMinor;
        moved += movedMinor;
        overspent += Math.max(0, spentMinor - budgetMinor - carriedMinor - movedMinor);
        return {
          id: x.id, name: x.name, kind: x.kind, budgetKind: x.budgetKind, budgetMinor, budgetBasisPoints: x.budgetBasisPoints,
          keep: x.keep, capMinor: x.capMinor, carriedMinor, movedMinor, spentMinor, availableMinor: budgetMinor + carriedMinor + movedMinor - spentMinor,
        };
      });
      const spentMinor = subsections.reduce((a: number, x: any) => a + x.spentMinor, 0);
      const movedMinor = movedSec.get(sec.id) ?? 0;
      return {
        id: sec.id, name: sec.name, colorSlot: sec.colorSlot, movedMinor,
        budgetedMinor, restMinor: budgetedMinor - claimed - overspent + movedMinor, spentMinor,
        availableMinor: budgetedMinor + carried + moved + movedMinor - spentMinor, subsections,
      };
    });
    const budgetedMinor = sections.reduce((a, x) => a + x.budgetedMinor, 0);
    const spentMinor = sections.reduce((a, x) => a + x.spentMinor, 0);
    const budget = {
      month, currency: user.baseCurrency, closed,
      unsortedCount: one(`SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ? AND ${UNSORTED}`, uid, month).n as number,
      totals: {
        incomeMinor: txIncome + carry.income, budgetedMinor, spentMinor,
        availableMinor: sections.reduce((a, x) => a + x.availableMinor, 0), leftOverMinor: f.leftOverMinor,
      },
      sections,
    };
    return { budget, pipeline, rules: new Map(secs.map((x) => [x.id, x.rest])) };
  };

  // A closed month answers with the figures stored when it closed.
  const answer = (user: Who, month: string, which: 'budget' | 'pipeline') => {
    const stored = one('SELECT budget, pipeline FROM closed_months WHERE user_id = ? AND month = ?', user.id, month);
    return stored ? (which === 'budget' ? { unsortedCount: 0, ...JSON.parse(stored.budget) } : JSON.parse(stored.pipeline)) : live(user, month)[which];
  };
  r.get('/pipeline', (req, res) => {
    res.json(answer(req.user, parse(s.monthQuery, req.query).month, 'pipeline'));
  });
  r.get('/budget', (req, res) => {
    res.json(answer(req.user, parse(s.monthQuery, req.query).month, 'budget'));
  });

  // Moves
  const closedErr = () => new HttpError(409, 'closed', 'This month is closed. Reopen it to change it.');
  const fmt = (n: number, cur: string) => {
    const d = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n / 10 ** d);
  };
  r.get('/moves', (req, res) => {
    res.json({ moves: movesOf(req.user.id, parse(s.monthQuery, req.query).month) });
  });
  r.post('/moves', (req, res) => {
    const uid = req.user.id;
    const b = parse(s.move, req.body);
    if (isClosed(uid, b.month)) throw closedErr();
    const budget = live(req.user, b.month).budget;
    // Finds the end among the person's own subsections or sections: its name and what it has to move.
    const find = (e: End) => {
      for (const sec of budget.sections) {
        if ('sectionId' in e && sec.id === e.sectionId) return { name: sec.name, availableMinor: sec.restMinor };
        const sub = 'subsectionId' in e ? sec.subsections.find((x) => x.id === e.subsectionId) : undefined;
        if (sub) return { name: sub.name, availableMinor: sub.availableMinor };
      }
    };
    const from = find(b.from);
    if (!from) throw fieldError('from', 'Choose where the money comes from.');
    if (!find(b.to)) throw fieldError('to', 'Choose where the money goes.');
    if (JSON.stringify(b.from) === JSON.stringify(b.to)) throw fieldError('to', 'Choose a different place.');
    if (from.availableMinor <= 0) throw fieldError('amountMinor', `${from.name} has nothing to move.`);
    if (b.amountMinor > from.availableMinor)
      throw fieldError('amountMinor', `${from.name} has only ${fmt(from.availableMinor, req.user.baseCurrency)} to move.`);
    const n = (e: End, k: 'subsectionId' | 'sectionId') => (k in e ? (e as any)[k] : null);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO moves (user_id, month, from_subsection_id, from_section_id, to_subsection_id, to_section_id, amount_minor, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid, b.month, n(b.from, 'subsectionId'), n(b.from, 'sectionId'), n(b.to, 'subsectionId'), n(b.to, 'sectionId'), b.amountMinor, b.reason);
    res.status(201).json({ move: moveOf(one(`${MOVE} WHERE id = ?`, lastInsertRowid)) });
  });
  r.delete('/moves/:id', (req, res) => {
    const cur = must(one(`${MOVE} WHERE id = ? AND user_id = ?`, idOf(req), req.user.id));
    if (isClosed(req.user.id, cur.month)) throw closedErr();
    db.prepare('DELETE FROM moves WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Closing
  r.get('/months', (req, res) => { res.json(monthsOf(req.user.id)); });

  // Where each amount of month M goes, from the rest rules and the month's figures.
  const closePlan = (user: Who, month: string) => {
    const m = live(user, month);
    const rows: { fromSectionId: number | null; basisPoints: number; toSectionId: number | null; amountMinor: number }[] = [];
    const add = (fromSectionId: number | null, basisPoints: number, toSectionId: number | null, amountMinor: number) => {
      if (amountMinor !== 0) rows.push({ fromSectionId, basisPoints, toSectionId, amountMinor });
    };
    const subs = new Map<number, number>();
    for (const sec of m.budget.sections) {
      let restMinor = sec.restMinor;
      for (const x of sec.subsections) {
        const u = x.availableMinor;
        if (u <= 0) continue;
        const kept = x.keep === 'all' ? u : x.keep === 'cap' ? Math.min(u, x.capMinor!) : 0;
        if (kept > 0) subs.set(x.id, kept);
        restMinor += u - kept; // what a subsection does not keep joins the section's rest
      }
      const rule: Rule = m.rules.get(sec.id)!;
      if (restMinor < 0) add(sec.id, 10000, rule.overspent === 'section' ? sec.id : null, restMinor);
      else {
        const parts = rule.shares.map((x) => Math.floor((restMinor * x.basisPoints) / 10000));
        parts[0]! += restMinor - parts.reduce((a, n) => a + n, 0);
        rule.shares.forEach((x, i) => add(sec.id, x.basisPoints, x.sectionId, parts[i]!));
      }
    }
    add(null, 10000, null, m.budget.totals.leftOverMinor);
    const keptMinor = [...subs.values()].reduce((a, n) => a + n, 0);
    const incomeMinor = rows.reduce((a, x) => a + (x.toSectionId === null ? x.amountMinor : 0), 0);
    return { m, rows, subs, summary: { month, nextMonth: nextMonth(month), rows, keptMinor, incomeMinor } };
  };
  const closable = (uid: number, month: string) => {
    if (monthsOf(uid).toClose !== month) throw new HttpError(409, 'not_closable', 'This month cannot be closed now.');
  };

  r.get('/months/:month/close', (req, res) => {
    const month = monthParam(req);
    closable(req.user.id, month);
    res.json(closePlan(req.user, month).summary);
  });
  r.post('/months/:month/close', (req, res) => {
    const uid = req.user.id;
    const month = monthParam(req);
    closable(uid, month);
    if (one(`SELECT 1 FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ? AND ${UNSORTED}`, uid, month))
      throw new HttpError(409, 'unsorted', "Sort this month's imported transactions first.");
    db.transaction(() => {
      const p = closePlan(req.user, month);
      db.prepare('INSERT INTO closed_months (user_id, month, budget, pipeline) VALUES (?, ?, ?, ?)')
        .run(uid, month, JSON.stringify({ ...p.m.budget, closed: true }), JSON.stringify({ ...p.m.pipeline, closed: true }));
      const into = nextMonth(month);
      const put = (sec: number | null, sub: number | null, v: number) => {
        if (v !== 0) db.prepare('INSERT INTO carries (user_id, month, section_id, subsection_id, amount_minor) VALUES (?, ?, ?, ?, ?)').run(uid, into, sec, sub, v);
      };
      for (const [id, v] of p.subs) put(null, id, v);
      const bySection = new Map<number, number>();
      for (const x of p.rows) if (x.toSectionId !== null) bySection.set(x.toSectionId, (bySection.get(x.toSectionId) ?? 0) + x.amountMinor);
      for (const [id, v] of bySection) put(id, null, v);
      put(null, null, p.summary.incomeMinor);
      if (!one('SELECT 1 FROM sources WHERE user_id = ? AND is_leftovers = 1', uid))
        db.prepare('INSERT INTO sources (user_id, name, box_id, is_leftovers) VALUES (?, ?, ?, 1)').run(uid, LEFTOVERS, newBox());
    })();
    res.json(monthsOf(uid));
  });
  r.post('/months/:month/reopen', (req, res) => {
    const uid = req.user.id;
    const month = monthParam(req);
    if (lastClosedOf(uid) !== month) throw new HttpError(409, 'not_reopenable', 'Only the last closed month can be reopened.');
    db.transaction(() => {
      db.prepare('DELETE FROM carries WHERE user_id = ? AND month = ?').run(uid, nextMonth(month));
      db.prepare('DELETE FROM closed_months WHERE user_id = ? AND month = ?').run(uid, month);
    })();
    res.json(monthsOf(uid));
  });

  // Where each subsection's money sits
  r.get('/where', (req, res) => {
    const user = req.user;
    const uid = user.id;
    const base = user.baseCurrency;
    const month = parse(s.whereQuery, req.query).month ?? today().slice(0, 7);
    const until = `${month}-31`;
    const pockets = all<{ id: number; name: string; currency: string }>('SELECT id, name, currency FROM pockets WHERE user_id = ? ORDER BY id', uid);
    const home = pockets.find((p) => p.id === user.homePocketId) ?? pockets[0];
    const currencyOfPocket = new Map(pockets.map((p) => [p.id, p.currency]));
    // What each subsection has in each pocket, apart from the home pocket.
    const cells = new Map<number, Map<number, number>>();
    const add = (sub: number, pocket: number, v: number) => {
      if (pocket === home?.id) return;
      const m = cells.get(sub) ?? cells.set(sub, new Map()).get(sub)!;
      m.set(pocket, (m.get(pocket) ?? 0) + v);
    };
    for (const x of all<{ sub: number; pid: number; v: number }>(
      `SELECT subsection_id AS sub, to_pocket_id AS pid, SUM(to_amount_minor) AS v FROM transactions
       WHERE user_id = ? AND kind = 'transfer' AND subsection_id IS NOT NULL AND date <= ? GROUP BY 1, 2`, uid, until)) add(x.sub, x.pid, x.v);
    for (const x of all<{ sub: number; pid: number; v: number }>(
      `SELECT subsection_id AS sub, pocket_id AS pid, SUM(amount_minor) AS v FROM transactions
       WHERE user_id = ? AND kind IN ('transfer', 'expense') AND subsection_id IS NOT NULL AND date <= ? GROUP BY 1, 2`, uid, until)) add(x.sub, x.pid, -x.v);
    // A held holding counts as its worth minus what it cost; a sold one has paid back into the cash and is gone.
    for (const h of all<any>(`${HOLD} WHERE user_id = ? AND sold_date IS NULL`, uid))
      add(h.subsectionId, h.pocketId, worthIn(h, currencyOfPocket.get(h.pocketId)!) - h.paidMinor);

    const sections: any[] = answer(user, month, 'budget').sections;
    const rows: { subsectionId: number; totalMinor: number; cells: { pocketId: number; amountMinor: number }[] }[] = [];
    for (const sub of sections.flatMap((x) => x.subsections)) {
      const out = new Map(cells.get(sub.id));
      const total: number = sub.availableMinor;
      if (home) {
        const others = [...out].reduce((a, [pid, v]) => a + (rates.convert(v, currencyOfPocket.get(pid)!, base, today()) ?? 0), 0);
        out.set(home.id, rates.convert(total - others, base, home.currency, today()) ?? 0);
      }
      const list = [...out].filter(([, v]) => v !== 0).sort(([a], [b]) => a - b).map(([pocketId, amountMinor]) => ({ pocketId, amountMinor }));
      if (total !== 0 || list.length) rows.push({ subsectionId: sub.id, totalMinor: total, cells: list });
    }
    const used = new Set(rows.flatMap((x) => x.cells.map((c) => c.pocketId)));
    res.json({ currency: base, pockets: pockets.filter((p) => used.has(p.id)), rows });
  });

  // Holdings
  const holdingOf = (uid: number, id: number) => must(one(`${HOLD} WHERE id = ? AND user_id = ?`, id, uid));
  const unsold = <T extends { soldDate: string | null }>(h: T): T => {
    if (h.soldDate) throw new HttpError(409, 'sold', 'This holding is sold.');
    return h;
  };
  // Checks a holding's body against the person's own pockets and subsections and the offered currencies.
  const checkedHolding = (user: Who, body: unknown) => {
    const b = parse(s.holding, body);
    const pocket = one('SELECT currency FROM pockets WHERE id = ? AND user_id = ?', b.pocketId, user.id);
    if (!pocket) throw fieldError('pocketId', 'Choose a pocket.');
    if (!one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', b.subsectionId, user.id)) throw fieldError('subsectionId', 'Choose a subsection.');
    const worthCurrency = b.worthCurrency ?? pocket.currency;
    if (!rates.offered(user.baseCurrency).includes(worthCurrency)) throw fieldError('worthCurrency', 'Choose a currency.');
    return { ...b, worthMinor: b.worthMinor ?? b.paidMinor, worthCurrency };
  };
  r.get('/holdings', (req, res) => {
    res.json({ holdings: all(`${HOLD} WHERE user_id = ? ORDER BY sold_date IS NOT NULL, id`, req.user.id) });
  });
  r.post('/holdings', (req, res) => {
    const b = checkedHolding(req.user, req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO holdings (user_id, name, pocket_id, subsection_id, paid_minor, worth_minor, worth_currency, worth_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, b.name, b.pocketId, b.subsectionId, b.paidMinor, b.worthMinor, b.worthCurrency, today());
    res.status(201).json({ holding: holdingOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/holdings/:id', (req, res) => {
    const cur = unsold(holdingOf(req.user.id, idOf(req)));
    const body = req.body ?? {};
    // The pocket is fixed once the holding exists.
    const b = checkedHolding(req.user, { ...cur, ...body, pocketId: cur.pocketId });
    const worthDate = body.worthMinor !== undefined || body.worthCurrency !== undefined ? today() : cur.worthDate;
    db.prepare('UPDATE holdings SET name = ?, subsection_id = ?, paid_minor = ?, worth_minor = ?, worth_currency = ?, worth_date = ? WHERE id = ? AND user_id = ?')
      .run(b.name, b.subsectionId, b.paidMinor, b.worthMinor, b.worthCurrency, worthDate, cur.id, req.user.id);
    res.json({ holding: holdingOf(req.user.id, cur.id) });
  });
  r.post('/holdings/:id/sell', (req, res) => {
    const uid = req.user.id;
    const cur = unsold(holdingOf(uid, idOf(req)));
    const b = parse(s.sale, req.body);
    if (isClosed(uid, b.date.slice(0, 7))) throw fieldError('date', 'This date is in a closed month.');
    const currency: string = one('SELECT currency FROM pockets WHERE id = ?', cur.pocketId).currency;
    const gain = b.receivedMinor - cur.paidMinor;
    if (gain > 0 && (b.sourceId == null || !one('SELECT 1 FROM sources WHERE id = ? AND user_id = ? AND is_leftovers = 0', b.sourceId, uid)))
      throw fieldError('sourceId', 'Choose a source.');
    const id = db.transaction(() => {
      db.prepare('UPDATE holdings SET sold_date = ? WHERE id = ?').run(b.date, cur.id);
      if (gain === 0) return null;
      const amountMinor = Math.abs(gain);
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, subsection_id, source_id, payee, note)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`)
        .run(uid, b.date, gain > 0 ? 'income' : 'expense', amountMinor, baseOf(req.user, { amountMinor, currency, date: b.date }), cur.pocketId,
          gain > 0 ? null : cur.subsectionId, gain > 0 ? b.sourceId : null, `Sale of ${cur.name}`);
      return Number(lastInsertRowid);
    })();
    res.json({ holding: holdingOf(uid, cur.id), transaction: id === null ? null : txOf(uid, id) });
  });
  r.delete('/holdings/:id', (req, res) => {
    const cur = unsold(holdingOf(req.user.id, idOf(req)));
    db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Rules
  type RuleRow = { id: number; match: string; subsectionId: number | null; sourceId: number | null };
  const RULE = 'SELECT id, match, subsection_id AS subsectionId, source_id AS sourceId FROM rules';
  const rulesOf = (uid: number) => all<RuleRow>(`${RULE} WHERE user_id = ? ORDER BY id`, uid);
  // The first (oldest) rule that matches the payee, for an expense or an income.
  const ruleFor = (rules: RuleRow[], kind: string, payee: string) => {
    const p = payee.toLowerCase();
    return rules.find((x) => (kind === 'expense' ? x.subsectionId !== null : x.sourceId !== null) && p.includes(x.match.toLowerCase()));
  };
  r.get('/rules', (req, res) => { res.json({ rules: rulesOf(req.user.id) }); });
  r.post('/rules', (req, res) => {
    const uid = req.user.id;
    const b = parse(s.rule, req.body);
    const sub = b.subsectionId ?? null, srcId = b.sourceId ?? null;
    const CHOOSE = 'Choose a subsection or a source.';
    if ((sub === null) === (srcId === null)) throw fieldError(srcId !== null ? 'sourceId' : 'subsectionId', CHOOSE);
    if (sub !== null && !one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', sub, uid)) throw fieldError('subsectionId', CHOOSE);
    if (srcId !== null && !one('SELECT 1 FROM sources WHERE id = ? AND user_id = ? AND is_leftovers = 0', srcId, uid)) throw fieldError('sourceId', CHOOSE);
    const out = db.transaction(() => {
      const { lastInsertRowid } = db.prepare('INSERT INTO rules (user_id, match, subsection_id, source_id) VALUES (?, ?, ?, ?)').run(uid, b.match, sub, srcId);
      const rule = one(`${RULE} WHERE id = ?`, Number(lastInsertRowid)) as RuleRow;
      const last = lastClosedOf(uid);
      const open = all<{ id: number; payee: string }>(
        `SELECT id, payee FROM transactions WHERE user_id = ? AND kind = ? AND ${UNSORTED} AND substr(date, 1, 7) > ?`, uid, sub !== null ? 'expense' : 'income', last ?? '')
        .filter((x) => x.payee.toLowerCase().includes(b.match.toLowerCase()));
      for (const x of open) db.prepare(`UPDATE transactions SET ${sub !== null ? 'subsection_id' : 'source_id'} = ? WHERE id = ?`).run(sub ?? srcId, x.id);
      return { rule, sorted: open.length };
    })();
    res.status(201).json(out);
  });
  r.delete('/rules/:id', (req, res) => {
    const cur = must(one(`${RULE} WHERE id = ? AND user_id = ?`, idOf(req), req.user.id));
    db.prepare('DELETE FROM rules WHERE id = ?').run(cur.id);
    res.status(204).end();
  });

  // Statement import
  const statement = (uid: number, body: unknown) => {
    const b = parse(s.importText, body);
    const pocket = one('SELECT currency FROM pockets WHERE id = ? AND user_id = ?', b.pocketId, uid);
    if (!pocket) throw fieldError('pocketId', 'Choose a pocket.');
    const csv = readCsv(b.text);
    if (!csv) throw fieldError('text', 'This file does not look like a CSV statement.');
    return { b, pocket, csv };
  };
  r.post('/imports/preview', (req, res) => {
    const { csv } = statement(req.user.id, req.body);
    res.json({ delimiter: csv.delimiter, headers: csv.headers, rows: csv.rows.slice(0, 5), guess: guessMapping(csv.headers, csv.rows) });
  });
  r.post('/imports', (req, res) => {
    const uid = req.user.id;
    const { b, pocket, csv } = statement(uid, req.body);
    const { mapping: m } = parse(s.importBody, req.body);
    const width = csv.headers.length;
    if ([m.date, m.amount, m.debit, m.credit, m.payee, m.note].some((c) => c != null && c >= width)) throw fieldError('mapping', 'Choose the columns of this file.');
    const exponent = new Intl.NumberFormat('en', { style: 'currency', currency: pocket.currency }).resolvedOptions().maximumFractionDigits!;
    // Every row is read before anything is saved.
    const rows = csv.rows.map((cells, i) => {
      const bad = fieldError('mapping', `Row ${i + 2} has a date or amount this mapping cannot read.`);
      const date = readDate(cells[m.date]!, m.dateFormat);
      const empty = (c: number) => cells[c]!.trim() === '';
      const num = (c: number) => (empty(c) ? 0 : readAmount(cells[c]!, m.decimal, exponent));
      let amount: number | null;
      if (m.amount != null) amount = empty(m.amount) ? null : num(m.amount);
      else {
        const d = num(m.debit!), c = num(m.credit!);
        amount = d === null || c === null || (empty(m.debit!) && empty(m.credit!)) ? null : Math.abs(c) - Math.abs(d);
      }
      if (date === null || amount === null) throw bad;
      return { date, amount, payee: cells[m.payee]!.trim().slice(0, 120), note: (m.note != null ? cells[m.note]!.trim() : '').slice(0, 500) };
    });
    const rules = rulesOf(uid);
    const out = { added: 0, duplicates: 0, closed: 0, unsorted: 0 };
    db.transaction(() => {
      const existing = new Map<string, number>();
      const seen = new Map<string, number>();
      for (const x of rows) {
        if (x.amount === 0) continue;
        if (isClosed(uid, x.date.slice(0, 7))) { out.closed++; continue; }
        const kind = x.amount < 0 ? 'expense' : 'income';
        const amountMinor = Math.abs(x.amount);
        const key = JSON.stringify([x.date, kind, amountMinor, x.payee]);
        if (!existing.has(key))
          existing.set(key, one('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND pocket_id = ? AND date = ? AND kind = ? AND amount_minor = ? AND payee = ?',
            uid, b.pocketId, x.date, kind, amountMinor, x.payee).n);
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (existing.get(key)! >= n) { out.duplicates++; continue; }
        const rule = ruleFor(rules, kind, x.payee);
        const subsectionId = kind === 'expense' ? rule?.subsectionId ?? null : null;
        const sourceId = kind === 'income' ? rule?.sourceId ?? null : null;
        db.prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, base_amount_minor, pocket_id, subsection_id, source_id, payee, note, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')`)
          .run(uid, x.date, kind, amountMinor, baseOf(req.user, { amountMinor, currency: pocket.currency, date: x.date }), b.pocketId, subsectionId, sourceId, x.payee, x.note);
        out.added++;
        if (!rule) out.unsorted++;
      }
    })();
    res.status(201).json(out);
  });

  r.use(bankRouter(db, bank, { isClosed, rulesOf, ruleFor, baseOf }));

  return r;
}
