import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AvailabilityDisplaySettings {
  displayWindowDays: number;
  aiConciergeEnabled: boolean;
  updatedAt: string;
}

type AvailabilityDisplaySettingsStore = Record<string, AvailabilityDisplaySettings>;

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

const MISSING_TABLE_CODE = 'PGRST205';
const MIN_DISPLAY_DAYS = 7;
const MAX_DISPLAY_DAYS = 60;
const BOOKING_DISPLAY_SETTINGS_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS booking_display_settings (
  user_email TEXT PRIMARY KEY,
  display_window_days INTEGER NOT NULL DEFAULT 20 CHECK (display_window_days BETWEEN 7 AND 60),
  ai_concierge_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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

export async function getAvailabilityDisplaySettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  defaultDisplayWindowDays: number
): Promise<AvailabilityDisplaySettings> {
  const fallbackSettings = getFileBackedSettings(userEmail, defaultDisplayWindowDays);

  if (!supabase) {
    return fallbackSettings;
  }

  const tableStatus = await ensureBookingDisplaySettingsTable(supabase);
  if (!tableStatus.ready) {
    return fallbackSettings;
  }

  const { data, error } = await supabase
    .from('booking_display_settings')
    .select('display_window_days, ai_concierge_enabled, updated_at')
    .eq('user_email', userEmail)
    .maybeSingle<{
      display_window_days: number;
      ai_concierge_enabled: boolean;
      updated_at: string | null;
    }>();

  if (error || !data) {
    return fallbackSettings;
  }

  return {
    displayWindowDays: clampDisplayWindowDays(
      data.display_window_days,
      fallbackSettings.displayWindowDays
    ),
    aiConciergeEnabled: data.ai_concierge_enabled ?? fallbackSettings.aiConciergeEnabled,
    updatedAt: data.updated_at || fallbackSettings.updatedAt,
  };
}

export async function saveAvailabilityDisplaySettings(
  supabase: SupabaseClient | null,
  userEmail: string,
  settings: Partial<AvailabilityDisplaySettings>,
  defaultDisplayWindowDays: number
): Promise<AvailabilityDisplaySettings> {
  const fallbackSave = (): AvailabilityDisplaySettings =>
    saveFileBackedSettings(userEmail, settings, defaultDisplayWindowDays);

  if (!supabase) {
    return fallbackSave();
  }

  const tableStatus = await ensureBookingDisplaySettingsTable(supabase);
  if (!tableStatus.ready) {
    return fallbackSave();
  }

  const existing = await getAvailabilityDisplaySettings(supabase, userEmail, defaultDisplayWindowDays);
  const nextSettings: AvailabilityDisplaySettings = {
    displayWindowDays: clampDisplayWindowDays(
      settings.displayWindowDays ?? existing.displayWindowDays,
      existing.displayWindowDays
    ),
    aiConciergeEnabled: settings.aiConciergeEnabled ?? existing.aiConciergeEnabled,
    updatedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('booking_display_settings')
    .upsert(
      {
        user_email: userEmail,
        display_window_days: nextSettings.displayWindowDays,
        ai_concierge_enabled: nextSettings.aiConciergeEnabled,
        updated_at: nextSettings.updatedAt,
      },
      { onConflict: 'user_email' }
    )
    .select('display_window_days, ai_concierge_enabled, updated_at')
    .single<{
      display_window_days: number;
      ai_concierge_enabled: boolean;
      updated_at: string | null;
    }>();

  if (error || !data) {
    return fallbackSave();
  }

  return {
    displayWindowDays: clampDisplayWindowDays(
      data.display_window_days,
      nextSettings.displayWindowDays
    ),
    aiConciergeEnabled: data.ai_concierge_enabled ?? nextSettings.aiConciergeEnabled,
    updatedAt: data.updated_at || nextSettings.updatedAt,
  };
}

export { MAX_DISPLAY_DAYS, MIN_DISPLAY_DAYS };
