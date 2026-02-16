/**
 * Calendar Availability API
 *
 * Provides endpoints for fetching unified availability across all connected calendars
 * and checking feature flags for calendar slot display
 */

import { Router, type Request, type Response } from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { getSchedulingConfig, validateDuration, getBookingWindowHours } from '../utils/booking-rules.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';

const router = Router();

/**
 * Get Available Time Slots
 * GET /api/calendar/availability?duration=30&start=2026-03-01
 *
 * Enforces standardized booking rules:
 * - Durations: 15, 30, 45 minutes
 * - 48-hour booking window (SPECIFIC to 15-minute Q&A)
 * - 30-minute minimum lead time
 * - 1-hour slot spacing (fixed interval)
 * - Maximum 12 slots offered
 */
router.get('/availability', async (req: Request, res: Response): Promise<void> => {
  try {
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

    // Parse duration and validate against rules
    const durationMinutes = parseInt(req.query['duration'] as string) || config.defaultDuration;
    const validation = validateDuration(durationMinutes);

    if (!validation.valid) {
      res.status(400).json({
        error: validation.error,
        slots: [],
      });
      return;
    }

    // Calculate window boundaries
    // Start depends on lead time (at least 30 mins after now)
    const now = new Date();
    const minStart = new Date(now.getTime() + config.minLeadTimeMinutes * 60 * 1000);

    const requestedStart = req.query['start']
      ? new Date(req.query['start'] as string)
      : minStart;

    // Ensure we don't book earlier than lead time allow
    const startDate = requestedStart < minStart ? minStart : requestedStart;

    // Window size depends on duration
    const windowHours = getBookingWindowHours(durationMinutes);
    const endDate = new Date(startDate.getTime() + windowHours * 60 * 60 * 1000);

    // Fetch availability across all calendars (intersection logic)
    const slots = await calendarService.getAvailableSlots({
      startDate,
      endDate,
      durationMinutes,
      maxSlots: config.maxSlots,
      workingHours: {
        start: '09:00',
        end: '17:00',
      },
      bufferMinutes: 0, // We use fixed interval now
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
        window_hours: windowHours,
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
 * Get Feature Flag for Calendar Slot Display
 * GET /api/booking/config/show-slots
 *
 * Returns whether calendar availability should be displayed on booking form
 * Controlled by SHOW_CALENDAR_SLOTS environment variable
 */
router.get('/config/show-slots', (_req: Request, res: Response): void => {
  const enabled = process.env['SHOW_CALENDAR_SLOTS'] === 'true';

  res.json({
    enabled,
    feature: 'calendar_slot_display',
    description: enabled
      ? 'Real-time availability display enabled'
      : 'Availability sent via email after booking submission',
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
