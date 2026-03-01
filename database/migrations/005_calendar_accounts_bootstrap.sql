CREATE TABLE IF NOT EXISTS calendar_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  calendar_email TEXT NOT NULL,
  calendar_type TEXT NOT NULL DEFAULT 'google',
  oauth_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  webhook_channel_id TEXT,
  webhook_resource_id TEXT,
  webhook_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_accounts_active
  ON calendar_accounts(is_active, priority DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_accounts_email
  ON calendar_accounts(calendar_email);
