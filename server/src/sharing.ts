import { Router } from 'express';
import { z } from 'zod';
import { ownerOnlyBudget } from './auth';
import type { Db } from './db';
import { fieldError, notFound, parse } from './http';

const idParam = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw notFound();
  return Number(v);
};
const addBody = z.object({ username: z.string({ error: 'There is no account with this username.' }).trim().toLowerCase() });
const viewBody = z.object({ ownerId: z.number({ error: 'Choose a budget shared with you.' }).int('Choose a budget shared with you.').nullable() });

export function sharingRouter(db: Db): Router {
  const r = Router();
  // Every route here is the signed-in person's own (req.me), never the acting budget.
  r.get('/sharing', (req, res) => {
    res.json({
      members: db.prepare('SELECT u.id, u.display_name AS displayName FROM budget_members m JOIN users u ON u.id = m.member_id WHERE m.owner_id = ? ORDER BY u.id').all(req.me.id),
      sharedWithMe: db.prepare('SELECT u.id AS ownerId, u.display_name AS displayName FROM budget_members m JOIN users u ON u.id = m.owner_id WHERE m.member_id = ? ORDER BY u.id').all(req.me.id),
      viewing: req.viewing?.ownerId ?? null,
    });
  });
  r.post('/sharing/members', ownerOnlyBudget, (req, res) => {
    const { username } = parse(addBody, req.body);
    const who = db.prepare('SELECT id, display_name AS displayName FROM users WHERE username = ?').get(username) as { id: number; displayName: string } | undefined;
    if (!who) throw fieldError('username', 'There is no account with this username.');
    if (who.id === req.me.id) throw fieldError('username', 'You cannot add yourself.');
    if (db.prepare('SELECT 1 FROM budget_members WHERE owner_id = ? AND member_id = ?').get(req.me.id, who.id)) throw fieldError('username', 'This person is already a member.');
    db.prepare('INSERT INTO budget_members (owner_id, member_id) VALUES (?, ?)').run(req.me.id, who.id);
    res.status(201).json({ member: who });
  });
  r.delete('/sharing/members/:id', ownerOnlyBudget, (req, res) => {
    const id = idParam(req.params.id);
    db.transaction(() => {
      if (!db.prepare('DELETE FROM budget_members WHERE owner_id = ? AND member_id = ?').run(req.me.id, id).changes) throw notFound();
      db.prepare('UPDATE users SET viewing_owner_id = NULL WHERE id = ? AND viewing_owner_id = ?').run(id, req.me.id);
    })();
    res.status(204).end();
  });
  r.post('/sharing/view', (req, res) => {
    const { ownerId } = parse(viewBody, req.body);
    if (ownerId !== null && !db.prepare('SELECT 1 FROM budget_members WHERE owner_id = ? AND member_id = ?').get(ownerId, req.me.id))
      throw fieldError('ownerId', 'Choose a budget shared with you.');
    db.prepare('UPDATE users SET viewing_owner_id = ? WHERE id = ?').run(ownerId, req.me.id);
    res.json({ viewing: ownerId });
  });
  r.delete('/sharing/shared/:ownerId', (req, res) => {
    const id = idParam(req.params.ownerId);
    db.transaction(() => {
      if (!db.prepare('DELETE FROM budget_members WHERE owner_id = ? AND member_id = ?').run(id, req.me.id).changes) throw notFound();
      db.prepare('UPDATE users SET viewing_owner_id = NULL WHERE id = ? AND viewing_owner_id = ?').run(req.me.id, id);
    })();
    res.status(204).end();
  });
  return r;
}
