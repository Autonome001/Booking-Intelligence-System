import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import {
  getAvailabilityDisplaySettings,
  saveAvailabilityDisplaySettings,
} from './calendar/availabilityDisplaySettings.js';
import {
  getMeetingNotificationSettings,
  saveMeetingNotificationSettings,
} from './notifications/meetingNotificationSettings.js';

const DISPLAY_SETTINGS_FILE_PATH = join(
  process.cwd(),
  'data',
  'availability-display-settings.json'
);
const NOTIFICATION_SETTINGS_FILE_PATH = join(
  process.cwd(),
  'data',
  'meeting-notification-settings.json'
);

type FileBackup = {
  existed: boolean;
  content: string;
};

const fileBackups = new Map<string, FileBackup>();
const testUserEmails = [
  'display-settings-fallback-test@autonome.test',
  'display-settings-db-failure@autonome.test',
  'display-settings-waitlist-test@autonome.test',
  'notification-settings-fallback-test@autonome.test',
  'notification-settings-db-failure@autonome.test',
];

function backupFile(filePath: string): void {
  fileBackups.set(filePath, {
    existed: existsSync(filePath),
    content: existsSync(filePath) ? readFileSync(filePath, 'utf8') : '',
  });
}

function restoreFile(filePath: string): void {
  const backup = fileBackups.get(filePath);

  if (!backup) {
    return;
  }

  if (!backup.existed) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, backup.content, 'utf8');
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, 'utf8');

  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function removeTestUsers(filePath: string): void {
  const nextStore = readJsonFile(filePath);

  for (const userEmail of testUserEmails) {
    delete nextStore[userEmail];
  }

  if (Object.keys(nextStore).length === 0) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return;
  }

  writeJsonFile(filePath, nextStore);
}

function createUnavailableDisplaySupabase(): any {
  return {
    from: () => ({
      select: () => ({
        limit: async () => ({
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.booking_display_settings'",
          },
        }),
      }),
    }),
    rpc: async () => ({
      error: {
        message: 'exec_sql is not available',
      },
    }),
  };
}

function createUnavailableNotificationSupabase(): any {
  return {
    from: () => ({
      select: () => ({
        limit: async () => ({
          error: {
            code: 'PGRST205',
            message: "Could not find the table 'public.meeting_notification_settings'",
          },
        }),
      }),
    }),
    rpc: async () => ({
      error: {
        message: 'exec_sql is not available',
      },
    }),
  };
}

function createReadableDisplaySupabase(row: {
  display_window_days: number;
  ai_concierge_enabled: boolean;
  minimum_notice_minutes: number;
  updated_at: string;
  waitlist_enabled?: boolean;
  waitlist_title?: string;
  waitlist_description?: string;
  show_waitlist_copyright?: boolean;
  waitlist_cta_title?: string;
  waitlist_cta_description?: string;
  waitlist_cta_button_text?: string;
}): any {
  return {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: [],
          error: null,
        }),
        eq: () => ({
          maybeSingle: async () => ({
            data: row,
            error: null,
          }),
        }),
      }),
    }),
  };
}

