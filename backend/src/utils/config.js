import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from multiple potential locations
const envPaths = ['.env', '../.env', '../../.env'];
for (const envPath of envPaths) {
  const fullPath = join(__dirname, envPath);
  try {
    dotenv.config({ path: fullPath });
    if (process.env.SUPABASE_URL) {
      logger.info(`Environment loaded from ${fullPath}`);
      break;
    }
  } catch (err) {
    // Continue trying other paths
  }
}

// Critical environment variables (app won't start without these)
const CRITICAL_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY'
];

// Optional service environment variables (graceful degradation)
const OPTIONAL_SERVICE_ENV_VARS = {
  supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
  openai: ['OPENAI_API_KEY'],
  slack: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
  email: ['RESEND_API_KEY'],
  calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
};

/**
 * Validate environment variables and determine service availability
 */
function validateEnvironment() {
  const validation = {
    isValid: true,
    missingCritical: [],
    availableServices: [],
    unavailableServices: []
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
    const hasAllVars = envVars.every(varName => process.env[varName]);
    if (hasAllVars) {
      validation.availableServices.push(serviceName);
    } else {
      validation.unavailableServices.push(serviceName);
    }
  }

  return validation;
}

/**
 * Check if a specific service is configured
 */
function isServiceConfigured(serviceName) {
  const envVars = OPTIONAL_SERVICE_ENV_VARS[serviceName];
  if (!envVars) return false;
  return envVars.every(varName => process.env[varName]);
}

/**
 * Get configuration for a specific service
 */
function getServiceConfig(serviceName) {
  const configs = {
    supabase: {
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_KEY
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o'
    },
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      channelId: process.env.REAL_CHANNEL_ID || process.env.SLACK_CHANNEL_ID,
      webhookUrl: process.env.SLACK_WEBHOOK_URL
    },
    email: {
      apiKey: process.env.RESEND_API_KEY,
      fromAddress: process.env.EMAIL_FROM_ADDRESS || 'bookings@autonome.us'
    },
    calendar: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
  };

  return configs[serviceName] || {};
}

// Validate environment on startup
const envValidation = validateEnvironment();

if (!envValidation.isValid) {
  logger.error('Critical environment variables missing:', envValidation.missingCritical);
  logger.warn('Server will start in degraded mode - some features may not work');
  // Don't throw error - allow server to start for healthcheck
}

if (envValidation.availableServices.length > 0) {
  logger.info('Available services:', envValidation.availableServices);
}

if (envValidation.unavailableServices.length > 0) {
  logger.warn('Services running in degraded mode:', envValidation.unavailableServices);
}

export {
  validateEnvironment,
  isServiceConfigured,
  getServiceConfig,
  envValidation
};
