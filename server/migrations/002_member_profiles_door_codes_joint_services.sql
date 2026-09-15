-- =====================================================================
--  002: Member profile columns, door codes, and joint (all-branches)
--  services — for databases initialised before these features existed.
--
--  NOTE: this file sorts BEFORE schema.sql, so on a fresh database the
--  tables do not exist yet when it runs. Every statement is therefore
--  wrapped in a table-existence guard; the columns it would add are
--  already inside schema.sql's CREATE TABLE for fresh installs.
--
--  Every statement is idempotent, so re-running is safe too.
-- =====================================================================

-- ------------------- Member profile columns + door codes ------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'members') THEN
    -- Profile fields added after some deployments were initialised.
    ALTER TABLE members ADD COLUMN IF NOT EXISTS birthday        DATE;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS gender          TEXT CHECK (gender IN ('male', 'female'));
    ALTER TABLE members ADD COLUMN IF NOT EXISTS age             INTEGER CHECK (age >= 0);
    ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type TEXT CHECK (membership_type IN ('new_convert', 'existing'));
    ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status  TEXT CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed'));
    ALTER TABLE members ADD COLUMN IF NOT EXISTS profession      TEXT;
    ALTER TABLE members ADD COLUMN IF NOT EXISTS residence       TEXT;

    -- Door codes ushers type at the door for quick marking.
    ALTER TABLE members ADD COLUMN IF NOT EXISTS member_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS members_member_code_idx
      ON members (member_code) WHERE member_code IS NOT NULL;

    -- Give every existing member a code. Deterministic + unique by
    -- construction (id suffix), so it never collides or duplicates.
    UPDATE members
       SET member_code = upper(substr(md5('cat-member-' || id::text), 1, 6)) || '-' || id::text
     WHERE member_code IS NULL;
  END IF;
END $$;

-- ----------------- Joint (all-branches) services --------------------
-- When TRUE, ushers of EVERY branch can view and mark this service
-- (combined gatherings). Regular services keep the same-branch rule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'services') THEN
    ALTER TABLE services ADD COLUMN IF NOT EXISTS all_branches BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
