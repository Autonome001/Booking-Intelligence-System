import express, { type Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebClient } from '@slack/web-api';
import type OpenAI from 'openai';
import type { Resend } from 'resend';
import { serviceManager } from '../services/serviceManager.js';
import { normalizeCustomerFacingEmailCopy } from '../services/email/normalizeCustomerFacingEmailCopy.js';
import { sendTransactionalEmail } from '../services/email/sendTransactionalEmail.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import { determineProcessingMode, ProcessingMode } from '../services/mode-selector.js';
import { processFullAIMode, generateScheduleSuggestions } from '../services/ai-processing.js';
import {
  getMeetingNotificationSettings,
  saveMeetingNotificationSettings,
  type MeetingNotificationSettings,
} from '../services/notifications/meetingNotificationSettings.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';
import type { BookingResponse } from '../../../src/types/index.js';

const router: Router = express.Router();
const DEFAULT_ADMIN_USER_EMAIL = 'dev@autonome.us';

/**
 * Booking form request data
 */
interface BookingData {
  name: string;
  email: string;
  company?: string;
  message: string;
  phone?: string;
  inquiry_type?: string;
  preferred_date?: string;
  selected_slot_end?: string;
  provisional_hold_id?: string;
  booking_session_id?: string;
  user_agent?: string;
  ai_concierge_engaged?: boolean;
}

/**
 * Emergency mode response
 */
interface EmergencyResult extends Partial<BookingResponse> {
  processing_id?: string;
}

interface InboundEmailPayload {
  from: string;
  subject?: string;
  text?: string;
  html?: string;
  thread_id?: string;
}

