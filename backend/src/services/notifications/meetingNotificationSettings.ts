import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PreMeetingReminderConfig {
  id: string;
  enabled: boolean;
  minutesBefore: number;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface PostMeetingThankYouConfig {
  enabled: boolean;
  minutesAfter: number;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface MeetingNotificationSettings {
  timezone: string;
  preMeeting: PreMeetingReminderConfig[];
  postMeeting: PostMeetingThankYouConfig;
  updatedAt: string;
}

interface MeetingNotificationSettingsOptions {
  requirePersistentStore?: boolean;
  seedDefaults?: boolean;
}

type MeetingNotificationSettingsStore = Record<string, MeetingNotificationSettings>;

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

interface PersistedNotificationSettingsRow {
  timezone: string | null;
  pre_meeting: unknown;
  post_meeting: unknown;
  updated_at: string | null;
}

const MISSING_TABLE_CODE = 'PGRST205';
const MAX_PRE_MEETING_REMINDERS = 5;
const DEFAULT_TIMEZONE = 'America/New_York';
const MEETING_NOTIFICATION_SETTINGS_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS meeting_notification_settings (
  user_email TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  pre_meeting JSONB NOT NULL DEFAULT '[]'::jsonb,
  post_meeting JSONB NOT NULL DEFAULT '{"enabled":false,"minutes_after":5,"subject_template":"Thank you for meeting with Autonome, {customer_name}","body_template":"Hi {customer_name},\\n\\nThank you for taking the time to meet with Autonome. We appreciated the conversation about {company_name}.\\n\\nIf you have any follow-up questions, reply directly to this email and we will continue the conversation.\\n\\nBest,\\nThe Autonome Team"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

function getSettingsFilePath(): string {
  return join(process.cwd(), 'data', 'meeting-notification-settings.json');
}

function ensureSettingsDirectory(): void {
  const filePath = getSettingsFilePath();
  const dirPath = dirname(filePath);

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readStore(): MeetingNotificationSettingsStore {
  const filePath = getSettingsFilePath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw) as MeetingNotificationSettingsStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: MeetingNotificationSettingsStore): void {
  ensureSettingsDirectory();
  writeFileSync(getSettingsFilePath(), JSON.stringify(store, null, 2), 'utf8');
}

function createPersistenceError(message: string): Error {
  return new Error(`Meeting notification settings persistence error: ${message}`);
}

function defaultPreMeetingReminders(): PreMeetingReminderConfig[] {
  return [
    {
      id: 'reminder_1',
      enabled: true,
      minutesBefore: 24 * 60,
      subjectTemplate: 'Reminder: Your Autonome consultation is tomorrow, {customer_name}',
      bodyTemplate:
        'Hi {customer_name},\n\nThis is a reminder that your Autonome consultation is scheduled for {meeting_datetime} ({timezone}).\n\nWe look forward to speaking with you.\n\nBest,\nThe Autonome Team',
    },
    {
      id: 'reminder_2',
      enabled: false,
      minutesBefore: 60,
      subjectTemplate: 'Reminder: Your Autonome consultation starts in 1 hour',
      bodyTemplate:
        'Hi {customer_name},\n\nYour Autonome consultation is coming up at {meeting_datetime} ({timezone}).\n\nReply to this email if anything changes.\n\nBest,\nThe Autonome Team',
    },
    {
      id: 'reminder_3',
      enabled: false,
      minutesBefore: 15,
      subjectTemplate: 'Reminder: Your Autonome consultation starts soon',
      bodyTemplate:
        'Hi {customer_name},\n\nThis is a quick reminder that your Autonome consultation begins at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
    },
    {
      id: 'reminder_4',
      enabled: false,
      minutesBefore: 5,
      subjectTemplate: 'Reminder: Your Autonome consultation begins in 5 minutes',
      bodyTemplate:
        'Hi {customer_name},\n\nYour Autonome consultation begins in about 5 minutes at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
    },
    {
      id: 'reminder_5',
      enabled: false,
      minutesBefore: 2,
      subjectTemplate: 'Reminder: Your Autonome consultation is about to begin',
      bodyTemplate:
        'Hi {customer_name},\n\nYour Autonome consultation is about to begin at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
    },
  ];
}

function defaultPostMeetingThankYou(): PostMeetingThankYouConfig {
  return {
    enabled: false,
    minutesAfter: 5,
    subjectTemplate: 'Thank you for meeting with Autonome, {customer_name}',
    bodyTemplate:
      'Hi {customer_name},\n\nThank you for taking the time to meet with Autonome today. We appreciated the opportunity to discuss {company_name} and your goals.\n\nIf you have follow-up questions, reply directly and we will continue the conversation.\n\nBest,\nThe Autonome Team',
  };
}

function normalizeMinutes(value: unknown, fallback: number, maxValue: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(maxValue, parsed));
}

function sanitizePreMeetingReminder(
  reminder: Partial<PreMeetingReminderConfig> | undefined,
  index: number
): PreMeetingReminderConfig {
  const defaultReminders = defaultPreMeetingReminders();
  const defaults = defaultReminders[index] ?? defaultReminders[0] ?? {
    id: `reminder_${index + 1}`,
    enabled: false,
    minutesBefore: 5,
    subjectTemplate: '',
    bodyTemplate: '',
  };

  return {
    id: reminder?.id || defaults.id || `reminder_${index + 1}`,
    enabled: reminder?.enabled ?? defaults.enabled,
    minutesBefore: normalizeMinutes(reminder?.minutesBefore, defaults.minutesBefore, 60 * 24 * 30),
    subjectTemplate: (reminder?.subjectTemplate || defaults.subjectTemplate).trim(),
    bodyTemplate: (reminder?.bodyTemplate || defaults.bodyTemplate).trim(),
  };
}

function sanitizePostMeetingThankYou(
  postMeeting: Partial<PostMeetingThankYouConfig> | undefined
): PostMeetingThankYouConfig {
  const defaults = defaultPostMeetingThankYou();

  return {
    enabled: postMeeting?.enabled ?? defaults.enabled,
    minutesAfter: normalizeMinutes(postMeeting?.minutesAfter, defaults.minutesAfter, 60 * 24 * 7),
    subjectTemplate: (postMeeting?.subjectTemplate || defaults.subjectTemplate).trim(),
    bodyTemplate: (postMeeting?.bodyTemplate || defaults.bodyTemplate).trim(),
  };
}

function sanitizeSettings(
  settings: Partial<MeetingNotificationSettings> | undefined
): MeetingNotificationSettings {
  const defaults = defaultMeetingNotificationSettings();
  const inputPreMeeting = Array.isArray(settings?.preMeeting) ? settings?.preMeeting : defaults.preMeeting;
  const normalizedPreMeeting = Array.from({ length: MAX_PRE_MEETING_REMINDERS }, (_, index) =>
    sanitizePreMeetingReminder(inputPreMeeting?.[index], index)
  );

  return {
    timezone:
      typeof settings?.timezone === 'string' && settings.timezone.trim()
        ? settings.timezone.trim()
        : defaults.timezone,
    preMeeting: normalizedPreMeeting,
    postMeeting: sanitizePostMeetingThankYou(settings?.postMeeting),
    updatedAt: settings?.updatedAt || new Date().toISOString(),
  };
}

function mapDatabaseBackedSettings(
  row: PersistedNotificationSettingsRow,
  fallbackSettings: MeetingNotificationSettings
): MeetingNotificationSettings {
  return sanitizeSettings({
    timezone: row.timezone || fallbackSettings.timezone,
    preMeeting: Array.isArray(row.pre_meeting)
      ? row.pre_meeting.map((reminder, index) => ({
          id: String((reminder as Record<string, unknown>)['id'] || `reminder_${index + 1}`),
          enabled: Boolean((reminder as Record<string, unknown>)['enabled']),
          minutesBefore: normalizeMinutes(
            (reminder as Record<string, unknown>)['minutes_before'],
            fallbackSettings.preMeeting[index]?.minutesBefore || 5,
            60 * 24 * 30
          ),
          subjectTemplate: String(
            (reminder as Record<string, unknown>)['subject_template']
              || fallbackSettings.preMeeting[index]?.subjectTemplate
              || ''
          ),
          bodyTemplate: String(
            (reminder as Record<string, unknown>)['body_template']
              || fallbackSettings.preMeeting[index]?.bodyTemplate
              || ''
          ),
        }))
      : fallbackSettings.preMeeting,
    postMeeting:
      row.post_meeting && typeof row.post_meeting === 'object'
        ? {
            enabled: Boolean((row.post_meeting as Record<string, unknown>)['enabled']),
            minutesAfter: normalizeMinutes(
              (row.post_meeting as Record<string, unknown>)['minutes_after'],
              fallbackSettings.postMeeting.minutesAfter,
              60 * 24 * 7
            ),
            subjectTemplate: String(
              (row.post_meeting as Record<string, unknown>)['subject_template']
                || fallbackSettings.postMeeting.subjectTemplate
            ),
            bodyTemplate: String(
              (row.post_meeting as Record<string, unknown>)['body_template']
                || fallbackSettings.postMeeting.bodyTemplate
            ),
          }
        : fallbackSettings.postMeeting,
    updatedAt: row.updated_at || fallbackSettings.updatedAt,
  });
}

export function defaultMeetingNotificationSettings(): MeetingNotificationSettings {
  return {
    timezone: DEFAULT_TIMEZONE,
    preMeeting: defaultPreMeetingReminders(),
    postMeeting: defaultPostMeetingThankYou(),
    updatedAt: new Date().toISOString(),
  };
}

function getFileBackedSettings(userEmail: string): MeetingNotificationSettings {
  const store = readStore();
  const storedSettings = store[userEmail];

  return sanitizeSettings(storedSettings);
}

function getPersistedFileBackedSettings(userEmail: string): MeetingNotificationSettings | null {
  const store = readStore();

  if (!store[userEmail]) {
    return null;
  }

  return sanitizeSettings(store[userEmail]);
}

function saveFileBackedSettings(
  userEmail: string,
  settings: Partial<MeetingNotificationSettings>
): MeetingNotificationSettings {
  const store = readStore();
  const existing = getFileBackedSettings(userEmail);
  const nextSettings = sanitizeSettings({
    ...existing,
    ...settings,
    preMeeting: settings.preMeeting || existing.preMeeting,
    postMeeting: settings.postMeeting || existing.postMeeting,
    updatedAt: new Date().toISOString(),
  });

  store[userEmail] = nextSettings;
  writeStore(store);

  return nextSettings;
}

function syncFileBackedSettings(
  userEmail: string,
  settings: MeetingNotificationSettings
): MeetingNotificationSettings {
  const store = readStore();
  store[userEmail] = settings;
  writeStore(store);

  return settings;
}

function isUpdatedAtMoreRecent(candidateUpdatedAt: string, baselineUpdatedAt: string): boolean {
  const candidateTimestamp = Date.parse(candidateUpdatedAt);
  const baselineTimestamp = Date.parse(baselineUpdatedAt);

  if (Number.isNaN(candidateTimestamp)) {
    return false;
  }

  if (Number.isNaN(baselineTimestamp)) {
    return true;
  }

  return candidateTimestamp > baselineTimestamp;
}

function isMeetingNotificationSettingsMissing(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === MISSING_TABLE_CODE ||
    error.message?.includes("Could not find the table 'public.meeting_notification_settings'") === true
  );
}

async function ensureMeetingNotificationSettingsTable(
  supabase: SupabaseClient
): Promise<{ ready: boolean; repaired: boolean; reason?: string }> {
  const probe = await supabase.from('meeting_notification_settings').select('user_email').limit(1);

  if (!isMeetingNotificationSettingsMissing(probe.error)) {
    return { ready: true, repaired: false };
  }

  const bootstrap = await supabase.rpc('exec_sql', {
    sql: MEETING_NOTIFICATION_SETTINGS_BOOTSTRAP_SQL,
  });

  if (bootstrap.error) {
    return {
      ready: false,
      repaired: false,
      reason: bootstrap.error.message,
    };
  }

  const verify = await supabase.from('meeting_notification_settings').select('user_email').limit(1);

  if (verify.error) {
    return {
      ready: false,
      repaired: true,
      reason: verify.error.message,
    };
  }

  return { ready: true, repaired: true };
}

async function persistDatabaseBackedSettings(
  supabase: SupabaseClient,
  userEmail: string,
  nextSettings: MeetingNotificationSettings
): Promise<MeetingNotificationSettings | null> {
  const preMeetingPayload = nextSettings.preMeeting.map((reminder) => ({
    id: reminder.id,
    enabled: reminder.enabled,
    minutes_before: reminder.minutesBefore,
    subject_template: reminder.subjectTemplate,
    body_template: reminder.bodyTemplate,
  }));

  const postMeetingPayload = {
    enabled: nextSettings.postMeeting.enabled,
    minutes_after: nextSettings.postMeeting.minutesAfter,
    subject_template: nextSettings.postMeeting.subjectTemplate,
    body_template: nextSettings.postMeeting.bodyTemplate,
  };

  const { data, error } = await supabase
    .from('meeting_notification_settings')
    .upsert(
      {
        user_email: userEmail,
        timezone: nextSettings.timezone,
        pre_meeting: preMeetingPayload,
        post_meeting: postMeetingPayload,
        updated_at: nextSettings.updatedAt,
      },
      { onConflict: 'user_email' }
    )
    .select('timezone, pre_meeting, post_meeting, updated_at')
    .single<PersistedNotificationSettingsRow>();

  if (error || !data) {
    return null;
  }

  return mapDatabaseBackedSettings(data, nextSettings);
}

export async function getMeetingNotificationSettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  options: MeetingNotificationSettingsOptions = {}
): Promise<MeetingNotificationSettings> {
  const persistedFileSettings = getPersistedFileBackedSettings(userEmail);
  const fallbackSettings = persistedFileSettings || getFileBackedSettings(userEmail);

  if (!supabase) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('database service is not available');
    }
    return fallbackSettings;
  }

  const tableStatus = await ensureMeetingNotificationSettingsTable(supabase);
  if (!tableStatus.ready) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(
        tableStatus.reason || 'meeting_notification_settings table is unavailable'
      );
    }
    return fallbackSettings;
  }

  const { data, error } = await supabase
    .from('meeting_notification_settings')
    .select('timezone, pre_meeting, post_meeting, updated_at')
    .eq('user_email', userEmail)
    .maybeSingle<PersistedNotificationSettingsRow>();

  if (error) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(error.message);
    }
    return fallbackSettings;
  }

  if (!data) {
    if (options.seedDefaults || options.requirePersistentStore) {
      const seeded = await persistDatabaseBackedSettings(supabase, userEmail, fallbackSettings);

      if (seeded) {
        return syncFileBackedSettings(userEmail, seeded);
      }

      if (options.requirePersistentStore) {
        throw createPersistenceError('failed to initialize default settings row');
      }
    }

    return fallbackSettings;
  }

  const resolvedSettings = mapDatabaseBackedSettings(data, fallbackSettings);

  if (
    persistedFileSettings
    && isUpdatedAtMoreRecent(persistedFileSettings.updatedAt, resolvedSettings.updatedAt)
  ) {
    return persistedFileSettings;
  }

  return syncFileBackedSettings(userEmail, resolvedSettings);
}

