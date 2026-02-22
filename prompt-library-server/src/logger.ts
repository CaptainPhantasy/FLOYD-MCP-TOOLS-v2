/**
 * Structured Logging Configuration for Prompt Library Server
 *
 * Uses Winston for production-ready structured logging with:
 * - JSON format for log aggregation
 * - Multiple transports (console, file)
 * - Daily log rotation
 * - Request ID tracking for distributed tracing
 * - Log levels: error, warn, info, debug
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = join(__dirname, '../logs');

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Log colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

// Define log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'info';
};

// Custom format for console with colors
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// JSON format for file logs
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production'
      ? fileFormat  // JSON in production
      : consoleFormat,  // Colored text in development
  }),

  // Daily rotating file for all logs
  new DailyRotateFile({
    filename: join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',  // Keep 14 days of logs
    format: fileFormat,
    level: 'info',
  }),

  // Daily rotating file for error logs only
  new DailyRotateFile({
    filename: join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',  // Keep 30 days of error logs
    format: fileFormat,
    level: 'error',
  }),
];

// Create the logger instance
export const logger = winston.createLogger({
  levels,
  level: level(),
  format: fileFormat,
  transports,
  exitOnError: false,
});

// ============================================================================
// CONTEXT AWARE LOGGING
// ============================================================================

/**
 * Create a child logger with bound context
 * Useful for request-specific logging
 */
export function createLogger(context: string): winston.Logger {
  const childLogger = winston.createLogger({
    levels,
    level: level(),
    format: fileFormat,
    transports,
    exitOnError: false,
    defaultMeta: { context },
  });
  return childLogger;
}

/**
 * Create a child logger with request metadata
 */
export function createRequestLogger(requestId: string, additionalMeta?: Record<string, any>): winston.Logger {
  const meta: Record<string, any> = { requestId };
  if (additionalMeta) {
    Object.assign(meta, additionalMeta);
  }
  const childLogger = winston.createLogger({
    levels,
    level: level(),
    format: fileFormat,
    transports,
    exitOnError: false,
    defaultMeta: meta,
  });
  return childLogger;
}

// ============================================================================
// REQUEST LOGGING MIDDLEWARE
// ============================================================================

import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include logger and requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      logger?: winston.Logger;
    }
  }
}

/**
 * Middleware to add request ID and logger to each request
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate or use existing request ID
  const requestId = (req.headers['x-request-id'] as string) ||
                    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  req.requestId = requestId;

  // Create request-scoped logger
  const requestLogger = createRequestLogger(requestId, {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  req.logger = requestLogger;

  // Log incoming request
  requestLogger.info('Incoming request', {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  // Capture response
  const originalSend = res.send;
  res.send = function(this: Response, data: any) {
    res.send = originalSend;

    // Log response
    const statusCode = res.statusCode;
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    requestLogger.log(logLevel, 'Request completed', {
      statusCode,
      contentLength: res.get('content-length'),
    });

    return originalSend.call(this, data);
  };

  next();
}

// ============================================================================
// STREAM FOR HTTP/HTTPS LOGGING
// ============================================================================

/**
 * Stream object for use with morgan or other HTTP logging middleware
 */
export const logStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// ============================================================================
// ERROR HANDLING HELPERS
// ============================================================================

/**
 * Log an error with full context
 */
export function logError(error: Error, context?: Record<string, any>): void {
  logger.error(error.message, {
    stack: error.stack,
    ...context,
  });
}

/**
 * Log an API error with response details
 */
export function logApiError(
  error: Error,
  req: Request,
  additionalContext?: Record<string, any>
): void {
  logger.error('API error', {
    message: error.message,
    stack: error.stack,
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    ...additionalContext,
  });
}

// ============================================================================
// LOG LEVEL HELPERS
// ============================================================================

export const log = {
  error: (message: string, meta?: Record<string, any>) => logger.error(message, meta),
  warn: (message: string, meta?: Record<string, any>) => logger.warn(message, meta),
  info: (message: string, meta?: Record<string, any>) => logger.info(message, meta),
  debug: (message: string, meta?: Record<string, any>) => logger.debug(message, meta),
};

export default logger;
