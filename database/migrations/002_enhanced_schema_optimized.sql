-- ═══════════════════════════════════════════════════════════════════════
-- Booking Intelligence System - Enhanced Database Schema (Optimized)
-- Migration: 002_enhanced_schema
-- Optimized to avoid memory limits
-- ═══════════════════════════════════════════════════════════════════════

-- === STEP 1: CREATE TABLES ===

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

-- Add AI analysis fields
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='ai_analysis') THEN
        ALTER TABLE booking_inquiries ADD COLUMN ai_analysis JSONB DEFAULT '{}';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='qualification_score') THEN
        ALTER TABLE booking_inquiries ADD COLUMN qualification_score INTEGER;
    END IF;

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

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='provisional_hold_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN provisional_hold_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='provisional_hold_expires_at') THEN
        ALTER TABLE booking_inquiries ADD COLUMN provisional_hold_expires_at TIMESTAMPTZ;
    END IF;

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

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='booking_inquiries' AND column_name='conversation_id') THEN
        ALTER TABLE booking_inquiries ADD COLUMN conversation_id UUID;
    END IF;

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

-- === STEP 3: CREATE ESSENTIAL INDEXES ONLY ===

-- Calendar accounts - only most critical index
CREATE INDEX IF NOT EXISTS idx_calendar_accounts_active
    ON calendar_accounts(is_active, priority DESC)
    WHERE is_active = TRUE;

-- Provisional holds - only active holds index
CREATE INDEX IF NOT EXISTS idx_provisional_holds_active
    ON provisional_holds(expires_at, status)
    WHERE status = 'active';

-- Email conversations - thread lookup
CREATE INDEX IF NOT EXISTS idx_email_conversations_thread
    ON email_conversations(thread_id);

-- Booking inquiries - priority only
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_priority
    ON booking_inquiries(priority_level DESC)
    WHERE priority_level IS NOT NULL;

-- === STEP 4: CREATE FUNCTION FOR TIMESTAMPS ===

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

-- === STEP 6: ADD SAMPLE DATA ===

INSERT INTO calendar_accounts (user_email, calendar_email, is_primary, priority, is_active)
VALUES ('dev@autonome.us', 'primary@autonome.us', TRUE, 100, TRUE)
ON CONFLICT (calendar_email) DO NOTHING;

-- === MIGRATION COMPLETE ===

SELECT
    'Migration 002_enhanced_schema completed successfully' AS status,
    (SELECT COUNT(*) FROM calendar_accounts) AS calendar_accounts_count,
    (SELECT COUNT(*) FROM provisional_holds) AS provisional_holds_count,
    (SELECT COUNT(*) FROM routing_rules) AS routing_rules_count,
    (SELECT COUNT(*) FROM email_conversations) AS email_conversations_count;
