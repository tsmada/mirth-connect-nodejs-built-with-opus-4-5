/**
 * Logging Module — Barrel Exports
 *
 * Usage:
 *   import { getLogger, initializeLogging } from './logging/index.js';
 */

// Factory (primary API)
export {
  initializeLogging,
  getLogger,
  setGlobalLevel,
  getGlobalLevel,
  shutdownLogging,
  resetLogging,
} from './LoggerFactory.js';

// Logger class
export { Logger } from './Logger.js';

// Debug mode registry
export {
  registerComponent,
  setComponentLevel,
  clearComponentLevel,
  getRegisteredComponents,
  resetDebugRegistry,
} from './DebugModeRegistry.js';

// Config
export { resetLoggingConfig } from './config.js';
export type { LoggingConfiguration } from './config.js';

// Transports
export { ConsoleTransport, FileTransport } from './transports.js';
export type { LogTransport } from './transports.js';
