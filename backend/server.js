import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './src/utils/logger.js';
import { serviceManager } from './src/services/serviceManager.js';
import { getServiceConfig } from './src/utils/config.js';
import unifiedBookingRouter from './src/api/unified-booking.js';
import slackRouter from './src/api/slack-router.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'resilient-booking-system',
    version: '2.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Detailed diagnostics endpoint
app.get('/diagnostics', async (req, res) => {
  try {
    const health = await serviceManager.healthCheck();
    const stats = serviceManager.getServiceStats();
    
    res.json({
      system: {
        status: 'operational',
        version: '2.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
      },
      services: health,
      statistics: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      system: {
        status: 'error',
        error: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Register service factories with graceful error handling
async function initializeServices() {
  const services = ['supabase', 'slack', 'openai', 'email'];
  const results = { success: [], failed: [] };

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
    results.failed.push({ service: 'supabase', error: error.message });
    logger.error('❌ Supabase service registration failed:', error.message);
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
    results.failed.push({ service: 'slack', error: error.message });
    logger.error('❌ Slack service registration failed:', error.message);
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
    results.failed.push({ service: 'openai', error: error.message });
    logger.error('❌ OpenAI service registration failed:', error.message);
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
    results.failed.push({ service: 'email', error: error.message });
    logger.error('❌ Email service registration failed:', error.message);
  }

  logger.info(`Service registration summary: ${results.success.length}/${services.length} successful`);
  
  if (results.failed.length > 0) {
    logger.warn('Failed services:', results.failed.map(f => f.service).join(', '));
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

// Debug: Log all requests to help identify Slack webhook URL
app.use('*', (req, res, next) => {
  if (req.originalUrl.includes('slack') || req.originalUrl.includes('interaction')) {
    logger.info(`Slack-related request: ${req.method} ${req.originalUrl}`);
    logger.info(`Headers: ${JSON.stringify(req.headers)}`);
    logger.info(`Body: ${JSON.stringify(req.body)}`);
  }
  next();
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Graceful startup
async function startServer() {
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

startServer().catch(error => {
  logger.error('Critical startup error:', error);
  console.error('Server failed to start:', error.message);
  process.exit(1);
});