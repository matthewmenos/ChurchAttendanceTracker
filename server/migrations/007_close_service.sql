-- ============ Close service attendance ============

-- Admin can lock a service so no further marking/correction is possible.
ALTER TABLE services ADD COLUMN IF NOT EXISTS attendance_closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS attendance_closed_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN IF NOT EXISTS attendance_closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;