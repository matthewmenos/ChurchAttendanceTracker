-- Configurable auto-follow-up: number of consecutive absences that automatically
-- adds a member to the follow-up list. 0 disables the feature entirely.
INSERT INTO settings (key, value) VALUES ('followup_absent_threshold', '3')
ON CONFLICT (key) DO NOTHING;
