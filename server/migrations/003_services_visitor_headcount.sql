-- =====================================================================
--  003: Visitor headcount per service + usher add-member switch.
--
--  1) services.visitor_headcount: manual count of walk-in visitors,
--     entered on the service form. The UI shows:
--     total headcount = members marked present + visitors.
--  2) branches.allow_usher_add_member: per-branch switch (controlled by
--     the branch admin) that lets ushers add members from their screen.
--  Idempotent; no-ops on fresh installs (schema.sql already has both
--  columns inside CREATE TABLE).
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'services') THEN
    ALTER TABLE services ADD COLUMN IF NOT EXISTS visitor_headcount INTEGER NOT NULL DEFAULT 0
      CHECK (visitor_headcount >= 0);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'branches') THEN
    -- Per-branch switch: when TRUE, ushers of that branch may add members.
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS allow_usher_add_member BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
