-- ═══════════════════════════════════════════════════════════════════════
-- Booking Intelligence System - Enhanced Database Schema
-- Migration: 002_enhanced_schema
--
-- Adds support for:
-- - Multi-calendar accounts (up to 7 calendars)
-- - Provisional holds system
-- - Routing rules
-- - Email conversation tracking
-- - Enhanced booking inquiry fields
-- ═══════════════════════════════════════════════════════════════════════

-- === CALENDAR ACCOUNTS (Multi-Calendar Support) ===
CREATE TABLE IF NOT EXISTS calendar_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    calendar_email TEXT UNIQUE NOT NULL,
    calendar_type TEXT DEFAULT 'google' CHECK (calendar_type IN ('google', 'calendly', 'outlook', 'nylas')),
    oauth_credentials JSONB,  -- Encrypted refresh tokens and access tokens
    is_primary BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 0,  -- Higher priority = preferred for booking
    is_active BOOLEAN DEFAULT TRUE,
    constraints JSONB DEFAULT '{}',  -- Calendar-specific constraints (working hours, buffers)
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one primary calendar
CREATE UNIQUE INDEX idx_calendar_accounts_primary
    ON calendar_accounts(is_primary)
    WHERE is_primary = TRUE;

-- === PROVISIONAL HOLDS (Temporary Slot Reservations) ===
CREATE TABLE IF NOT EXISTS provisional_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_inquiry_id UUID REFERENCES booking_inquiries(id) ON DELETE CASCADE,
    calendar_account_id UUID REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    calendar_email TEXT NOT NULL,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'expired', 'released')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    confirmed_event_id TEXT,  -- Google Calendar event ID when confirmed
    metadata JSONB DEFAULT '{}'
);

-- Index for active holds
CREATE INDEX idx_provisional_holds_active
    ON provisional_holds(expires_at, status)
    WHERE status = 'active';

-- Index for calendar-based lookups
CREATE INDEX idx_provisional_holds_calendar_slot
    ON provisional_holds(calendar_email, slot_start, slot_end)
    WHERE status = 'active';

-- === ROUTING RULES (YAML-backed with database cache) ===
CREATE TABLE IF NOT EXISTS routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT UNIQUE NOT NULL,
    priority INTEGER DEFAULT 0,
    conditions JSONB NOT NULL,  -- Match conditions (tier, urgency, score, etc.)
    actions JSONB NOT NULL,     -- Routing actions (meeting type, duration, priority, calendar)
    is_active BOOLEAN DEFAULT TRUE,
    is_from_yaml BOOLEAN DEFAULT TRUE,  -- TRUE if loaded from YAML, FALSE if custom
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rule matching
CREATE INDEX idx_routing_rules_priority
    ON routing_rules(priority DESC, is_active)
    WHERE is_active = TRUE;

