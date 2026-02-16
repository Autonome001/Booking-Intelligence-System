import { logger } from '../utils/logger.js';
import { isServiceConfigured, ServiceName } from '../utils/config.js';

/**
 * Service Manager with Circuit Breaker Pattern
 * Manages service initialization, health checks, and graceful degradation
 */

// Service states
export enum ServiceState {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  FAILED = 'failed',
  CIRCUIT_OPEN = 'circuit_open',
}

// Circuit breaker states
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  timeout: 30000, // 30 seconds
  resetTimeout: 60000, // 1 minute
} as const;

// Type definitions
interface CircuitBreaker {
  state: CircuitBreakerState;
  failures: number;
  lastFailureTime: number | null;
  nextAttempt: number | null;
}

interface ServiceInfo<T = unknown> {
  factory: () => Promise<T> | T;
  instance: T | null;
  dependencies: string[];
  state: ServiceState;
  lastHealthCheck: Date | null;
  errorCount: number;
  isConfigured: boolean;
}

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'failed';
  services: Record<
    string,
    {
      configured: boolean;
      state: ServiceState;
      circuitBreaker: CircuitBreakerState;
      errorCount: number;
      lastHealthCheck: Date | null;
      status: string;
    }
  >;
  timestamp: string;
}

interface ServiceStats {
  totalServices: number;
  healthyServices: number;
  degradedServices: number;
  failedServices: number;
  unconfiguredServices: number;
}

export class ServiceManager {
  private services: Map<string, ServiceInfo>;
  private circuitBreakers: Map<string, CircuitBreaker>;

  constructor() {
    this.services = new Map();
    this.circuitBreakers = new Map();
  }

  /**
   * Register a service with the manager
   */
  registerService<T>(
    serviceName: string,
    serviceFactory: () => Promise<T> | T,
    dependencies: string[] = []
  ): void {
    this.services.set(serviceName, {
      factory: serviceFactory,
      instance: null,
      dependencies,
      state: ServiceState.HEALTHY,
      lastHealthCheck: null,
      errorCount: 0,
      isConfigured: isServiceConfigured(serviceName as ServiceName),
    });

    // Initialize circuit breaker
    this.circuitBreakers.set(serviceName, {
      state: CircuitBreakerState.CLOSED,
      failures: 0,
      lastFailureTime: null,
      nextAttempt: null,
    });

    logger.info(`Service registered: ${serviceName}`);
  }

  /**
   * Get a service instance with circuit breaker protection
   */
  async getService<T = unknown>(serviceName: string): Promise<T | null> {
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
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for service: ${serviceName}`);
    }

    if (circuitBreaker.state === CircuitBreakerState.OPEN) {
      const now = Date.now();
      if (circuitBreaker.nextAttempt && now < circuitBreaker.nextAttempt) {
        logger.warn(`Circuit breaker OPEN for service ${serviceName}`);
        return null;
      }
      // Try to reset circuit breaker
      circuitBreaker.state = CircuitBreakerState.HALF_OPEN;
    }

    try {
      // Lazy initialization
      if (!serviceInfo.instance) {
        logger.info(`Initializing service: ${serviceName}`);
        serviceInfo.instance = await serviceInfo.factory();
        serviceInfo.state = ServiceState.HEALTHY;
      }

      // Reset circuit breaker on successful access
      if (circuitBreaker.state === CircuitBreakerState.HALF_OPEN) {
        circuitBreaker.state = CircuitBreakerState.CLOSED;
        circuitBreaker.failures = 0;
        logger.info(`Circuit breaker CLOSED for service ${serviceName}`);
      }

      return serviceInfo.instance as T;
    } catch (error) {
      logger.error(`Service initialization failed for ${serviceName}:`, error);

      // Update circuit breaker
      circuitBreaker.failures++;
      circuitBreaker.lastFailureTime = Date.now();

      if (circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        circuitBreaker.state = CircuitBreakerState.OPEN;
        circuitBreaker.nextAttempt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeout;
        logger.warn(`Circuit breaker OPENED for service ${serviceName}`);
      }

      serviceInfo.state = ServiceState.FAILED;
      serviceInfo.errorCount++;

      return null;
    }
  }

  /**
   * Check the health of all services
   */
  async healthCheck(): Promise<ServiceHealth> {
    const health: ServiceHealth = {
      status: 'healthy',
      services: {},
      timestamp: new Date().toISOString(),
    };

    for (const [serviceName, serviceInfo] of this.services.entries()) {
      const circuitBreaker = this.circuitBreakers.get(serviceName);
      if (!circuitBreaker) {
        continue;
      }

      health.services[serviceName] = {
        configured: serviceInfo.isConfigured,
        state: serviceInfo.state,
        circuitBreaker: circuitBreaker.state,
        errorCount: serviceInfo.errorCount,
        lastHealthCheck: serviceInfo.lastHealthCheck,
        status: 'healthy',
      };

      if (!serviceInfo.isConfigured) {
        health.services[serviceName].status = 'not_configured';
      } else if (circuitBreaker.state === CircuitBreakerState.OPEN) {
        health.services[serviceName].status = 'circuit_open';
        health.status = 'degraded';
      } else if (serviceInfo.state === ServiceState.FAILED) {
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
  getServiceStats(): ServiceStats {
    const stats: ServiceStats = {
      totalServices: this.services.size,
      healthyServices: 0,
      degradedServices: 0,
      failedServices: 0,
      unconfiguredServices: 0,
    };

    for (const [, serviceInfo] of this.services.entries()) {
      if (!serviceInfo.isConfigured) {
        stats.unconfiguredServices++;
      } else if (serviceInfo.state === ServiceState.HEALTHY) {
        stats.healthyServices++;
      } else if (serviceInfo.state === ServiceState.DEGRADED) {
        stats.degradedServices++;
      } else {
        stats.failedServices++;
      }
    }

    return stats;
  }

  /**
   * Reset circuit breaker for a service (manual intervention)
   */
  resetCircuitBreaker(serviceName: string): void {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (circuitBreaker) {
      circuitBreaker.state = CircuitBreakerState.CLOSED;
      circuitBreaker.failures = 0;
      circuitBreaker.lastFailureTime = null;
      circuitBreaker.nextAttempt = null;
      logger.info(`Circuit breaker manually reset for service ${serviceName}`);
    }
  }

  /**
   * Force re-initialization of a service
   */
  async reinitializeService(serviceName: string): Promise<void> {
    const serviceInfo = this.services.get(serviceName);
    if (serviceInfo) {
      serviceInfo.instance = null;
      serviceInfo.state = ServiceState.HEALTHY;
      serviceInfo.errorCount = 0;
      this.resetCircuitBreaker(serviceName);
      logger.info(`Service ${serviceName} marked for re-initialization`);
    }
  }
}

// Global service manager instance
export const serviceManager = new ServiceManager();

// Export types
export type { ServiceHealth, ServiceStats, ServiceInfo, CircuitBreaker };
