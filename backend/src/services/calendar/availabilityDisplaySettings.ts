import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AvailabilityDisplaySettings {
  displayWindowDays: number;
  aiConciergeEnabled: boolean;
  minimumNoticeMinutes: number;
  updatedAt: string;
}

interface AvailabilityDisplaySettingsOptions {
  requirePersistentStore?: boolean;
  seedDefaults?: boolean;
}

type AvailabilityDisplaySettingsStore = Record<string, AvailabilityDisplaySettings>;

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

const MISSING_TABLE_CODE = 'PGRST205';
const MISSING_COLUMN_CODE = 'PGRST204';
const MIN_DISPLAY_DAYS = 7;
const MAX_DISPLAY_DAYS = 60;
const MIN_MINIMUM_NOTICE_MINUTES = 0;
const MAX_MINIMUM_NOTICE_MINUTES = 24 * 60;
const BOOKING_DISPLAY_SETTINGS_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS booking_display_settings (
  user_email TEXT PRIMARY KEY,
  display_window_days INTEGER NOT NULL DEFAULT 20 CHECK (display_window_days BETWEEN 7 AND 60),
  ai_concierge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_notice_minutes INTEGER NOT NULL DEFAULT 30 CHECK (minimum_notice_minutes BETWEEN 0 AND 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
const BOOKING_DISPLAY_SETTINGS_MINIMUM_NOTICE_SQL = `
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS minimum_notice_minutes INTEGER NOT NULL DEFAULT 30 CHECK (minimum_notice_minutes BETWEEN 0 AND 1440);
`;

function getSettingsFilePath(): string {
  return join(process.cwd(), 'data', 'availability-display-settings.json');
}

function clampDisplayWindowDays(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(MAX_DISPLAY_DAYS, Math.max(MIN_DISPLAY_DAYS, parsed));
}

function clampMinimumNoticeMinutes(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(MAX_MINIMUM_NOTICE_MINUTES, Math.max(MIN_MINIMUM_NOTICE_MINUTES, parsed));
}

function ensureSettingsDirectory(): void {
  const filePath = getSettingsFilePath();
  const dirPath = dirname(filePath);

  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readStore(): AvailabilityDisplaySettingsStore {
  const filePath = getSettingsFilePath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw) as AvailabilityDisplaySettingsStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: AvailabilityDisplaySettingsStore): void {
  ensureSettingsDirectory();
  writeFileSync(getSettingsFilePath(), JSON.stringify(store, null, 2), 'utf8');
}

function createPersistenceError(message: string): Error {
  return new Error(`Booking display settings persistence error: ${message}`);
}

function getFileBackedSettings(
  userEmail: string,
  defaultDisplayWindowDays: number
): AvailabilityDisplaySettings {
  const store = readStore();
  const storedSettings = store[userEmail];
  const sanitizedDefault = clampDisplayWindowDays(defaultDisplayWindowDays, 14);

  return {
    displayWindowDays: clampDisplayWindowDays(storedSettings?.displayWindowDays, sanitizedDefault),
    aiConciergeEnabled: storedSettings?.aiConciergeEnabled ?? true,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(storedSettings?.minimumNoticeMinutes, 30),
    updatedAt: storedSettings?.updatedAt || new Date().toISOString(),
  };
}

function saveFileBackedSettings(
  userEmail: string,
  settings: Partial<AvailabilityDisplaySettings>,
  defaultDisplayWindowDays: number
): AvailabilityDisplaySettings {
  const store = readStore();
  const existing = getFileBackedSettings(userEmail, defaultDisplayWindowDays);

  const nextSettings: AvailabilityDisplaySettings = {
    displayWindowDays: clampDisplayWindowDays(
      settings.displayWindowDays ?? existing.displayWindowDays,
      existing.displayWindowDays
    ),
    aiConciergeEnabled: settings.aiConciergeEnabled ?? existing.aiConciergeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      settings.minimumNoticeMinutes ?? existing.minimumNoticeMinutes,
      existing.minimumNoticeMinutes
    ),
    updatedAt: new Date().toISOString(),
  };

  store[userEmail] = nextSettings;
  writeStore(store);

  return nextSettings;
}

function isBookingDisplaySettingsMissing(
  error: PostgrestLikeError | null | undefined
): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === MISSING_TABLE_CODE ||
    error.message?.includes("Could not find the table 'public.booking_display_settings'") === true
  );
}

