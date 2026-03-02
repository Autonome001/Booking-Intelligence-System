ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS minimum_notice_minutes INTEGER NOT NULL DEFAULT 30
  CHECK (minimum_notice_minutes BETWEEN 0 AND 1440);
