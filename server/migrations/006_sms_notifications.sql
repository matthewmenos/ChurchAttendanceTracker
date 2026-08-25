-- ============ SMS activity notifications ============

-- One row per member per message sent (announcements & reminders).
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

-- Master switch for activity SMS (separate from birthday messages).
INSERT INTO settings (key, value) VALUES ('notifications_enabled', 'true')
ON CONFLICT (key) DO NOTHING;