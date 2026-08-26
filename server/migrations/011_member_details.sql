-- ============ Extra member registration details ============

-- Membership type: how the person joined the congregation.
ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type TEXT
  CHECK (membership_type IN ('new_convert', 'existing'));

-- Marital status (free set, commonly tracked by churches).
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status TEXT
  CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed'));

-- Profession / occupation (free text).
ALTER TABLE members ADD COLUMN IF NOT EXISTS profession TEXT;

-- Place of residence (free text).
ALTER TABLE members ADD COLUMN IF NOT EXISTS residence TEXT;