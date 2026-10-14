import { Router, type Request } from 'express';
import type { Db } from './db';
import { HttpError, fieldError, notFound, parse } from './http';
import * as s from './schemas';

const POCKET = `SELECT p.id, p.name, p.kind, p.emoji, p.currency, p.opening_balance_minor AS openingBalanceMinor,
  p.opening_balance_minor + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount_minor ELSE -t.amount_minor END)
    FROM transactions t WHERE t.pocket_id = p.id AND t.user_id = p.user_id), 0) AS balanceMinor
  FROM pockets p`;
const SUB = `SELECT id, section_id AS sectionId, name, budget_minor AS budgetMinor, position FROM subsections`;
const TX = `SELECT id, date, kind, amount_minor AS amountMinor, pocket_id AS pocketId, subsection_id AS subsectionId, source_id AS sourceId,
  payee, note, source FROM transactions`;

type Rule = { shares: { sectionId: number | null; basisPoints: number }[]; overspent: 'income' | 'section' };
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
    const first: string | null = lastClosed ? nextMonth(lastClosed) : one('SELECT MIN(substr(date, 1, 7)) AS m FROM transactions WHERE user_id = ?', uid).m;
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
    if (one(`SELECT 1 FROM steps WHERE section_id = ? AND user_id = ?
             UNION SELECT 1 FROM step_shares h JOIN steps p ON p.id = h.step_id WHERE h.section_id = ? AND p.user_id = ?
             UNION SELECT 1 FROM rest_shares h JOIN sections o ON o.id = h.section_id WHERE h.to_section_id = ? AND h.section_id != ? AND o.user_id = ?`,
      cur.id, req.user.id, cur.id, req.user.id, cur.id, cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This section is used in the pipeline. Remove it from the steps and rest rules first.');
    if (one('SELECT 1 FROM carries WHERE user_id = ? AND (section_id = ? OR subsection_id IN (SELECT id FROM subsections WHERE section_id = ?))', req.user.id, cur.id, cur.id))
      throw new HttpError(409, 'in_use', 'This section has money carried between months.');
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
    if (one('SELECT 1 FROM carries WHERE subsection_id = ? AND user_id = ?', cur.id, req.user.id))
      throw new HttpError(409, 'in_use', 'This subsection has money carried between months.');
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
  const checked = (uid: number, body: unknown) => {
    const t = parse(s.transaction, body);
    if (isClosed(uid, t.date.slice(0, 7))) throw fieldError('date', 'This date is in a closed month.');
    if (!one('SELECT 1 FROM pockets WHERE id = ? AND user_id = ?', t.pocketId, uid)) throw fieldError('pocketId', 'Choose a pocket.');
    if (t.subsectionId !== null && !one('SELECT 1 FROM subsections WHERE id = ? AND user_id = ?', t.subsectionId, uid))
      throw fieldError('subsectionId', 'Choose a subsection.');
    if (t.sourceId !== null && !one('SELECT 1 FROM sources WHERE id = ? AND user_id = ? AND is_leftovers = 0', t.sourceId, uid)) throw fieldError('sourceId', 'Choose a source.');
    return t;
  };
  const lockedTx = (uid: number, cur: { date: string }) => {
    if (isClosed(uid, cur.date.slice(0, 7))) throw new HttpError(409, 'closed', 'This transaction is in a closed month. Reopen the month to change it.');
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
      .prepare(`INSERT INTO transactions (user_id, date, kind, amount_minor, pocket_id, subsection_id, source_id, payee, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, t.date, t.kind, t.amountMinor, t.pocketId, t.subsectionId, t.sourceId, t.payee, t.note);
    res.status(201).json({ transaction: txOf(req.user.id, Number(lastInsertRowid)) });
  });
  r.patch('/transactions/:id', (req, res) => {
    const cur = txOf(req.user.id, idOf(req)) as any;
    lockedTx(req.user.id, cur);
    const t = checked(req.user.id, { ...cur, ...req.body });
    db.prepare(`UPDATE transactions SET date = ?, kind = ?, amount_minor = ?, pocket_id = ?, subsection_id = ?, source_id = ?, payee = ?, note = ?
                WHERE id = ? AND user_id = ?`)
      .run(t.date, t.kind, t.amountMinor, t.pocketId, t.subsectionId, t.sourceId, t.payee, t.note, cur.id, req.user.id);
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

  // What the month's income does: boxes, steps, what each section receives from them, what is left.
  const flow = (uid: number, month: string, carry: ReturnType<typeof carriesOf>) => {
    const income = new Map(
      all<{ id: number; v: number }>(
        `SELECT source_id AS id, SUM(amount_minor) AS v FROM transactions
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
        `SELECT subsection_id AS id, SUM(amount_minor) AS v FROM transactions
         WHERE user_id = ? AND kind = 'expense' AND substr(date, 1, 7) = ? GROUP BY subsection_id`, uid, month,
      ).map((x) => [x.id, x.v]),
    );
    const txIncome = one(
      `SELECT COALESCE(SUM(amount_minor), 0) AS v FROM transactions
       WHERE user_id = ? AND kind = 'income' AND substr(date, 1, 7) = ?`, uid, month).v as number;
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
      let claimed = 0, overspent = 0, carried = 0;
      const subsections: any[] = sec.subsections.map((x: any) => {
        const spentMinor = spent.get(x.id) ?? 0;
        const carriedMinor = carry.subs.get(x.id) ?? 0;
        claimed += x.budgetMinor;
        carried += carriedMinor;
        overspent += Math.max(0, spentMinor - x.budgetMinor - carriedMinor);
        return { id: x.id, name: x.name, budgetMinor: x.budgetMinor, carriedMinor, spentMinor, availableMinor: x.budgetMinor + carriedMinor - spentMinor };
      });
      const budgetedMinor = pipeline.sections.find((x) => x.id === sec.id)!.receivedMinor;
      const spentMinor = subsections.reduce((a: number, x: any) => a + x.spentMinor, 0);
      return {
        id: sec.id, name: sec.name, colorSlot: sec.colorSlot,
        budgetedMinor, restMinor: budgetedMinor - claimed - overspent, spentMinor, availableMinor: budgetedMinor + carried - spentMinor, subsections,
      };
    });
    const budgetedMinor = sections.reduce((a, x) => a + x.budgetedMinor, 0);
    const spentMinor = sections.reduce((a, x) => a + x.spentMinor, 0);
    const budget = {
      month, currency: user.baseCurrency, closed,
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
    return stored ? JSON.parse(stored[which]) : live(user, month)[which];
  };
  r.get('/pipeline', (req, res) => {
    res.json(answer(req.user, parse(s.monthQuery, req.query).month, 'pipeline'));
  });
  r.get('/budget', (req, res) => {
    res.json(answer(req.user, parse(s.monthQuery, req.query).month, 'budget'));
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
      for (const x of sec.subsections) if (x.availableMinor > 0) subs.set(x.id, x.availableMinor);
      const rule: Rule = m.rules.get(sec.id)!;
      if (sec.restMinor < 0) add(sec.id, 10000, rule.overspent === 'section' ? sec.id : null, sec.restMinor);
      else {
        const parts = rule.shares.map((x) => Math.floor((sec.restMinor * x.basisPoints) / 10000));
        parts[0]! += sec.restMinor - parts.reduce((a, n) => a + n, 0);
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

  return r;
}
