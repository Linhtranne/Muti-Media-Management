-- US-006 runtime hardening: persist sanitized publish failure details.
ALTER TABLE publish_jobs
ADD COLUMN IF NOT EXISTS last_error_code TEXT,
ADD COLUMN IF NOT EXISTS last_error TEXT;
