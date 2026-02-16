-- ═══════════════════════════════════════════════════════════════════════
-- Booking Intelligence System - Availability Controls
-- Migration: 003_availability_controls
-- Adds blackout periods and working hours management
-- ═══════════════════════════════════════════════════════════════════════

-- === BLACKOUT PERIODS TABLE ===
-- Manual time blocks that prevent bookings (vacations, lunch breaks, etc.)
CREATE TABLE IF NOT EXISTS blackout_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Validation: end_time must be after start_time
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- === WORKING HOURS TABLE ===
-- Define available hours by day of week
CREATE TABLE IF NOT EXISTS working_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Validation
    CONSTRAINT valid_day_of_week CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CONSTRAINT valid_working_hours CHECK (end_time > start_time),

    -- Unique constraint: one working hour entry per user per day
    UNIQUE(user_email, day_of_week)
);

-- === INDEXES ===

-- Blackout periods - query by user and time range
CREATE INDEX IF NOT EXISTS idx_blackout_periods_user_time
    ON blackout_periods(user_email, start_time, end_time)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_blackout_periods_active
    ON blackout_periods(is_active, start_time DESC)
    WHERE is_active = TRUE;

-- Working hours - query by user
CREATE INDEX IF NOT EXISTS idx_working_hours_user
    ON working_hours(user_email, day_of_week)
    WHERE is_active = TRUE;

-- === TRIGGERS ===

DROP TRIGGER IF EXISTS update_blackout_periods_timestamp ON blackout_periods;
CREATE TRIGGER update_blackout_periods_timestamp
    BEFORE UPDATE ON blackout_periods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS update_working_hours_timestamp ON working_hours;
CREATE TRIGGER update_working_hours_timestamp
    BEFORE UPDATE ON working_hours
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- === DEFAULT WORKING HOURS ===
-- Insert default Monday-Friday 9 AM - 5 PM EST for primary user
INSERT INTO working_hours (user_email, day_of_week, start_time, end_time, timezone)
VALUES
    ('dev@autonome.us', 1, '09:00:00', '17:00:00', 'America/New_York'), -- Monday
    ('dev@autonome.us', 2, '09:00:00', '17:00:00', 'America/New_York'), -- Tuesday
    ('dev@autonome.us', 3, '09:00:00', '17:00:00', 'America/New_York'), -- Wednesday
    ('dev@autonome.us', 4, '09:00:00', '17:00:00', 'America/New_York'), -- Thursday
    ('dev@autonome.us', 5, '09:00:00', '17:00:00', 'America/New_York')  -- Friday
ON CONFLICT (user_email, day_of_week) DO NOTHING;

-- === MIGRATION COMPLETE ===

SELECT
    'Migration 003_availability_controls completed successfully' AS status,
    (SELECT COUNT(*) FROM blackout_periods) AS blackout_periods_count,
    (SELECT COUNT(*) FROM working_hours) AS working_hours_count;