export async function saveMeetingNotificationSettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  settings: Partial<MeetingNotificationSettings>,
  options: MeetingNotificationSettingsOptions = {}
): Promise<MeetingNotificationSettings> {
  const fallbackSave = (): MeetingNotificationSettings => saveFileBackedSettings(userEmail, settings);

  if (!supabase) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('database service is not available');
    }
    return fallbackSave();
  }

  const tableStatus = await ensureMeetingNotificationSettingsTable(supabase);
  if (!tableStatus.ready) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(
        tableStatus.reason || 'meeting_notification_settings table is unavailable'
      );
    }

    return fallbackSave();
  }

  const existing = await getMeetingNotificationSettings(supabase, userEmail, {
    requirePersistentStore: options.requirePersistentStore === true,
    seedDefaults: true,
  });
  const nextSettings = sanitizeSettings({
    ...existing,
    ...settings,
    preMeeting: settings.preMeeting || existing.preMeeting,
    postMeeting: settings.postMeeting || existing.postMeeting,
    updatedAt: new Date().toISOString(),
  });

  const persisted = await persistDatabaseBackedSettings(supabase, userEmail, nextSettings);

  if (!persisted) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('failed to write settings to the database');
    }

    return fallbackSave();
  }

  return syncFileBackedSettings(userEmail, persisted);
}

export async function getAllMeetingNotificationSettings(
  supabase: SupabaseClient | null
): Promise<Array<{ userEmail: string; settings: MeetingNotificationSettings }>> {
  if (!supabase) {
    return [];
  }

  const tableStatus = await ensureMeetingNotificationSettingsTable(supabase);
  if (!tableStatus.ready) {
    return [];
  }

  const { data, error } = await supabase
    .from('meeting_notification_settings')
    .select('user_email, timezone, pre_meeting, post_meeting, updated_at');

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    userEmail: row.user_email,
    settings: mapDatabaseBackedSettings(row as PersistedNotificationSettingsRow, defaultMeetingNotificationSettings()),
  }));
}

export { DEFAULT_TIMEZONE, MAX_PRE_MEETING_REMINDERS };
