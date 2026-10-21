import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './db';

const MIG = path.join(__dirname, '..', 'migrations');
let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-bak-'));
  file = path.join(dir, 'tally.db');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function oldDb() {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
  for (const n of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql') && f < '005').sort()) {
    db.exec(fs.readFileSync(path.join(MIG, n), 'utf8'));
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(n);
  }
  db.prepare("INSERT INTO users (username, display_name, password_hash, base_currency) VALUES ('u','U','x','USD')").run();
  return db;
}
const tables = (db: Database.Database) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();

it('backs up before a pending migration, once', () => {
  oldDb().close();
  openDb(file).close();
  const dirB = path.join(dir, 'backups');
  const files = fs.readdirSync(dirB);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^tally-\d{8}-\d{6}-before-005_closing\.db$/);
  const b = new Database(path.join(dirB, files[0]), { readonly: true });
  expect(b.prepare('SELECT count(*) FROM users').pluck().get()).toBe(1);
  expect(tables(b)).not.toContain('closed_months');
  b.close();
  const m = openDb(file);
  expect(tables(m)).toContain('closed_months');
  m.close();
  expect(fs.readdirSync(dirB)).toHaveLength(1);
});

it('makes no backups folder for a new database', () => {
  openDb(file).close();
  expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
});

it('stops without migrating when the backup cannot be written', () => {
  oldDb().close();
  fs.writeFileSync(path.join(dir, 'backups'), 'x');
  expect(() => openDb(file)).toThrow(/Backup before migration failed.*backups/);
  const db = new Database(file);
  expect(db.prepare('SELECT count(*) FROM migrations').pluck().get()).toBe(4);
  expect(tables(db)).not.toContain('closed_months');
  db.close();
});
