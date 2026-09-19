-- =====================================================================
--  Church Attendance Tracker : COMPLETE CONSOLIDATED SCHEMA
--  Combines migrations 001-013 into one idempotent, deployable schema.
--  Safe to run repeatedly against the same database.
-- =====================================================================

-- ============================= LOCALS =============================
-- Created first so local_id foreign keys resolve on other tables.
CREATE TABLE IF NOT EXISTS locals (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  location      TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  allow_usher_add_member BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locals_id_idx ON locals(id);

-- ============================== USERS ==============================
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'usher'
                         CHECK (role IN ('district_admin', 'local_admin', 'usher')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  phone                TEXT,
  username             TEXT,
  last_login_at        TIMESTAMPTZ,
  local_id            INTEGER REFERENCES locals(id) ON DELETE SET NULL,
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users (lower(username))
  WHERE username IS NOT NULL AND username <> '';
CREATE INDEX IF NOT EXISTS users_local_idx ON users(local_id);

-- ========================== MEMBER GROUPS ==========================
CREATE TABLE IF NOT EXISTS member_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  leader_name TEXT,
  local_id   INTEGER REFERENCES locals(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_groups_local_idx ON member_groups(local_id);

-- ============================ LOCATIONS ============================
CREATE TABLE IF NOT EXISTS locations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  local_id   INTEGER REFERENCES locals(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locations_local_idx ON locations(local_id);
-- ============================= MEMBERS =============================
CREATE TABLE IF NOT EXISTS members (
  id                  SERIAL PRIMARY KEY,
  full_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_attended       DATE,
  consecutive_absences INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_absences >= 0),
  notes               TEXT,
  birthday            DATE,
  gender              TEXT CHECK (gender IN ('male', 'female')),
  membership_type     TEXT CHECK (membership_type IN ('new_convert', 'existing')),
  marital_status      TEXT CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed')),
  profession          TEXT,
  residence           TEXT,
  age                 INTEGER CHECK (age >= 0),
  member_code         TEXT,
  local_id           INTEGER REFERENCES locals(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique_idx
  ON members (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS members_status_idx ON members(status);
CREATE INDEX IF NOT EXISTS members_local_idx ON members(local_id);
CREATE INDEX IF NOT EXISTS members_birthday_idx ON members(birthday);

-- ===================== MEMBER GROUP ASSIGNMENTS ====================
CREATE TABLE IF NOT EXISTS member_group_assignments (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  group_id   INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_mga_group ON member_group_assignments(group_id);

-- ============================= SERVICES ============================
CREATE TABLE IF NOT EXISTS services (
  id                      SERIAL PRIMARY KEY,
  service_date            DATE NOT NULL,
  service_name            TEXT NOT NULL,
  start_time              TIME,
  location_id             INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  total_headcount         INTEGER NOT NULL DEFAULT 0 CHECK (total_headcount >= 0),
  notes                   TEXT,
  attendance_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  attendance_closed_at    TIMESTAMPTZ,
  attendance_closed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attendance_close_time   TIMESTAMPTZ,
  local_id               INTEGER REFERENCES locals(id) ON DELETE SET NULL,
  all_locals            BOOLEAN NOT NULL DEFAULT FALSE,
  visitor_headcount       INTEGER NOT NULL DEFAULT 0 CHECK (visitor_headcount >= 0),
  created_by              INTEGER REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_date_idx ON services(service_date DESC);
CREATE INDEX IF NOT EXISTS services_local_idx ON services(local_id);

-- ============================ ATTENDANCE ===========================
CREATE TABLE IF NOT EXISTS attendance (
  id                     SERIAL PRIMARY KEY,
  member_id              INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  service_id             INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  notes                  TEXT,
  recorded_by_user_id    INTEGER NOT NULL REFERENCES users(id),
  updated_by_user_id     INTEGER REFERENCES users(id),
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_member_service_unique UNIQUE (member_id, service_id)
);

CREATE INDEX IF NOT EXISTS attendance_service_idx ON attendance(service_id);
CREATE INDEX IF NOT EXISTS attendance_member_idx ON attendance(member_id);
CREATE INDEX IF NOT EXISTS attendance_recorded_by_idx ON attendance(recorded_by_user_id);
-- ============================ FOLLOW-UPS ===========================
CREATE TABLE IF NOT EXISTS follow_ups (
  id            SERIAL PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  absent_weeks  INTEGER NOT NULL DEFAULT 0 CHECK (absent_weeks >= 0),
  last_seen     DATE,
  reason        TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  assigned_to   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_ups_member_idx ON follow_ups(member_id);

-- ========================== REFRESH TOKENS ========================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);

-- ============================= SETTINGS ===========================
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('church_name', 'COP Agona Ahanta'),
  ('usher_can_correct_attendance', 'true'),
  ('usher_correction_window_minutes', '30'),
  ('show_member_contacts_to_ushers', 'false'),
  ('birthday_messages_enabled', 'true'),
  ('birthday_message_template', 'Happy birthday {{first_name}}! May God bless your new year of life and keep you growing in grace. With love, {{church_name}}.'),
  ('notifications_enabled', 'true'),
  ('visitor_thanks_enabled', 'true'),
  ('visitor_thanks_template', 'Hi {{first_name}}! Thank you for visiting {{church_name}} today. We would love to welcome you back.'),
  ('followup_absent_threshold', '3')
ON CONFLICT (key) DO NOTHING;

-- ======================== BIRTHDAY MESSAGES ========================
CREATE TABLE IF NOT EXISTS birthday_messages (
  id                SERIAL PRIMARY KEY,
  member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year              INTEGER NOT NULL CHECK (year >= 1900),
  phone             TEXT,
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  provider_response TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, year)
);
CREATE INDEX IF NOT EXISTS birthday_messages_member_idx ON birthday_messages(member_id);

-- ======================== SMS NOTIFICATIONS =======================
CREATE TABLE IF NOT EXISTS sms_notifications (
  id                SERIAL PRIMARY KEY,
  member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  phone             TEXT,
  message           TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'announcement' CHECK (category IN ('announcement', 'reminder')),
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_response TEXT,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_member ON sms_notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_created ON sms_notifications(created_at DESC);
-- ============================= VISITORS ===========================
CREATE TABLE IF NOT EXISTS visitors (
  id                  SERIAL PRIMARY KEY,
  full_name           TEXT NOT NULL,
  gender              TEXT CHECK (gender IN ('male', 'female')),
  phone               TEXT,
  email               TEXT,
  age_group           TEXT CHECK (age_group IN ('child', 'teen', 'adult')),
  home_area           TEXT,
  invited_by          TEXT,
  prayer_request      TEXT,
  service_id          INTEGER REFERENCES services(id) ON DELETE SET NULL,
  first_visit_date    DATE,
  visit_count         INTEGER NOT NULL DEFAULT 1 CHECK (visit_count >= 1),
  last_visit_date     DATE,
  converted_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  followup_status     TEXT NOT NULL DEFAULT 'new' CHECK (followup_status IN ('new', 'contacted', 'visited', 'joined', 'lost')),
  assigned_to         TEXT,
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitors_service ON visitors(service_id);
CREATE INDEX IF NOT EXISTS idx_visitors_phone ON visitors(phone);
CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(followup_status);

-- ========================= VISITOR VISITS =========================
CREATE TABLE IF NOT EXISTS visitor_visits (
  visitor_id  INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  visit_date  DATE NOT NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_service ON visitor_visits(service_id);

-- ======================= updated_at TRIGGERS ======================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_groups_updated ON member_groups;
CREATE TRIGGER trg_groups_updated BEFORE UPDATE ON member_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_locations_updated ON locations;
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_members_updated ON members;
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_services_updated ON services;
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_attendance_updated ON attendance;
CREATE TRIGGER trg_attendance_updated BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_follow_ups_updated ON follow_ups;
CREATE TRIGGER trg_follow_ups_updated BEFORE UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_settings_updated ON settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_visitors_updated ON visitors;
CREATE TRIGGER trg_visitors_updated BEFORE UPDATE ON visitors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_locals_updated ON locals;
CREATE TRIGGER trg_locals_updated BEFORE UPDATE ON locals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ====================== DEFAULT LOCAL DATA =======================
INSERT INTO locals (name, description)
SELECT 'Main Local', 'Default local for existing data'
WHERE NOT EXISTS (SELECT 1 FROM locals WHERE name = 'Main Local');

UPDATE users        SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE members      SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE services     SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE member_groups SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE locations    SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;

-- ================= RECONCILE EXISTING DATABASES =================
-- The following run on already-initialised databases so they are brought
-- up to the same state as a fresh install. They are no-ops on fresh DBs.

-- Multi-local columns (safe if the table already exists from old schema).
ALTER TABLE users         ADD COLUMN IF NOT EXISTS local_id INTEGER REFERENCES locals(id) ON DELETE SET NULL;
ALTER TABLE members       ADD COLUMN IF NOT EXISTS local_id INTEGER REFERENCES locals(id) ON DELETE SET NULL;
ALTER TABLE services      ADD COLUMN IF NOT EXISTS local_id INTEGER REFERENCES locals(id) ON DELETE SET NULL;
ALTER TABLE member_groups ADD COLUMN IF NOT EXISTS local_id INTEGER REFERENCES locals(id) ON DELETE SET NULL;
ALTER TABLE locations     ADD COLUMN IF NOT EXISTS local_id INTEGER REFERENCES locals(id) ON DELETE SET NULL;

-- Member profile columns (safe if the table already existed from old schema).
ALTER TABLE members ADD COLUMN IF NOT EXISTS birthday         DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS gender           TEXT CHECK (gender IN ('male', 'female'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS age             INTEGER CHECK (age >= 0);
ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type TEXT CHECK (membership_type IN ('new_convert', 'existing'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status  TEXT CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS profession      TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS residence       TEXT;

-- Local indexes (resolved here in case tables pre-existed).
CREATE INDEX IF NOT EXISTS users_local_idx          ON users(local_id);
CREATE INDEX IF NOT EXISTS members_local_idx        ON members(local_id);
CREATE INDEX IF NOT EXISTS services_local_idx       ON services(local_id);
CREATE INDEX IF NOT EXISTS member_groups_local_idx  ON member_groups(local_id);
CREATE INDEX IF NOT EXISTS locations_local_idx      ON locations(local_id);

-- Promote legacy admins and enforce the new role set.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'district_admin' WHERE role IN ('admin', 'district_admin');
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('district_admin', 'local_admin', 'usher'));

-- ======================= MEMBER PINS =======================
-- Four-digit numeric PINs ushers type at the door to mark a member present.
ALTER TABLE members ADD COLUMN IF NOT EXISTS member_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS members_member_code_idx ON members(member_code) WHERE member_code IS NOT NULL;
-- Backfill PINs for members created before this change, and replace any
-- legacy alphanumeric codes. One row at a time so a random collision
-- retries instead of aborting the whole statement.
DO $$
DECLARE
  r        RECORD;
  new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM members
            WHERE member_code IS NULL OR member_code !~ '^\d{4}$'
            ORDER BY id
  LOOP
    LOOP
      new_code := lpad(floor(random() * 10000)::int::text, 4, '0');
      BEGIN
        UPDATE members SET member_code = new_code WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- PIN already taken; draw again.
      END;
    END LOOP;
  END LOOP;
END $$;

-- Joint (all-locals) services: ushers of EVERY local can mark attendance.
ALTER TABLE services ADD COLUMN IF NOT EXISTS all_locals BOOLEAN NOT NULL DEFAULT FALSE;

-- Per-local switch (controlled by the local admin): when TRUE, ushers of
-- that local may add new members from their own screen.
ALTER TABLE locals ADD COLUMN IF NOT EXISTS allow_usher_add_member BOOLEAN NOT NULL DEFAULT FALSE;

-- Manual count of walk-in visitors per service. Total headcount shown in the
-- UI = members marked present + this number.
ALTER TABLE services ADD COLUMN IF NOT EXISTS visitor_headcount INTEGER NOT NULL DEFAULT 0
  CHECK (visitor_headcount >= 0);

-- Re-point orphaned rows at the default local.
UPDATE users         SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE members       SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE services      SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE member_groups SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;
UPDATE locations     SET local_id = (SELECT id FROM locals WHERE name = 'Main Local') WHERE local_id IS NULL;





