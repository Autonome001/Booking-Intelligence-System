import winston from 'winston';

/**
 * Winston Logger Configuration
 * Provides structured logging for the Booking Intelligence System
 */

const logLevel = process.env['LOG_LEVEL'] || 'info';
const serviceName = process.env['SERVICE_NAME'] || 'booking-intelligence-system';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: serviceName },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Always add console transport for development and Railway visibility
logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, service, ...metadata }) => {
        let msg = `${timestamp} [${service}] ${level}: ${message}`;
        if (Object.keys(metadata).length > 0) {
          msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
      })
    ),
  })
);

// Production initialization message
if (process.env['NODE_ENV'] === 'production') {
  logger.info('Production logger initialized - Enhanced logging enabled');
}

// Export a default logger instance
export default logger;
