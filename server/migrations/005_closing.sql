ALTER TABLE sections ADD COLUMN overspent TEXT NOT NULL DEFAULT 'income' CHECK (overspent IN ('income','section'));
ALTER TABLE sources ADD COLUMN is_leftovers INTEGER NOT NULL DEFAULT 0;

-- A section with no rows here has the default rule: all of it to next month's income.
CREATE TABLE rest_shares (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  to_section_id INTEGER REFERENCES sections(id),
  basis_points INTEGER NOT NULL
);

-- The figures of a closed month, as the budget and pipeline routes answered when it closed.
CREATE TABLE closed_months (
  user_id INTEGER NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  budget TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
);

-- What closing the month before put into `month`. Both ids null: into the month's income.
CREATE TABLE carries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  section_id INTEGER REFERENCES sections(id),
  subsection_id INTEGER REFERENCES subsections(id),
  amount_minor INTEGER NOT NULL
);
CREATE INDEX carries_user_month ON carries(user_id, month);
