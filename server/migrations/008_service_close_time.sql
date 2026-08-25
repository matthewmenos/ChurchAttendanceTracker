-- ============ Scheduled attendance close time ============

-- Set on a service so marking locks automatically once this moment passes.
ALTER TABLE services ADD COLUMN IF NOT EXISTS attendance_close_time TIMESTAMPTZ;