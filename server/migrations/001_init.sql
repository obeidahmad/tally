CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  base_currency TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE pockets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bank','cash','fund','broker')),
  currency TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL
);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  color_slot INTEGER NOT NULL CHECK (color_slot BETWEEN 0 AND 8),
  position INTEGER NOT NULL
);

CREATE TABLE subsections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  budget_minor INTEGER NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  pocket_id INTEGER NOT NULL REFERENCES pockets(id),
  subsection_id INTEGER REFERENCES subsections(id),
  payee TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX transactions_user_date ON transactions(user_id, date);
