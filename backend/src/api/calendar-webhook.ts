/**
 * Calendar Webhook Handler
 *
 * Receives Google Calendar push notifications when calendar events change
 * Invalidates availability cache to ensure fresh data on next fetch
 */

import { Router, type Request, type Response } from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import type { CalendarService } from '../services/calendar/CalendarService.js';

const router = Router();

/**
 * Calendar Webhook Endpoint
 * POST /api/calendar/webhook/:calendar_account_id
 *
 * Google Calendar sends notifications to this endpoint when events change
 *
 * Headers sent by Google:
 * - X-Goog-Channel-ID: Channel identifier
 * - X-Goog-Resource-ID: Resource identifier
 * - X-Goog-Resource-State: sync|exists|not_exists
 * - X-Goog-Message-Number: Message sequence number
 */
router.post('/webhook/:calendar_account_id', async (req: Request, res: Response): Promise<void> => {
  const { calendar_account_id } = req.params;
  const channelId = req.headers['x-goog-channel-id'] as string | undefined;
  const resourceState = req.headers['x-goog-resource-state'] as string | undefined;
  const messageNumber = req.headers['x-goog-message-number'] as string | undefined;

  logger.info('Calendar webhook received', {
    calendar_account_id,
    channelId,
    resourceState,
    messageNumber,
  });

  try {
    // Get calendar service
    const calendarService = await serviceManager.getService<CalendarService>('calendar');

    if (!calendarService) {
      logger.warn('Calendar service not available for webhook processing');
      res.status(503).send('Calendar service unavailable');
      return;
    }

    // Handle different resource states
    switch (resourceState) {
      case 'sync':
        // Initial sync notification - no action needed
        logger.info(`Webhook sync notification for calendar ${calendar_account_id}`);
        break;

      case 'exists':
        // Calendar event created/updated/deleted
        logger.info(`Calendar change detected for ${calendar_account_id}`);

        // Invalidate availability cache (type assertion safe - always present from route param)
        calendarService.handleWebhookNotification(calendar_account_id!);

        break;

      case 'not_exists':
        // Resource deleted or channel expired
        logger.warn(`Webhook resource not exists for calendar ${calendar_account_id}`);
        break;

      default:
        logger.warn(`Unknown resource state: ${resourceState}`);
    }

    // Respond quickly (Google requires <10s response)
    res.status(200).send('OK');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Webhook processing error:', errorMessage);

    // Still return 200 to prevent Google from retrying
    res.status(200).send('Error logged');
  }
});

/**
 * Health check for webhook endpoint
 * GET /api/calendar/webhook/health
 */
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    endpoint: 'calendar-webhook',
    timestamp: new Date().toISOString(),
  });
});

export default router;
