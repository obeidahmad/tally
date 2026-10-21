-- budget_minor stays NOT NULL: a percent subsection keeps 0 there and the API answers null.
ALTER TABLE subsections ADD COLUMN kind TEXT NOT NULL DEFAULT 'spending' CHECK (kind IN ('spending','goal'));
ALTER TABLE subsections ADD COLUMN budget_kind TEXT NOT NULL DEFAULT 'amount' CHECK (budget_kind IN ('amount','percent'));
ALTER TABLE subsections ADD COLUMN budget_basis_points INTEGER;
ALTER TABLE subsections ADD COLUMN keep TEXT NOT NULL DEFAULT 'all' CHECK (keep IN ('all','cap','none'));
ALTER TABLE subsections ADD COLUMN cap_minor INTEGER;
