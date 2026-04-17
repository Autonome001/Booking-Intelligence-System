-- Migration: Add personal_view_tagline column to booking_display_settings
-- Created: 2026-04-16

ALTER TABLE booking_display_settings 
ADD COLUMN IF NOT EXISTS personal_view_tagline TEXT;