interface BookingLookupRecord {
  id?: string;
  processing_id: string;
  email_from: string;
  customer_name: string | null;
  company_name: string | null;
  status: string;
  email_thread_id?: string | null;
  email_body?: string | null;
  drafted_email?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface EmailConversationRecord {
  id: string;
  messages: unknown[];
  turns_count: number | null;
}

function resolveAdminUserEmail(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_ADMIN_USER_EMAIL;
}

function extractBookingIdFromText(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const match = value.match(/booking_[a-z0-9_]+/i);
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
}

function getInboundEmailBody(payload: InboundEmailPayload): string {
  const textBody = payload.text?.trim();
  if (textBody) {
    return textBody;
  }

  const htmlBody = payload.html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return htmlBody || '';
}

function shouldAutoApproveInboundReply(replyBody: string): boolean {
  if (process.env['AUTO_APPROVE_BOOKING_REPLIES'] === 'false') {
    return false;
  }

  const normalized = replyBody.toLowerCase();
  const blockedSignals = [
    'price',
    'pricing',
    'contract',
    'legal',
    'nda',
    'invoice',
    'refund',
    'cancel',
    'complaint',
    'issue',
    'problem',
    'urgent',
    'angry',
    'frustrated',
    'stop',
    'unsubscribe',
    'human',
    'call me',
  ];

  if (blockedSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  return replyBody.trim().length <= 500;
}

function buildAutoReplyEmailSubject(booking: BookingLookupRecord): string {
  const companyName = booking.company_name?.trim();
  const bookingReference = `[${booking.processing_id}]`;

  if (companyName) {
    return `Re: Your Autonome consultation request for ${companyName} ${bookingReference}`;
  }

  return `Re: Your Autonome consultation request ${bookingReference}`;
}

function buildAutoReplyEmailBody(booking: BookingLookupRecord, draft: string): string {
  return `${normalizeCustomerFacingEmailCopy(draft)}\n\nBooking reference: ${booking.processing_id}\nReply directly to continue scheduling with Autonome.`;
}

function shouldBypassInteractiveAIBookingFlow(bookingData: BookingData): boolean {
  const hasSelectedSlot = typeof bookingData.provisional_hold_id === 'string'
    && bookingData.provisional_hold_id.trim().length > 0;

  return hasSelectedSlot && bookingData.ai_concierge_engaged !== true;
}

async function generateInboundReplyDraft(
  openai: OpenAI,
  booking: BookingLookupRecord,
  inboundMessage: string
): Promise<string> {
  const openaiConfig = getServiceConfig('openai');
  const priorDraft = booking.drafted_email?.trim();

  const completion = await openai.chat.completions.create({
    model: openaiConfig.model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are the Autonome booking AI. Continue an active scheduling conversation by email.

Requirements:
- Keep the tone professional, warm, and concise
- Answer the customer's latest message directly
- Move the conversation toward confirming a suitable consultation time
- If the customer suggests timing constraints, acknowledge them and propose the next step
- Do not mention internal tools, Slack, or approvals
- Sign as "The Autonome Team"
- Return plain email body text only`,
      },
      {
        role: 'user',
        content: `Customer name: ${booking.customer_name || 'Customer'}
Company: ${booking.company_name || 'Not provided'}
Customer email: ${booking.email_from}
Original inquiry:
${booking.email_body || 'Not available'}

Previous outbound draft:
${priorDraft || 'None yet'}

Latest inbound reply:
${inboundMessage}

Write the next best email response from the booking AI.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  const draftedReply = completion.choices[0]?.message?.content?.trim();
  if (!draftedReply) {
    throw new Error('Empty AI draft generated for inbound reply');
  }

  return normalizeCustomerFacingEmailCopy(draftedReply);
}

async function sendAutomatedBookingReply(
  booking: BookingLookupRecord,
  draft: string
): Promise<void> {
  const emailService = await serviceManager.getService<Resend>('email');

  if (!emailService) {
    throw new Error('Email service not available');
  }

  await sendTransactionalEmail({
    emailService,
    to: [booking.email_from],
    subject: buildAutoReplyEmailSubject(booking),
    text: buildAutoReplyEmailBody(booking, draft),
    context: `automated_booking_reply:${booking.processing_id}`,
  });
}

async function persistConversationTurn(
  supabase: SupabaseClient,
  booking: BookingLookupRecord,
  threadId: string,
  direction: 'inbound' | 'outbound',
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!booking.id) {
    return;
  }

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('email_conversations')
      .select('id, messages, turns_count')
      .eq('thread_id', threadId)
      .maybeSingle<EmailConversationRecord>();

    if (fetchError) {
      throw fetchError;
    }

    const messageEntry = {
      direction,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    if (existing) {
      const messages = Array.isArray(existing.messages) ? [...existing.messages, messageEntry] : [messageEntry];
      const turnsCount = (existing.turns_count || 0) + 1;

      const updatePayload: Record<string, unknown> = {
        messages,
        turns_count: turnsCount,
        updated_at: new Date().toISOString(),
      };

      if (direction === 'inbound') {
        updatePayload['last_inbound_at'] = new Date().toISOString();
      } else {
        updatePayload['last_outbound_at'] = new Date().toISOString();
      }

      await supabase.from('email_conversations').update(updatePayload).eq('id', existing.id);
      return;
    }

    await supabase.from('email_conversations').insert({
      booking_inquiry_id: booking.id,
      thread_id: threadId,
      turns_count: 1,
      messages: [messageEntry],
      conversation_stage: 'gathering_info',
      last_inbound_at: direction === 'inbound' ? new Date().toISOString() : null,
      last_outbound_at: direction === 'outbound' ? new Date().toISOString() : null,
    });
  } catch (error) {
    logger.warn('Failed to persist email conversation turn:', error);
  }
}

function buildConfirmedMeetingSummary(bookingData: BookingData): string {
  const company = bookingData.company?.trim();
  if (company) {
    return `Autonome Strategic Consultation with ${company}`;
  }

  return `Autonome Strategic Consultation with ${bookingData.name.trim()}`;
}

function buildConfirmedMeetingDescription(
  bookingData: BookingData,
  bookingId: string
): string {
  const lines = [
    `Booking reference: ${bookingId}`,
    `Customer: ${bookingData.name}`,
    `Email: ${bookingData.email}`,
  ];

  if (bookingData.company?.trim()) {
    lines.push(`Company: ${bookingData.company.trim()}`);
  }

  if (bookingData.phone?.trim()) {
    lines.push(`Phone: ${bookingData.phone.trim()}`);
  }

  lines.push('', 'Strategic intent:', bookingData.message.trim());

  return lines.join('\n');
}

function formatCustomerFacingDate(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  })} EST`;
}

async function sendBookingCustomerEmail(
  bookingData: BookingData,
  bookingId: string,
  calendarConfirmation:
    | {
      confirmed: boolean;
      meeting_link?: string;
      start?: string;
    }
    | null
): Promise<{ accepted: boolean; messageId: string | null }> {
  const emailService = await serviceManager.getService<Resend>('email');

  if (!emailService) {
    logger.warn(`Confirmation email skipped for ${bookingId}: email service not available`);
    return { accepted: false, messageId: null };
  }

  const customerName = bookingData.name.trim() || 'there';
  const isCalendarConfirmed = Boolean(calendarConfirmation?.confirmed);
  const formattedDate =
    formatCustomerFacingDate(calendarConfirmation?.start)
    || formatCustomerFacingDate(bookingData.preferred_date)
    || 'the requested time';

  const subject = isCalendarConfirmed
    ? `Your Autonome consultation is confirmed [${bookingId}]`
    : `We received your Autonome consultation request [${bookingId}]`;

  const body = isCalendarConfirmed
    ? [
      `Hi ${customerName},`,
      '',
      'Your Autonome strategic consultation is confirmed.',
      `Reference: ${bookingId}`,
      `When: ${formattedDate}`,
      calendarConfirmation?.meeting_link ? `Google Meet: ${calendarConfirmation.meeting_link}` : null,
      '',
      'This confirmation email is your direct reference from the Autonome team and includes the meeting details you need.',
      '',
      'If you need to adjust anything, simply reply to this email and we will help.',
      '',
      'The Autonome Team',
    ].filter(Boolean).join('\n')
    : [
      `Hi ${customerName},`,
      '',
      'We received your consultation request and your information is now in our booking queue.',
      `Reference: ${bookingId}`,
      `Requested timing: ${formattedDate}`,
      '',
      'A strategist will follow up shortly with the next step and the best confirmed meeting time for you.',
      '',
      'The Autonome Team',
    ].join('\n');

  const sendResult = await sendTransactionalEmail({
    emailService,
    to: [bookingData.email],
    subject,
    text: body,
    context: `booking_confirmation:${bookingId}`,
  });

  const messageId = sendResult.messageId;

  logger.info(`Customer confirmation email accepted for ${bookingId}`, {
    messageId,
    recipient: bookingData.email,
    calendarConfirmed: isCalendarConfirmed,
    fromAddress: sendResult.fromAddress,
  });

  return {
    accepted: true,
    messageId,
  };
}

async function requiresConfirmedCalendarBooking(): Promise<boolean> {
  if (process.env['SHOW_CALENDAR_SLOTS'] !== 'true') {
    return false;
  }

  const calendarService = await serviceManager.getService<CalendarService>('calendar');
  return Boolean(calendarService && calendarService.getProviders().length > 0);
}

async function confirmCalendarBooking(
  bookingData: BookingData,
  bookingId: string
): Promise<{
  confirmed: boolean;
  calendar_email?: string;
  event_id?: string;
  meeting_link?: string;
  start?: string;
  end?: string;
}> {
  const holdId = typeof bookingData.provisional_hold_id === 'string'
    ? bookingData.provisional_hold_id.trim()
    : '';

  if (!holdId) {
    return { confirmed: false };
  }

  const calendarService = await serviceManager.getService<CalendarService>('calendar');

  if (!calendarService) {
    throw new Error('Calendar service not available for booking confirmation');
  }

  const confirmed = await calendarService.confirmSelectionHold(holdId, {
    summary: buildConfirmedMeetingSummary(bookingData),
    description: buildConfirmedMeetingDescription(bookingData, bookingId),
    attendees: [bookingData.email],
    location: 'Autonome Partners Google Meet',
    meetingLink: 'generate',
    sendUpdates: 'none',
  });
  let confirmedEvent = confirmed.event;

  if (!confirmedEvent.meetingLink) {
    const matchingProvider = calendarService
      .getProviders()
      .find((provider) => provider.calendarEmail === confirmed.calendarEmail);

    if (matchingProvider && confirmedEvent.id) {
      try {
        const refreshedEvent = await matchingProvider.getEvent(confirmedEvent.id);
        if (refreshedEvent.meetingLink) {
          confirmedEvent = refreshedEvent;
        }
      } catch (error) {
        logger.warn(`Confirmed calendar event re-fetch failed for ${bookingId}:`, error);
      }
    }
  }

  if (!confirmedEvent.meetingLink) {
    logger.warn(`Calendar event confirmed without Google Meet link for ${bookingId}`, {
      calendarEmail: confirmed.calendarEmail,
      eventId: confirmedEvent.id,
    });
  }

  const supabase = await serviceManager.getService<SupabaseClient>('supabase');

  if (supabase) {
    const updatePayload: Record<string, unknown> = {
      assigned_calendar_email: confirmed.calendarEmail,
      confirmed_event_id: confirmedEvent.id,
      selected_slot_start: confirmedEvent.start.toISOString(),
      selected_slot_end: confirmedEvent.end.toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('booking_inquiries')
      .update(updatePayload)
      .eq('processing_id', bookingId);

    if (error) {
      logger.warn(`Calendar event confirmed but booking row update failed for ${bookingId}:`, error);
    }
  }

  logger.info(`Calendar booking confirmed for ${bookingId}`, {
    calendarEmail: confirmed.calendarEmail,
    eventId: confirmedEvent.id,
    start: confirmedEvent.start.toISOString(),
    end: confirmedEvent.end.toISOString(),
    meetingLink: confirmedEvent.meetingLink,
  });

  return {
    confirmed: true,
    calendar_email: confirmed.calendarEmail,
    event_id: confirmedEvent.id,
    meeting_link: confirmedEvent.meetingLink,
    start: confirmedEvent.start.toISOString(),
    end: confirmedEvent.end.toISOString(),
  };
}

/**
 * Validate booking request
 */
function validateBookingRequest(req: Request): string[] {
  const { name, email, message } = req.body as Partial<BookingData>;
  const errors: string[] = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Name is required');
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    errors.push('Valid email is required');
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    errors.push('Message is required');
  }

  if (message && message.length > 2000) {
    errors.push('Message must be less than 2000 characters');
  }

  return errors;
}

/**
 * Process booking in emergency mode (database only)
 */
async function processEmergencyMode(
  bookingData: BookingData,
  requestId: string
): Promise<EmergencyResult> {
  logger.warn(`Processing booking ${requestId} in EMERGENCY mode`);

  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');

    if (!supabase) {
      throw new Error('Supabase service not available');
    }

    const metadata = {
      user_agent: bookingData.user_agent,
      source: 'emergency_fallback',
      processing_mode: 'emergency',
    };

    const bookingRecordVariants: Array<Record<string, unknown>> = [
      {
        form_submission_id: requestId,
        customer_name: bookingData.name,
        email_from: bookingData.email,
        company_name: bookingData.company || null,
        phone_number: bookingData.phone || null,
        email_body: bookingData.message,
        inquiry_type: bookingData.inquiry_type || 'strategy_call',
        preferred_date: bookingData.preferred_date || null,
        status: 'pending',
        processing_id: requestId,
        metadata,
      },
      {
        form_submission_id: requestId,
        customer_name: bookingData.name,
        email_from: bookingData.email,
        company_name: bookingData.company || null,
        phone_number: bookingData.phone || null,
        email_body: bookingData.message,
        inquiry_type: bookingData.inquiry_type || 'strategy_call',
        preferred_date: bookingData.preferred_date || null,
        status: 'pending',
        metadata,
      },
      {
        form_submission_id: requestId,
        customer_name: bookingData.name,
        email_from: bookingData.email,
        company_name: bookingData.company || null,
        phone_number: bookingData.phone || null,
        email_body: bookingData.message,
        status: 'pending',
      },
      {
        form_submission_id: requestId,
        customer_name: bookingData.name,
        email_from: bookingData.email,
        email_body: bookingData.message,
      },
      {
        customer_name: bookingData.name,
        email_from: bookingData.email,
        email_body: bookingData.message,
        status: 'pending',
      },
    ];

    let lastInsertError: { code?: string; message: string } | null = null;

    for (const [index, bookingRecord] of bookingRecordVariants.entries()) {
      const { error } = await supabase.from('booking_inquiries').insert([bookingRecord]);

      if (!error) {
        logger.info(`Emergency mode booking stored successfully: ${requestId} (variant ${index + 1})`);

        return {
          success: true,
          booking_id: requestId,
          status: 'stored_for_manual_processing',
          processing_mode: ProcessingMode.EMERGENCY as any,
          message: 'Your booking request has been stored and will be processed manually.',
        } as EmergencyResult;
      }

      const isDuplicateBookingRecord =
        error.code === '23505' &&
        (error.message.includes('booking_inquiries_processing_id_key') ||
          error.message.includes('booking_inquiries_form_submission_id_key'));

      if (isDuplicateBookingRecord) {
        logger.info(`Emergency mode booking already exists after duplicate insert attempt: ${requestId}`);

        return {
          success: true,
          booking_id: requestId,
          status: 'stored_for_manual_processing',
          processing_mode: ProcessingMode.EMERGENCY as any,
          message: 'Your booking request has been stored and will be processed manually.',
        } as EmergencyResult;
      }

      lastInsertError = {
        code: error.code,
        message: error.message,
      };

      logger.warn(`Emergency mode insert variant ${index + 1} failed for ${requestId}:`, {
        errorCode: error.code,
        errorMessage: error.message,
      });
    }

    if (lastInsertError) {
      logger.error(`Database insert failed for ${requestId}:`, {
        errorCode: lastInsertError.code,
        errorMessage: lastInsertError.message,
      });

      throw new Error(
        `Database insert failed after compatibility retries: ${lastInsertError.message} (Code: ${lastInsertError.code})`
      );
    }
    throw new Error('Database insert failed without a returned error payload');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Emergency mode processing failed for ${requestId}: ${errorMessage}`);
    throw new Error(`Emergency mode processing failed: ${errorMessage}`);
  }
}

