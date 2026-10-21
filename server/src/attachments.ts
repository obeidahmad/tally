import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, raw, type RequestHandler } from 'express';
import type { Db } from './db';
import { HttpError, notFound } from './http';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_TX = 5;
const wrongType = () => new HttpError(415, 'unsupported_type', 'Attach a JPEG, PNG, WebP or PDF.');
// The first bytes of each allowed type: the header alone is not trusted.
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};
const idOf = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw notFound();
  return Number(v);
};
const fileNameOf = (header: unknown) => {
  let n = 'receipt';
  try { n = decodeURIComponent(String(header ?? '')); } catch { /* a bad escape keeps the default */ }
  n = n.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\/]/).pop()!.trim().slice(0, 200);
  return n || 'receipt';
};

export const attachmentDir = (db: Db) => path.join(path.dirname(db.name), 'attachments');
export const removeFiles = (db: Db, files: string[]) => {
  for (const f of files) fs.rmSync(path.join(attachmentDir(db), f), { force: true });
};

export function attachmentsRouter(db: Db): Router {
  const r = Router();
  const one = (sql: string, ...a: unknown[]): any => db.prepare(sql).get(...a);
  const attachmentOf = (uid: number, id: number) => {
    const a = one('SELECT id, name, type, size, file FROM attachments WHERE id = ? AND user_id = ?', id, uid);
    if (!a) throw notFound();
    return a;
  };

  // The transaction must be the person's and have room; then the type, then the size (express.raw), then the bytes.
  const gate: RequestHandler = (req, _res, next) => {
    const txId = idOf(req.params.id);
    if (!one('SELECT 1 FROM transactions WHERE id = ? AND user_id = ?', txId, req.user.id)) throw notFound();
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!MAGIC[type]) throw wrongType();
    if (one('SELECT COUNT(*) AS n FROM attachments WHERE transaction_id = ?', txId).n >= MAX_PER_TX)
      throw new HttpError(409, 'too_many', 'A transaction can have at most 5 receipts.');
    next();
  };
  const body = raw({ type: () => true, limit: MAX_BYTES });
  const sized: RequestHandler = (req, res, next) =>
    body(req, res, (e?: any) => next(e?.type === 'entity.too.large' ? new HttpError(413, 'too_large', 'A receipt can be at most 10 MB.') : e));

  r.post('/transactions/:id/attachments', gate, sized, (req, res) => {
    const txId = idOf(req.params.id);
    const type = String(req.headers['content-type']).split(';')[0]!.trim().toLowerCase();
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length || !MAGIC[type]!(bytes)) throw wrongType();
    const file = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(attachmentDir(db), { recursive: true });
    fs.writeFileSync(path.join(attachmentDir(db), file), bytes, { flag: 'wx' });
    try {
      const name = fileNameOf(req.headers['x-filename']);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO attachments (user_id, transaction_id, name, type, size, created_at, file) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.user.id, txId, name, type, bytes.length, new Date().toISOString(), file);
      res.status(201).json({ attachment: { id: Number(lastInsertRowid), name, type, size: bytes.length } });
    } catch (e) {
      removeFiles(db, [file]);
      throw e;
    }
  });

  r.get('/attachments/:id', (req, res) => {
    const a = attachmentOf(req.user.id, idOf(req.params.id));
    const stream = fs.createReadStream(path.join(attachmentDir(db), a.file));
    stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } }); else res.destroy(); });
    stream.on('open', () => {
      res.set({
        'Content-Type': a.type,
        'Content-Length': String(a.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
        'X-Content-Type-Options': 'nosniff',
      });
      stream.pipe(res);
    });
  });
  r.delete('/attachments/:id', (req, res) => {
    const a = attachmentOf(req.user.id, idOf(req.params.id));
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    removeFiles(db, [a.file]);
    res.status(204).end();
  });
  return r;
}
