import type { SupabaseClient } from '@supabase/supabase-js';

const MISSING_TABLE_CODE = 'PGRST205';

const CALENDAR_ACCOUNTS_BOOTSTRAP_SQL = `
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
`;

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

export function isCalendarAccountsMissing(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === MISSING_TABLE_CODE ||
    error.message?.includes("Could not find the table 'public.calendar_accounts'") === true
  );
}

export async function ensureCalendarAccountsTable(
  supabase: SupabaseClient
): Promise<{ ready: boolean; repaired: boolean; reason?: string }> {
  const probe = await supabase.from('calendar_accounts').select('id').limit(1);

  if (!isCalendarAccountsMissing(probe.error)) {
    return { ready: true, repaired: false };
  }

  const bootstrap = await supabase.rpc('exec_sql', {
    sql: CALENDAR_ACCOUNTS_BOOTSTRAP_SQL,
  });

  if (bootstrap.error) {
    return {
      ready: false,
      repaired: false,
      reason: bootstrap.error.message,
    };
  }

  const verify = await supabase.from('calendar_accounts').select('id').limit(1);

  if (verify.error) {
    return {
      ready: false,
      repaired: true,
      reason: verify.error.message,
    };
  }

  return { ready: true, repaired: true };
}
