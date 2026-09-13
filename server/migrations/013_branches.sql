-- ============ Multi-branch church architecture ============

CREATE TABLE branches (
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

-- Add branch_id to existing tables
ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE member_groups ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE locations ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX users_branch_idx ON users(branch_id);
CREATE INDEX members_branch_idx ON members(branch_id);
CREATE INDEX services_branch_idx ON services(branch_id);
CREATE INDEX member_groups_branch_idx ON member_groups(branch_id);
CREATE INDEX locations_branch_idx ON locations(branch_id);

-- Insert default branch for existing data
INSERT INTO branches (name, description) VALUES ('Main Branch', 'Default branch for existing data');

-- Assign existing data to default branch
UPDATE users SET branch_id = 1 WHERE role != 'admin';
UPDATE members SET branch_id = 1;
UPDATE services SET branch_id = 1;
UPDATE member_groups SET branch_id = 1;
UPDATE locations SET branch_id = 1;

-- Update admin role to district_admin
UPDATE users SET role = 'district_admin' WHERE role = 'admin';

-- Update role check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('district_admin', 'branch_admin', 'usher'));

-- Add trigger for updated_at
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
