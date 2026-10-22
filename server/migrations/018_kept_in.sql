-- Spec 29: each subsection is kept in one pocket (null = any pocket); a transfer no longer names a subsection.
ALTER TABLE subsections ADD COLUMN pocket_id INTEGER REFERENCES pockets(id) ON DELETE SET NULL;
UPDATE transactions SET subsection_id = NULL WHERE kind = 'transfer';
UPDATE users SET home_pocket_id = NULL WHERE home_pocket_id IS NOT NULL AND home_pocket_id NOT IN (SELECT id FROM pockets WHERE kind IN ('bank', 'cash', 'fund', 'broker'));
