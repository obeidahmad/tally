ALTER TABLE sections ADD COLUMN budget_kind TEXT NOT NULL DEFAULT 'subsections' CHECK (budget_kind IN ('subsections','fixed','percent'));
ALTER TABLE sections ADD COLUMN budget_minor INTEGER;
ALTER TABLE sections ADD COLUMN budget_basis_points INTEGER;
