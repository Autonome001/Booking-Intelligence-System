/**
 * Calendar Availability API
 *
 * Provides endpoints for fetching customer-facing availability,
 * checking feature flags for calendar slot display, and powering the live booking chat.
 */

import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import { getSchedulingConfig, validateDuration, getBookingWindowHours } from '../utils/booking-rules.js';
import { calculateAvailabilityResponseLimit } from '../utils/availability-response-limit.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';
import {
  getAvailabilityDisplaySettings,
  saveAvailabilityDisplaySettings,
  MAX_DISPLAY_DAYS,
  MIN_DISPLAY_DAYS,
  MAX_MINIMUM_NOTICE_MINUTES,
  MIN_MINIMUM_NOTICE_MINUTES,
} from '../services/calendar/availabilityDisplaySettings.js';

const router = Router();
const DEFAULT_USER_EMAIL = 'dev@autonome.us';
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DEFAULT_CHAT_SEARCH_WINDOW_DAYS = 30;
type DayLabel = (typeof WEEKDAY_LABELS)[number];
type DayPeriod = 'morning' | 'afternoon' | 'evening';

interface CalendarSlotResponse {
  start: string;
  end: string;
  duration_minutes: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationSignals {
  weekdays: DayLabel[];
  periods: DayPeriod[];
  afterMinutes: number | null;
  beforeMinutes: number | null;
  exactMinutes: number | null;
  referencesExactTime: boolean;
  isFlexible: boolean;
  hasConcreteTiming: boolean;
  summary: string;
  combinedText: string;
}

function resolveUserEmail(value: unknown, fallbackUserEmail = DEFAULT_USER_EMAIL): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallbackUserEmail;
}

