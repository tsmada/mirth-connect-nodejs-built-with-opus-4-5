/**
 * Server Log Controller
 *
 * Manages server log collection and distribution.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/serverlog/DefaultServerLogController.java
 *
 * Key behaviors:
 * - Maintains a circular buffer of recent log entries
 * - Supports filtering by log level and category
 * - Provides WebSocket streaming for real-time log viewing
 * - Thread-safe log access
 */

import { EventEmitter } from 'events';
import {
  ServerLogItem,
  LogLevel,
  serializeServerLogItem,
  SerializableServerLogItem,
  shouldDisplayLogLevel,
} from './ServerLogItem.js';

/**
 * Maximum number of log entries to keep in memory
 */
const DEFAULT_LOG_SIZE = 100;

/**
 * Events emitted by the server log controller
 */
export interface ServerLogEvents {
  log: (item: ServerLogItem) => void;
  clear: () => void;
}

/**
 * Log filter options
 */
export interface LogFilter {
  /** Minimum log level to include */
  level?: LogLevel;
  /** Category pattern to match (substring) */
  category?: string;
  /** Only include logs after this ID */
  afterId?: number;
}

/**
 * Server Log Controller
 */
export class ServerLogController extends EventEmitter {
  private logs: ServerLogItem[] = [];
  private maxLogSize: number;
  private nextId: number = 1;
  private serverId: string | null = null;

  constructor(maxLogSize: number = DEFAULT_LOG_SIZE) {
    super();
    this.maxLogSize = maxLogSize;
  }

  /**
   * Set the server ID for log entries
   */
  setServerId(serverId: string): void {
    this.serverId = serverId;
  }

  /**
   * Get the server ID
   */
  getServerId(): string | null {
    return this.serverId;
  }

  /**
   * Add a log item to the buffer
   */
  addLogItem(item: Omit<ServerLogItem, 'id'>): ServerLogItem {
    const logItem: ServerLogItem = {
      ...item,
      id: this.nextId++,
      serverId: item.serverId ?? this.serverId,
    };

    // Add to front of list (most recent first)
    this.logs.unshift(logItem);

    // Remove oldest if over limit
    if (this.logs.length > this.maxLogSize) {
      this.logs.pop();
    }

    // Emit event for real-time streaming
    this.emit('log', logItem);

    return logItem;
  }

  /**
   * Add a log entry with basic parameters
   */
  log(
    level: LogLevel,
    message: string,
    options?: {
      category?: string;
      lineNumber?: string;
      throwableInformation?: string;
    }
  ): ServerLogItem {
    return this.addLogItem({
      serverId: this.serverId,
      level,
      date: new Date(),
      threadName: null,
      category: options?.category ?? null,
      lineNumber: options?.lineNumber ?? null,
      message,
      throwableInformation: options?.throwableInformation ?? null,
    });
  }

  /**
   * Log an info message
   */
  info(message: string, category?: string): ServerLogItem {
    return this.log(LogLevel.INFO, message, { category });
  }

  /**
   * Log a warning message
   */
  warn(message: string, category?: string): ServerLogItem {
    return this.log(LogLevel.WARN, message, { category });
  }

