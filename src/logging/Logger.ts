/**
 * Logger
 *
 * Lightweight wrapper around a winston logger instance.
 * Each Logger is bound to a component name and writes to both:
 * 1. Winston (console/file output)
 * 2. ServerLogController (in-memory buffer for Dashboard streaming)
 *
 * Level filtering uses DebugModeRegistry for per-component overrides.
 */

import winston from 'winston';
import { LogLevel } from '../plugins/serverlog/ServerLogItem.js';
import type { ServerLogController } from '../plugins/serverlog/ServerLogController.js';
import { shouldLog } from './DebugModeRegistry.js';

/** Reference to the factory's global level getter, injected to avoid circular imports */
let globalLevelFn: () => LogLevel = () => LogLevel.INFO;

/**
 * Set the global level provider function.
 * Called by LoggerFactory during initialization.
 * @internal
 */
export function setGlobalLevelProvider(fn: () => LogLevel): void {
  globalLevelFn = fn;
}

export class Logger {
  constructor(
    private readonly component: string,
    private readonly winstonLogger: winston.Logger,
    private readonly serverLogController?: ServerLogController | null
  ) {}

  /**
   * Log a TRACE-level message.
   */
  trace(message: string, metadata?: Record<string, unknown>): void {
    this.logAt(LogLevel.TRACE, 'trace', message, undefined, metadata);
  }

  /**
   * Log a DEBUG-level message.
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.logAt(LogLevel.DEBUG, 'debug', message, undefined, metadata);
  }

  /**
   * Log an INFO-level message.
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.logAt(LogLevel.INFO, 'info', message, undefined, metadata);
  }

  /**
   * Log a WARN-level message.
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.logAt(LogLevel.WARN, 'warn', message, undefined, metadata);
  }

  /**
   * Log an ERROR-level message with an optional Error object.
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.logAt(LogLevel.ERROR, 'error', message, error, metadata);
  }

  /**
   * Check if DEBUG level would be logged for this component.
   */
  isDebugEnabled(): boolean {
    return shouldLog(this.component, LogLevel.DEBUG, globalLevelFn());
  }

  /**
   * Check if TRACE level would be logged for this component.
   */
  isTraceEnabled(): boolean {
    return shouldLog(this.component, LogLevel.TRACE, globalLevelFn());
  }

  /**
   * Create a child logger with a sub-component suffix.
   * e.g., logger.child('parser') on component "mllp-connector" yields "mllp-connector.parser"
   */
  child(subComponent: string): Logger {
    return new Logger(
      `${this.component}.${subComponent}`,
      this.winstonLogger,
      this.serverLogController
    );
  }

  /**
   * Get this logger's component name.
   */
  getComponent(): string {
    return this.component;
  }

  // -- internal --

  private logAt(
    level: LogLevel,
    winstonLevel: string,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): void {
    if (!shouldLog(this.component, level, globalLevelFn())) {
      return;
    }

    // Write to winston
    const meta: Record<string, unknown> = {
      component: this.component,
      ...metadata,
    };
    if (error?.stack) {
      meta['errorStack'] = error.stack;
    }
    this.winstonLogger.log(winstonLevel, message, meta);

    // Write to ServerLogController for dashboard streaming
    if (this.serverLogController) {
      this.serverLogController.log(level, message, {
        category: this.component,
        throwableInformation: error?.stack,
      });
    }
  }
}
