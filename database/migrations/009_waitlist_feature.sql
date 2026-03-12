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

-- Add waitlist feature columns to booking_display_settings
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_enabled') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_title') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_title TEXT DEFAULT 'Experience the Future of AI Strategy';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_description') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_description TEXT DEFAULT 'Join our exclusive waitlist today and be the first to know when we open new slots for our Autonome Blueprint AI audit and assessment platform.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'show_waitlist_copyright') THEN
        ALTER TABLE booking_display_settings ADD COLUMN show_waitlist_copyright BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_cta_title') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_cta_title TEXT DEFAULT 'High Demand: Alternative Path Available';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_cta_description') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_cta_description TEXT DEFAULT 'Can''t find a perfect time? Join our priority waitlist to get notified of cancellations and exclusive early-access windows.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_display_settings' AND column_name = 'waitlist_cta_button_text') THEN
        ALTER TABLE booking_display_settings ADD COLUMN waitlist_cta_button_text TEXT DEFAULT 'Join Priority Waitlist';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
