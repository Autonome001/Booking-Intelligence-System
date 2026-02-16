/**
 * Calendar Availability API
 *
 * Provides endpoints for fetching unified availability across all connected calendars
 * and checking feature flags for calendar slot display
 */

import { Router, type Request, type Response } from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';

const router = Router();

/**
 * Get Available Time Slots
 * GET /api/calendar/availability?duration=30&days=7&start=2026-03-01
 *
 * Query Parameters:
 * - duration: Meeting duration in minutes (default: 30)
 * - days: Number of days to look ahead (default: 7)
 * - start: Start date for availability search (default: today)
 *
 * Returns unified availability across ALL connected calendars
 * (shows slots only when ALL calendars are free)
 */
router.get('/availability', async (req: Request, res: Response): Promise<void> => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');

    if (!calendarService) {
      res.status(503).json({
        error: 'Calendar service not available',
        calendars_checked: 0,
        slots: [],
      });
      return;
    }

    // Parse query parameters with defaults
    const durationMinutes = parseInt(req.query['duration'] as string) || 30;
    const daysAhead = parseInt(req.query['days'] as string) || 7;

    const startDate = req.query['start']
      ? new Date(req.query['start'] as string)
      : new Date();

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + daysAhead);

    // Validate date range
    if (startDate >= endDate) {
      res.status(400).json({
        error: 'Invalid date range: start date must be before end date',
        slots: [],
      });
      return;
    }

    // Fetch availability across all calendars (intersection logic)
    const slots = await calendarService.getAvailableSlots({
      startDate,
      endDate,
      durationMinutes,
      maxSlots: 20,
      workingHours: {
        start: '09:00',
        end: '17:00',
      },
      bufferMinutes: 15,
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
      query: {
        duration_minutes: durationMinutes,
        days_ahead: daysAhead,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
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
