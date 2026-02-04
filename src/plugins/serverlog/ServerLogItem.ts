/**
 * Server Log Item
 *
 * Represents a single server log entry.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/serverlog/ServerLogItem.java
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  TRACE = 'TRACE',
}

/**
 * Server log item interface
 */
export interface ServerLogItem {
  /** Unique identifier for this log entry */
  id: number;
  /** Server ID that generated this log */
  serverId: string | null;
  /** Log level (DEBUG, INFO, WARN, ERROR) */
  level: LogLevel;
  /** Timestamp when the log was created */
  date: Date;
  /** Thread name that generated the log */
  threadName: string | null;
  /** Logger category/class name */
  category: string | null;
  /** Line number in source (if available) */
  lineNumber: string | null;
  /** Log message */
  message: string;
  /** Stack trace or exception info (if available) */
  throwableInformation: string | null;
}

/**
 * Serializable version for API responses
 */
export interface SerializableServerLogItem {
  id: number;
  serverId: string | null;
  level: string;
  date: string;
  threadName: string | null;
  category: string | null;
  lineNumber: string | null;
  message: string;
  throwableInformation: string | null;
}

/**
 * Date format for log display
 */
export const LOG_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss,SSS';

/**
 * Create a server log item
 */
export function createServerLogItem(
  id: number,
  message: string,
  options?: {
    serverId?: string;
    level?: LogLevel;
    date?: Date;
    threadName?: string;
    category?: string;
    lineNumber?: string;
    throwableInformation?: string;
  }
): ServerLogItem {
  return {
    id,
    serverId: options?.serverId ?? null,
    level: options?.level ?? LogLevel.INFO,
    date: options?.date ?? new Date(),
    threadName: options?.threadName ?? null,
    category: options?.category ?? null,
    lineNumber: options?.lineNumber ?? null,
    message,
    throwableInformation: options?.throwableInformation ?? null,
  };
}

/**
 * Create a simple message-only log item (no ID)
 */
export function createSimpleLogItem(message: string): ServerLogItem {
  return {
    id: 0,
    serverId: null,
    level: LogLevel.INFO,
    date: new Date(),
    threadName: null,
    category: null,
    lineNumber: null,
    message,
    throwableInformation: null,
  };
}

/**
 * Convert a log item to a serializable format for API responses
 */
export function serializeServerLogItem(item: ServerLogItem): SerializableServerLogItem {
  return {
    id: item.id,
    serverId: item.serverId,
    level: item.level,
    date: item.date.toISOString(),
    threadName: item.threadName,
    category: item.category,
    lineNumber: item.lineNumber,
    message: item.message,
    throwableInformation: item.throwableInformation,
  };
}

/**
 * Format a log item as a string for display
 */
export function formatServerLogItem(item: ServerLogItem): string {
  if (item.id === 0) {
    // Simple message format
    return item.message;
  }

  const parts: string[] = [];

  // Date
  const dateStr = formatLogDate(item.date);
  parts.push(`[${dateStr}]`);

  // Level
  parts.push(item.level.padEnd(5));

  // Category
  if (item.category) {
    let categoryPart = item.category;
    if (item.lineNumber) {
      categoryPart += `:${item.lineNumber}`;
    }
    parts.push(`(${categoryPart})`);
  }

  // Message
  parts.push(item.message);

  let result = parts.join('  ');

  // Throwable info
  if (item.throwableInformation) {
    result += '\n' + item.throwableInformation;
  }

  return result;
}

/**
 * Format a date for log display
 */
function formatLogDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${millis}`;
}

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string): LogLevel {
  const upper = level.toUpperCase();
  switch (upper) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
    case 'INFORMATION':
      return LogLevel.INFO;
    case 'WARN':
    case 'WARNING':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'TRACE':
      return LogLevel.TRACE;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Check if a log level should be displayed given a filter level
 */
export function shouldDisplayLogLevel(itemLevel: LogLevel, filterLevel: LogLevel): boolean {
  const levels = [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  const itemIndex = levels.indexOf(itemLevel);
  const filterIndex = levels.indexOf(filterLevel);
  return itemIndex >= filterIndex;
}