function isBookingDisplaySettingsColumnMissing(
  error: PostgrestLikeError | null | undefined,
  columnName: string
): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === MISSING_COLUMN_CODE ||
    error.message?.includes(`Could not find the '${columnName}' column`) === true
  );
}

async function ensureBookingDisplaySettingsTable(
  supabase: SupabaseClient
): Promise<{ ready: boolean; repaired: boolean; reason?: string }> {
  const probe = await supabase.from('booking_display_settings').select('user_email').limit(1);

  if (!isBookingDisplaySettingsMissing(probe.error)) {
    return { ready: true, repaired: false };
  }

  const bootstrap = await supabase.rpc('exec_sql', {
    sql: BOOKING_DISPLAY_SETTINGS_BOOTSTRAP_SQL,
  });

  if (bootstrap.error) {
    return {
      ready: false,
      repaired: false,
      reason: bootstrap.error.message,
    };
  }

  const verify = await supabase.from('booking_display_settings').select('user_email').limit(1);

  if (verify.error) {
    return {
      ready: false,
      repaired: true,
      reason: verify.error.message,
    };
  }

  return { ready: true, repaired: true };
}

async function ensureMinimumNoticeColumn(
  supabase: SupabaseClient
): Promise<{ ready: boolean; repaired: boolean; reason?: string }> {
  const probe = await supabase
    .from('booking_display_settings')
    .select('minimum_notice_minutes')
    .limit(1);

  if (!isBookingDisplaySettingsColumnMissing(probe.error, 'minimum_notice_minutes')) {
    return { ready: true, repaired: false };
  }

  const migration = await supabase.rpc('exec_sql', {
    sql: BOOKING_DISPLAY_SETTINGS_MINIMUM_NOTICE_SQL,
  });

  if (migration.error) {
    return {
      ready: false,
      repaired: false,
      reason: migration.error.message,
    };
  }

  const verify = await supabase
    .from('booking_display_settings')
    .select('minimum_notice_minutes')
    .limit(1);

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
  nextSettings: AvailabilityDisplaySettings,
  options: { includeMinimumNoticeMinutes: boolean }
): Promise<AvailabilityDisplaySettings | null> {
  const payload: Record<string, unknown> = {
    user_email: userEmail,
    display_window_days: nextSettings.displayWindowDays,
    ai_concierge_enabled: nextSettings.aiConciergeEnabled,
    updated_at: nextSettings.updatedAt,
  };

  if (options.includeMinimumNoticeMinutes) {
    payload['minimum_notice_minutes'] = nextSettings.minimumNoticeMinutes;
  }

  const { data, error } = await supabase
    .from('booking_display_settings')
    .upsert(payload, { onConflict: 'user_email' })
    .select('*')
    .single<Record<string, unknown>>();

  if (error || !data) {
    return null;
  }

  return {
    displayWindowDays: clampDisplayWindowDays(
      data['display_window_days'],
      nextSettings.displayWindowDays
    ),
    aiConciergeEnabled:
      typeof data['ai_concierge_enabled'] === 'boolean'
        ? data['ai_concierge_enabled']
        : nextSettings.aiConciergeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      data['minimum_notice_minutes'],
      nextSettings.minimumNoticeMinutes
    ),
    updatedAt:
      typeof data['updated_at'] === 'string' && data['updated_at']
        ? data['updated_at']
        : nextSettings.updatedAt,
  };
}

export async function getAvailabilityDisplaySettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  defaultDisplayWindowDays: number,
  options: AvailabilityDisplaySettingsOptions = {}
): Promise<AvailabilityDisplaySettings> {
  const fallbackSettings = getFileBackedSettings(userEmail, defaultDisplayWindowDays);

  if (!supabase) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('database service is not available');
    }
    return fallbackSettings;
  }

  const tableStatus = await ensureBookingDisplaySettingsTable(supabase);
  if (!tableStatus.ready) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(
        tableStatus.reason || 'booking_display_settings table is unavailable'
      );
    }
    return fallbackSettings;
  }

  const minimumNoticeColumnStatus = await ensureMinimumNoticeColumn(supabase);
  const supportsMinimumNotice = minimumNoticeColumnStatus.ready;

  const { data, error } = await supabase
    .from('booking_display_settings')
    .select('*')
    .eq('user_email', userEmail)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(error.message);
    }
    return fallbackSettings;
  }

  if (!data) {
    if (options.seedDefaults || options.requirePersistentStore) {
      const seeded = await persistDatabaseBackedSettings(supabase, userEmail, fallbackSettings, {
        includeMinimumNoticeMinutes: supportsMinimumNotice,
      });

      if (seeded) {
        return seeded;
      }

      if (options.requirePersistentStore) {
        throw createPersistenceError('failed to initialize default settings row');
      }
    }

    return fallbackSettings;
  }

  return {
    displayWindowDays: clampDisplayWindowDays(
      data['display_window_days'],
      fallbackSettings.displayWindowDays
    ),
    aiConciergeEnabled:
      typeof data['ai_concierge_enabled'] === 'boolean'
        ? data['ai_concierge_enabled']
        : fallbackSettings.aiConciergeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      supportsMinimumNotice ? data['minimum_notice_minutes'] : undefined,
      fallbackSettings.minimumNoticeMinutes
    ),
    updatedAt:
      typeof data['updated_at'] === 'string' && data['updated_at']
        ? data['updated_at']
        : fallbackSettings.updatedAt,
  };
}

export async function saveAvailabilityDisplaySettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  settings: Partial<AvailabilityDisplaySettings>,
  defaultDisplayWindowDays: number,
  options: AvailabilityDisplaySettingsOptions = {}
): Promise<AvailabilityDisplaySettings> {
  const fallbackSave = (): AvailabilityDisplaySettings =>
    saveFileBackedSettings(userEmail, settings, defaultDisplayWindowDays);

  if (!supabase) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('database service is not available');
    }
    return fallbackSave();
  }

  const tableStatus = await ensureBookingDisplaySettingsTable(supabase);
  if (!tableStatus.ready) {
    throw createPersistenceError(
      tableStatus.reason || 'booking_display_settings table is unavailable'
    );
  }

  const minimumNoticeColumnStatus = await ensureMinimumNoticeColumn(supabase);
  const supportsMinimumNotice = minimumNoticeColumnStatus.ready;

  if (!supportsMinimumNotice && settings.minimumNoticeMinutes !== undefined) {
    throw createPersistenceError(
      minimumNoticeColumnStatus.reason
      || 'minimum_notice_minutes column is unavailable. Run migration 008_booking_display_minimum_notice.sql'
    );
  }

  const existing = await getAvailabilityDisplaySettings(
    supabase,
    userEmail,
    defaultDisplayWindowDays,
    {
      requirePersistentStore: true,
      seedDefaults: true,
    }
  );
  const nextSettings: AvailabilityDisplaySettings = {
    displayWindowDays: clampDisplayWindowDays(
      settings.displayWindowDays ?? existing.displayWindowDays,
      existing.displayWindowDays
    ),
    aiConciergeEnabled: settings.aiConciergeEnabled ?? existing.aiConciergeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      settings.minimumNoticeMinutes ?? existing.minimumNoticeMinutes,
      existing.minimumNoticeMinutes
    ),
    updatedAt: new Date().toISOString(),
  };

  const persisted = await persistDatabaseBackedSettings(supabase, userEmail, nextSettings, {
    includeMinimumNoticeMinutes: supportsMinimumNotice,
  });

  if (!persisted) {
    throw createPersistenceError('failed to write settings to the database');
  }

  return persisted;
}

export {
  MAX_DISPLAY_DAYS,
  MIN_DISPLAY_DAYS,
  MAX_MINIMUM_NOTICE_MINUTES,
  MIN_MINIMUM_NOTICE_MINUTES,
};
