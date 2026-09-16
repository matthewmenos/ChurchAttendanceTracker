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

-- ------------------- Member profile columns + member PINs ------------
DO $$
DECLARE
  r        RECORD;
  new_code TEXT;
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

    -- Member PINs ushers type at the door for quick marking: four digits,
    -- numbers only. Any legacy alphanumeric codes are replaced.
    ALTER TABLE members ADD COLUMN IF NOT EXISTS member_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS members_member_code_idx
      ON members (member_code) WHERE member_code IS NOT NULL;

    -- Give every member without a valid 4-digit PIN a fresh one, one row
    -- at a time so a random collision retries instead of aborting.
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
  END IF;
END $$;

-- ----------------- Joint (all-branches) services --------------------
-- When TRUE, ushers of EVERY branch can view and mark this service
-- (combined gatherings). Regular services keep the same-branch rule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'services') THEN
    ALTER TABLE services ADD COLUMN IF NOT EXISTS all_branches BOOLEAN NOT NULL DEFAULT FALSE;
    -- Manual count of walk-in visitors per service. Total headcount shown in
    -- the UI = members marked present + this number.
    ALTER TABLE services ADD COLUMN IF NOT EXISTS visitor_headcount INTEGER NOT NULL DEFAULT 0
      CHECK (visitor_headcount >= 0);
  END IF;
END $$;
