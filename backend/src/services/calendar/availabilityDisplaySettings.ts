import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AvailabilityDisplaySettings {
  displayWindowDays: number;
  aiConciergeEnabled: boolean;
  discoveryModeEnabled: boolean;
  minimumNoticeMinutes: number;
  waitlistEnabled: boolean;
  waitlistTitle?: string;
  waitlistDescription?: string;
  showWaitlistCopyright?: boolean;
  waitlistCtaTitle?: string;
  waitlistCtaDescription?: string;
  waitlistCtaButtonText?: string;
  createdAt?: string;
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
export const MIN_DISPLAY_DAYS = 7;
export const MAX_DISPLAY_DAYS = 60;
export const MIN_MINIMUM_NOTICE_MINUTES = 0;
export const MAX_MINIMUM_NOTICE_MINUTES = 24 * 60;

const BOOKING_DISPLAY_SETTINGS_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS booking_display_settings (
  user_email TEXT PRIMARY KEY,
  display_window_days INTEGER NOT NULL DEFAULT 20 CHECK (display_window_days BETWEEN 7 AND 60),
  ai_concierge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  discovery_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_notice_minutes INTEGER NOT NULL DEFAULT 30 CHECK (minimum_notice_minutes BETWEEN 0 AND 1440),
  waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  waitlist_title TEXT DEFAULT 'Experience the Future of AI Strategy',
  waitlist_description TEXT DEFAULT 'Join our exclusive waitlist today and be the first to know when we open new slots for our Autonome Blueprint AI audit and assessment platform.',
  show_waitlist_copyright BOOLEAN DEFAULT TRUE,
  waitlist_cta_title TEXT DEFAULT 'High Demand: Alternative Path Available',
  waitlist_cta_description TEXT DEFAULT 'Can\'t find a perfect time? Join our priority waitlist to get notified of cancellations and exclusive early-access windows.',
  waitlist_cta_button_text TEXT DEFAULT 'Join Priority Waitlist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const BOOKING_DISPLAY_SETTINGS_MIGRATION_SQL = `
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS discovery_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_title TEXT DEFAULT 'Experience the Future of AI Strategy';
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_description TEXT DEFAULT 'Join our exclusive waitlist today and be the first to know when we open new slots for our Autonome Blueprint AI audit and assessment platform.';
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS show_waitlist_copyright BOOLEAN DEFAULT TRUE;
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_title TEXT DEFAULT 'High Demand: Alternative Path Available';
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_description TEXT DEFAULT 'Can\'t find a perfect time? Join our priority waitlist to get notified of cancellations and exclusive early-access windows.';
ALTER TABLE booking_display_settings
  ADD COLUMN IF NOT EXISTS waitlist_cta_button_text TEXT DEFAULT 'Join Priority Waitlist';
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
    discoveryModeEnabled: storedSettings?.discoveryModeEnabled ?? true,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(storedSettings?.minimumNoticeMinutes, 30),
    waitlistEnabled: storedSettings?.waitlistEnabled ?? false,
    waitlistTitle: storedSettings?.waitlistTitle ?? 'Experience the Future of AI Strategy',
    waitlistDescription: storedSettings?.waitlistDescription ?? 'Join our exclusive waitlist today and be the first to know when we open new slots for our Autonome Blueprint AI audit and assessment platform.',
    showWaitlistCopyright: storedSettings?.showWaitlistCopyright ?? true,
    waitlistCtaTitle: storedSettings?.waitlistCtaTitle ?? 'High Demand: Alternative Path Available',
    waitlistCtaDescription: storedSettings?.waitlistCtaDescription ?? 'Can\'t find a perfect time? Join our priority waitlist to get notified of cancellations and exclusive early-access windows.',
    waitlistCtaButtonText: storedSettings?.waitlistCtaButtonText ?? 'Join Priority Waitlist',
    createdAt: storedSettings?.createdAt || new Date().toISOString(),
    updatedAt: storedSettings?.updatedAt || new Date().toISOString(),
  };
}

