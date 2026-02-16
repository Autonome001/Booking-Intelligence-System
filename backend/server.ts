import express, { type Request, type Response, type NextFunction, type Application } from 'express';
import type { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './src/utils/logger.js';
import { serviceManager } from './src/services/serviceManager.js';
import { getServiceConfig } from './src/utils/config.js';
import unifiedBookingRouter from './src/api/unified-booking.js';
import slackRouter from './src/api/slack-router.js';
import calendarOAuthRouter from './src/api/calendar-oauth.js';
import calendarWebhookRouter from './src/api/calendar-webhook.js';
import calendarAvailabilityRouter from './src/api/calendar-availability.js';
import calendarAvailabilityControlsRouter from './src/api/calendar-availability-controls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Application = express();
const PORT = process.env['PORT'] ? parseInt(process.env['PORT']) : 3001;

/**
 * Service initialization result types
 */
interface ServiceFailure {
  service: string;
  error: string;
}

interface ServiceInitResults {
  success: string[];
  failed: ServiceFailure[];
}

/**
 * System diagnostics response
 */
interface SystemInfo {
  status: string;
  version: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  environment: string;
}

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    service: 'resilient-booking-system',
    version: '2.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Detailed diagnostics endpoint
 */
app.get('/diagnostics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const health = await serviceManager.healthCheck();
    const stats = serviceManager.getServiceStats();

    const systemInfo: SystemInfo = {
      status: 'operational',
      version: '2.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env['NODE_ENV'] || 'development',
    };

    res.json({
      system: systemInfo,
      services: health,
      statistics: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      system: {
        status: 'error',
        error: errorMessage,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Register service factories with graceful error handling
 */
async function initializeServices(): Promise<ServiceInitResults> {
  const services = ['supabase', 'slack', 'openai', 'email', 'calendar'];
  const results: ServiceInitResults = { success: [], failed: [] };

  // Supabase service
  try {
    serviceManager.registerService('supabase', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const config = getServiceConfig('supabase');
      return createClient(config.url, config.serviceKey);
    });
    results.success.push('supabase');
    logger.info('✅ Supabase service registered');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.failed.push({ service: 'supabase', error: errorMessage });
    logger.error('❌ Supabase service registration failed:', errorMessage);
  }

  // Slack service
  try {
    serviceManager.registerService('slack', async () => {
      const { WebClient } = await import('@slack/web-api');
      const config = getServiceConfig('slack');
      return new WebClient(config.botToken);
    });
    results.success.push('slack');
    logger.info('✅ Slack service registered');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.failed.push({ service: 'slack', error: errorMessage });
    logger.error('❌ Slack service registration failed:', errorMessage);
  }

  // OpenAI service
  try {
    serviceManager.registerService('openai', async () => {
      const { default: OpenAI } = await import('openai');
      const config = getServiceConfig('openai');
      return new OpenAI({ apiKey: config.apiKey });
    });
    results.success.push('openai');
    logger.info('✅ OpenAI service registered');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.failed.push({ service: 'openai', error: errorMessage });
    logger.error('❌ OpenAI service registration failed:', errorMessage);
  }

  // Email service
  try {
    serviceManager.registerService('email', async () => {
      const { Resend } = await import('resend');
      const config = getServiceConfig('email');
      return new Resend(config.apiKey);
    });
    results.success.push('email');
    logger.info('✅ Email service registered');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.failed.push({ service: 'email', error: errorMessage });
    logger.error('❌ Email service registration failed:', errorMessage);
  }

  // Calendar service (multi-calendar orchestration)
  try {
    serviceManager.registerService('calendar', async () => {
      const { CalendarService } = await import('./src/services/calendar/CalendarService.js');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = await serviceManager.getService<ReturnType<typeof createClient>>('supabase');
      const config = getServiceConfig('calendar');

      if (!supabase) {
        throw new Error('Supabase service required for calendar service');
      }

      const calendarService = new CalendarService(supabase, {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
      });

      // Initialize calendar providers from database
      await calendarService.initializeProviders();

      return calendarService;
    });
    results.success.push('calendar');
    logger.info('✅ Calendar service registered');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.failed.push({ service: 'calendar', error: errorMessage });
    logger.error('❌ Calendar service registration failed:', errorMessage);
  }

  logger.info(`Service registration summary: ${results.success.length}/${services.length} successful`);

  if (results.failed.length > 0) {
    logger.warn('Failed services:', results.failed.map((f) => f.service).join(', '));
    // Don't throw error - let server continue with partial functionality
  }

  return results;
}

// Use unified booking API
app.use('/api/booking', unifiedBookingRouter);

// Legacy endpoint redirect
app.use('/api/webhook/public', unifiedBookingRouter);

// Slack endpoints - both paths for compatibility
app.use('/slack', slackRouter);
app.use('/api/slack', slackRouter);

// Calendar OAuth endpoints
app.use('/api/calendar/oauth', calendarOAuthRouter);

// Calendar webhook endpoint
app.use('/api/calendar/webhook', calendarWebhookRouter);

// Calendar availability API
app.use('/api/calendar', calendarAvailabilityRouter);

// Calendar availability controls (blackouts, working hours)
app.use('/api/calendar', calendarAvailabilityControlsRouter);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Default route serves booking form
app.get('/', (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin route for calendar management
app.get('/admin', (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Debug: Log all requests to help identify Slack webhook URL
app.use('*', (req: Request, _res: Response, next: NextFunction): void => {
  if (req.originalUrl.includes('slack') || req.originalUrl.includes('interaction')) {
    logger.info(`Slack-related request: ${req.method} ${req.originalUrl}`);
    logger.info(`Headers: ${JSON.stringify(req.headers)}`);
    logger.info(`Body: ${JSON.stringify(req.body)}`);
  }
  next();
});

/**
 * Error handling middleware
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction): void => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Graceful startup
 */
async function startServer(): Promise<Server> {
  // Start server first to respond to health checks
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Resilient Booking System v2.0 running on port ${PORT}`);
    logger.info(`🌐 Server bound to 0.0.0.0:${PORT} for Railway compatibility`);
    logger.info('🔗 Available endpoints:');
    logger.info('  • Main booking: /api/booking/booking-form');
    logger.info('  • Health check: /health');
    logger.info('  • Diagnostics: /diagnostics');
    logger.info('  • Service status: /api/booking/service-status');
    console.log(`Server running on port ${PORT}`);
  });

  // Initialize services after server starts (non-blocking)
  try {
    logger.info('Initializing external services...');
    await initializeServices();
    logger.info('✅ All services initialized successfully');
  } catch (error) {
    logger.error('⚠️ Service initialization failed, but server will continue:', error);
    logger.warn('Some features may be degraded until services are available');
  }

  return server;
}

startServer().catch((error: Error) => {
  logger.error('Critical startup error:', error);
  console.error('Server failed to start:', error.message);
  process.exit(1);
});

// Initialize calendar cron jobs (cleanup holds, renew webhooks)
import './src/services/calendar/calendar-cron.js';
