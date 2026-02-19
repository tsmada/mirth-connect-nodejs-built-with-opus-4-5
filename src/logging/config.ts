/**
 * Logging Configuration
 *
 * Central configuration derived from environment variables for logging.
 * Follows ClusterConfig.ts caching pattern with reset for testing.
 */

import { LogLevel, parseLogLevel } from '../plugins/serverlog/ServerLogItem.js';

export interface LoggingConfiguration {
  /** Minimum log level (LOG_LEVEL env, default INFO) */
  logLevel: LogLevel;
  /** Components to enable debug logging for (MIRTH_DEBUG_COMPONENTS env, comma-separated) */
  debugComponents: string[];
  /** Log output format (LOG_FORMAT env, default 'text') */
  logFormat: 'text' | 'json';
  /** Optional file path to write logs to (LOG_FILE env) */
  logFile?: string;
  /** Timestamp format: 'mirth' matches Java Log4j, 'iso' uses ISO-8601 (LOG_TIMESTAMP_FORMAT env, default 'mirth') */
  timestampFormat: 'mirth' | 'iso';
}

let cachedConfig: LoggingConfiguration | null = null;

function parseFormat(value: string | undefined): 'text' | 'json' {
  if (value === 'json') return 'json';
  return 'text';
}

function parseTimestampFormat(value: string | undefined): 'mirth' | 'iso' {
  if (value === 'iso') return 'iso';
  return 'mirth';
}

function parseDebugComponents(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Get the current logging configuration.
 * Values are parsed from environment variables with sensible defaults.
 * The configuration is cached after first call; use resetLoggingConfig() in tests.
 */
export function getLoggingConfig(): LoggingConfiguration {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    logLevel: parseLogLevel(process.env['LOG_LEVEL'] ?? 'INFO'),
    debugComponents: parseDebugComponents(process.env['MIRTH_DEBUG_COMPONENTS']),
    logFormat: parseFormat(process.env['LOG_FORMAT']),
    logFile: process.env['LOG_FILE'] || undefined,
    timestampFormat: parseTimestampFormat(process.env['LOG_TIMESTAMP_FORMAT']),
  };

  return cachedConfig;
}

/**
 * Reset cached configuration (for testing)
 */
export function resetLoggingConfig(): void {
  cachedConfig = null;
}
