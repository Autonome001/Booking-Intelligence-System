CREATE TABLE IF NOT EXISTS booking_display_settings (
  user_email TEXT PRIMARY KEY,
  display_window_days INTEGER NOT NULL DEFAULT 20 CHECK (display_window_days BETWEEN 7 AND 60),
  ai_concierge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_display_settings_updated_at
  ON booking_display_settings(updated_at DESC);
