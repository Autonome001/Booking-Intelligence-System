import type OpenAI from 'openai';
import type { WebClient } from '@slack/web-api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Resend } from 'resend';
import { serviceManager } from './serviceManager.js';
import { logger } from '../utils/logger.js';

/**
 * Processing modes based on service availability
 */
export enum ProcessingMode {
  FULL_AI = 'full_ai',     // All services available
  BASIC_AI = 'basic_ai',   // OpenAI + Slack only
  FALLBACK = 'fallback',   // Database + Slack only
  EMERGENCY = 'emergency', // Database only
}

/**
 * Service availability status
 */
interface ServiceAvailability {
  openai: OpenAI | null;
  slack: WebClient | null;
  supabase: SupabaseClient | null;
  email: Resend | null;
}

/**
 * Determine optimal processing mode based on service availability
 */
export async function determineProcessingMode(): Promise<ProcessingMode> {
  const services: ServiceAvailability = {
    openai: null,
    slack: null,
    supabase: null,
    email: null,
  };

  try {
    // Try to get each service with individual error handling
    logger.info('Checking service availability...');

    try {
      services.openai = await serviceManager.getService<OpenAI>('openai');
      logger.info('OpenAI service:', services.openai ? 'available' : 'unavailable');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('OpenAI service initialization failed:', errorMessage);
      services.openai = null;
    }

    try {
      services.slack = await serviceManager.getService<WebClient>('slack');
      logger.info('Slack service:', services.slack ? 'available' : 'unavailable');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Slack service initialization failed:', errorMessage);
      services.slack = null;
    }

    try {
      services.supabase = await serviceManager.getService<SupabaseClient>('supabase');
      logger.info('Supabase service:', services.supabase ? 'available' : 'unavailable');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Supabase service initialization failed:', errorMessage);
      services.supabase = null;
    }

    try {
      services.email = await serviceManager.getService<Resend>('email');
      logger.info('Email service:', services.email ? 'available' : 'unavailable');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Email service initialization failed:', errorMessage);
      services.email = null;
    }

    // Determine processing mode based on available services
    if (services.openai && services.slack && services.email && services.supabase) {
      logger.info('All services available - using FULL_AI mode');
      return ProcessingMode.FULL_AI;
    }

    if (services.openai && services.slack && services.supabase) {
      logger.info('Core AI services available - using BASIC_AI mode');
      return ProcessingMode.BASIC_AI;
    }

    if (services.slack && services.supabase) {
      logger.info('Basic services available - using FALLBACK mode');
      return ProcessingMode.FALLBACK;
    }

    if (services.supabase) {
      logger.info('Database only available - using EMERGENCY mode');
      return ProcessingMode.EMERGENCY;
    }

    // If no services are available, this is a critical error
    logger.error('No services available for processing booking request');
    throw new Error('All services unavailable - cannot process booking request');
  } catch (error) {
    logger.error('Error determining processing mode:', error);
    // If there's a critical error, try emergency mode as last resort
    logger.warn('Attempting emergency fallback due to service determination error');
    return ProcessingMode.EMERGENCY;
  }
}
