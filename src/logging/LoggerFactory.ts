/**
 * Logger Factory
 *
 * Central factory for creating and managing Logger instances.
 * Initializes the root Winston logger and caches per-component Logger wrappers.
 *
 * Usage:
 *   import { getLogger, initializeLogging } from '../logging/index.js';
 *
 *   // At server startup (optional — lazy-init with defaults if skipped):
 *   initializeLogging(serverLogController);
 *
 *   // In any module:
 *   const logger = getLogger('my-component');
 *   logger.info('Server started');
 */

import winston from 'winston';
import { LogLevel } from '../plugins/serverlog/ServerLogItem.js';
import type { ServerLogController } from '../plugins/serverlog/ServerLogController.js';
import { getLoggingConfig } from './config.js';
import { initFromEnv } from './DebugModeRegistry.js';
import { Logger, setGlobalLevelProvider } from './Logger.js';
import { ConsoleTransport, FileTransport } from './transports.js';
import type { LogTransport } from './transports.js';

/**
 * Winston uses LOWER numbers for HIGHER priority (opposite of our LogLevel ordering).
 * TRACE < DEBUG < INFO < WARN < ERROR in severity, but in winston:
 * error=0 (highest prio), trace=4 (lowest prio)
 */
const WINSTON_LEVELS: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

/** Map LogLevel enum to winston level string */
function toWinstonLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.ERROR:
      return 'error';
    case LogLevel.WARN:
      return 'warn';
    case LogLevel.INFO:
      return 'info';
    case LogLevel.DEBUG:
      return 'debug';
    case LogLevel.TRACE:
      return 'trace';
    default:
      return 'info';
  }
}

let rootLogger: winston.Logger | null = null;
let serverLogCtrl: ServerLogController | null = null;
let currentGlobalLevel: LogLevel = LogLevel.INFO;
const loggerCache = new Map<string, Logger>();

/**
 * Initialize the logging subsystem.
 * Call once at server startup. If getLogger() is called before this,
 * it lazy-initializes with defaults (console transport, INFO level).
 */
export function initializeLogging(
  controller?: ServerLogController | null,
  additionalTransports?: LogTransport[]
): void {
  const config = getLoggingConfig();

  currentGlobalLevel = config.logLevel;
  serverLogCtrl = controller ?? null;

  // Build transport list
  const transports: winston.transport[] = [];

  // Always add console transport
  const consoleTransport = new ConsoleTransport(config.logFormat, config.timestampFormat);
  transports.push(consoleTransport.createWinstonTransport());

  // Add file transport if configured
  if (config.logFile) {
    const fileTransport = new FileTransport(config.logFile, config.logFormat);
    transports.push(fileTransport.createWinstonTransport());
  }

  // Add user-supplied transports
  if (additionalTransports) {
    for (const t of additionalTransports) {
      transports.push(t.createWinstonTransport());
    }
  }

  // Create or reconfigure root winston logger
  rootLogger = winston.createLogger({
    levels: WINSTON_LEVELS,
    level: toWinstonLevel(currentGlobalLevel),
    transports,
    exitOnError: false,
  });

  // Wire global level provider into Logger class
  setGlobalLevelProvider(() => currentGlobalLevel);

  // Initialize component debug overrides from env
  initFromEnv(config.debugComponents);

  // Re-wire existing cached loggers to new root
  for (const [component] of loggerCache) {
    loggerCache.set(component, new Logger(component, rootLogger, serverLogCtrl));
  }
}

/**
 * Lazy-init: ensure root logger exists with defaults.
 */
function ensureInitialized(): void {
  if (!rootLogger) {
    initializeLogging();
  }
}

/**
 * Get (or create) a Logger for a named component.
 * Loggers are cached by component name.
 */
export function getLogger(component: string): Logger {
  const cached = loggerCache.get(component);
  if (cached) return cached;

  ensureInitialized();

  const logger = new Logger(component, rootLogger!, serverLogCtrl);
  loggerCache.set(component, logger);
  return logger;
}

/**
 * Change the global log level at runtime.
 * Affects all loggers that don't have a per-component override.
 */
export function setGlobalLevel(level: LogLevel): void {
  currentGlobalLevel = level;
  if (rootLogger) {
    rootLogger.level = toWinstonLevel(level);
  }
}

/**
 * Get the current global log level.
 */
export function getGlobalLevel(): LogLevel {
  return currentGlobalLevel;
}

/**
 * Gracefully shut down all transports (flush pending writes).
 */
export async function shutdownLogging(): Promise<void> {
  if (rootLogger) {
    await new Promise<void>((resolve) => {
      rootLogger!.on('finish', resolve);
      rootLogger!.end();
    });
  }
}

/**
 * Reset all logging state (for testing).
 */
export function resetLogging(): void {
  if (rootLogger) {
    rootLogger.close();
  }
  rootLogger = null;
  serverLogCtrl = null;
  currentGlobalLevel = LogLevel.INFO;
  loggerCache.clear();
  setGlobalLevelProvider(() => LogLevel.INFO);
}