-- === EMAIL CONVERSATIONS (Multi-turn email tracking) ===
CREATE TABLE IF NOT EXISTS email_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_inquiry_id UUID REFERENCES booking_inquiries(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,  -- Email thread identifier
    conversation_stage TEXT DEFAULT 'initial' CHECK (conversation_stage IN (
        'initial',
        'gathering_info',
        'proposing_slots',
        'confirming',
        'completed',
        'abandoned'
    )),
    turns_count INTEGER DEFAULT 0,
    messages JSONB DEFAULT '[]',  -- Array of {direction: 'inbound'|'outbound', content, timestamp, metadata}
    context JSONB DEFAULT '{}',   -- Extracted information (preferred times, answers, sentiment)
    last_inbound_at TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for thread lookups
CREATE INDEX idx_email_conversations_thread
    ON email_conversations(thread_id);

-- Index for inquiry lookups
CREATE INDEX idx_email_conversations_inquiry
    ON email_conversations(booking_inquiry_id);

-- === ENHANCE EXISTING booking_inquiries TABLE ===
-- Add new fields for Booking Intelligence System

-- AI Analysis and Qualification
ALTER TABLE booking_inquiries
ADD COLUMN IF NOT EXISTS ai_analysis JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS qualification_score INTEGER CHECK (qualification_score >= 0 AND qualification_score <= 100),
ADD COLUMN IF NOT EXISTS sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative'));

-- Routing Decision
ADD COLUMN IF NOT EXISTS meeting_type TEXT,
ADD COLUMN IF NOT EXISTS meeting_duration INTEGER,
ADD COLUMN IF NOT EXISTS priority_level INTEGER CHECK (priority_level >= 1 AND priority_level <= 5),
ADD COLUMN IF NOT EXISTS assigned_calendar_email TEXT;

-- Provisional Hold Tracking
ALTER TABLE booking_inquiries
ADD COLUMN IF NOT EXISTS provisional_hold_id UUID REFERENCES provisional_holds(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS provisional_hold_expires_at TIMESTAMPTZ;

-- Tavus Integration
ALTER TABLE booking_inquiries
ADD COLUMN IF NOT EXISTS tavus_video_id TEXT,
ADD COLUMN IF NOT EXISTS tavus_video_status TEXT CHECK (tavus_video_status IN ('queuing', 'generating', 'ready', 'failed')),
ADD COLUMN IF NOT EXISTS tavus_video_url TEXT,
ADD COLUMN IF NOT EXISTS tavus_qa_responses JSONB;

-- Email Conversation Tracking
ALTER TABLE booking_inquiries
ADD COLUMN IF NOT EXISTS email_thread_id TEXT,
ADD COLUMN IF NOT EXISTS conversation_turns INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS conversation_stage TEXT;

-- Processing Metadata
ALTER TABLE booking_inquiries
ADD COLUMN IF NOT EXISTS processing_id TEXT UNIQUE;  -- May already exist

-- Ensure processing_id is unique (in case it wasn't before)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_inquiries_processing_id_key'
    ) THEN
        ALTER TABLE booking_inquiries ADD CONSTRAINT booking_inquiries_processing_id_key UNIQUE (processing_id);
    END IF;
END $$;

-- === CALENDAR AVAILABILITY CACHE (Enhanced) ===
-- Add new fields to existing calendar_availability table
ALTER TABLE calendar_availability
ADD COLUMN IF NOT EXISTS calendar_email TEXT,
ADD COLUMN IF NOT EXISTS sync_token TEXT,
ADD COLUMN IF NOT EXISTS event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_type TEXT DEFAULT 'google';

-- Index for calendar-based availability lookups
CREATE INDEX IF NOT EXISTS idx_calendar_availability_calendar_time
    ON calendar_availability(calendar_email, start_time, end_time)
    WHERE is_available = TRUE;

-- === FUNCTIONS ===

-- Function to auto-release expired provisional holds
CREATE OR REPLACE FUNCTION release_expired_provisional_holds()
RETURNS INTEGER AS $$
DECLARE
    released_count INTEGER;
BEGIN
    UPDATE provisional_holds
    SET status = 'expired',
        released_at = NOW()
    WHERE status = 'active'
      AND expires_at < NOW();

    GET DIAGNOSTICS released_count = ROW_COUNT;

    RETURN released_count;
END;
$$ LANGUAGE plpgsql;

-- Function to check for calendar conflicts
CREATE OR REPLACE FUNCTION check_calendar_conflicts(
    p_calendar_email TEXT,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ
)
RETURNS BOOLEAN AS $$
DECLARE
    conflict_count INTEGER;
BEGIN
    -- Check for overlapping active provisional holds
    SELECT COUNT(*)
    INTO conflict_count
    FROM provisional_holds
    WHERE calendar_email = p_calendar_email
      AND status = 'active'
      AND (
          (slot_start <= p_start_time AND slot_end > p_start_time) OR
          (slot_start < p_end_time AND slot_end >= p_end_time) OR
          (slot_start >= p_start_time AND slot_end <= p_end_time)
      );

    -- Check for existing calendar events (unavailable slots)
    IF conflict_count = 0 THEN
        SELECT COUNT(*)
        INTO conflict_count
        FROM calendar_availability
        WHERE calendar_email = p_calendar_email
          AND is_available = FALSE
          AND (
              (start_time <= p_start_time AND end_time > p_start_time) OR
              (start_time < p_end_time AND end_time >= p_end_time) OR
              (start_time >= p_start_time AND end_time <= p_end_time)
          );
    END IF;

    RETURN conflict_count > 0;
END;
$$ LANGUAGE plpgsql;

-- Function to get multi-calendar availability (intersection logic)
CREATE OR REPLACE FUNCTION get_multi_calendar_availability(
    p_calendar_emails TEXT[],
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_slot_duration_minutes INTEGER DEFAULT 30
)
RETURNS TABLE (
    slot_start TIMESTAMPTZ,
    slot_end TIMESTAMPTZ,
    all_calendars_free BOOLEAN
) AS $$
BEGIN
    -- This is a placeholder - actual implementation will be in TypeScript
    -- using the Calendar Aggregator class with proper timezone handling
    RETURN QUERY
    SELECT
        generate_series(
            p_start_date,
            p_end_date,
            (p_slot_duration_minutes || ' minutes')::INTERVAL
        ) AS slot_start,
        generate_series(
            p_start_date + (p_slot_duration_minutes || ' minutes')::INTERVAL,
            p_end_date + (p_slot_duration_minutes || ' minutes')::INTERVAL,
            (p_slot_duration_minutes || ' minutes')::INTERVAL
        ) AS slot_end,
        TRUE AS all_calendars_free
    LIMIT 0;  -- Placeholder returns no rows
END;
$$ LANGUAGE plpgsql;

-- === TRIGGERS ===

-- Auto-update updated_at timestamps
CREATE OR REPLACE TRIGGER update_calendar_accounts_timestamp
    BEFORE UPDATE ON calendar_accounts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE OR REPLACE TRIGGER update_routing_rules_timestamp
    BEFORE UPDATE ON routing_rules
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE OR REPLACE TRIGGER update_email_conversations_timestamp
    BEFORE UPDATE ON email_conversations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- === INDEXES (Additional) ===

-- Booking inquiry indexes
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_priority
    ON booking_inquiries(priority_level DESC, created_at DESC)
    WHERE priority_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_inquiries_meeting_type
    ON booking_inquiries(meeting_type, status);

CREATE INDEX IF NOT EXISTS idx_booking_inquiries_qualification
    ON booking_inquiries(qualification_score DESC)
    WHERE qualification_score IS NOT NULL;

-- Calendar accounts indexes
CREATE INDEX idx_calendar_accounts_active
    ON calendar_accounts(is_active, priority DESC)
    WHERE is_active = TRUE;

CREATE INDEX idx_calendar_accounts_email
    ON calendar_accounts(calendar_email)
    WHERE is_active = TRUE;

-- === COMMENTS (Documentation) ===

COMMENT ON TABLE calendar_accounts IS 'Stores up to 7 Google Calendar accounts with OAuth credentials';
COMMENT ON TABLE provisional_holds IS 'Temporary slot reservations during approval flow (30 min expiration)';
COMMENT ON TABLE routing_rules IS 'Intelligent routing rules for meeting type, duration, and priority assignment';
COMMENT ON TABLE email_conversations IS 'Multi-turn email conversation tracking for booking requests';

COMMENT ON COLUMN calendar_accounts.oauth_credentials IS 'Encrypted JSON containing refresh_token, access_token, expiry';
COMMENT ON COLUMN calendar_accounts.priority IS 'Higher number = preferred calendar for booking events';
COMMENT ON COLUMN provisional_holds.expires_at IS 'Automatic expiration time (default 30 minutes from creation)';
COMMENT ON COLUMN booking_inquiries.ai_analysis IS 'GPT-4o analysis result: {customer_tier, urgency_level, budget_estimation, key_needs_summary}';
COMMENT ON COLUMN booking_inquiries.qualification_score IS 'Lead quality score 0-100 based on multiple signals';

-- === INITIAL DATA (Development/Testing) ===

-- Insert sample calendar account for development (DO NOT use in production)
INSERT INTO calendar_accounts (user_email, calendar_email, is_primary, priority, is_active)
VALUES ('dev@autonome.us', 'primary', TRUE, 100, TRUE)
ON CONFLICT (calendar_email) DO NOTHING;

-- === GRANTS (Security) ===

-- Service role should have full access
GRANT ALL ON TABLE calendar_accounts TO service_role;
GRANT ALL ON TABLE provisional_holds TO service_role;
GRANT ALL ON TABLE routing_rules TO service_role;
GRANT ALL ON TABLE email_conversations TO service_role;

-- === MIGRATION COMPLETE ===

SELECT 'Migration 002_enhanced_schema completed successfully' AS status;
