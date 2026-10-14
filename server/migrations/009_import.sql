-- Imported transactions use source = 'import' and may have no subsection (expense) or source (income) yet: both columns are already nullable.
CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  match TEXT NOT NULL,
  subsection_id INTEGER REFERENCES subsections(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  CHECK ((subsection_id IS NULL) != (source_id IS NULL))
);
CREATE INDEX rules_user ON rules(user_id);
