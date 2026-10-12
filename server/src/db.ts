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
  for (const name of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    })();
  }
  return db;
}
