import express from 'express';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { getServiceConfig } from '../utils/config.js';
import { determineProcessingMode, PROCESSING_MODES } from '../services/mode-selector.js';
import { processFullAIMode } from '../services/ai-processing.js';
import { generateScheduleSuggestions } from '../services/calendar-service.js';

const router = express.Router();

/**
 * Validate booking request
 */
function validateBookingRequest(req) {
  const { name, email, message } = req.body;
  const errors = [];

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
async function processEmergencyMode(bookingData, requestId) {
  logger.warn(`Processing booking ${requestId} in EMERGENCY mode`);
  
  try {
    const supabase = await serviceManager.getService('supabase');
    
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
        processing_mode: 'emergency'
      }
    };

    const { data, error } = await supabase
      .from('booking_inquiries')
      .insert([bookingRecord]);

    if (error) {
      logger.error(`Database insert failed for ${requestId}:`, {
        errorCode: error.code,
        errorMessage: error.message
      });
      throw new Error(`Database insert failed: ${error.message} (Code: ${error.code})`);
    }

    logger.info(`Emergency mode booking stored successfully: ${requestId}`);

    return {
      success: true,
      booking_id: requestId,
      status: 'stored_for_manual_processing',
      processing_mode: 'emergency',
      message: 'Your booking request has been stored and will be processed manually.'
    };
    
  } catch (error) {
    logger.error(`Emergency mode processing failed for ${requestId}: ${error.message}`);
    throw new Error(`Emergency mode processing failed: ${error.message}`);
  }
}


/**
 * Process booking in fallback mode (database + slack)
 */
async function processFallbackMode(bookingData, requestId) {
  logger.info(`Processing booking ${requestId} in FALLBACK mode`);
  
  // Store to database first
  const emergencyResult = await processEmergencyMode(bookingData, requestId);
  
  // Try to send Slack notification
  try {
    const slack = await serviceManager.getService('slack');
    if (slack) {
      await slack.chat.postMessage({
        channel: getServiceConfig('slack').channelId,
        text: `🔥 FALLBACK MODE BOOKING\nName: ${bookingData.name}\nEmail: ${bookingData.email}\nMessage: ${bookingData.message}\nBooking ID: ${requestId}`
      });
      
      emergencyResult.slack_notification = { sent: true };
      emergencyResult.message = 'Your booking request has been received! Our team has been notified.';
    }
  } catch (error) {
    logger.error('Slack notification failed in fallback mode:', error);
  }

  emergencyResult.processing_mode = 'fallback';
  return emergencyResult;
}

/**
 * Main unified booking endpoint
 */
router.post('/booking-form', async (req, res) => {
  const requestId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  logger.info(`UNIFIED BOOKING REQUEST: ${requestId}`, { body: req.body });

  try {
    // Validate request
    const validationErrors = validateBookingRequest(req);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors,
        request_id: requestId
      });
    }

    // Determine processing mode
    const processingMode = await determineProcessingMode();
    logger.info(`Processing booking ${requestId} in ${processingMode} mode`);

    let result;

    // Process based on available services
    switch (processingMode) {
      case PROCESSING_MODES.FULL_AI:
        try {
          result = await processFullAIMode(req.body, requestId, processEmergencyMode, generateScheduleSuggestions);
        } catch (error) {
          logger.error('Full AI processing failed, falling back:', error);
          result = await processFallbackMode(req.body, requestId);
        }
        break;

      case PROCESSING_MODES.BASIC_AI:
        // Basic AI processing would go here  
        result = await processFallbackMode(req.body, requestId);
        result.processing_mode = 'basic_ai';
        result.message = 'Your booking request has been received and processed!';
        break;

      case PROCESSING_MODES.FALLBACK:
        result = await processFallbackMode(req.body, requestId);
        break;

      case PROCESSING_MODES.EMERGENCY:
        result = await processEmergencyMode(req.body, requestId);
        break;

      default:
        throw new Error(`Unknown processing mode: ${processingMode}`);
    }

    // Add metadata
    result.request_id = requestId;
    result.processing_time_ms = Date.now() - startTime;
    result.timestamp = new Date().toISOString();

    logger.info(`UNIFIED BOOKING PROCESSING COMPLETE: ${requestId}`, result);
    
    res.json(result);

  } catch (error) {
    logger.error(`UNIFIED BOOKING PROCESSING ERROR: ${requestId}`, error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error during booking processing',
      request_id: requestId,
      processing_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = await serviceManager.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Service status endpoint
router.get('/service-status', async (req, res) => {
  try {
    const stats = serviceManager.getServiceStats();
    const health = await serviceManager.healthCheck();
    
    res.json({
      stats,
      services: health.services,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Slack debugging endpoint 
router.post('/debug-slack', async (req, res) => {
  try {
    logger.info('=== SLACK DEBUG ENDPOINT CALLED ===');
    
    const slack = await serviceManager.getService('slack');
    const config = getServiceConfig('slack');
    
    logger.info('Slack service available:', !!slack);
    logger.info('Slack config:', {
      channelId: config.channelId,
      botTokenExists: !!config.botToken,
      botTokenLength: config.botToken ? config.botToken.length : 0
    });
    
    if (!slack) {
      throw new Error('Slack service not available');
    }
    
    const testMessage = {
      channel: config.channelId,
      text: `🧪 DEBUG TEST from unified-booking.js at ${new Date().toISOString()}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn", 
            text: `*🧪 Debug Test Message*\n\nThis message was sent from the unified-booking.js debug endpoint to verify Slack integration is working.\n\nChannel ID: ${config.channelId}\nTimestamp: ${new Date().toISOString()}`
          }
        }
      ]
    };
    
    logger.info('Sending debug message...');
    const slackResponse = await slack.chat.postMessage(testMessage);
    logger.info('Slack debug response:', slackResponse);
    
    res.json({
      success: true,
      slackResponse,
      config: {
        channelId: config.channelId,
        botTokenLength: config.botToken ? config.botToken.length : 0
      }
    });
    
  } catch (error) {
    logger.error('Slack debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// REMOVED: Duplicate Slack interaction endpoints - these are now handled by slack-router.js
// This fixes route conflicts that were preventing buttons from working

// Removed handleSlackInteraction function - now handled exclusively by slack-router.js


export default router;
