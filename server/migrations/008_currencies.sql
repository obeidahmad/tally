-- ECB euro reference rates, shared by every account. The euro itself (1) is not stored.
CREATE TABLE rates (
  date TEXT NOT NULL,
  currency TEXT NOT NULL,
  per_euro TEXT NOT NULL,
  PRIMARY KEY (date, currency)
);

-- Rebuilt because the kind CHECK gains 'transfer'. Existing rows: base amount = amount.
CREATE TABLE transactions_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  pocket_id INTEGER NOT NULL REFERENCES pockets(id),
  subsection_id INTEGER REFERENCES subsections(id),
  payee TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_id INTEGER REFERENCES sources(id),
  base_amount_minor INTEGER NOT NULL,
  to_pocket_id INTEGER REFERENCES pockets(id),
  to_amount_minor INTEGER
);
INSERT INTO transactions_new (id, user_id, date, kind, amount_minor, pocket_id, subsection_id, payee, note, source, source_id, base_amount_minor)
  SELECT id, user_id, date, kind, amount_minor, pocket_id, subsection_id, payee, note, source, source_id, amount_minor FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;
CREATE INDEX transactions_user_date ON transactions(user_id, date);
