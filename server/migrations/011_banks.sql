-- Enable Banking. The private key is stored encrypted (secrets.ts).
CREATE TABLE bank_registrations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  application_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL
);
-- A random value kept from connect until the bank sends the person back.
CREATE TABLE bank_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank TEXT NOT NULL,
  country TEXT NOT NULL
);
CREATE TABLE bank_connections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank TEXT NOT NULL,
  country TEXT NOT NULL,
  session_id TEXT NOT NULL,
  valid_until TEXT NOT NULL
);
CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  iban TEXT NOT NULL,
  currency TEXT NOT NULL,
  pocket_id INTEGER UNIQUE REFERENCES pockets(id) ON DELETE SET NULL,
  last_sync_at TEXT,
  UNIQUE (connection_id, uid)
);
ALTER TABLE pockets ADD COLUMN synced_balance_minor INTEGER;
ALTER TABLE pockets ADD COLUMN synced_at TEXT;
ALTER TABLE transactions ADD COLUMN bank_ref TEXT;
CREATE UNIQUE INDEX transactions_bank_ref ON transactions(pocket_id, bank_ref) WHERE bank_ref IS NOT NULL;
