import { Router, type Request } from 'express';
import type { Db } from './db';
import { HttpError, fieldError, notFound, parse } from './http';
import * as s from './schemas';

const POCKET = `SELECT p.id, p.name, p.kind, p.emoji, p.currency, p.opening_balance_minor AS openingBalanceMinor,
  p.opening_balance_minor + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount_minor ELSE -t.amount_minor END)
    FROM transactions t WHERE t.pocket_id = p.id AND t.user_id = p.user_id), 0) AS balanceMinor
  FROM pockets p`;
const SUB = `SELECT id, section_id AS sectionId, name, budget_minor AS budgetMinor, position FROM subsections`;
const TX = `SELECT id, date, kind, amount_minor AS amountMinor, pocket_id AS pocketId, subsection_id AS subsectionId,
  payee, note, source FROM transactions`;

const idOf = (req: Request): number => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id as string) || !Number.isSafeInteger(id)) throw notFound();
  return id;
};
const inUse = (what: string) => new HttpError(409, 'in_use', `This ${what} has transactions. Delete them first.`);

export function dataRouter(db: Db): Router {
  const r = Router();
  const one = (sql: string, ...args: unknown[]): any => db.prepare(sql).get(...args);
  const all = <T = any>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];
  const must = (row: any): any => {
    if (!row) throw notFound();
    return row;
  };
  const pocketOf = (uid: number, id: number) => must(one(`${POCKET} WHERE p.id = ? AND p.user_id = ?`, id, uid));
  const subOf = (uid: number, id: number) => must(one(`${SUB} WHERE id = ? AND user_id = ?`, id, uid));
  const txOf = (uid: number, id: number) => must(one(`${TX} WHERE id = ? AND user_id = ?`, id, uid));
  const sectionOf = (uid: number, id: number) => {
    const sec = must(one('SELECT id, name, color_slot AS colorSlot, position, budget_kind AS budgetKind, budget_minor AS budgetMinor, budget_basis_points AS budgetBasisPoints FROM sections WHERE id = ? AND user_id = ?', id, uid));
    return { ...sec, subsections: all(`${SUB} WHERE section_id = ? AND user_id = ? ORDER BY position, id`, id, uid) };
  };

  // Blocks a percentage that would push the person's percent sections past 100%.
  const checkPercent = (uid: number, exceptId: number, b: { budgetKind: string; budgetBasisPoints: number | null }) => {
    if (b.budgetKind !== 'percent') return;
    const others = one(
      `SELECT COALESCE(SUM(budget_basis_points), 0) AS v FROM sections
       WHERE user_id = ? AND budget_kind = 'percent' AND id != ?`, uid, exceptId).v as number;
    if (others + b.budgetBasisPoints! > 10000)
      throw fieldError('budgetBasisPoints', `Your sections would take more than 100% of income. Other sections already take ${others / 100}%.`);
  };

  // Pockets
  r.get('/pockets', (req, res) => {
    res.json({ pockets: all(`${POCKET} WHERE p.user_id = ? ORDER BY p.id`, req.user.id) });
  });
  r.post('/pockets', (req, res) => {
    const b = parse(s.pocket, req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO pockets (user_id, name, kind, emoji, currency, opening_balance_minor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, b.name, b.kind, b.emoji ?? String.fromCodePoint(s.DEFAULT_EMOJI[b.kind]), req.user.baseCurrency, b.openingBalanceMinor);
    res.status(201).json({ pocket: pocketOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/pockets/:id', (req, res) => {
    const cur = pocketOf(req.user.id, idOf(req));
    const b = parse(s.pocket, { ...cur, ...req.body });
    db.prepare('UPDATE pockets SET name = ?, kind = ?, emoji = ?, opening_balance_minor = ? WHERE id = ? AND user_id = ?').run(
      b.name, b.kind, b.emoji, b.openingBalanceMinor, cur.id, req.user.id,
    );
    res.json({ pocket: pocketOf(req.user.id, cur.id) });
  });
  r.delete('/pockets/:id', (req, res) => {
    const cur = pocketOf(req.user.id, idOf(req));
    if (one('SELECT 1 FROM transactions WHERE pocket_id = ? AND user_id = ?', cur.id, req.user.id)) throw inUse('pocket');
    db.prepare('DELETE FROM pockets WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Sections and subsections
  r.get('/sections', (req, res) => {
    const ids = all<{ id: number }>('SELECT id FROM sections WHERE user_id = ? ORDER BY position, id', req.user.id);
    res.json({ sections: ids.map((x) => sectionOf(req.user.id, x.id)) });
  });
  r.post('/sections', (req, res) => {
    const b = parse(s.section, req.body);
    checkPercent(req.user.id, 0, b);
    const used = new Set(all<{ c: number }>('SELECT color_slot AS c FROM sections WHERE user_id = ?', req.user.id).map((x) => x.c));
    const slot = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => !used.has(n)) ?? 0;
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO sections (user_id, name, color_slot, position, budget_kind, budget_minor, budget_basis_points)
                VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM sections WHERE user_id = ?), ?, ?, ?)`)
      .run(req.user.id, b.name, slot, req.user.id, b.budgetKind, b.budgetMinor, b.budgetBasisPoints);
    res.status(201).json({ section: sectionOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/sections/:id', (req, res) => {
    const cur = sectionOf(req.user.id, idOf(req));
    const b = parse(s.section, { ...cur, ...req.body });
    checkPercent(req.user.id, cur.id, b);
    db.prepare('UPDATE sections SET name = ?, budget_kind = ?, budget_minor = ?, budget_basis_points = ? WHERE id = ? AND user_id = ?').run(
      b.name, b.budgetKind, b.budgetMinor, b.budgetBasisPoints, cur.id, req.user.id,
    );
    res.json({ section: sectionOf(req.user.id, cur.id) });
  });
  r.delete('/sections/:id', (req, res) => {
    const cur = sectionOf(req.user.id, idOf(req));
    const used = one(
      `SELECT 1 FROM transactions t JOIN subsections x ON x.id = t.subsection_id
       WHERE x.section_id = ? AND t.user_id = ?`, cur.id, req.user.id);
    if (used) throw inUse('section');
    db.prepare('DELETE FROM sections WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });
  r.post('/sections/:id/subsections', (req, res) => {
    const sec = sectionOf(req.user.id, idOf(req));
    const b = parse(s.subsection, req.body);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO subsections (user_id, section_id, name, budget_minor, position)
                VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM subsections WHERE section_id = ?))`)
      .run(req.user.id, sec.id, b.name, b.budgetMinor, sec.id);
    res.status(201).json({ subsection: subOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/subsections/:id', (req, res) => {
    const cur = subOf(req.user.id, idOf(req)) as any;
    const b = parse(s.subsection, { ...cur, ...req.body });
    db.prepare('UPDATE subsections SET name = ?, budget_minor = ? WHERE id = ? AND user_id = ?').run(
      b.name, b.budgetMinor, cur.id, req.user.id,
    );
    res.json({ subsection: subOf(req.user.id, cur.id) });
  });
  r.delete('/subsections/:id', (req, res) => {
    const cur = subOf(req.user.id, idOf(req)) as any;
    if (one('SELECT 1 FROM transactions WHERE subsection_id = ? AND user_id = ?', cur.id, req.user.id)) throw inUse('subsection');
    db.prepare('DELETE FROM subsections WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Transactions
  const checked = (uid: number, body: unknown) => {
    const t = parse(s.transaction, body);
    if (!one('SELECT 1 FROM pockets WHERE id = ? AND user_id = ?', t.pocketId, uid)) throw fieldError('pocketId', 'Choose a pocket.');
    if (t.subsectionId !== null && !one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', t.subsectionId, uid))
      throw fieldError('subsectionId', 'Choose a subsection.');
    return t;
  };
  r.get('/transactions', (req, res) => {
    const q = parse(s.txQuery, req.query);
    let sql = `${TX} WHERE user_id = ? AND substr(date, 1, 7) = ?`;
    const args: unknown[] = [req.user.id, q.month];
    if (q.pocketId !== undefined) { sql += ' AND pocket_id = ?'; args.push(q.pocketId); }
    if (q.subsectionId !== undefined) { sql += ' AND subsection_id = ?'; args.push(q.subsectionId); }
    res.json({ transactions: all(`${sql} ORDER BY date DESC, id DESC`, ...args) });
  });
  r.post('/transactions', (req, res) => {
    const t = checked(req.user.id, req.body);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, pocket_id, subsection_id, payee, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, t.date, t.kind, t.amountMinor, t.pocketId, t.subsectionId, t.payee, t.note);
    res.status(201).json({ transaction: txOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/transactions/:id', (req, res) => {
    const cur = txOf(req.user.id, idOf(req)) as any;
    const t = checked(req.user.id, { ...cur, ...req.body });
    db.prepare(`UPDATE transactions SET date = ?, kind = ?, amount_minor = ?, pocket_id = ?, subsection_id = ?, payee = ?, note = ?
                WHERE id = ? AND user_id = ?`)
      .run(t.date, t.kind, t.amountMinor, t.pocketId, t.subsectionId, t.payee, t.note, cur.id, req.user.id);
    res.json({ transaction: txOf(req.user.id, cur.id) });
  });
  r.delete('/transactions/:id', (req, res) => {
    const cur = txOf(req.user.id, idOf(req)) as any;
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(cur.id, req.user.id);
    res.status(204).end();
  });

  // Budget
  r.get('/budget', (req, res) => {
    const { month } = parse(s.monthQuery, req.query);
    const uid = req.user.id;
    const spent = new Map(
      all<{ id: number; v: number }>(
        `SELECT subsection_id AS id, SUM(amount_minor) AS v FROM transactions
         WHERE user_id = ? AND kind = 'expense' AND substr(date, 1, 7) = ? GROUP BY subsection_id`, uid, month,
      ).map((x) => [x.id, x.v]),
    );
    const incomeMinor = one(
      `SELECT COALESCE(SUM(amount_minor), 0) AS v FROM transactions
       WHERE user_id = ? AND kind = 'income' AND substr(date, 1, 7) = ?`, uid, month)!.v as number;
    const secs = all<{ id: number }>('SELECT id FROM sections WHERE user_id = ? ORDER BY position, id', uid).map(({ id }) => sectionOf(uid, id));
    // Fixed amounts come off the income first; percentages share what remains.
    const base = Math.max(0, incomeMinor - secs.reduce((a, x) => a + (x.budgetKind === 'fixed' ? x.budgetMinor : 0), 0));
    const sections = secs.map((sec) => {
      const subsections: any[] = sec.subsections.map((x: any) => {
        const spentMinor = spent.get(x.id) ?? 0;
        return { id: x.id, name: x.name, budgetMinor: x.budgetMinor, spentMinor, availableMinor: x.budgetMinor - spentMinor };
      });
      const claimed = subsections.reduce((a: number, x: any) => a + x.budgetMinor, 0);
      const budgetedMinor =
        sec.budgetKind === 'fixed' ? sec.budgetMinor
        : sec.budgetKind === 'percent' ? Number((BigInt(base) * BigInt(sec.budgetBasisPoints)) / 10000n) // BigInt: the product can pass 2^53
        : claimed;
      const spentMinor = subsections.reduce((a: number, x: any) => a + x.spentMinor, 0);
      return {
        id: sec.id, name: sec.name, colorSlot: sec.colorSlot,
        budgetKind: sec.budgetKind, budgetMinor: sec.budgetMinor, budgetBasisPoints: sec.budgetBasisPoints,
        budgetedMinor, restMinor: budgetedMinor - claimed, spentMinor, availableMinor: budgetedMinor - spentMinor, subsections,
      };
    });
    const budgetedMinor = sections.reduce((a: number, x: any) => a + x.budgetedMinor, 0);
    const spentMinor = sections.reduce((a: number, x: any) => a + x.spentMinor, 0);
    res.json({
      month,
      currency: req.user.baseCurrency,
      totals: { incomeMinor, budgetedMinor, spentMinor, availableMinor: budgetedMinor - spentMinor },
      sections,
    });
  });

  return r;
}