function getPersistedFileBackedSettings(
  userEmail: string,
  defaultDisplayWindowDays: number
): AvailabilityDisplaySettings | null {
  const store = readStore();

  if (!store[userEmail]) {
    return null;
  }

  return getFileBackedSettings(userEmail, defaultDisplayWindowDays);
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
    discoveryModeEnabled: settings.discoveryModeEnabled ?? existing.discoveryModeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      settings.minimumNoticeMinutes ?? existing.minimumNoticeMinutes,
      existing.minimumNoticeMinutes
    ),
    waitlistEnabled: settings.waitlistEnabled ?? existing.waitlistEnabled,
    waitlistTitle: settings.waitlistTitle ?? existing.waitlistTitle,
    waitlistDescription: settings.waitlistDescription ?? existing.waitlistDescription,
    showWaitlistCopyright: settings.showWaitlistCopyright ?? existing.showWaitlistCopyright,
    waitlistCtaTitle: settings.waitlistCtaTitle ?? existing.waitlistCtaTitle,
    waitlistCtaDescription: settings.waitlistCtaDescription ?? existing.waitlistCtaDescription,
    waitlistCtaButtonText: settings.waitlistCtaButtonText ?? existing.waitlistCtaButtonText,
    createdAt: existing.createdAt, // createdAt is not updated on save
    updatedAt: new Date().toISOString(),
  };

  store[userEmail] = nextSettings;
  writeStore(store);

  return nextSettings;
}

