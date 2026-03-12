-- Create waitlist submissions table
CREATE TABLE IF NOT EXISTS waitlist_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    interest_level TEXT NOT NULL CHECK (interest_level IN ('curious', 'platform', 'assessment', 'reseller')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE waitlist_submissions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for service account access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'waitlist_submissions' AND policyname = 'Service can manage all waitlist submissions') THEN
        CREATE POLICY "Service can manage all waitlist submissions" 
            ON waitlist_submissions FOR ALL 
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_waitlist_submissions_email ON waitlist_submissions(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_submissions_created_at ON waitlist_submissions(created_at DESC);

-- Add waitlist_enabled to booking_display_settings
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_enabled') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_enabled BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
