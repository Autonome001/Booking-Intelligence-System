-- ═══════════════════════════════════════════════════════════════════════
-- Booking Intelligence System - Enhanced Database Schema (FIXED VERSION)
-- Migration: 002_enhanced_schema
-- Run this version in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- === STEP 1: CREATE CORE TABLES ===

-- Calendar Accounts (Multi-Calendar Support)
CREATE TABLE IF NOT EXISTS calendar_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    calendar_email TEXT UNIQUE NOT NULL,
    calendar_type TEXT DEFAULT 'google',
    oauth_credentials JSONB,
    is_primary BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    constraints JSONB DEFAULT '{}',
    webhook_channel_id TEXT,
    webhook_resource_id TEXT,
    webhook_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provisional Holds (Temporary Slot Reservations)
CREATE TABLE IF NOT EXISTS provisional_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_inquiry_id UUID,
    calendar_account_id UUID,
    calendar_email TEXT NOT NULL,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    confirmed_event_id TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Routing Rules (YAML-backed)
CREATE TABLE IF NOT EXISTS routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT UNIQUE NOT NULL,
    priority INTEGER DEFAULT 0,
    conditions JSONB NOT NULL,
    actions JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_from_yaml BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Conversations (Multi-turn tracking)
CREATE TABLE IF NOT EXISTS email_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_inquiry_id UUID,
    thread_id TEXT NOT NULL,
    conversation_stage TEXT DEFAULT 'initial',
    turns_count INTEGER DEFAULT 0,
    messages JSONB DEFAULT '[]',
    context JSONB DEFAULT '{}',
    last_inbound_at TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- === STEP 2: ENHANCE BOOKING_INQUIRIES TABLE ===
-- Add AI analysis and routing fields one by one

DO $$
BEGIN
    -- AI Analysis
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='ai_analysis') THEN
        ALTER TABLE booking_inquiries ADD COLUMN ai_analysis JSONB DEFAULT '{}';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='qualification_score') THEN
        ALTER TABLE booking_inquiries ADD COLUMN qualification_score INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='sentiment') THEN
        ALTER TABLE booking_inquiries ADD COLUMN sentiment TEXT;
    END IF;

    -- Routing Decision
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='meeting_type') THEN
        ALTER TABLE booking_inquiries ADD COLUMN meeting_type TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='meeting_duration') THEN
        ALTER TABLE booking_inquiries ADD COLUMN meeting_duration INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='priority_level') THEN
        ALTER TABLE booking_inquiries ADD COLUMN priority_level INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='assigned_calendar') THEN
        ALTER TABLE booking_inquiries ADD COLUMN assigned_calendar TEXT;
    END IF;

    -- Provisional Hold Tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='provisional_hold_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN provisional_hold_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='provisional_hold_expires_at') THEN
        ALTER TABLE booking_inquiries ADD COLUMN provisional_hold_expires_at TIMESTAMPTZ;
    END IF;

    -- Tavus Integration
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='tavus_video_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN tavus_video_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='tavus_video_status') THEN
        ALTER TABLE booking_inquiries ADD COLUMN tavus_video_status TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='tavus_responses') THEN
        ALTER TABLE booking_inquiries ADD COLUMN tavus_responses JSONB DEFAULT '{}';
    END IF;

    -- Email Conversation Tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='conversation_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN conversation_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='email_thread_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN email_thread_id TEXT;
    END IF;

    -- Slot Selection
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='selected_slot_start') THEN
        ALTER TABLE booking_inquiries ADD COLUMN selected_slot_start TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='selected_slot_end') THEN
        ALTER TABLE booking_inquiries ADD COLUMN selected_slot_end TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='confirmed_event_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN confirmed_event_id TEXT;
    END IF;
END $$;

-- === STEP 3: CREATE INDEXES ===

-- Calendar accounts indexes
CREATE INDEX IF NOT EXISTS idx_calendar_accounts_active
    ON calendar_accounts(is_active, priority DESC)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_calendar_accounts_user
    ON calendar_accounts(user_email)
    WHERE is_active = TRUE;

-- Provisional holds indexes
CREATE INDEX IF NOT EXISTS idx_provisional_holds_active
    ON provisional_holds(expires_at, status)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_provisional_holds_calendar
    ON provisional_holds(calendar_email, slot_start, slot_end)
    WHERE status = 'active';

-- Email conversations indexes
CREATE INDEX IF NOT EXISTS idx_email_conversations_thread
    ON email_conversations(thread_id);

CREATE INDEX IF NOT EXISTS idx_email_conversations_inquiry
    ON email_conversations(booking_inquiry_id);

-- Booking inquiries indexes
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_priority
    ON booking_inquiries(priority_level DESC)
    WHERE priority_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_inquiries_meeting
    ON booking_inquiries(meeting_type, status)
    WHERE meeting_type IS NOT NULL;

-- === STEP 4: CREATE TIMESTAMP FUNCTION (if not exists) ===

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- === STEP 5: CREATE TRIGGERS ===

DROP TRIGGER IF EXISTS update_calendar_accounts_timestamp ON calendar_accounts;
CREATE TRIGGER update_calendar_accounts_timestamp
    BEFORE UPDATE ON calendar_accounts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS update_routing_rules_timestamp ON routing_rules;
CREATE TRIGGER update_routing_rules_timestamp
    BEFORE UPDATE ON routing_rules
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS update_email_conversations_timestamp ON email_conversations;
CREATE TRIGGER update_email_conversations_timestamp
    BEFORE UPDATE ON email_conversations
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- === STEP 6: CREATE HELPER FUNCTIONS ===

-- Function to release expired provisional holds
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
    conflict_count INTEGER := 0;
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

    RETURN conflict_count > 0;
END;
$$ LANGUAGE plpgsql;

-- === STEP 7: INSERT SAMPLE DATA ===

-- Insert default calendar account for dev@autonome.us
INSERT INTO calendar_accounts (user_email, calendar_email, is_primary, priority, is_active)
VALUES ('dev@autonome.us', 'dev@autonome.us', TRUE, 100, TRUE)
ON CONFLICT (calendar_email) DO NOTHING;

-- === MIGRATION COMPLETE ===

SELECT
    'Migration 002_enhanced_schema completed successfully' AS status,
    (SELECT COUNT(*) FROM calendar_accounts) AS calendar_accounts_count,
    (SELECT COUNT(*) FROM provisional_holds) AS provisional_holds_count,
    (SELECT COUNT(*) FROM routing_rules) AS routing_rules_count,
    (SELECT COUNT(*) FROM email_conversations) AS email_conversations_count,
    (SELECT COUNT(*) FROM booking_inquiries) AS booking_inquiries_count;