function createReadableNotificationSupabase(row: {
  timezone: string;
  pre_meeting: unknown[];
  post_meeting: Record<string, unknown>;
  updated_at: string;
}): any {
  return {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: [],
          error: null,
        }),
        eq: () => ({
          maybeSingle: async () => ({
            data: row,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('settings persistence fallbacks', () => {
  beforeAll(() => {
    backupFile(DISPLAY_SETTINGS_FILE_PATH);
    backupFile(NOTIFICATION_SETTINGS_FILE_PATH);
  });

  afterEach(() => {
    removeTestUsers(DISPLAY_SETTINGS_FILE_PATH);
    removeTestUsers(NOTIFICATION_SETTINGS_FILE_PATH);
  });

  afterAll(() => {
    restoreFile(DISPLAY_SETTINGS_FILE_PATH);
    restoreFile(NOTIFICATION_SETTINGS_FILE_PATH);
  });

  it('retains availability display settings through the file-backed fallback', async () => {
    const userEmail = 'display-settings-fallback-test@autonome.test';

    const saved = await saveAvailabilityDisplaySettings(
      null,
      userEmail,
      {
        displayWindowDays: 35,
        aiConciergeEnabled: false,
        minimumNoticeMinutes: 90,
      },
      20
    );

    const loaded = await getAvailabilityDisplaySettings(null, userEmail, 20);

    expect(saved.displayWindowDays).toBe(35);
    expect(saved.aiConciergeEnabled).toBe(false);
    expect(saved.minimumNoticeMinutes).toBe(90);
    expect(loaded).toMatchObject({
      displayWindowDays: 35,
      aiConciergeEnabled: false,
      minimumNoticeMinutes: 90,
    });
  });

  it('retains waitlist personalization fields through the file-backed fallback', async () => {
    const userEmail = 'display-settings-waitlist-test@autonome.test';

    const saved = await saveAvailabilityDisplaySettings(
      null,
      userEmail,
      {
        waitlistEnabled: true,
        waitlistTitle: 'Custom Waitlist Title',
        waitlistDescription: 'Custom waitlist description for the public page.',
        showWaitlistCopyright: false,
        waitlistCtaTitle: 'Join the custom priority list',
        waitlistCtaDescription: 'Get notified when a better-fit slot opens.',
        waitlistCtaButtonText: 'Join My Waitlist',
      },
      20
    );

    const loaded = await getAvailabilityDisplaySettings(null, userEmail, 20);

    expect(saved).toMatchObject({
      waitlistEnabled: true,
      waitlistTitle: 'Custom Waitlist Title',
      waitlistDescription: 'Custom waitlist description for the public page.',
      showWaitlistCopyright: false,
      waitlistCtaTitle: 'Join the custom priority list',
      waitlistCtaDescription: 'Get notified when a better-fit slot opens.',
      waitlistCtaButtonText: 'Join My Waitlist',
    });
    expect(loaded).toMatchObject({
      waitlistEnabled: true,
      waitlistTitle: 'Custom Waitlist Title',
      waitlistDescription: 'Custom waitlist description for the public page.',
      showWaitlistCopyright: false,
      waitlistCtaTitle: 'Join the custom priority list',
      waitlistCtaDescription: 'Get notified when a better-fit slot opens.',
      waitlistCtaButtonText: 'Join My Waitlist',
    });
  });

  it('falls back to file-backed availability settings when database bootstrapping fails', async () => {
    const userEmail = 'display-settings-db-failure@autonome.test';

    await saveAvailabilityDisplaySettings(
      createUnavailableDisplaySupabase(),
      userEmail,
      {
        displayWindowDays: 28,
        aiConciergeEnabled: true,
        minimumNoticeMinutes: 45,
      },
      20,
      {
        requirePersistentStore: false,
      }
    );

    const loaded = await getAvailabilityDisplaySettings(null, userEmail, 20);

    expect(loaded).toMatchObject({
      displayWindowDays: 28,
      aiConciergeEnabled: true,
      minimumNoticeMinutes: 45,
    });
  });

  it('prefers newer file-backed availability settings over stale database rows', async () => {
    const userEmail = 'display-settings-fallback-test@autonome.test';

    await saveAvailabilityDisplaySettings(
      null,
      userEmail,
      {
        displayWindowDays: 32,
        aiConciergeEnabled: false,
        minimumNoticeMinutes: 75,
      },
      20
    );

    const loaded = await getAvailabilityDisplaySettings(
      createReadableDisplaySupabase({
        display_window_days: 20,
        ai_concierge_enabled: true,
        minimum_notice_minutes: 30,
        updated_at: '2020-01-01T00:00:00.000Z',
      }),
      userEmail,
      20
    );

    expect(loaded).toMatchObject({
      displayWindowDays: 32,
      aiConciergeEnabled: false,
      minimumNoticeMinutes: 75,
    });
  });

  it('reads waitlist personalization fields from database-backed settings rows', async () => {
    const userEmail = 'display-settings-waitlist-test@autonome.test';

    const loaded = await getAvailabilityDisplaySettings(
      createReadableDisplaySupabase({
        display_window_days: 20,
        ai_concierge_enabled: true,
        minimum_notice_minutes: 30,
        waitlist_enabled: true,
        waitlist_title: 'Database Waitlist Title',
        waitlist_description: 'Database-backed waitlist description.',
        show_waitlist_copyright: false,
        waitlist_cta_title: 'Database CTA Title',
        waitlist_cta_description: 'Database CTA Description',
        waitlist_cta_button_text: 'Database CTA Button',
        updated_at: '2030-01-01T00:00:00.000Z',
      }),
      userEmail,
      20
    );

    expect(loaded).toMatchObject({
      waitlistEnabled: true,
      waitlistTitle: 'Database Waitlist Title',
      waitlistDescription: 'Database-backed waitlist description.',
      showWaitlistCopyright: false,
      waitlistCtaTitle: 'Database CTA Title',
      waitlistCtaDescription: 'Database CTA Description',
      waitlistCtaButtonText: 'Database CTA Button',
    });
  });

  it('retains meeting notification settings through the file-backed fallback', async () => {
    const userEmail = 'notification-settings-fallback-test@autonome.test';

    const saved = await saveMeetingNotificationSettings(null, userEmail, {
      timezone: 'America/Chicago',
      preMeeting: [
        {
          id: 'reminder_1',
          enabled: true,
          minutesBefore: 180,
          subjectTemplate: 'Heads up',
          bodyTemplate: 'Reminder body',
        },
      ],
      postMeeting: {
        enabled: true,
        minutesAfter: 10,
        subjectTemplate: 'Thanks',
        bodyTemplate: 'Thank you body',
      },
    });

    const loaded = await getMeetingNotificationSettings(null, userEmail);

    expect(saved.timezone).toBe('America/Chicago');
    expect(saved.preMeeting[0]).toMatchObject({
      id: 'reminder_1',
      enabled: true,
      minutesBefore: 180,
      subjectTemplate: 'Heads up',
      bodyTemplate: 'Reminder body',
    });
    expect(saved.postMeeting).toMatchObject({
      enabled: true,
      minutesAfter: 10,
      subjectTemplate: 'Thanks',
      bodyTemplate: 'Thank you body',
    });
    expect(loaded.timezone).toBe('America/Chicago');
    expect(loaded.preMeeting[0]).toMatchObject({
      enabled: true,
      minutesBefore: 180,
      subjectTemplate: 'Heads up',
      bodyTemplate: 'Reminder body',
    });
    expect(loaded.postMeeting).toMatchObject({
      enabled: true,
      minutesAfter: 10,
      subjectTemplate: 'Thanks',
      bodyTemplate: 'Thank you body',
    });
  });

  it('falls back to file-backed notification settings when database bootstrapping fails', async () => {
    const userEmail = 'notification-settings-db-failure@autonome.test';

    await saveMeetingNotificationSettings(
      createUnavailableNotificationSupabase(),
      userEmail,
      {
        timezone: 'America/Los_Angeles',
        preMeeting: [
          {
            id: 'reminder_1',
            enabled: true,
            minutesBefore: 240,
            subjectTemplate: 'Reminder',
            bodyTemplate: 'See you soon',
          },
        ],
      },
      {
        requirePersistentStore: false,
      }
    );

    const loaded = await getMeetingNotificationSettings(null, userEmail);

    expect(loaded.timezone).toBe('America/Los_Angeles');
    expect(loaded.preMeeting[0]).toMatchObject({
      enabled: true,
      minutesBefore: 240,
      subjectTemplate: 'Reminder',
      bodyTemplate: 'See you soon',
    });
  });

  it('preserves custom notification lead times when reloading database-backed settings', async () => {
    const userEmail = 'notification-settings-db-read@autonome.test';

    const loaded = await getMeetingNotificationSettings(
      createReadableNotificationSupabase({
        timezone: 'America/Chicago',
        pre_meeting: [
          {
            id: 'reminder_1',
            enabled: true,
            minutes_before: 180,
            subject_template: 'Heads up',
            body_template: 'Reminder body',
          },
          {
            id: 'reminder_2',
            enabled: true,
            minutes_before: 45,
            subject_template: 'Almost time',
            body_template: 'Starts soon',
          },
        ],
        post_meeting: {
          enabled: true,
          minutes_after: 10,
          subject_template: 'Thanks',
          body_template: 'Thank you body',
        },
        updated_at: '2026-03-02T12:00:00.000Z',
      }),
      userEmail
    );

    expect(loaded.timezone).toBe('America/Chicago');
    expect(loaded.preMeeting[0]).toMatchObject({
      enabled: true,
      minutesBefore: 180,
      subjectTemplate: 'Heads up',
      bodyTemplate: 'Reminder body',
    });
    expect(loaded.preMeeting[1]).toMatchObject({
      enabled: true,
      minutesBefore: 45,
      subjectTemplate: 'Almost time',
      bodyTemplate: 'Starts soon',
    });
    expect(loaded.postMeeting).toMatchObject({
      enabled: true,
      minutesAfter: 10,
      subjectTemplate: 'Thanks',
      bodyTemplate: 'Thank you body',
    });
  });

  it('prefers newer file-backed notification settings over stale database rows', async () => {
    const userEmail = 'notification-settings-fallback-test@autonome.test';

    await saveMeetingNotificationSettings(null, userEmail, {
      timezone: 'America/Denver',
      preMeeting: [
        {
          id: 'reminder_1',
          enabled: true,
          minutesBefore: 120,
          subjectTemplate: 'New reminder',
          bodyTemplate: 'Fresh body',
        },
      ],
      postMeeting: {
        enabled: true,
        minutesAfter: 12,
        subjectTemplate: 'Fresh thanks',
        bodyTemplate: 'Fresh follow-up',
      },
    });

    const loaded = await getMeetingNotificationSettings(
      createReadableNotificationSupabase({
        timezone: 'America/New_York',
        pre_meeting: [],
        post_meeting: {
          enabled: false,
          minutes_after: 5,
          subject_template: 'Old thanks',
          body_template: 'Old follow-up',
        },
        updated_at: '2020-01-01T00:00:00.000Z',
      }),
      userEmail
    );

    expect(loaded.timezone).toBe('America/Denver');
    expect(loaded.preMeeting[0]).toMatchObject({
      enabled: true,
      minutesBefore: 120,
      subjectTemplate: 'New reminder',
      bodyTemplate: 'Fresh body',
    });
    expect(loaded.postMeeting).toMatchObject({
      enabled: true,
      minutesAfter: 12,
      subjectTemplate: 'Fresh thanks',
      bodyTemplate: 'Fresh follow-up',
    });
  });
});
