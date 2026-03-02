CREATE TABLE IF NOT EXISTS meeting_notification_settings (
  user_email TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  pre_meeting JSONB NOT NULL DEFAULT '[]'::jsonb,
  post_meeting JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "minutes_after": 5,
    "subject_template": "Thank you for meeting with Autonome, {customer_name}",
    "body_template": "Hi {customer_name},\n\nThank you for taking the time to meet with Autonome. We appreciated the conversation about {company_name}.\n\nIf you have any follow-up questions, reply directly to this email and we will continue the conversation.\n\nBest,\nThe Autonome Team"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notification_settings_updated_at
  ON meeting_notification_settings(updated_at DESC);
