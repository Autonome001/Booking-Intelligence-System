ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS discovery_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_title TEXT DEFAULT 'Experience the Future of AI Strategy';

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_description TEXT DEFAULT 'Join our exclusive waitlist today and be the first to know when we open new slots for our Autonome Blueprint AI audit and assessment platform.';

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS show_waitlist_copyright BOOLEAN DEFAULT TRUE;

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_title TEXT DEFAULT 'High Demand: Alternative Path Available';

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_description TEXT DEFAULT 'Can''t find a perfect time? Join our priority waitlist to get notified of cancellations and exclusive early-access windows.';

ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_button_text TEXT DEFAULT 'Join Priority Waitlist';

NOTIFY pgrst, 'reload schema';
