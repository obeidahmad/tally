-- Payee keys the person said are not recurring.
CREATE TABLE recurring_dismissed (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