function formatSlotLabel(slot: CalendarSlotResponse): string {
  const start = new Date(slot.start);

  return start.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function formatMinutesLabel(totalMinutes: number): string {
  const normalizedMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours24 = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  if (minutes === 0) {
    return `${hours12} ${meridiem}`;
  }

  return `${hours12}:${minutes.toString().padStart(2, '0')} ${meridiem}`;
}

function parseMatchedTime(match: RegExpMatchArray): number | null {
  const rawHour = parseInt(match[1] || '', 10);
  const rawMinute = parseInt(match[2] || '0', 10);
  const meridiem = match[3]?.toLowerCase();

  if (Number.isNaN(rawHour) || Number.isNaN(rawMinute) || rawMinute < 0 || rawMinute > 59) {
    return null;
  }

  if (!meridiem) {
    if (rawHour < 0 || rawHour > 23) {
      return null;
    }

    return rawHour * 60 + rawMinute;
  }

  if (rawHour < 1 || rawHour > 12) {
    return null;
  }

  let normalizedHour = rawHour % 12;
  if (meridiem === 'pm') {
    normalizedHour += 12;
  }

  return normalizedHour * 60 + rawMinute;
}

function extractBoundaryMinutes(
  text: string,
  keyword: 'after' | 'before'
): number | null {
  const pattern = new RegExp(`${keyword}\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b`);
  const match = text.match(pattern);
  return match ? parseMatchedTime(match) : null;
}

function extractExactTimeMinutes(text: string): number | null {
  const match = text.match(/\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  return match ? parseMatchedTime(match) : null;
}

function buildSignalSummary(signals: Omit<ConversationSignals, 'summary'>): string {
  const parts: string[] = [];

  if (signals.weekdays.length === 1) {
    const preferredDay = signals.weekdays[0];

    if (preferredDay) {
      parts.push(preferredDay);
    }
  } else if (signals.weekdays.length > 1) {
    parts.push(signals.weekdays.join(', '));
  }

  if (signals.exactMinutes !== null) {
    parts.push(`around ${formatMinutesLabel(signals.exactMinutes)}`);
  } else {
    if (signals.afterMinutes !== null) {
      parts.push(`after ${formatMinutesLabel(signals.afterMinutes)}`);
    }

    if (signals.beforeMinutes !== null) {
      parts.push(`before ${formatMinutesLabel(signals.beforeMinutes)}`);
    }
  }

  if (signals.periods.length > 0) {
    parts.push(signals.periods.join(' / '));
  }

  if (parts.length === 0 && signals.isFlexible) {
    return 'a flexible time';
  }

  if (parts.length === 0) {
    return 'general availability';
  }

  return parts.join(' ');
}

function collectConversationSignals(
  userMessage: string,
  history: ChatMessage[]
): ConversationSignals {
  const recentUserContext = history
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => message.content);

  const combinedText = [...recentUserContext, userMessage].join(' ').toLowerCase();
  const weekdays = WEEKDAY_LABELS.filter((weekday) =>
    combinedText.includes(weekday.toLowerCase())
  );
  const periods: DayPeriod[] = [];

  if (combinedText.includes('morning')) {
    periods.push('morning');
  }
  if (combinedText.includes('afternoon')) {
    periods.push('afternoon');
  }
  if (combinedText.includes('evening')) {
    periods.push('evening');
  }

  const afterMinutes = extractBoundaryMinutes(combinedText, 'after');
  const beforeMinutes = extractBoundaryMinutes(combinedText, 'before');
  const exactMinutes = extractExactTimeMinutes(combinedText);
  const isFlexible = [
    'flexible',
    'open',
    'any time',
    'whenever',
    'no preference',
    'either works',
  ].some((token) => combinedText.includes(token));

  const hasConcreteTiming =
    weekdays.length > 0 ||
    periods.length > 0 ||
    afterMinutes !== null ||
    beforeMinutes !== null ||
    exactMinutes !== null ||
    combinedText.includes('this week') ||
    combinedText.includes('next week') ||
    combinedText.includes('next month') ||
    /\bweek of\b/.test(combinedText);

  const partialSignals = {
    weekdays,
    periods,
    afterMinutes,
    beforeMinutes,
    exactMinutes,
    referencesExactTime: exactMinutes !== null,
    isFlexible,
    hasConcreteTiming,
    combinedText,
  };

  return {
    ...partialSignals,
    summary: buildSignalSummary(partialSignals),
  };
}

function getSlotLocalStartMinutes(slot: CalendarSlotResponse): number {
  const slotStart = new Date(slot.start);
  const parts = slotStart.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  }).split(':');

  const hour = parseInt(parts[0] || '0', 10);
  const minute = parseInt(parts[1] || '0', 10);

  return hour * 60 + minute;
}

function matchesPreferredTimePeriod(
  signals: ConversationSignals,
  slot: CalendarSlotResponse
): boolean {
  const slotMinutes = getSlotLocalStartMinutes(slot);

  if (signals.periods.includes('morning') && slotMinutes >= 12 * 60) {
    return false;
  }

  if (signals.periods.includes('afternoon') && (slotMinutes < 12 * 60 || slotMinutes >= 17 * 60)) {
    return false;
  }

  if (signals.periods.includes('evening') && slotMinutes < 17 * 60) {
    return false;
  }

  if (signals.afterMinutes !== null && slotMinutes <= signals.afterMinutes) {
    return false;
  }

  if (signals.beforeMinutes !== null && slotMinutes >= signals.beforeMinutes) {
    return false;
  }

  return true;
}

