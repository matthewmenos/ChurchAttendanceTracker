-- ============ Visitors ============

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

-- Repeated attendance per visitor, one row per service.
CREATE TABLE IF NOT EXISTS visitor_visits (
  visitor_id   INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  service_id   INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  visit_date   DATE NOT NULL,
  recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_visitor_visits_service ON visitor_visits(service_id);

-- Auto-updated timestamp trigger for visitors.
CREATE OR REPLACE FUNCTION set_visitors_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_visitors_updated ON visitors;
CREATE TRIGGER trg_visitors_updated BEFORE UPDATE ON visitors
  FOR EACH ROW EXECUTE FUNCTION set_visitors_updated_at();

INSERT INTO settings (key, value) VALUES
  ('visitor_thanks_enabled', 'true'),
  ('visitor_thanks_template', 'Hi {{first_name}}! Thank you for visiting {{church_name}} today. We would love to welcome you back.')
ON CONFLICT (key) DO NOTHING;