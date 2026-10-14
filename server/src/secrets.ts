import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// TALLY_SECRET (64 hex characters) if set, else a random key created once in <data dir>/secret.key.
function key(): Buffer {
  const env = process.env.TALLY_SECRET;
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error('TALLY_SECRET must be 64 hex characters.');
    return Buffer.from(env, 'hex');
  }
  const dir = process.env.TALLY_DATA_DIR ?? path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'secret.key');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

// AES-256-GCM; the blob is base64(iv | tag | ciphertext).
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function decrypt(blob: string): string {
  const b = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