function rankSlotsByPreference(
  slots: CalendarSlotResponse[],
  signals: ConversationSignals
): CalendarSlotResponse[] {
  if (slots.length === 0) {
    return [];
  }

  let filtered = slots.filter((slot) => matchesPreferredTimePeriod(signals, slot));

  if (signals.weekdays.length > 0) {
    const weekdayFiltered = filtered.filter((slot) => {
      const slotWeekday = new Date(slot.start).toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'America/New_York',
      });
      return signals.weekdays.includes(slotWeekday as DayLabel);
    });

    if (weekdayFiltered.length > 0) {
      filtered = weekdayFiltered;
    }
  }

  if (filtered.length === 0) {
    filtered = slots;
  }

  return [...filtered].sort((slotA, slotB) => {
    const slotAMinutes = getSlotLocalStartMinutes(slotA);
    const slotBMinutes = getSlotLocalStartMinutes(slotB);

    let scoreA = 0;
    let scoreB = 0;

    if (signals.exactMinutes !== null) {
      scoreA += Math.abs(slotAMinutes - signals.exactMinutes);
      scoreB += Math.abs(slotBMinutes - signals.exactMinutes);
    } else if (signals.afterMinutes !== null) {
      scoreA += Math.max(0, slotAMinutes - signals.afterMinutes);
      scoreB += Math.max(0, slotBMinutes - signals.afterMinutes);
    } else if (signals.beforeMinutes !== null) {
      scoreA += Math.max(0, signals.beforeMinutes - slotAMinutes);
      scoreB += Math.max(0, signals.beforeMinutes - slotBMinutes);
    }

    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }

    return new Date(slotA.start).getTime() - new Date(slotB.start).getTime();
  });
}

function findSuggestedSlots(
  slots: CalendarSlotResponse[],
  signals: ConversationSignals,
  limit = 3
): CalendarSlotResponse[] {
  return rankSlotsByPreference(slots, signals).slice(0, limit);
}

function buildFallbackChatReply(
  userMessage: string,
  suggestedSlots: CalendarSlotResponse[],
  searchWindowDays: number,
  signals: ConversationSignals
): string {
  const preferenceSummary = signals.summary === 'general availability'
    ? userMessage
    : signals.summary;

  if (suggestedSlots.length === 0) {
    if (!signals.hasConcreteTiming) {
      return `I can help narrow this down, but I need one more detail first. Tell me your preferred day, time window, or how soon you want to meet, and I will refine the search across the next ${searchWindowDays} days for you.`;
    }

    return `I looked for ${preferenceSummary} across the next ${searchWindowDays} days and I do not see a direct fit yet. If you can flex earlier, later, or on a nearby day, I can keep refining this with you here.`;
  }

  const suggestions = suggestedSlots.map((slot) => formatSlotLabel(slot)).join(', ');

  if (!signals.hasConcreteTiming) {
    return `I can narrow this down more precisely for you. A few strong openings to start with are ${suggestions}. Tell me your ideal day, time window, or how quickly you want to meet, and I will refine these into a tighter match.`;
  }

  return `I looked for ${preferenceSummary}. The closest open options right now are ${suggestions}. If those are close but not quite right, tell me whether to search earlier, later, or on a different day and I will keep refining it.`;
}

