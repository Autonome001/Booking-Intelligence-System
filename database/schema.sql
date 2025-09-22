-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create booking inquiries table
CREATE TABLE IF NOT EXISTS booking_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_submission_id TEXT UNIQUE NOT NULL,
    email_from TEXT NOT NULL,
    email_subject TEXT,
    email_body TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    company_name TEXT,
    phone_number TEXT,
    preferred_date TIMESTAMP WITH TIME ZONE,
    inquiry_type TEXT DEFAULT 'strategy_call',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'draft_created', 'approved', 'revised', 'human_takeover', 'sent', 'failed')),
    draft_response TEXT,
    final_response TEXT,
    slack_message_ts TEXT,
    slack_thread_ts TEXT,
    approval_history JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    priority INTEGER DEFAULT 0,
    assigned_to TEXT
);

-- Create vector store for FAQs and knowledge base
CREATE TABLE IF NOT EXISTS faq_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT,
    tags TEXT[],
    embedding vector(1536), -- OpenAI embedding dimension
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0
);

-- Create approval audit log
CREATE TABLE IF NOT EXISTS approval_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inquiry_id UUID REFERENCES booking_inquiries(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('approved', 'revised', 'human_takeover', 'cancelled', 'escalated')),
    actor_slack_id TEXT,
    actor_name TEXT,
    feedback TEXT,
    previous_draft TEXT,
    new_draft TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    processing_time_ms INTEGER
);

-- Create calendar availability table (optional for caching)
CREATE TABLE IF NOT EXISTS calendar_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    event_title TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create email delivery log
CREATE TABLE IF NOT EXISTS email_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inquiry_id UUID REFERENCES booking_inquiries(id) ON DELETE CASCADE,
    email_provider TEXT DEFAULT 'resend',
    provider_message_id TEXT,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Enable Row Level Security
ALTER TABLE booking_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for service account access
CREATE POLICY "Service can manage all booking inquiries" 
    ON booking_inquiries FOR ALL 
    USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage all faq embeddings" 
    ON faq_embeddings FOR ALL 
    USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage all approval logs" 
    ON approval_audit_log FOR ALL 
    USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage all calendar availability" 
    ON calendar_availability FOR ALL 
    USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage all email delivery logs" 
    ON email_delivery_log FOR ALL 
    USING (auth.role() = 'service_role');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_status ON booking_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_created_at ON booking_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_email ON booking_inquiries(email_from);
CREATE INDEX IF NOT EXISTS idx_booking_inquiries_slack_ts ON booking_inquiries(slack_message_ts) WHERE slack_message_ts IS NOT NULL;

-- Vector similarity search index for FAQ embeddings
CREATE INDEX IF NOT EXISTS idx_faq_embeddings_vector ON faq_embeddings 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_faq_embeddings_category ON faq_embeddings(category) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_faq_embeddings_active ON faq_embeddings(is_active, priority DESC);

CREATE INDEX IF NOT EXISTS idx_approval_audit_inquiry ON approval_audit_log(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_approval_audit_timestamp ON approval_audit_log(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_availability_time ON calendar_availability(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_email_delivery_inquiry ON email_delivery_log(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_status ON email_delivery_log(status, sent_at DESC);

-- Create functions for updated_at timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE OR REPLACE TRIGGER set_timestamp_booking_inquiries
    BEFORE UPDATE ON booking_inquiries
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE OR REPLACE TRIGGER set_timestamp_faq_embeddings
    BEFORE UPDATE ON faq_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- Function to search FAQ embeddings by similarity
CREATE OR REPLACE FUNCTION match_faq_embeddings(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id uuid,
    question text,
    answer text,
    category text,
    tags text[],
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT 
        faq_embeddings.id,
        faq_embeddings.question,
        faq_embeddings.answer,
        faq_embeddings.category,
        faq_embeddings.tags,
        1 - (faq_embeddings.embedding <=> query_embedding) as similarity
    FROM faq_embeddings
    WHERE 
        faq_embeddings.is_active = TRUE
        AND 1 - (faq_embeddings.embedding <=> query_embedding) > match_threshold
    ORDER BY faq_embeddings.embedding <=> query_embedding ASC
    LIMIT LEAST(match_count, 20);
$$;

-- Function to get booking inquiry statistics
CREATE OR REPLACE FUNCTION get_booking_stats(
    start_date timestamp with time zone DEFAULT NOW() - INTERVAL '30 days',
    end_date timestamp with time zone DEFAULT NOW()
)
RETURNS TABLE (
    total_inquiries bigint,
    pending_inquiries bigint,
    approved_inquiries bigint,
    human_takeover_inquiries bigint,
    avg_processing_time_hours numeric,
    approval_rate numeric
)
LANGUAGE sql STABLE
AS $$
    WITH stats AS (
        SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status IN ('sent', 'approved')) as approved,
            COUNT(*) FILTER (WHERE status = 'human_takeover') as takeover,
            AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_hours
        FROM booking_inquiries 
        WHERE created_at BETWEEN start_date AND end_date
    )
    SELECT 
        total,
        pending,
        approved,
        takeover,
        ROUND(avg_hours::numeric, 2),
        CASE 
            WHEN total > 0 THEN ROUND((approved::numeric / total::numeric) * 100, 2)
            ELSE 0 
        END
    FROM stats;
$$;