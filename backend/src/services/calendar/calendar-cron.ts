/**
 * Calendar Maintenance Cron Jobs
 *
 * Automated tasks:
 * 1. Cleanup expired provisional holds (every 5 minutes)
 * 2. Renew webhook subscriptions (daily at 2 AM)
 */

import cron from 'node-cron';
import { serviceManager } from '../serviceManager.js';
import { logger } from '../../utils/logger.js';
import type { CalendarService } from './CalendarService.js';

/**
 * Cleanup Expired Provisional Holds
 * Runs every 5 minutes
 *
 * Removes holds that have expired (default: 30 minutes after creation)
 * Frees up calendar slots for other bookings
 */
cron.schedule('*/5 * * * *', async () => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');

    if (!calendarService) {
      logger.warn('Cron: Calendar service not available for hold cleanup');
      return;
    }

    const cleanedCount = await calendarService.cleanupExpiredHolds();

    if (cleanedCount > 0) {
      logger.info(`✓ Cron: Cleaned up ${cleanedCount} expired provisional hold(s)`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Cron: Failed to cleanup expired holds:', errorMessage);
  }
});

/**
 * Renew Webhook Subscriptions
 * Runs daily at 2:00 AM
 *
 * Google Calendar webhooks expire after ~7 days
 * This job renews all active subscriptions to prevent expiration
 */
cron.schedule('0 2 * * *', async () => {
  try {
    const calendarService = await serviceManager.getService<CalendarService>('calendar');

    if (!calendarService) {
      logger.warn('Cron: Calendar service not available for webhook renewal');
      return;
    }

    // Note: renewAllWebhooks() needs to be implemented in CalendarService
    // For now, we'll log that it would run
    logger.info('✓ Cron: Webhook renewal scheduled (implementation pending)');

    // TODO: Implement after CalendarService.renewAllWebhooks() is added
    // await calendarService.renewAllWebhooks();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Cron: Failed to renew webhooks:', errorMessage);
  }
});

logger.info('📅 Calendar cron jobs initialized:');
logger.info('  • Cleanup expired holds: */5 * * * * (every 5 minutes)');
logger.info('  • Renew webhooks: 0 2 * * * (daily at 2:00 AM)');
