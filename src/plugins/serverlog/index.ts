/**
 * Server Log Plugin
 *
 * Provides real-time server log streaming and history.
 *
 * Features:
 * - Circular buffer of recent log entries
 * - Filter by log level (DEBUG, INFO, WARN, ERROR)
 * - Filter by category/component
 * - WebSocket streaming for real-time viewing
 * - REST API for log retrieval
 * - Console hook for automatic capture
 */

// Models
export {
  ServerLogItem,
  SerializableServerLogItem,
  LogLevel,
  LOG_DATE_FORMAT,
  createServerLogItem,
  createSimpleLogItem,
  serializeServerLogItem,
  formatServerLogItem,
  parseLogLevel,
  shouldDisplayLogLevel,
} from './ServerLogItem.js';

// Controller
export {
  ServerLogController,
  serverLogController,
  LogFilter,
  hookConsole,
  hookWinston,
} from './ServerLogController.js';

// WebSocket
export {
  ServerLogWebSocketHandler,
  serverLogWebSocket,
  WsMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  GetHistoryMessage,
  LogMessage,
  HistoryMessage,
  ErrorMessage,
} from './ServerLogWebSocket.js';

// Servlet
export { serverLogRouter } from './ServerLogServlet.js';

/**
 * Plugin point name
 */
export const SERVER_LOG_PLUGIN_POINT = 'Server Log';

/**
 * Permission constants
 */
export const SERVER_LOG_PERMISSION_VIEW = 'View Server Log';
