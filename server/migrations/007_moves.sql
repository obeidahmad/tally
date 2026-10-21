-- Money moved between subsections or sections' rests in one month. Exactly one of each from/to pair is set.
CREATE TABLE moves (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  from_subsection_id INTEGER REFERENCES subsections(id),
  from_section_id INTEGER REFERENCES sections(id),
  to_subsection_id INTEGER REFERENCES subsections(id),
  to_section_id INTEGER REFERENCES sections(id),
  amount_minor INTEGER NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX moves_user_month ON moves(user_id, month);
