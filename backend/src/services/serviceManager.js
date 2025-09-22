import { logger } from '../utils/logger.js';
import { isServiceConfigured } from '../utils/config.js';

// Service states
const SERVICE_STATES = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded', 
  FAILED: 'failed',
  CIRCUIT_OPEN: 'circuit_open'
};

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  timeout: 30000, // 30 seconds
  resetTimeout: 60000 // 1 minute
};

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.circuitBreakers = new Map();
    this.initialized = false;
  }

  /**
   * Register a service with the manager
   */
  registerService(serviceName, serviceFactory, dependencies = []) {
    this.services.set(serviceName, {
      factory: serviceFactory,
      instance: null,
      dependencies,
      state: SERVICE_STATES.HEALTHY,
      lastHealthCheck: null,
      errorCount: 0,
      isConfigured: isServiceConfigured(serviceName)
    });

    // Initialize circuit breaker
    this.circuitBreakers.set(serviceName, {
      state: 'closed',
      failures: 0,
      lastFailureTime: null,
      nextAttempt: null
    });

    logger.info(`Service registered: ${serviceName}`);
  }

  /**
   * Get a service instance with circuit breaker protection
   */
  async getService(serviceName) {
    const serviceInfo = this.services.get(serviceName);
    if (!serviceInfo) {
      throw new Error(`Service not registered: ${serviceName}`);
    }

    // Check if service is configured
    if (!serviceInfo.isConfigured) {
      logger.warn(`Service ${serviceName} not configured - will be unavailable`);
      return null;
    }

    // Check circuit breaker
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (circuitBreaker.state === 'open') {
      const now = Date.now();
      if (now < circuitBreaker.nextAttempt) {
        logger.warn(`Circuit breaker OPEN for service ${serviceName}`);
        return null;
      }
      // Try to reset circuit breaker
      circuitBreaker.state = 'half-open';
    }

    try {
      // Lazy initialization
      if (!serviceInfo.instance) {
        logger.info(`Initializing service: ${serviceName}`);
        serviceInfo.instance = await serviceInfo.factory();
        serviceInfo.state = SERVICE_STATES.HEALTHY;
      }

      // Reset circuit breaker on successful access
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        circuitBreaker.failures = 0;
        logger.info(`Circuit breaker CLOSED for service ${serviceName}`);
      }

      return serviceInfo.instance;
    } catch (error) {
      logger.error(`Service initialization failed for ${serviceName}:`, error);
      
      // Update circuit breaker
      circuitBreaker.failures++;
      circuitBreaker.lastFailureTime = Date.now();

      if (circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        circuitBreaker.state = 'open';
        circuitBreaker.nextAttempt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeout;
        logger.warn(`Circuit breaker OPENED for service ${serviceName}`);
      }

      serviceInfo.state = SERVICE_STATES.FAILED;
      serviceInfo.errorCount++;
      
      return null;
    }
  }

  /**
   * Check the health of all services
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      services: {},
      timestamp: new Date().toISOString()
    };

    for (const [serviceName, serviceInfo] of this.services.entries()) {
      const circuitBreaker = this.circuitBreakers.get(serviceName);
      
      health.services[serviceName] = {
        configured: serviceInfo.isConfigured,
        state: serviceInfo.state,
        circuitBreaker: circuitBreaker.state,
        errorCount: serviceInfo.errorCount,
        lastHealthCheck: serviceInfo.lastHealthCheck
      };

      if (!serviceInfo.isConfigured) {
        health.services[serviceName].status = 'not_configured';
      } else if (circuitBreaker.state === 'open') {
        health.services[serviceName].status = 'circuit_open';
        health.status = 'degraded';
      } else if (serviceInfo.state === SERVICE_STATES.FAILED) {
        health.services[serviceName].status = 'failed';
        health.status = 'degraded';
      } else {
        health.services[serviceName].status = 'healthy';
      }
    }

    return health;
  }

  /**
   * Get service statistics for monitoring
   */
  getServiceStats() {
    const stats = {
      totalServices: this.services.size,
      healthyServices: 0,
      degradedServices: 0,
      failedServices: 0,
      unconfiguredServices: 0
    };

    for (const [serviceName, serviceInfo] of this.services.entries()) {
      if (!serviceInfo.isConfigured) {
        stats.unconfiguredServices++;
      } else if (serviceInfo.state === SERVICE_STATES.HEALTHY) {
        stats.healthyServices++;
      } else if (serviceInfo.state === SERVICE_STATES.DEGRADED) {
        stats.degradedServices++;
      } else {
        stats.failedServices++;
      }
    }

    return stats;
  }
}

// Global service manager instance
const serviceManager = new ServiceManager();

export { serviceManager, SERVICE_STATES };
