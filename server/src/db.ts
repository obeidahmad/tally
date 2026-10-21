import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

export type Db = Database.Database;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
  const done = new Set(db.prepare('SELECT name FROM migrations').pluck().all() as string[]);
  const pending = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().filter((f) => !done.has(f));
  if (done.size && pending.length) backup(db, file, pending[0]);
  // A table rebuild must not cascade: foreign keys are off while migrating (the pragma is a no-op inside a transaction).
  db.pragma('foreign_keys = OFF');
  for (const name of pending) {
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    })();
  }
  db.pragma('foreign_keys = ON');
  return db;
}

// VACUUM INTO includes what is still in the WAL; a plain file copy would not.
function backup(db: Db, file: string, firstPending: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const target = path.join(path.dirname(file), 'backups', `tally-${stamp}-before-${firstPending.replace(/\.sql$/, '')}.db`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    db.prepare('VACUUM INTO ?').run(target);
  } catch (e) {
    db.close();
    throw new Error(`Backup before migration failed, nothing was migrated. Tried to write ${target}: ${(e as Error).message}`);
  }
}
