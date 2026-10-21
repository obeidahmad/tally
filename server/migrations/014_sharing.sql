-- Who may view whose budget. A budget is the data keyed by its owner's user id.
CREATE TABLE budget_members (
  owner_id INTEGER NOT NULL REFERENCES users(id),
  member_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (owner_id, member_id)
);
CREATE INDEX budget_members_member ON budget_members(member_id);
ALTER TABLE users ADD COLUMN viewing_owner_id INTEGER REFERENCES users(id);
-- Null (every transaction made before sharing) means the budget's owner.
ALTER TABLE transactions ADD COLUMN created_by INTEGER REFERENCES users(id);
