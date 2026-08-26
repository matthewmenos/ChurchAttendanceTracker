-- ============ Auto-calculated member age ============

-- Age in whole years, derived from birthday at save time.
ALTER TABLE members ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age >= 0);
