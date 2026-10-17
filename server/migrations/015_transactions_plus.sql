-- Tags, split transactions and receipts.
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (user_id, name)
);
CREATE TABLE transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE INDEX transaction_tags_tag ON transaction_tags(tag_id);
CREATE TABLE transaction_splits (
  id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  subsection_id INTEGER NOT NULL REFERENCES subsections(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  base_amount_minor INTEGER NOT NULL
);
CREATE INDEX transaction_splits_tx ON transaction_splits(transaction_id);
-- `file` is the random name of the stored file; it never leaves the server.
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  file TEXT NOT NULL UNIQUE
);
CREATE INDEX attachments_tx ON attachments(transaction_id);
-- Every spend or income figure reads this: a split counts each part in its own subsection, any other transaction counts once.
CREATE VIEW tx_parts AS
  SELECT t.id, t.user_id, t.date, t.kind, t.pocket_id, t.source_id, t.payee, t.source, t.subsection_id, t.amount_minor, t.base_amount_minor
    FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM transaction_splits p WHERE p.transaction_id = t.id)
  UNION ALL
  SELECT t.id, t.user_id, t.date, t.kind, t.pocket_id, t.source_id, t.payee, t.source, p.subsection_id, p.amount_minor, p.base_amount_minor
    FROM transactions t JOIN transaction_splits p ON p.transaction_id = t.id;
