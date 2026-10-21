CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  box_id INTEGER NOT NULL
);
CREATE INDEX sources_user ON sources(user_id);

CREATE TABLE steps (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  box_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('amount','percent')),
  section_id INTEGER REFERENCES sections(id),
  amount_minor INTEGER
);
CREATE INDEX steps_box ON steps(user_id, box_id);

CREATE TABLE step_shares (
  id INTEGER PRIMARY KEY,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  basis_points INTEGER NOT NULL
);

ALTER TABLE transactions ADD COLUMN source_id INTEGER REFERENCES sources(id);

-- A person with income gets one source, in a box of its own. The user id doubles as that box's id.
INSERT INTO sources (user_id, name, box_id)
  SELECT DISTINCT user_id, 'Income', user_id FROM transactions WHERE kind = 'income';
UPDATE transactions SET source_id = (SELECT s.id FROM sources s WHERE s.user_id = transactions.user_id)
  WHERE kind = 'income';

ALTER TABLE sections DROP COLUMN budget_kind;
ALTER TABLE sections DROP COLUMN budget_minor;
ALTER TABLE sections DROP COLUMN budget_basis_points;
