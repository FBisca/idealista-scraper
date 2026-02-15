import pino from 'pino'

/**
 * Log levels:
 * - fatal (60): Application crash
 * - error (50): Error messages
 * - warn (40): Warning messages
 * - info (30): General informational messages (default)
 * - debug (20): Debug messages
 * - trace (10): Very detailed trace messages
 */

// Get log level from environment variable or default to 'info'
const logLevel = (process.env.LOG_LEVEL ?? 'debug') as pino.LevelWithSilent

// Create the base logger
const baseLogger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '{msg}',
      customColors: 'fatal:bgRed,error:red,warn:yellow,info:cyan,debug:green,trace:gray',
      customLevels: 'fatal:60,error:50,warn:40,info:30,debug:20,trace:10'
    }
  }
})

/**
 * Wrapper to make logger more flexible with arguments
 */
const createLoggerWrapper = (logger: pino.Logger) => {
  const wrap = (level: keyof pino.Logger) => {
    return (msgOrObj: unknown, ...args: unknown[]) => {
      const logFn = logger[level] as (msg: string) => void

      if (args.length === 0) {
        // Single argument - just log it
        logFn.call(logger, String(msgOrObj))
      } else if (args.length === 1) {
        // Two arguments: message and data
        if (typeof args[0] === 'object' || args[0] instanceof Error || typeof args[0] === 'string') {
          logFn.call(
            logger,
            `${msgOrObj} ${
              args[0] instanceof Error
                ? args[0].message
                : typeof args[0] === 'object'
                  ? JSON.stringify(args[0], null, 2)
                  : args[0]
            }`
          )
        } else {
          logFn.call(logger, `${msgOrObj} ${args[0]}`)
        }
      } else {
        // Multiple arguments - concat them
        const message = [msgOrObj, ...args]
          .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
          .join(' ')
        logFn.call(logger, message)
      }
    }
  }

  return {
    fatal: wrap('fatal'),
    error: wrap('error'),
    warn: wrap('warn'),
    info: wrap('info'),
    debug: wrap('debug'),
    trace: wrap('trace'),
    child: (bindings: pino.Bindings) => createLoggerWrapper(logger.child(bindings))
  }
}

/**
 * Logger instance for the application
 *
 * Usage:
 * ```typescript
 * import { log } from './utils/logger';
 *
 * log.info('Starting process...');
 * log.debug('Detailed info:', { data: 'value' });
 * log.warn('Warning message');
 * log.error('Error occurred:', error);
 * ```
 *
 * Set log level via environment variable:
 * ```bash
 * LOG_LEVEL=debug pnpm run scrape:esma -- "FRANCE"
 * LOG_LEVEL=trace pnpm run enrich:esma -- "FRANCE"
 * ```
 */
export const log = createLoggerWrapper(baseLogger)

/**
 * Create a child logger with a specific context
 *
 * @param context - Context name for the logger
 * @returns Child logger instance
 *
 * @example
 * ```typescript
 * const scraperLog = createLogger('ESMA Scraper');
 * scraperLog.info('Starting scrape...');
 * ```
 */
export function createLogger(context: string) {
  return createLoggerWrapper(baseLogger.child({ context }))
}

/**
 * Set the log level dynamically
 *
 * @param level - New log level
 *
 * @example
 * ```typescript
 * setLogLevel('debug');
 * ```
 */
export function setLogLevel(level: pino.LevelWithSilent) {
  baseLogger.level = level
}
