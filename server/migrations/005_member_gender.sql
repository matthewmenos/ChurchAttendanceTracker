-- ============ Member gender ============

-- Gender for per-service and range reports. NULL = not specified.
ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));