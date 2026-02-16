import express, { type Router, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebClient } from '@slack/web-api';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import { determineProcessingMode, ProcessingMode } from '../services/mode-selector.js';
import { processFullAIMode, generateScheduleSuggestions } from '../services/ai-processing.js';
import type { BookingResponse } from '../../../src/types/index.js';

const router: Router = express.Router();

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
  user_agent?: string;
}

/**
 * Emergency mode response
 */
interface EmergencyResult extends Partial<BookingResponse> {
  processing_id?: string;
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

    const bookingRecord = {
      customer_name: bookingData.name,
      email_from: bookingData.email,
      company_name: bookingData.company || null,
      phone_number: bookingData.phone || null,
      email_body: bookingData.message,
      inquiry_type: bookingData.inquiry_type || 'strategy_call',
      preferred_date: bookingData.preferred_date || null,
      status: 'new',
      processing_id: requestId,
      metadata: {
        user_agent: bookingData.user_agent,
        source: 'emergency_fallback',
        processing_mode: 'emergency',
      },
    };

    const { data: _data, error } = await supabase.from('booking_inquiries').insert([bookingRecord]);

    if (error) {
      logger.error(`Database insert failed for ${requestId}:`, {
        errorCode: error.code,
        errorMessage: error.message,
      });
      throw new Error(`Database insert failed: ${error.message} (Code: ${error.code})`);
    }

    logger.info(`Emergency mode booking stored successfully: ${requestId}`);

    return {
      success: true,
      booking_id: requestId,
      status: 'stored_for_manual_processing',
      processing_mode: ProcessingMode.EMERGENCY as any,
      message: 'Your booking request has been stored and will be processed manually.',
    } as EmergencyResult;
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

    // Determine processing mode
    const processingMode = await determineProcessingMode();
    logger.info(`Processing booking ${requestId} in ${processingMode} mode`);

    let result: BookingResponse | EmergencyResult;

    // Process based on available services
    switch (processingMode) {
      case ProcessingMode.FULL_AI:
        try {
          result = await processFullAIMode(
            req.body as BookingData,
            requestId,
            processEmergencyMode,
            generateScheduleSuggestions
          );
        } catch (error) {
          logger.error('Full AI processing failed, falling back:', error);
          result = await processFallbackMode(req.body as BookingData, requestId);
        }
        break;

      case ProcessingMode.BASIC_AI:
        // Basic AI processing would go here
        result = await processFallbackMode(req.body as BookingData, requestId);
        result.processing_mode = ProcessingMode.BASIC_AI as any;
        result.message = 'Your booking request has been received and processed!';
        break;

      case ProcessingMode.FALLBACK:
        result = await processFallbackMode(req.body as BookingData, requestId);
        break;

      case ProcessingMode.EMERGENCY:
        result = await processEmergencyMode(req.body as BookingData, requestId);
        break;

      default:
        throw new Error(`Unknown processing mode: ${processingMode}`);
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
 * Slack debugging endpoint
 */
router.post('/debug-slack', async (_req: Request, res: Response): Promise<void> => {
  try {
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