  /**
   * Log an error message
   */
  error(message: string, category?: string, error?: Error): ServerLogItem {
    return this.log(LogLevel.ERROR, message, {
      category,
      throwableInformation: error?.stack,
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, category?: string): ServerLogItem {
    return this.log(LogLevel.DEBUG, message, { category });
  }

  /**
   * Get server logs with optional filtering
   */
  getServerLogs(fetchSize: number = DEFAULT_LOG_SIZE, lastLogId?: number | null): ServerLogItem[] {
    const result: ServerLogItem[] = [];

    for (const logItem of this.logs) {
      // Filter by lastLogId - only return logs newer than this ID
      if (lastLogId !== undefined && lastLogId !== null && logItem.id <= lastLogId) {
        continue;
      }

      result.push(logItem);

      if (result.length >= fetchSize) {
        break;
      }
    }

    return result;
  }

  /**
   * Get server logs with filtering options
   */
  getFilteredLogs(fetchSize: number, filter?: LogFilter): ServerLogItem[] {
    const result: ServerLogItem[] = [];

    for (const logItem of this.logs) {
      // Filter by lastLogId
      if (filter?.afterId !== undefined && logItem.id <= filter.afterId) {
        continue;
      }

      // Filter by level
      if (filter?.level && !shouldDisplayLogLevel(logItem.level, filter.level)) {
        continue;
      }

      // Filter by category
      if (
        filter?.category &&
        logItem.category &&
        !logItem.category.toLowerCase().includes(filter.category.toLowerCase())
      ) {
        continue;
      }

      result.push(logItem);

      if (result.length >= fetchSize) {
        break;
      }
    }

    return result;
  }

  /**
   * Get logs as serializable format for API responses
   */
  getSerializableLogs(
    fetchSize: number = DEFAULT_LOG_SIZE,
    lastLogId?: number | null
  ): SerializableServerLogItem[] {
    return this.getServerLogs(fetchSize, lastLogId).map(serializeServerLogItem);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    this.emit('clear');
  }

  /**
   * Get the most recent log ID
   */
  getLatestLogId(): number | null {
    return this.logs.length > 0 ? this.logs[0]!.id : null;
  }

  /**
   * Get total log count
   */
  getLogCount(): number {
    return this.logs.length;
  }

  /**
   * Get max log size
   */
  getMaxLogSize(): number {
    return this.maxLogSize;
  }

  /**
   * Set max log size
   */
  setMaxLogSize(size: number): void {
    this.maxLogSize = size;

    // Trim if necessary
    while (this.logs.length > this.maxLogSize) {
      this.logs.pop();
    }
  }

  /**
   * Add a listener for new log events
   */
  onLog(listener: (item: ServerLogItem) => void): void {
    this.on('log', listener);
  }

  /**
   * Remove a log listener
   */
  offLog(listener: (item: ServerLogItem) => void): void {
    this.off('log', listener);
  }

  /**
   * Add a listener for clear events
   */
  onClear(listener: () => void): void {
    this.on('clear', listener);
  }

  /**
   * Remove a clear listener
   */
  offClear(listener: () => void): void {
    this.off('clear', listener);
  }
}

/**
 * Singleton server log controller instance
 */
export const serverLogController = new ServerLogController();

/**
 * Hook into console for automatic log capture
 */
export function hookConsole(controller: ServerLogController = serverLogController): void {
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  const originalConsoleDebug = console.debug;

  console.log = (...args: unknown[]) => {
    originalConsoleLog.apply(console, args);
    controller.info(formatArgs(args), 'console');
  };

  console.info = (...args: unknown[]) => {
    originalConsoleInfo.apply(console, args);
    controller.info(formatArgs(args), 'console');
  };

  console.warn = (...args: unknown[]) => {
    originalConsoleWarn.apply(console, args);
    controller.warn(formatArgs(args), 'console');
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    const errorArg = args.find((arg) => arg instanceof Error);
    controller.error(formatArgs(args), 'console', errorArg);
  };

  console.debug = (...args: unknown[]) => {
    originalConsoleDebug.apply(console, args);
    controller.debug(formatArgs(args), 'console');
  };
}

/**
 * Format console arguments to a string
 */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/**
 * Hook into winston logger for automatic log capture
 */
export function hookWinston(
  winstonLogger: {
    on: (event: string, callback: (info: { level: string; message: string }) => void) => void;
  },
  controller: ServerLogController = serverLogController
): void {
  winstonLogger.on('data', (info: { level: string; message: string }) => {
    const level = parseWinstonLevel(info.level);
    controller.log(level, info.message, { category: 'winston' });
  });
}

/**
 * Parse winston log level to LogLevel
 */
function parseWinstonLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'error':
      return LogLevel.ERROR;
    case 'warn':
    case 'warning':
      return LogLevel.WARN;
    case 'info':
      return LogLevel.INFO;
    case 'debug':
      return LogLevel.DEBUG;
    case 'verbose':
    case 'silly':
      return LogLevel.TRACE;
    default:
      return LogLevel.INFO;
  }
}
