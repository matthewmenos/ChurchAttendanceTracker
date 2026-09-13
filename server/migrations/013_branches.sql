-- ============ Multi-branch church architecture ============

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  location TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add branch_id to existing tables (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE member_groups ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

-- Create indexes (idempotent)
CREATE INDEX IF NOT EXISTS users_branch_idx ON users(branch_id);
CREATE INDEX IF NOT EXISTS members_branch_idx ON members(branch_id);
CREATE INDEX IF NOT EXISTS services_branch_idx ON services(branch_id);
CREATE INDEX IF NOT EXISTS member_groups_branch_idx ON member_groups(branch_id);
CREATE INDEX IF NOT EXISTS locations_branch_idx ON locations(branch_id);

-- Insert default branch for existing data (idempotent)
INSERT INTO branches (name, description)
SELECT 'Main Branch', 'Default branch for existing data'
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'Main Branch');

-- Assign existing data to default branch only where not yet assigned
UPDATE users SET branch_id = (SELECT id FROM branches WHERE name = 'Main Branch')
  WHERE branch_id IS NULL;
UPDATE members SET branch_id = (SELECT id FROM branches WHERE name = 'Main Branch')
  WHERE branch_id IS NULL;
UPDATE services SET branch_id = (SELECT id FROM branches WHERE name = 'Main Branch')
  WHERE branch_id IS NULL;
UPDATE member_groups SET branch_id = (SELECT id FROM branches WHERE name = 'Main Branch')
  WHERE branch_id IS NULL;
UPDATE locations SET branch_id = (SELECT id FROM branches WHERE name = 'Main Branch')
  WHERE branch_id IS NULL;

-- Update admin role to district_admin
UPDATE users SET role = 'district_admin' WHERE role IN ('admin', 'district_admin');

-- Update role check constraint (idempotent)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('district_admin', 'branch_admin', 'usher'));
