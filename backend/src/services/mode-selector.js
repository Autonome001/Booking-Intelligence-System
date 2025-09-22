import { serviceManager } from './serviceManager.js';
import { logger } from '../utils/logger.js';

// Processing modes based on service availability
const PROCESSING_MODES = {
  FULL_AI: 'full_ai',        // All services available
  BASIC_AI: 'basic_ai',      // OpenAI + Slack only
  FALLBACK: 'fallback',      // Database + Slack only
  EMERGENCY: 'emergency'     // Database only
};

/**
 * Determine optimal processing mode based on service availability
 */
async function determineProcessingMode() {
  const services = {};

  try {
    // Try to get each service with individual error handling
    logger.info('Checking service availability...');

    try {
      services.openai = await serviceManager.getService('openai');
      logger.info('OpenAI service:', services.openai ? 'available' : 'unavailable');
    } catch (error) {
      logger.warn('OpenAI service initialization failed:', error.message);
      services.openai = null;
    }

    try {
      services.slack = await serviceManager.getService('slack');
      logger.info('Slack service:', services.slack ? 'available' : 'unavailable');
    } catch (error) {
      logger.warn('Slack service initialization failed:', error.message);
      services.slack = null;
    }

    try {
      services.supabase = await serviceManager.getService('supabase');
      logger.info('Supabase service:', services.supabase ? 'available' : 'unavailable');
    } catch (error) {
      logger.warn('Supabase service initialization failed:', error.message);
      services.supabase = null;
    }

    try {
      services.email = await serviceManager.getService('email');
      logger.info('Email service:', services.email ? 'available' : 'unavailable');
    } catch (error) {
      logger.warn('Email service initialization failed:', error.message);
      services.email = null;
    }

    // Determine processing mode based on available services
    if (services.openai && services.slack && services.email && services.supabase) {
      logger.info('All services available - using FULL_AI mode');
      return PROCESSING_MODES.FULL_AI;
    }

    if (services.openai && services.slack && services.supabase) {
      logger.info('Core AI services available - using BASIC_AI mode');
      return PROCESSING_MODES.BASIC_AI;
    }

    if (services.slack && services.supabase) {
      logger.info('Basic services available - using FALLBACK mode');
      return PROCESSING_MODES.FALLBACK;
    }

    if (services.supabase) {
      logger.info('Database only available - using EMERGENCY mode');
      return PROCESSING_MODES.EMERGENCY;
    }

    // If no services are available, this is a critical error
    logger.error('No services available for processing booking request');
    throw new Error('All services unavailable - cannot process booking request');

  } catch (error) {
    logger.error('Error determining processing mode:', error);
    // If there's a critical error, try emergency mode as last resort
    logger.warn('Attempting emergency fallback due to service determination error');
    return PROCESSING_MODES.EMERGENCY;
  }
}

export { determineProcessingMode, PROCESSING_MODES };