function syncFileBackedSettings(
  userEmail: string,
  settings: AvailabilityDisplaySettings
): AvailabilityDisplaySettings {
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

async function ensureNecessaryColumns(
  supabase: SupabaseClient
): Promise<{ ready: boolean; repaired: boolean; reason?: string }> {
  // Check for minimum_notice_minutes column
  const probeNotice = await supabase
    .from('booking_display_settings')
    .select('minimum_notice_minutes')
    .limit(1);

  const noticeMissing = isBookingDisplaySettingsColumnMissing(probeNotice.error, 'minimum_notice_minutes');

  // Check for discovery_mode_enabled column
  const probeDiscovery = await supabase
    .from('booking_display_settings')
    .select('discovery_mode_enabled')
    .limit(1);

  const discoveryMissing = isBookingDisplaySettingsColumnMissing(probeDiscovery.error, 'discovery_mode_enabled');

  // Check for waitlist_enabled column
  const probeWaitlist = await supabase
    .from('booking_display_settings')
    .select('waitlist_enabled')
    .limit(1);

  const waitlistMissing = isBookingDisplaySettingsColumnMissing(probeWaitlist.error, 'waitlist_enabled');

  // Check for customization columns
  const probeCustom = await supabase
    .from('booking_display_settings')
    .select('waitlist_title')
    .limit(1);
  const customMissing = isBookingDisplaySettingsColumnMissing(probeCustom.error, 'waitlist_title');

  // Check for CTA columns
  const probeCtaTitle = await supabase
    .from('booking_display_settings')
    .select('waitlist_cta_title')
    .limit(1);
  const ctaTitleMissing = isBookingDisplaySettingsColumnMissing(probeCtaTitle.error, 'waitlist_cta_title');

  const probeCtaDescription = await supabase
    .from('booking_display_settings')
    .select('waitlist_cta_description')
    .limit(1);
  const ctaDescriptionMissing = isBookingDisplaySettingsColumnMissing(probeCtaDescription.error, 'waitlist_cta_description');

  const probeCtaButtonText = await supabase
    .from('booking_display_settings')
    .select('waitlist_cta_button_text')
    .limit(1);
  const ctaButtonTextMissing = isBookingDisplaySettingsColumnMissing(probeCtaButtonText.error, 'waitlist_cta_button_text');


  if (!noticeMissing && !discoveryMissing && !waitlistMissing && !customMissing && !ctaTitleMissing && !ctaDescriptionMissing && !ctaButtonTextMissing) {
    return { ready: true, repaired: false };
  }

  const migration = await supabase.rpc('exec_sql', {
    sql: BOOKING_DISPLAY_SETTINGS_MIGRATION_SQL,
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
    .select('minimum_notice_minutes, discovery_mode_enabled, waitlist_enabled, waitlist_title, waitlist_description, show_waitlist_copyright, waitlist_cta_title, waitlist_cta_description, waitlist_cta_button_text')
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
  options: { includeExtendedColumns: boolean }
): Promise<AvailabilityDisplaySettings | null> {
  const payload: Record<string, unknown> = {
    user_email: userEmail,
    display_window_days: nextSettings.displayWindowDays,
    ai_concierge_enabled: nextSettings.aiConciergeEnabled,
    updated_at: nextSettings.updatedAt,
    created_at: nextSettings.createdAt,
  };

  if (options.includeExtendedColumns) {
    payload['minimum_notice_minutes'] = nextSettings.minimumNoticeMinutes;
    payload['discovery_mode_enabled'] = nextSettings.discoveryModeEnabled;
    payload['waitlist_enabled'] = nextSettings.waitlistEnabled;
    payload['waitlist_title'] = nextSettings.waitlistTitle;
    payload['waitlist_description'] = nextSettings.waitlistDescription;
    payload['show_waitlist_copyright'] = nextSettings.showWaitlistCopyright;
    payload['waitlist_cta_title'] = nextSettings.waitlistCtaTitle;
    payload['waitlist_cta_description'] = nextSettings.waitlistCtaDescription;
    payload['waitlist_cta_button_text'] = nextSettings.waitlistCtaButtonText;
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
    discoveryModeEnabled:
      typeof data['discovery_mode_enabled'] === 'boolean'
        ? data['discovery_mode_enabled']
        : nextSettings.discoveryModeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      data['minimum_notice_minutes'],
      nextSettings.minimumNoticeMinutes
    ),
    waitlistEnabled:
      typeof data['waitlist_enabled'] === 'boolean'
        ? data['waitlist_enabled']
        : nextSettings.waitlistEnabled,
    waitlistTitle:
      typeof data['waitlist_title'] === 'string'
        ? data['waitlist_title']
        : nextSettings.waitlistTitle,
    waitlistDescription:
      typeof data['waitlist_description'] === 'string'
        ? data['waitlist_description']
        : nextSettings.waitlistDescription,
    showWaitlistCopyright:
      typeof data['show_waitlist_copyright'] === 'boolean'
        ? data['show_waitlist_copyright']
        : nextSettings.showWaitlistCopyright,
    waitlistCtaTitle:
      typeof data['waitlist_cta_title'] === 'string'
        ? data['waitlist_cta_title']
        : nextSettings.waitlistCtaTitle,
    waitlistCtaDescription:
      typeof data['waitlist_cta_description'] === 'string'
        ? data['waitlist_cta_description']
        : nextSettings.waitlistCtaDescription,
    waitlistCtaButtonText:
      typeof data['waitlist_cta_button_text'] === 'string'
        ? data['waitlist_cta_button_text']
        : nextSettings.waitlistCtaButtonText,
    createdAt:
      typeof data['created_at'] === 'string' && data['created_at']
        ? data['created_at']
        : nextSettings.createdAt,
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
  const persistedFileSettings = getPersistedFileBackedSettings(userEmail, defaultDisplayWindowDays);
  const fallbackSettings = persistedFileSettings || getFileBackedSettings(userEmail, defaultDisplayWindowDays);

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

  const columnStatus = await ensureNecessaryColumns(supabase);
  const supportsExtendedColumns = columnStatus.ready;

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
        includeExtendedColumns: supportsExtendedColumns,
      });

      if (seeded) {
        return syncFileBackedSettings(userEmail, seeded);
      }

      if (options.requirePersistentStore) {
        throw createPersistenceError('failed to initialize default settings row');
      }
    }

    return fallbackSettings;
  }

  const resolvedSettings = {
    displayWindowDays: clampDisplayWindowDays(
      data['display_window_days'],
      fallbackSettings.displayWindowDays
    ),
    aiConciergeEnabled:
      typeof data['ai_concierge_enabled'] === 'boolean'
        ? data['ai_concierge_enabled']
        : fallbackSettings.aiConciergeEnabled,
    discoveryModeEnabled:
      typeof data['discovery_mode_enabled'] === 'boolean'
        ? data['discovery_mode_enabled']
        : fallbackSettings.discoveryModeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      supportsExtendedColumns ? data['minimum_notice_minutes'] : undefined,
      fallbackSettings.minimumNoticeMinutes
    ),
    waitlistEnabled:
      typeof data['waitlist_enabled'] === 'boolean'
        ? data['waitlist_enabled']
        : fallbackSettings.waitlistEnabled,
    waitlistTitle:
      typeof data['waitlist_title'] === 'string'
        ? data['waitlist_title']
        : fallbackSettings.waitlistTitle,
    waitlistDescription:
      typeof data['waitlist_description'] === 'string'
        ? data['waitlist_description']
        : fallbackSettings.waitlistDescription,
    showWaitlistCopyright:
      typeof data['show_waitlist_copyright'] === 'boolean'
        ? data['show_waitlist_copyright']
        : fallbackSettings.showWaitlistCopyright,
    waitlistCtaTitle:
      typeof data['waitlist_cta_title'] === 'string'
        ? data['waitlist_cta_title']
        : fallbackSettings.waitlistCtaTitle,
    waitlistCtaDescription:
      typeof data['waitlist_cta_description'] === 'string'
        ? data['waitlist_cta_description']
        : fallbackSettings.waitlistCtaDescription,
    waitlistCtaButtonText:
      typeof data['waitlist_cta_button_text'] === 'string'
        ? data['waitlist_cta_button_text']
        : fallbackSettings.waitlistCtaButtonText,
    updatedAt:
      typeof data['updated_at'] === 'string' && data['updated_at']
        ? data['updated_at']
        : fallbackSettings.updatedAt,
  };

  if (
    persistedFileSettings
    && isUpdatedAtMoreRecent(persistedFileSettings.updatedAt, resolvedSettings.updatedAt)
  ) {
    return persistedFileSettings;
  }

  return syncFileBackedSettings(userEmail, resolvedSettings);
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
    if (options.requirePersistentStore) {
      throw createPersistenceError(
        tableStatus.reason || 'booking_display_settings table is unavailable'
      );
    }

    return fallbackSave();
  }

  const columnStatus = await ensureNecessaryColumns(supabase);
  const supportsExtendedColumns = columnStatus.ready;

  if (!supportsExtendedColumns && (
    settings.minimumNoticeMinutes !== undefined ||
    settings.discoveryModeEnabled !== undefined ||
    settings.waitlistEnabled !== undefined
  )) {
    if (options.requirePersistentStore) {
      throw createPersistenceError(
        columnStatus.reason
        || 'Extended columns are unavailable. Check database schema.'
      );
    }

    return fallbackSave();
  }

  const existing = await getAvailabilityDisplaySettings(
    supabase,
    userEmail,
    defaultDisplayWindowDays,
    {
      requirePersistentStore: options.requirePersistentStore === true,
      seedDefaults: true,
    }
  );

  const nextSettings: AvailabilityDisplaySettings = {
    displayWindowDays: clampDisplayWindowDays(
      settings.displayWindowDays ?? existing.displayWindowDays,
      existing.displayWindowDays
    ),
    aiConciergeEnabled: settings.aiConciergeEnabled ?? existing.aiConciergeEnabled,
    discoveryModeEnabled: settings.discoveryModeEnabled ?? existing.discoveryModeEnabled,
    minimumNoticeMinutes: clampMinimumNoticeMinutes(
      settings.minimumNoticeMinutes ?? existing.minimumNoticeMinutes,
      existing.minimumNoticeMinutes
    ),
    waitlistEnabled: settings.waitlistEnabled ?? existing.waitlistEnabled,
    waitlistTitle: settings.waitlistTitle ?? existing.waitlistTitle,
    waitlistDescription: settings.waitlistDescription ?? existing.waitlistDescription,
    showWaitlistCopyright: settings.showWaitlistCopyright ?? existing.showWaitlistCopyright,
    waitlistCtaTitle: settings.waitlistCtaTitle ?? existing.waitlistCtaTitle,
    waitlistCtaDescription: settings.waitlistCtaDescription ?? existing.waitlistCtaDescription,
    waitlistCtaButtonText: settings.waitlistCtaButtonText ?? existing.waitlistCtaButtonText,
    updatedAt: new Date().toISOString(),
  };

  const persisted = await persistDatabaseBackedSettings(supabase, userEmail, nextSettings, {
    includeExtendedColumns: supportsExtendedColumns,
  });

  if (!persisted) {
    if (options.requirePersistentStore) {
      throw createPersistenceError('failed to write settings to the database');
    }
    return fallbackSave();
  }

  return syncFileBackedSettings(userEmail, persisted);
}
