-- Trading212: one connection per person. The key (and secret) are stored encrypted (secrets.ts).
CREATE TABLE broker_connections (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  pocket_id INTEGER NOT NULL REFERENCES pockets(id) ON DELETE CASCADE,
  subsection_id INTEGER NOT NULL REFERENCES subsections(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('live','demo')),
  currency TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  secret_enc TEXT,
  key_end TEXT NOT NULL,
  synced_at TEXT,
  error TEXT,
  instruments_at TEXT
);
CREATE TABLE broker_instruments (
  user_id INTEGER NOT NULL REFERENCES users(id),
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (user_id, ticker)
);
ALTER TABLE holdings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE holdings ADD COLUMN ticker TEXT;
