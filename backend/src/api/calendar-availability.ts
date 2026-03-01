/**
 * Calendar Availability API
 *
 * Provides endpoints for fetching unified availability across all connected calendars,
 * checking feature flags for calendar slot display, and powering the live booking chat.
 */

import { Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import { getSchedulingConfig, validateDuration, getBookingWindowHours } from '../utils/booking-rules.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';
import {
  getAvailabilityDisplaySettings,
  saveAvailabilityDisplaySettings,
  MAX_DISPLAY_DAYS,
  MIN_DISPLAY_DAYS,
} from '../services/calendar/availabilityDisplaySettings.js';

const router = Router();
const DEFAULT_USER_EMAIL = 'dev@autonome.us';
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DEFAULT_CHAT_SEARCH_WINDOW_DAYS = 30;

interface CalendarSlotResponse {
  start: string;
  end: string;
  duration_minutes: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function resolveUserEmail(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_USER_EMAIL;
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

function matchesPreferredTimePeriod(message: string, slot: CalendarSlotResponse): boolean {
  const normalized = message.toLowerCase();
  const slotStart = new Date(slot.start);
  const slotHour = parseInt(
    slotStart.toLocaleTimeString('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    }),
    10
  );

  if (normalized.includes('morning') && slotHour >= 12) {
    return false;
  }

  if (normalized.includes('afternoon') && (slotHour < 12 || slotHour >= 17)) {
    return false;
  }

  if (normalized.includes('evening') && slotHour < 17) {
    return false;
  }

  return true;
}

function findSuggestedSlots(
  slots: CalendarSlotResponse[],
  userMessage: string
): CalendarSlotResponse[] {
  if (slots.length === 0) {
    return [];
  }

  const normalized = userMessage.toLowerCase();
  const weekdayMatches = WEEKDAY_LABELS.filter((weekday) =>
    normalized.includes(weekday.toLowerCase())
  );

  let filtered = slots.filter((slot) => matchesPreferredTimePeriod(normalized, slot));

  if (weekdayMatches.length > 0) {
    const weekdayFiltered = filtered.filter((slot) => {
      const slotWeekday = new Date(slot.start).toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'America/New_York',
      });
      return weekdayMatches.includes(slotWeekday as (typeof WEEKDAY_LABELS)[number]);
    });

    if (weekdayFiltered.length > 0) {
      filtered = weekdayFiltered;
    }
  }

  if (filtered.length === 0) {
    filtered = slots;
  }

  return filtered.slice(0, 3);
}

function buildFallbackChatReply(
  userMessage: string,
  suggestedSlots: CalendarSlotResponse[],
  searchWindowDays: number
): string {
  if (suggestedSlots.length === 0) {
    return `I searched the next ${searchWindowDays} days for "${userMessage}" and I do not see a direct fit yet. Give me another constraint or a broader range and I can keep refining the search with you here.`;
  }

  const suggestions = suggestedSlots.map((slot) => formatSlotLabel(slot)).join(', ');
  return `I searched the next ${searchWindowDays} days for "${userMessage}". The closest open options right now are ${suggestions}. If those still do not fit, tell me what to tighten or broaden and I will keep searching here.`;
}

async function buildOpenAIChatReply(
  openai: OpenAI,
  userMessage: string,
  history: ChatMessage[],
  suggestedSlots: CalendarSlotResponse[],
  displayWindowDays: number,
  searchWindowDays: number
): Promise<string> {
  const openaiConfig = getServiceConfig('openai');
  const slotContext = suggestedSlots.length > 0
    ? suggestedSlots.map((slot) => `- ${formatSlotLabel(slot)}`).join('\n')
    : 'No direct matches are currently available in the current search window.';

  const messages = [
    {
      role: 'system' as const,
      content: `You are the Autonome booking concierge. You are chatting live on the booking page.

Requirements:
- Be concise, warm, and specific
- Act like a real-time scheduling assistant, not a passive intake form
- Use the suggested slot list when it helps
- If no slot is a direct fit, ask for one clarifying preference or offer to broaden the search
- Do not tell the user to wait for a later follow-up just to continue the conversation
- Only mention submitting the form when the user has found an acceptable direction or wants to proceed
- Do not invent availability outside the provided slot list
- Do not mention internal tools or system architecture
- Keep replies to 2 short paragraphs max`,
    },
    ...history.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: 'user' as const,
      content: `Customer preference: ${userMessage}

Visible booking window: ${displayWindowDays} days
Live chat search horizon: ${searchWindowDays} days
Suggested slots:
${slotContext}

Reply as the booking concierge.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: openaiConfig.model || 'gpt-4o',
    messages,
    temperature: 0.3,
    max_tokens: 300,
  });

  return completion.choices[0]?.message?.content?.trim() || buildFallbackChatReply(userMessage, suggestedSlots, searchWindowDays);
}

async function getDisplaySettingsForUser(
  userEmail: string,
  defaultDisplayWindowDays: number
) {
  const supabase = await serviceManager.getService<SupabaseClient>('supabase');
  const settings = await getAvailabilityDisplaySettings(supabase, userEmail, defaultDisplayWindowDays);

  return { supabase, settings };
}

/**
 * Get Available Time Slots
 * GET /api/calendar/availability?duration=30&start=2026-03-01
 */
router.get('/availability', async (req: Request, res: Response): Promise<void> => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');
    const config = getSchedulingConfig();
    const userEmail = resolveUserEmail(req.query['user_email']);

    if (!calendarService) {
      res.status(503).json({
        error: 'Calendar service not available',
        calendars_checked: 0,
        slots: [],
      });
      return;
    }

    const durationMinutes = parseInt(req.query['duration'] as string) || config.defaultDuration;
    const validation = validateDuration(durationMinutes);

    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        slots: [],
      });
      return;
    }

    const now = new Date();
    const minStart = new Date(now.getTime() + config.minLeadTimeMinutes * 60 * 1000);
    const requestedStart = req.query['start']
      ? new Date(req.query['start'] as string)
      : minStart;
    const startDate = requestedStart < minStart ? minStart : requestedStart;

    const schedulingWindowDays = Math.max(1, Math.ceil(getBookingWindowHours(durationMinutes) / 24));
    const { settings: displaySettings } = await getDisplaySettingsForUser(
      userEmail,
      Math.min(config.defaultBookingWindowDays, schedulingWindowDays)
    );
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
          lead_time_minutes: config.minLeadTimeMinutes,
          max_slots: config.maxSlots,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const requestedEndDate = new Date(startDate.getTime() + requestedDays * 24 * 60 * 60 * 1000);
    const endDate = requestedEndDate < displayWindowEnd ? requestedEndDate : displayWindowEnd;

    const slots = await calendarService.getAvailableSlots({
      startDate,
      endDate,
      durationMinutes,
      maxSlots: config.maxSlots,
      workingHours: {
        start: '09:00',
        end: '17:00',
      },
      bufferMinutes: 0,
      slotIntervalMinutes: config.slotIntervalMinutes,
    });

    const providers = calendarService.getProviders();

    logger.info(`Availability fetched: ${slots.length} slots across ${providers.length} calendar(s)`);

    res.json({
      slots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        duration_minutes: durationMinutes,
      })),
      calendars_checked: providers.length,
      rules: {
        duration_minutes: durationMinutes,
        display_window_days: displayWindowDays,
        lead_time_minutes: config.minLeadTimeMinutes,
        max_slots: config.maxSlots,
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
    const userEmail = resolveUserEmail(user_email);
    const calendarService = await serviceManager.getService<CalendarService>('calendar');
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
      const minStart = new Date(now.getTime() + config.minLeadTimeMinutes * 60 * 1000);
      const chatSearchWindowDays = Math.min(
        MAX_DISPLAY_DAYS,
        Math.max(displaySettings.displayWindowDays, DEFAULT_CHAT_SEARCH_WINDOW_DAYS)
      );
      const endDate = new Date(
        now.getTime() + chatSearchWindowDays * 24 * 60 * 60 * 1000
      );

      const slots = await calendarService.getAvailableSlots({
        startDate: minStart,
        endDate,
        durationMinutes,
        maxSlots: 24,
        workingHours: {
          start: '09:00',
          end: '17:00',
        },
        bufferMinutes: 0,
        slotIntervalMinutes: config.slotIntervalMinutes,
      });

      slotResponses = slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        duration_minutes: durationMinutes,
      }));
    }

    const suggestedSlots = findSuggestedSlots(slotResponses, userMessage);
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

    let reply = buildFallbackChatReply(userMessage, suggestedSlots, chatSearchWindowDays);
    const openai = await serviceManager.getService<OpenAI>('openai');

    if (openai) {
      try {
        reply = await buildOpenAIChatReply(
          openai,
          userMessage,
          chatHistory,
          suggestedSlots,
          displaySettings.displayWindowDays,
          chatSearchWindowDays
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
 * Get Feature Flag for Calendar Slot Display
 * GET /api/calendar/config/show-slots
 */
router.get('/config/show-slots', async (req: Request, res: Response): Promise<void> => {
  const enabled = process.env['SHOW_CALENDAR_SLOTS'] === 'true';
  const config = getSchedulingConfig();
  const userEmail = resolveUserEmail(req.query['user_email']);
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
  });
});

/**
 * Get booking display preferences for the admin UI.
 * GET /api/calendar/preferences?user_email=dev@autonome.us
 */
router.get('/preferences', async (req: Request, res: Response): Promise<void> => {
  const config = getSchedulingConfig();
  const userEmail = resolveUserEmail(req.query['user_email']);
  const { settings } = await getDisplaySettingsForUser(userEmail, config.defaultBookingWindowDays);

  res.json({
    success: true,
    user_email: userEmail,
    settings,
    limits: {
      min_display_days: MIN_DISPLAY_DAYS,
      max_display_days: MAX_DISPLAY_DAYS,
    },
  });
});

/**
 * Update booking display preferences for the admin UI.
 * PUT /api/calendar/preferences
 */
router.put('/preferences', async (req: Request, res: Response): Promise<void> => {
  const config = getSchedulingConfig();
  const { user_email, display_window_days, ai_concierge_enabled } = req.body ?? {};
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

  const supabase = await serviceManager.getService<SupabaseClient>('supabase');
  const settings = await saveAvailabilityDisplaySettings(
    supabase,
    userEmail,
    {
      displayWindowDays: display_window_days,
      aiConciergeEnabled:
        typeof ai_concierge_enabled === 'boolean' ? ai_concierge_enabled : undefined,
    },
    config.defaultBookingWindowDays
  );

  res.json({
    success: true,
    user_email: userEmail,
    settings,
  });
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
