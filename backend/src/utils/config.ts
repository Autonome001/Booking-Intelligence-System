import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Environment Configuration Manager
 * Handles environment variable loading and service configuration
 */

// Service types
export type ServiceName = 'supabase' | 'openai' | 'slack' | 'email' | 'calendar';

// Configuration interfaces
export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  channelId: string;
  webhookUrl?: string;
}

export interface EmailConfig {
  apiKey: string;
  fromAddress: string;
}

export interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export type ServiceConfig =
  | SupabaseConfig
  | OpenAIConfig
  | SlackConfig
  | EmailConfig
  | CalendarConfig;

export interface EnvironmentValidation {
  isValid: boolean;
  missingCritical: string[];
  availableServices: ServiceName[];
  unavailableServices: ServiceName[];
}

// Load environment variables from multiple potential locations
const envPaths = ['.env', '../.env', '../../.env', '../../../.env'];
for (const envPath of envPaths) {
  const fullPath = join(__dirname, envPath);
  try {
    dotenv.config({ path: fullPath });
    if (process.env['SUPABASE_URL']) {
      logger.info(`Environment loaded from ${fullPath}`);
      break;
    }
  } catch (err) {
    // Continue trying other paths
  }
}

// Critical environment variables (app won't start without these)
const CRITICAL_ENV_VARS: string[] = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];

// Optional service environment variables (graceful degradation)
const OPTIONAL_SERVICE_ENV_VARS: Record<ServiceName, string[]> = {
  supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
  openai: ['OPENAI_API_KEY'],
  slack: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
  email: ['RESEND_API_KEY'],
  calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
};

/**
 * Validate environment variables and determine service availability
 */
export function validateEnvironment(): EnvironmentValidation {
  const validation: EnvironmentValidation = {
    isValid: true,
    missingCritical: [],
    availableServices: [],
    unavailableServices: [],
  };

  // Check critical variables
  for (const varName of CRITICAL_ENV_VARS) {
    if (!process.env[varName]) {
      validation.missingCritical.push(varName);
      validation.isValid = false;
    }
  }

  // Check optional service variables
  for (const [serviceName, envVars] of Object.entries(OPTIONAL_SERVICE_ENV_VARS)) {
    const hasAllVars = envVars.every((varName) => process.env[varName]);
    if (hasAllVars) {
      validation.availableServices.push(serviceName as ServiceName);
    } else {
      validation.unavailableServices.push(serviceName as ServiceName);
    }
  }

  return validation;
}

/**
 * Check if a specific service is configured
 */
export function isServiceConfigured(serviceName: ServiceName): boolean {
  const envVars = OPTIONAL_SERVICE_ENV_VARS[serviceName];
  if (!envVars) return false;
  return envVars.every((varName) => process.env[varName]);
}

/**
 * Get configuration for a specific service
 */
export function getServiceConfig(serviceName: 'supabase'): SupabaseConfig;
export function getServiceConfig(serviceName: 'openai'): OpenAIConfig;
export function getServiceConfig(serviceName: 'slack'): SlackConfig;
export function getServiceConfig(serviceName: 'email'): EmailConfig;
export function getServiceConfig(serviceName: 'calendar'): CalendarConfig;
export function getServiceConfig(serviceName: ServiceName): ServiceConfig {
  const configs: Record<ServiceName, ServiceConfig> = {
    supabase: {
      url: process.env['SUPABASE_URL'] || '',
      serviceKey: process.env['SUPABASE_SERVICE_KEY'] || '',
    },
    openai: {
      apiKey: process.env['OPENAI_API_KEY'] || '',
      model: process.env['OPENAI_MODEL'] || 'gpt-4o',
    },
    slack: {
      botToken: process.env['SLACK_BOT_TOKEN'] || '',
      signingSecret: process.env['SLACK_SIGNING_SECRET'] || '',
      channelId: process.env['REAL_CHANNEL_ID'] || process.env['SLACK_CHANNEL_ID'] || '',
      webhookUrl: process.env['SLACK_WEBHOOK_URL'],
    },
    email: {
      apiKey: process.env['RESEND_API_KEY'] || '',
      fromAddress: process.env['EMAIL_FROM_ADDRESS'] || 'bookings@autonome.us',
    },
    calendar: {
      clientId: process.env['GOOGLE_CLIENT_ID'] || '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] || '',
      redirectUri: process.env['GOOGLE_REDIRECT_URI'] || 'http://127.0.0.1:3001/api/calendar/oauth/callback',
      scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
    },
  };

  return configs[serviceName];
}

// Validate environment on startup
export const envValidation = validateEnvironment();

if (!envValidation.isValid) {
  logger.error('Critical environment variables missing:', {
    missing: envValidation.missingCritical,
  });
  logger.warn('Server will start in degraded mode - some features may not work');
  // Don't throw error - allow server to start for healthcheck
}

if (envValidation.availableServices.length > 0) {
  logger.info('Available services:', { services: envValidation.availableServices });
}

if (envValidation.unavailableServices.length > 0) {
  logger.warn('Services running in degraded mode:', {
    services: envValidation.unavailableServices,
  });
}
