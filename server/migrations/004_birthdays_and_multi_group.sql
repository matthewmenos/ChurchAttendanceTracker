-- ============ Birthdays + multi-group membership ============

-- Birthday details for member greetings (Arkasel SMS provider).
ALTER TABLE members ADD COLUMN IF NOT EXISTS birthday DATE;

-- A member can belong to several groups.
CREATE TABLE IF NOT EXISTS member_group_assignments (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  group_id   INTEGER NOT NULL REFERENCES member_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_mga_group ON member_group_assignments(group_id);

-- Carry the old single-group value over, then drop the column.
INSERT INTO member_group_assignments (member_id, group_id)
SELECT id, group_id FROM members WHERE group_id IS NOT NULL
ON CONFLICT (member_id, group_id) DO NOTHING;

ALTER TABLE members DROP COLUMN IF EXISTS group_id;

-- One birthday message per member per year, ever.
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

INSERT INTO settings (key, value) VALUES
  ('birthday_messages_enabled', 'true'),
  ('birthday_message_template', 'Happy birthday {{first_name}}! May God bless your new year of life and keep you growing in grace. With love, {{church_name}}.')
ON CONFLICT (key) DO NOTHING;
