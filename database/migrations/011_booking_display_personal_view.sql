-- Migration to add personal view settings to booking display settings
ALTER TABLE booking_display_settings
ADD COLUMN IF NOT EXISTS personal_view_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS personal_view_title TEXT DEFAULT 'Let''s Connect',
ADD COLUMN IF NOT EXISTS personal_view_description TEXT DEFAULT 'Schedule a personal meeting or informal catch-up.',
ADD COLUMN IF NOT EXISTS personal_view_logo_url TEXT,
ADD COLUMN IF NOT EXISTS personal_view_brand_name TEXT DEFAULT 'Jamelle Eugene',
ADD COLUMN IF NOT EXISTS personal_view_slug TEXT DEFAULT 'jamelleeugene',
ADD COLUMN IF NOT EXISTS personal_view_calendar_email TEXT;