/**
 * Process booking in fallback mode (database + slack)
 */
async function processFallbackMode(
  bookingData: BookingData,
  requestId: string
): Promise<EmergencyResult> {
  logger.info(`Processing booking ${requestId} in FALLBACK mode`);

  // Store to database first
  const emergencyResult = await processEmergencyMode(bookingData, requestId);

  // Try to send Slack notification
  try {
    const slack = await serviceManager.getService<WebClient>('slack');
    if (slack) {
      await slack.chat.postMessage({
        channel: getServiceConfig('slack').channelId,
        text: `🔥 FALLBACK MODE BOOKING\nName: ${bookingData.name}\nEmail: ${bookingData.email}\nMessage: ${bookingData.message}\nBooking ID: ${requestId}`,
      });

      emergencyResult.slack_notification = { sent: true, interactive: false, type: 'simple_notification' };
      emergencyResult.message = 'Your booking request has been received! Our team has been notified.';
    }
  } catch (error) {
    logger.error('Slack notification failed in fallback mode:', error);
  }

  emergencyResult.processing_mode = ProcessingMode.FALLBACK as any;
  return emergencyResult;
}

/**
 * Main unified booking endpoint
 */
router.post('/booking-form', async (req: Request, res: Response): Promise<void> => {
  const requestId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();

  logger.info(`UNIFIED BOOKING REQUEST: ${requestId}`, { body: req.body });

  try {
    // Validate request
    const validationErrors = validateBookingRequest(req);
    if (validationErrors.length > 0) {
      res.status(400).json({
        success: false,
        errors: validationErrors,
        request_id: requestId,
      });
      return;
    }

    const provisionalHoldId = typeof req.body?.['provisional_hold_id'] === 'string'
      ? req.body['provisional_hold_id'].trim()
      : '';
    const bookingData = req.body as BookingData;
    const bypassInteractiveAIFlow = shouldBypassInteractiveAIBookingFlow(bookingData);
    const calendarBookingRequired = await requiresConfirmedCalendarBooking();

    if (calendarBookingRequired && !provisionalHoldId) {
      res.status(400).json({
        success: false,
        error: 'Please select an available time before submitting your consultation request.',
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Determine processing mode
    const processingMode = await determineProcessingMode();
    logger.info(`Processing booking ${requestId} in ${processingMode} mode`);

    let result: BookingResponse | EmergencyResult;

    // Process based on available services
    switch (processingMode) {
      case ProcessingMode.FULL_AI:
        try {
          if (bypassInteractiveAIFlow) {
            result = await processEmergencyMode(bookingData, requestId);
            result.processing_mode = ProcessingMode.FULL_AI as any;
            result.message = 'Your selected consultation time is being finalized.';
          } else {
            result = await processFullAIMode(
              bookingData,
              requestId,
              processEmergencyMode,
              generateScheduleSuggestions
            );
          }
        } catch (error) {
          logger.error('Full AI processing failed, falling back:', error);
          result = await processFallbackMode(bookingData, requestId);
        }
        break;

      case ProcessingMode.BASIC_AI:
        // Basic AI processing would go here
        result = await processFallbackMode(bookingData, requestId);
        result.processing_mode = ProcessingMode.BASIC_AI as any;
        result.message = 'Your booking request has been received and processed!';
        break;

      case ProcessingMode.FALLBACK:
        result = await processFallbackMode(bookingData, requestId);
        break;

      case ProcessingMode.EMERGENCY:
        result = await processEmergencyMode(bookingData, requestId);
        break;

      default:
        throw new Error(`Unknown processing mode: ${processingMode}`);
    }

    let calendarConfirmation:
      | {
        confirmed: boolean;
        calendar_email?: string;
        event_id?: string;
        meeting_link?: string;
        start?: string;
        end?: string;
      }
      | null = null;
    let calendarConfirmationError: string | null = null;

    if ((result as { success?: boolean }).success && provisionalHoldId) {
      try {
        calendarConfirmation = await confirmCalendarBooking(bookingData, requestId);

        if (calendarConfirmation.confirmed) {
          (result as Record<string, unknown>)['calendar_confirmed'] = true;
          (result as Record<string, unknown>)['calendar_event_id'] = calendarConfirmation.event_id;
          (result as Record<string, unknown>)['meeting_link'] = calendarConfirmation.meeting_link;
          (result as Record<string, unknown>)['confirmed_start'] = calendarConfirmation.start;
          (result as Record<string, unknown>)['confirmed_end'] = calendarConfirmation.end;
          result.message = `Your consultation is confirmed. A confirmation email with the meeting details has been sent to ${bookingData.email}.`;
        }
      } catch (error) {
        calendarConfirmationError = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Calendar confirmation failed for ${requestId}: ${calendarConfirmationError}`);
        (result as Record<string, unknown>)['calendar_confirmed'] = false;
        (result as Record<string, unknown>)['calendar_confirmation_error'] = calendarConfirmationError;
        result.message =
          'Your request was received, but we could not finalize the meeting details automatically. Our team will follow up manually.';
      }
    }

    if (calendarBookingRequired && !calendarConfirmation?.confirmed) {
      res.status(409).json({
        success: false,
        error:
          calendarConfirmationError
          || 'We could not confirm your selected time slot. Please choose another available time and try again.',
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if ((result as { success?: boolean }).success) {
      try {
        const emailReceipt = await sendBookingCustomerEmail(
          bookingData,
          requestId,
          calendarConfirmation
        );
        (result as Record<string, unknown>)['confirmation_email_sent'] = emailReceipt.accepted;
        (result as Record<string, unknown>)['confirmation_email_id'] = emailReceipt.messageId;
      } catch (error) {
        const emailError = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Customer confirmation email failed for ${requestId}: ${emailError}`);
        (result as Record<string, unknown>)['confirmation_email_sent'] = false;
        (result as Record<string, unknown>)['confirmation_email_error'] = emailError;
      }
    }

    // Add metadata
    (result as any).request_id = requestId;
    (result as any).processing_time_ms = Date.now() - startTime;
    (result as any).timestamp = new Date().toISOString();

    logger.info(`UNIFIED BOOKING PROCESSING COMPLETE: ${requestId}`, result);

    res.json(result);
  } catch (error) {
    logger.error(`UNIFIED BOOKING PROCESSING ERROR: ${requestId}`, error);

    res.status(500).json({
      success: false,
      error: 'Internal server error during booking processing',
      request_id: requestId,
      processing_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const health = await serviceManager.healthCheck();
    res.json(health);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Service status endpoint
 */
router.get('/service-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = serviceManager.getServiceStats();
    const health = await serviceManager.healthCheck();

    res.json({
      stats,
      services: health.services,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Get configurable meeting notification settings for the admin UI.
 */
router.get('/notification-settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const userEmail = resolveAdminUserEmail(req.query['user_email']);
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    const settings = await getMeetingNotificationSettings(supabase, userEmail, {
      seedDefaults: true,
    });

    res.json({
      success: true,
      user_email: userEmail,
      settings,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Notification settings fetch error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Update configurable meeting notification settings for the admin UI.
 */
router.put('/notification-settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    const userEmail = resolveAdminUserEmail(req.body?.user_email);
    const payload = req.body?.settings as Partial<MeetingNotificationSettings> | undefined;

    if (!payload || typeof payload !== 'object') {
      res.status(400).json({
        success: false,
        error: 'settings payload is required',
      });
      return;
    }

    const settings = await saveMeetingNotificationSettings(supabase, userEmail, payload, {
      requirePersistentStore: false,
    });

    res.json({
      success: true,
      user_email: userEmail,
      settings,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Notification settings save error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Inbound email reply webhook
 * Accepts replies from the approved outbound booking email thread.
 */
router.post('/inbound-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const configuredSecret = process.env['INBOUND_EMAIL_WEBHOOK_SECRET'];
    const providedSecret = req.headers['x-booking-webhook-secret'];

    if (
      configuredSecret &&
      (typeof providedSecret !== 'string' || providedSecret !== configuredSecret)
    ) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const payload = req.body as Partial<InboundEmailPayload>;
    const from = payload.from?.trim().toLowerCase();
    const replyBody = getInboundEmailBody(payload as InboundEmailPayload);

    if (!from || !replyBody) {
      res.status(400).json({
        success: false,
        error: 'from and email body are required',
      });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    if (!supabase) {
      throw new Error('Supabase service not available');
    }

    const explicitBookingId = extractBookingIdFromText(payload.subject, payload.text, payload.html);
    let booking: BookingLookupRecord | null = null;

    if (payload.thread_id?.trim()) {
      const { data } = await supabase
        .from('booking_inquiries')
        .select('id, processing_id, email_from, customer_name, company_name, status, email_thread_id, email_body, drafted_email, metadata')
        .eq('email_thread_id', payload.thread_id.trim())
        .maybeSingle<BookingLookupRecord>();

      booking = data;
    }

    if (!booking && explicitBookingId) {
      const { data } = await supabase
        .from('booking_inquiries')
        .select('id, processing_id, email_from, customer_name, company_name, status, email_thread_id, email_body, drafted_email, metadata')
        .eq('processing_id', explicitBookingId)
        .maybeSingle<BookingLookupRecord>();

      booking = data;
    }

    if (!booking) {
      const { data } = await supabase
        .from('booking_inquiries')
        .select('id, processing_id, email_from, customer_name, company_name, status, email_thread_id, email_body, drafted_email, metadata')
        .eq('email_from', from)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle<BookingLookupRecord>();

      booking = data;
    }

    if (!booking) {
      logger.warn('Inbound email could not be matched to a booking', {
        from,
        subject: payload.subject,
      });

      res.status(404).json({
        success: false,
        error: 'No matching booking found',
      });
      return;
    }

    const conversationHistory = Array.isArray(booking.metadata?.['conversation_log'])
      ? [...(booking.metadata?.['conversation_log'] as unknown[])]
      : [];

    conversationHistory.push({
      direction: 'inbound',
      content: replyBody,
      timestamp: new Date().toISOString(),
      subject: payload.subject || null,
      thread_id: payload.thread_id || null,
    });

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      status: 'processing',
      metadata: {
        ...(booking.metadata || {}),
        conversation_log: conversationHistory,
      },
    };

    if (payload.thread_id?.trim()) {
      updateData['email_thread_id'] = payload.thread_id.trim();
    }

    const { error: updateError } = await supabase
      .from('booking_inquiries')
      .update(updateData)
      .eq('processing_id', booking.processing_id);

    if (updateError) {
      throw new Error(`Failed to update booking for inbound email: ${updateError.message}`);
    }

    const activeThreadId = payload.thread_id?.trim() || booking.email_thread_id || booking.processing_id;
    await persistConversationTurn(supabase, booking, activeThreadId, 'inbound', replyBody, {
      subject: payload.subject || null,
    });

    const slack = await serviceManager.getService<WebClient>('slack');
    const openai = await serviceManager.getService<OpenAI>('openai');
    let aiDraft: string | null = null;
    let autoApproved = false;

    if (openai) {
      try {
        aiDraft = await generateInboundReplyDraft(openai, booking, replyBody);

        const updatedConversationHistory = [
          ...conversationHistory,
          {
            direction: 'outbound_draft',
            content: aiDraft,
            timestamp: new Date().toISOString(),
          },
        ];

        const { error: draftUpdateError } = await supabase
          .from('booking_inquiries')
          .update({
            drafted_email: aiDraft,
            status: 'draft_created',
            updated_at: new Date().toISOString(),
            metadata: {
              ...(booking.metadata || {}),
              conversation_log: updatedConversationHistory,
            },
          })
          .eq('processing_id', booking.processing_id);

        if (draftUpdateError) {
          throw new Error(`Failed to save AI draft: ${draftUpdateError.message}`);
        }

        if (shouldAutoApproveInboundReply(replyBody)) {
          await sendAutomatedBookingReply(booking, aiDraft);
          autoApproved = true;
          await persistConversationTurn(supabase, booking, activeThreadId, 'outbound', aiDraft, {
            auto_approved: true,
          });

          const autoApprovedConversationHistory = [
            ...updatedConversationHistory,
            {
              direction: 'outbound_sent',
              content: aiDraft,
              timestamp: new Date().toISOString(),
              auto_approved: true,
            },
          ];

          const { error: sentUpdateError } = await supabase
            .from('booking_inquiries')
            .update({
              status: 'sent',
              updated_at: new Date().toISOString(),
              metadata: {
                ...(booking.metadata || {}),
                conversation_log: autoApprovedConversationHistory,
                last_auto_approved_at: new Date().toISOString(),
              },
            })
            .eq('processing_id', booking.processing_id);

          if (sentUpdateError) {
            throw new Error(`Failed to save auto-approved send status: ${sentUpdateError.message}`);
          }
        }
      } catch (aiError) {
        logger.error(`Failed to generate AI follow-up for booking ${booking.processing_id}:`, aiError);
      }
    }

    if (slack) {
      const channelId = getServiceConfig('slack').channelId;
      const blocks: any[] = [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `*Inbound Booking Reply Received*\n\n*Booking ID:* ${booking.processing_id}\n*Customer:* ${booking.customer_name || 'Unknown'}\n*Email:* ${booking.email_from}`,
          },
        },
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `*Reply Message:*\n${replyBody.slice(0, 2800)}`,
          },
        },
      ];

      if (aiDraft) {
        blocks.push(
          {
            type: 'divider' as const,
          },
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `*AI Booking Agent Draft Reply:*\n\n${aiDraft.slice(0, 2800)}`,
            },
          },
          {
            type: 'actions' as const,
            elements: [
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Approve AI Reply' },
                style: 'primary' as const,
                action_id: 'approve_email',
                value: booking.processing_id,
              },
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Revise AI Reply' },
                action_id: 'revise_email',
                value: booking.processing_id,
              },
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Human Takeover' },
                style: 'danger' as const,
                action_id: 'human_takeover',
                value: booking.processing_id,
              },
            ],
          }
        );
      }

      if (autoApproved && aiDraft) {
        blocks.push(
          {
            type: 'divider' as const,
          },
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `*Auto-Approved by Booking AI Flow*\nThis reply was sent automatically from ${getServiceConfig('email').fromAddress} because it matched the low-risk scheduling rules.`,
            },
          }
        );
      }

      await slack.chat.postMessage({
        channel: channelId,
        text: autoApproved
          ? `Inbound booking reply received and the AI automatically sent the next response for ${booking.processing_id}`
          : aiDraft
            ? `Inbound booking reply received and AI drafted the next response for ${booking.processing_id}`
            : `Inbound booking reply received for ${booking.processing_id}`,
        blocks,
      });
    }

    logger.info('Inbound email processed successfully', {
      bookingId: booking.processing_id,
      from,
    });

    res.json({
      success: true,
      booking_id: booking.processing_id,
      status: autoApproved ? 'sent' : 'processing',
      auto_approved: autoApproved,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Inbound email processing error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Slack debugging endpoint
 */
router.post('/debug-slack', async (_req: Request, res: Response): Promise<void> => {
  try {
    const debugSecret = process.env['BOOKING_ADMIN_SECRET'];
    const requestSecret = _req.headers['x-booking-admin-secret'];

    if (
      process.env['NODE_ENV'] === 'production' &&
      (!debugSecret || typeof requestSecret !== 'string' || requestSecret !== debugSecret)
    ) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    logger.info('=== SLACK DEBUG ENDPOINT CALLED ===');

    const slack = await serviceManager.getService<WebClient>('slack');
    const config = getServiceConfig('slack');

    logger.info('Slack service available:', !!slack);
    logger.info('Slack config:', {
      channelId: config.channelId,
      botTokenExists: !!config.botToken,
      botTokenLength: config.botToken ? config.botToken.length : 0,
    });

    if (!slack) {
      throw new Error('Slack service not available');
    }

    const testMessage = {
      channel: config.channelId,
      text: `🧪 DEBUG TEST from unified-booking.ts at ${new Date().toISOString()}`,
      blocks: [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `*🧪 Debug Test Message*\n\nThis message was sent from the unified-booking.ts debug endpoint to verify Slack integration is working.\n\nChannel ID: ${config.channelId}\nTimestamp: ${new Date().toISOString()}`,
          },
        },
      ],
    };

    logger.info('Sending debug message...');
    const slackResponse = await slack.chat.postMessage(testMessage);
    logger.info('Slack debug response:', slackResponse);

    res.json({
      success: true,
      slackResponse,
      config: {
        channelId: config.channelId,
        botTokenLength: config.botToken ? config.botToken.length : 0,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Slack debug error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage,
      stack: errorStack,
    });
  }
});

// REMOVED: Duplicate Slack interaction endpoints - these are now handled by slack-router.ts
// This fixes route conflicts that were preventing buttons from working

export default router;