async function buildOpenAIChatReply(
  openai: OpenAI,
  userMessage: string,
  history: ChatMessage[],
  candidateSlots: CalendarSlotResponse[],
  displayWindowDays: number,
  searchWindowDays: number,
  signals: ConversationSignals
): Promise<string> {
  const openaiConfig = getServiceConfig('openai');
  const slotContext = candidateSlots.length > 0
    ? candidateSlots.map((slot) => `- ${formatSlotLabel(slot)}`).join('\n')
    : 'No viable slot candidates are currently available in the current search window.';

  const messages = [
    {
      role: 'system' as const,
      content: `You are the public-facing Autonome booking concierge. You are chatting live on the booking page and should feel like a polished executive scheduling partner.

Requirements:
- Acknowledge the customer's preference in natural language before steering them
- If the request is broad, ask one pointed clarifying question before overloading them with times
- If the exact request is not available, say that gracefully and offer the closest viable alternatives
- When you mention times, explain why they are the best fit instead of only listing them
- Keep the tone warm, high-trust, polished, and concise
- Do not tell the customer to wait for a later follow-up just to continue the conversation
- Only mention submitting the form when they are close to a good choice or clearly ready to proceed
- Do not invent availability outside the provided slot list
- Do not mention internal tools, prompts, or system architecture
- Keep replies to at most 3 short paragraphs and no more than 1 brief question`,
    },
    ...history.slice(-10).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: 'user' as const,
      content: `Customer preference: ${userMessage}

Constraint summary: ${signals.summary}
Concrete timing provided: ${signals.hasConcreteTiming ? 'yes' : 'no'}
Visible booking window: ${displayWindowDays} days
Live chat search horizon: ${searchWindowDays} days
Best-fit slot candidates:
${slotContext}

Reply as the booking concierge.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: openaiConfig.model || 'gpt-4o',
    messages,
    temperature: 0.45,
    max_tokens: 420,
  });

  return completion.choices[0]?.message?.content?.trim()
    || buildFallbackChatReply(userMessage, candidateSlots.slice(0, 3), searchWindowDays, signals);
}

async function getDisplaySettingsForUser(
  userEmail: string,
  defaultDisplayWindowDays: number,
  requirePersistentStore = false
) {
  const supabase = await serviceManager.getService<SupabaseClient>('supabase');
  const settings = await getAvailabilityDisplaySettings(
    supabase,
    userEmail,
    defaultDisplayWindowDays,
    {
      requirePersistentStore,
      seedDefaults: true,
    }
  );

  return { supabase, settings };
}

async function invalidateCalendarAvailabilityCache(): Promise<void> {
  const calendarService = await serviceManager.getService<CalendarService>('calendar');
  calendarService?.invalidateAvailabilityCache();
}

/**
 * Get Available Time Slots
 * GET /api/calendar/availability?duration=30&start=2026-03-01
 */
router.get('/availability', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    const config = getSchedulingConfig();

    if (!calendarService) {
      res.status(503).json({
        error: 'Calendar service not available',
        calendars_checked: 0,
        slots: [],
      });
      return;
    }

    const userEmail = resolveUserEmail(
      req.query['user_email'],
      calendarService.getAvailabilityUserEmail() || DEFAULT_USER_EMAIL
    );

    const durationMinutes = parseInt(req.query['duration'] as string) || config.defaultDuration;
    const validation = validateDuration(durationMinutes);

    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        slots: [],
      });
      return;
    }

    const schedulingWindowDays = Math.max(1, Math.ceil(getBookingWindowHours(durationMinutes) / 24));
    const { settings: displaySettings } = await getDisplaySettingsForUser(
      userEmail,
      Math.min(config.defaultBookingWindowDays, schedulingWindowDays)
    );
    const now = new Date();
    const minimumNoticeMinutes = displaySettings.minimumNoticeMinutes ?? config.minLeadTimeMinutes;
    const minStart = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);
    const requestedStart = req.query['start']
      ? new Date(req.query['start'] as string)
      : minStart;
    const startDate = requestedStart < minStart ? minStart : requestedStart;
    const displayWindowDays = Math.min(displaySettings.displayWindowDays, schedulingWindowDays);
    const requestedDays = Math.max(1, parseInt(req.query['days'] as string) || 7);
    const displayWindowEnd = new Date(now.getTime() + displayWindowDays * 24 * 60 * 60 * 1000);

    if (startDate >= displayWindowEnd) {
      res.json({
        slots: [],
        calendars_checked: calendarService.getProviders().length,
        rules: {
          duration_minutes: durationMinutes,
          display_window_days: displayWindowDays,
          lead_time_minutes: minimumNoticeMinutes,
          max_slots: config.maxSlots,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const requestedEndDate = new Date(startDate.getTime() + requestedDays * 24 * 60 * 60 * 1000);
    const endDate = requestedEndDate < displayWindowEnd ? requestedEndDate : displayWindowEnd;
    const responseSlotLimit = calculateAvailabilityResponseLimit(
      startDate,
      endDate,
      config.slotIntervalMinutes,
      config.maxSlots
    );

    const slots = await calendarService.getAvailableSlots({
      startDate,
      endDate,
      durationMinutes,
      maxSlots: responseSlotLimit,
      bufferMinutes: 0,
      slotIntervalMinutes: config.slotIntervalMinutes,
    });

    const providers = calendarService.getProviders();
    const bookingCalendarInfo = calendarService.getBookingCalendarInfo();
    const calendarsChecked = bookingCalendarInfo.isConfigured ? 1 : providers.length;

    logger.info(`Availability fetched: ${slots.length} slots across ${calendarsChecked} calendar(s)`);

    res.json({
      slots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        duration_minutes: durationMinutes,
      })),
      calendars_checked: calendarsChecked,
      rules: {
        duration_minutes: durationMinutes,
        display_window_days: displayWindowDays,
        lead_time_minutes: minimumNoticeMinutes,
        max_slots: responseSlotLimit,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Availability fetch error:', errorMessage);

    res.status(500).json({
      error: 'Failed to fetch availability',
      details: errorMessage,
      slots: [],
    });
  }
});

/**
 * Live booking chat on the public booking page.
 * POST /api/calendar/chat
 */
router.post('/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history, user_email, duration_minutes } = req.body ?? {};
    const userMessage = typeof message === 'string' ? message.trim() : '';

    if (!userMessage) {
      res.status(400).json({
        success: false,
        error: 'message is required',
      });
      return;
    }

    const config = getSchedulingConfig();
    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    const userEmail = resolveUserEmail(
      user_email,
      calendarService?.getAvailabilityUserEmail() || DEFAULT_USER_EMAIL
    );
    const { settings: displaySettings } = await getDisplaySettingsForUser(
      userEmail,
      config.defaultBookingWindowDays
    );

    if (!displaySettings.aiConciergeEnabled) {
      res.status(403).json({
        success: false,
        error: 'AI booking concierge is disabled',
      });
      return;
    }

    const durationMinutes = Number.isInteger(duration_minutes)
      ? duration_minutes
      : config.defaultDuration;
    const validation = validateDuration(durationMinutes);

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: validation.error,
      });
      return;
    }

    let slotResponses: CalendarSlotResponse[] = [];

    if (calendarService) {
      const now = new Date();
      const minimumNoticeMinutes = displaySettings.minimumNoticeMinutes ?? config.minLeadTimeMinutes;
      const minStart = new Date(now.getTime() + minimumNoticeMinutes * 60 * 1000);
      const chatSearchWindowDays = Math.min(
        MAX_DISPLAY_DAYS,
        Math.max(displaySettings.displayWindowDays, DEFAULT_CHAT_SEARCH_WINDOW_DAYS)
      );
      const endDate = new Date(
        now.getTime() + chatSearchWindowDays * 24 * 60 * 60 * 1000
      );
      const responseSlotLimit = calculateAvailabilityResponseLimit(
        minStart,
        endDate,
        config.slotIntervalMinutes,
        24
      );

      const slots = await calendarService.getAvailableSlots({
        startDate: minStart,
        endDate,
        durationMinutes,
        maxSlots: responseSlotLimit,
        bufferMinutes: 0,
        slotIntervalMinutes: config.slotIntervalMinutes,
      });

      slotResponses = slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        duration_minutes: durationMinutes,
      }));
    }

    const chatHistory: ChatMessage[] = Array.isArray(history)
      ? history
          .filter(
            (entry): entry is ChatMessage =>
              entry &&
              (entry.role === 'user' || entry.role === 'assistant') &&
              typeof entry.content === 'string'
          )
          .slice(-6)
      : [];

    const chatSearchWindowDays = Math.min(
      MAX_DISPLAY_DAYS,
      Math.max(displaySettings.displayWindowDays, DEFAULT_CHAT_SEARCH_WINDOW_DAYS)
    );
    const signals = collectConversationSignals(userMessage, chatHistory);
    const candidateSlots = findSuggestedSlots(slotResponses, signals, 6);
    const suggestedSlots = candidateSlots.slice(0, 3);

    let reply = buildFallbackChatReply(
      userMessage,
      suggestedSlots,
      chatSearchWindowDays,
      signals
    );
    const openai = await serviceManager.getService<OpenAI>('openai');

    if (openai) {
      try {
        reply = await buildOpenAIChatReply(
          openai,
          userMessage,
          chatHistory,
          candidateSlots,
          displaySettings.displayWindowDays,
          chatSearchWindowDays,
          signals
        );
      } catch (error) {
        logger.warn('Falling back to deterministic booking chat reply:', error);
      }
    }

    res.json({
      success: true,
      reply,
      suggested_slots: suggestedSlots.map((slot) => ({
        ...slot,
        label: formatSlotLabel(slot),
      })),
      display_window_days: displaySettings.displayWindowDays,
      search_window_days: chatSearchWindowDays,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Booking chat error:', errorMessage);

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Create a provisional hold for a customer-selected slot on the designated booking calendar.
 * POST /api/calendar/holds/selection
 */
router.post('/holds/selection', async (req: Request, res: Response): Promise<void> => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    const { session_id, slot_start, slot_end, expiration_minutes, user_email } = req.body ?? {};

    if (!calendarService) {
      res.status(503).json({
        success: false,
        error: 'Calendar service not available',
      });
      return;
    }

    if (typeof session_id !== 'string' || !session_id.trim()) {
      res.status(400).json({
        success: false,
        error: 'session_id is required',
      });
      return;
    }

    const start = new Date(typeof slot_start === 'string' ? slot_start : '');
    const end = new Date(typeof slot_end === 'string' ? slot_end : '');

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      res.status(400).json({
        success: false,
        error: 'A valid slot_start and slot_end are required',
      });
      return;
    }

    const config = getSchedulingConfig();
    const userEmail = resolveUserEmail(
      user_email,
      calendarService.getAvailabilityUserEmail() || DEFAULT_USER_EMAIL
    );
    const { settings: displaySettings } = await getDisplaySettingsForUser(
      userEmail,
      config.defaultBookingWindowDays
    );
    const minimumNoticeMinutes = displaySettings.minimumNoticeMinutes ?? config.minLeadTimeMinutes;
    const earliestBookableStart = new Date(
      Date.now() + minimumNoticeMinutes * 60 * 1000
    );

    if (start < earliestBookableStart) {
      res.status(409).json({
        success: false,
        error: `This time is no longer available because bookings require at least ${minimumNoticeMinutes} minutes of notice. Please choose a later slot.`,
      });
      return;
    }

    const hold = await calendarService.createSelectionHold(
      session_id.trim(),
      { start, end },
      Number.isInteger(expiration_minutes) ? expiration_minutes : 15
    );

    res.json({
      success: true,
      hold_id: hold.holdId,
      expires_at: hold.expiresAt.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Selection hold creation failed:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Release a provisional hold when a customer changes their selected slot.
 * DELETE /api/calendar/holds/selection/:holdId
 */
router.delete('/holds/selection/:holdId', async (req: Request, res: Response): Promise<void> => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    const holdId = typeof req.params['holdId'] === 'string' ? decodeURIComponent(req.params['holdId']) : '';

    if (!calendarService) {
      res.status(503).json({
        success: false,
        error: 'Calendar service not available',
      });
      return;
    }

    if (!holdId) {
      res.status(400).json({
        success: false,
        error: 'holdId is required',
      });
      return;
    }

    await calendarService.releaseSelectionHold(holdId);

    res.json({
      success: true,
      hold_id: holdId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Selection hold release failed:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Get Feature Flag for Calendar Slot Display
 * GET /api/calendar/config/show-slots
 */
router.get('/config/show-slots', async (req: Request, res: Response): Promise<void> => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const enabled = process.env['SHOW_CALENDAR_SLOTS'] === 'true';
  const config = getSchedulingConfig();
  const calendarService = await serviceManager.getService<CalendarService>('calendar');
  const userEmail = resolveUserEmail(
    req.query['user_email'],
    calendarService?.getAvailabilityUserEmail() || DEFAULT_USER_EMAIL
  );
  const { settings: displaySettings } = await getDisplaySettingsForUser(
    userEmail,
    config.defaultBookingWindowDays
  );

  res.json({
    enabled,
    feature: 'calendar_slot_display',
    description: enabled
      ? 'Real-time availability display enabled'
      : 'Availability sent via email after booking submission',
    display_window_days: displaySettings.displayWindowDays,
    ai_concierge_enabled: displaySettings.aiConciergeEnabled,
    minimum_notice_minutes: displaySettings.minimumNoticeMinutes,
  });
});

/**
 * Get booking display preferences for the admin UI.
 * GET /api/calendar/preferences?user_email=dev@autonome.us
 */
router.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const config = getSchedulingConfig();
    const userEmail = resolveUserEmail(req.query['user_email']);
    const { settings } = await getDisplaySettingsForUser(
      userEmail,
      config.defaultBookingWindowDays
    );

    res.json({
      success: true,
      user_email: userEmail,
      settings,
      limits: {
        min_display_days: MIN_DISPLAY_DAYS,
        max_display_days: MAX_DISPLAY_DAYS,
        min_minimum_notice_minutes: MIN_MINIMUM_NOTICE_MINUTES,
        max_minimum_notice_minutes: MAX_MINIMUM_NOTICE_MINUTES,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Booking display settings fetch error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Update booking display preferences for the admin UI.
 * PUT /api/calendar/preferences
 */
router.put('/preferences', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = getSchedulingConfig();
    const { user_email, display_window_days, ai_concierge_enabled, minimum_notice_minutes } = req.body ?? {};
    const userEmail = resolveUserEmail(user_email);

    if (
      display_window_days !== undefined &&
      (!Number.isInteger(display_window_days) ||
        display_window_days < MIN_DISPLAY_DAYS ||
        display_window_days > MAX_DISPLAY_DAYS)
    ) {
      res.status(400).json({
        success: false,
        error: `display_window_days must be an integer between ${MIN_DISPLAY_DAYS} and ${MAX_DISPLAY_DAYS}`,
      });
      return;
    }

    if (
      minimum_notice_minutes !== undefined &&
      (!Number.isInteger(minimum_notice_minutes) ||
        minimum_notice_minutes < MIN_MINIMUM_NOTICE_MINUTES ||
        minimum_notice_minutes > MAX_MINIMUM_NOTICE_MINUTES)
    ) {
      res.status(400).json({
        success: false,
        error: `minimum_notice_minutes must be an integer between ${MIN_MINIMUM_NOTICE_MINUTES} and ${MAX_MINIMUM_NOTICE_MINUTES}`,
      });
      return;
    }

    const supabase = await serviceManager.getService<SupabaseClient>('supabase');
    const settings = await saveAvailabilityDisplaySettings(
      supabase,
      userEmail,
      {
        displayWindowDays: display_window_days,
        aiConciergeEnabled:
          typeof ai_concierge_enabled === 'boolean' ? ai_concierge_enabled : undefined,
        minimumNoticeMinutes:
          Number.isInteger(minimum_notice_minutes) ? minimum_notice_minutes : undefined,
      },
      config.defaultBookingWindowDays,
      {
        requirePersistentStore: false,
      }
    );

    await invalidateCalendarAvailabilityCache();

    res.json({
      success: true,
      user_email: userEmail,
      settings,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Booking display settings save error:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * Health check for availability API
 * GET /api/calendar/health
 */
router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');

    const providers = calendarService?.getProviders() || [];

    res.json({
      status: calendarService ? 'healthy' : 'degraded',
      calendars_connected: providers.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
