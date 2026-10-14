-- The pocket where a person's untransferred money sits; empty means their oldest pocket.
ALTER TABLE users ADD COLUMN home_pocket_id INTEGER REFERENCES pockets(id) ON DELETE SET NULL;

-- An investment: what was paid (in the pocket's currency) and what it is worth now (typed in, in its own currency).
CREATE TABLE holdings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  pocket_id INTEGER NOT NULL REFERENCES pockets(id),
  subsection_id INTEGER NOT NULL REFERENCES subsections(id),
  paid_minor INTEGER NOT NULL,
  worth_minor INTEGER NOT NULL,
  worth_currency TEXT NOT NULL,
  worth_date TEXT NOT NULL,
  sold_date TEXT
);
CREATE INDEX holdings_user ON holdings(user_id);
