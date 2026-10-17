-- pockets is rebuilt because the kind CHECK widens (db.ts turns foreign keys off for migrations, so nothing cascades).
CREATE TABLE pockets_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bank','cash','fund','broker','credit','loan','property')),
  currency TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  synced_balance_minor INTEGER,
  synced_at TEXT,
  reconciled_at TEXT,
  reconciled_balance_minor INTEGER
);
INSERT INTO pockets_new (id, user_id, name, kind, currency, opening_balance_minor, emoji, synced_balance_minor, synced_at)
  SELECT id, user_id, name, kind, currency, opening_balance_minor, emoji, synced_balance_minor, synced_at FROM pockets;
DROP TABLE pockets;
ALTER TABLE pockets_new RENAME TO pockets;
CREATE TABLE pocket_values (
  id INTEGER PRIMARY KEY,
  pocket_id INTEGER NOT NULL REFERENCES pockets(id) ON DELETE CASCADE,
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  date TEXT NOT NULL,
  UNIQUE (pocket_id, date)
);
