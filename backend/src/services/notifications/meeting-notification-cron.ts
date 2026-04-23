import cron from 'node-cron';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Resend } from 'resend';
import { serviceManager } from '../serviceManager.js';
import type { CalendarService } from '../calendar/CalendarService.js';
import { sendTransactionalEmail } from '../email/sendTransactionalEmail.js';
import { logger } from '../../utils/logger.js';
import {
  getAllMeetingNotificationSettings,
  type MeetingNotificationSettings,
  type PreMeetingReminderConfig,
} from './meetingNotificationSettings.js';

interface NotificationBookingRow {
  id: string;
  processing_id: string | null;
  customer_name: string | null;
  company_name: string | null;
  email_from: string;
  preferred_date: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

interface NotificationEventRecord {
  key: string;
  type: 'pre_meeting' | 'post_meeting';
  sent_at: string;
}

function formatMeetingDate(date: Date, timeZone: string): {
  meetingDate: string;
  meetingTime: string;
  meetingDateTime: string;
} {
  return {
    meetingDate: date.toLocaleDateString('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    meetingTime: date.toLocaleTimeString('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
    meetingDateTime: date.toLocaleString('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  };
}

function getRelativeDay(meetingDate: Date, timeZone: string): string {
  try {
    const now = new Date();
    const meetingStr = meetingDate.toLocaleString('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    const todayStr = now.toLocaleString('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleString('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });

    if (meetingStr === todayStr) return 'Today';
    if (meetingStr === tomorrowStr) return 'Tomorrow';
    return 'Your Scheduled';
  } catch (error) {
    return 'Tomorrow';
  }
}

function applyTemplate(
  template: string,
  booking: NotificationBookingRow,
  meetingDate: Date,
  timeZone: string
): string {
  const formatted = formatMeetingDate(meetingDate, timeZone);
  const relativeDay = getRelativeDay(meetingDate, timeZone);

  const replacements: Record<string, string> = {
    '{customer_name}': booking.customer_name || 'there',
    '{company_name}': booking.company_name || 'your team',
    '{meeting_date}': formatted.meetingDate,
    '{meeting_time}': formatted.meetingTime,
    '{meeting_datetime}': formatted.meetingDateTime,
    '{booking_id}': booking.processing_id || booking.id,
    '{timezone}': timeZone,
    '{customer_email}': booking.email_from,
    '{relative_day}': relativeDay,
  };

  return Object.entries(replacements).reduce(
    (content, [placeholder, value]) => content.split(placeholder).join(value),
    template
  );
}

function getNotificationEvents(booking: NotificationBookingRow): NotificationEventRecord[] {
  const metadata = booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {};
  const rawEvents = (metadata as Record<string, unknown>)['notification_events'];
  return Array.isArray(rawEvents) ? (rawEvents as NotificationEventRecord[]) : [];
}

async function markNotificationSent(
  supabase: SupabaseClient,
  booking: NotificationBookingRow,
  event: NotificationEventRecord
): Promise<void> {
  const metadata = booking.metadata && typeof booking.metadata === 'object' ? { ...booking.metadata } : {};
  const events = getNotificationEvents(booking);
  metadata['notification_events'] = [...events, event];

  await supabase
    .from('booking_inquiries')
    .update({ metadata })
    .eq('id', booking.id);
}

function hasSentEvent(booking: NotificationBookingRow, key: string): boolean {
  return getNotificationEvents(booking).some((e) => e.key === key);
}

async function sendNotificationEmail(
  emailService: Resend,
  booking: NotificationBookingRow,
  subjectTemplate: string,
  bodyTemplate: string,
  meetingDate: Date,
  timeZone: string
): Promise<void> {
  const subject = applyTemplate(subjectTemplate, booking, meetingDate, timeZone);
  const body = applyTemplate(bodyTemplate, booking, meetingDate, timeZone);

  await sendTransactionalEmail({
    emailService,
    to: [booking.email_from],
    subject,
    text: body,
    context: `meeting notification for ${booking.processing_id || booking.id}`,
  });
}

async function processPreMeetingReminder(
  supabase: SupabaseClient,
  emailService: Resend,
  booking: NotificationBookingRow,
  settings: MeetingNotificationSettings,
  reminder: PreMeetingReminderConfig,
  meetingDate: Date,
  now: Date
): Promise<boolean> {
  const sendAt = new Date(meetingDate.getTime() - reminder.minutesBefore * 60 * 1000);
  const notificationKey = `pre:${reminder.minutesBefore}:${meetingDate.toISOString()}`;

  if (!reminder.enabled || hasSentEvent(booking, notificationKey)) {
    return false;
  }

  if (now < sendAt || now >= meetingDate) {
    return false;
  }

  await sendNotificationEmail(
    emailService,
    booking,
    reminder.subjectTemplate,
    reminder.bodyTemplate,
    meetingDate,
    settings.timezone
  );

  await markNotificationSent(supabase, booking, {
    key: notificationKey,
    type: 'pre_meeting',
    sent_at: now.toISOString(),
  });

  return true;
}

async function processPostMeetingThankYou(
  supabase: SupabaseClient,
  emailService: Resend,
  booking: NotificationBookingRow,
  settings: MeetingNotificationSettings,
  meetingDate: Date,
  now: Date,
): Promise<boolean> {
  const postMeeting = settings.postMeeting;
  const sendAt = new Date(meetingDate.getTime() + postMeeting.minutesAfter * 60 * 1000);
  const notificationKey = `post:thank_you:${meetingDate.toISOString()}`;

  if (!postMeeting.enabled || hasSentEvent(booking, notificationKey)) {
    return false;
  }

  if (now < sendAt) {
    return false;
  }

  await sendNotificationEmail(
    emailService,
    booking,
    postMeeting.subjectTemplate,
    postMeeting.bodyTemplate,
    meetingDate,
    settings.timezone
  );

  await markNotificationSent(supabase, booking, {
    key: notificationKey,
    type: 'post_meeting',
    sent_at: now.toISOString(),
  });

  return true;
}

async function processMeetingNotifications(): Promise<void> {
  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    const emailService = await serviceManager.getService<Resend>('email');

    if (!supabase || !emailService) {
      return;
    }

    const configuredSettings = await getAllMeetingNotificationSettings(supabase);

    if (configuredSettings.length === 0) {
      return;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings, error } = await supabase
      .from('booking_inquiries')
      .select('id, processing_id, customer_name, company_name, email_from, preferred_date, status, metadata')
      .not('preferred_date', 'is', null)
      .gte('preferred_date', windowStart)
      .lte('preferred_date', windowEnd)
      .neq('status', 'failed');

    if (error || !bookings || bookings.length === 0) {
      return;
    }

    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    let sentCount = 0;

    for (const { settings } of configuredSettings) {
      for (const booking of bookings as NotificationBookingRow[]) {
        if (!booking.preferred_date) {
          continue;
        }

        // 1. Filter out personal bookings
        if (booking.metadata?.['is_personal'] === true) {
          continue;
        }

        const meetingDate = new Date(booking.preferred_date);
        if (Number.isNaN(meetingDate.getTime())) {
          continue;
        }

        // 2. Verify meeting existence in calendar (prevent notifications for deleted meetings)
        const calendarEventId = booking.metadata?.['calendar_event_id'] as string;
        if (calendarEventId && calendarService) {
          try {
            const event = await calendarService.getEvent(calendarEventId);
            if (!event) {
              logger.warn(`Skipping notifications for booking ${booking.id}: Calendar event ${calendarEventId} missing (likely deleted)`);
              continue;
            }
          } catch (err) {
            logger.error(`Error verifying calendar event ${calendarEventId} for booking ${booking.id}:`, err);
            // Default to sending if verification fails? No, better to skip if user said "deleted meetings are still sent".
            // But if it's a API error, we might skip a legitimate meeting.
            // However, the requirement is "ironclad" accuracy.
            continue;
          }
        }

        for (const reminder of settings.preMeeting) {
          if (await processPreMeetingReminder(supabase, emailService, booking, settings, reminder, meetingDate, now)) {
            sentCount++;
          }
        }

        if (await processPostMeetingThankYou(supabase, emailService, booking, settings, meetingDate, now)) {
          sentCount++;
        }
      }
    }

    if (sentCount > 0) {
      logger.info(`✓ Notification cron: sent ${sentCount} scheduled booking notification(s)`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Notification cron failed:', errorMessage);
  }
}

cron.schedule('* * * * *', async () => {
  await processMeetingNotifications();
});

logger.info('🔔 Meeting notification cron initialized:');
logger.info('  • Process scheduled reminders: * * * * * (every minute)');
