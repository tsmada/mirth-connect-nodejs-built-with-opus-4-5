/**
 * Dashboard Status Plugin
 *
 * Provides real-time connector connection status monitoring.
 *
 * Features:
 * - Track connection state for each connector
 * - Connection count with max limits
 * - Per-channel connection logs
 * - WebSocket streaming for real-time updates
 * - REST API for status retrieval
 */

// Models
export {
  ConnectionLogItem,
  SerializableConnectionLogItem,
  ConnectionStatusEventType,
  createConnectionLogItem,
  serializeConnectionLogItem,
  parseConnectionStatusEventType,
  isStateEvent,
} from './ConnectionLogItem.js';

export {
  ConnectionStateItem,
  SerializableConnectionStateItem,
  createConnectionStateItem,
  serializeConnectionStateItem,
  getStateColor,
  formatStateDisplay,
} from './ConnectionStateItem.js';

// Controller
export {
  DashboardStatusController,
  dashboardStatusController,
  ConnectionStatusEvent,
  ConnectorCountEvent,
} from './DashboardStatusController.js';

// WebSocket
export {
  DashboardStatusWebSocketHandler,
  dashboardStatusWebSocket,
} from './DashboardStatusWebSocket.js';

// Servlet
export { dashboardStatusRouter } from './DashboardStatusServlet.js';

/**
 * Plugin point name
 */
export const DASHBOARD_STATUS_PLUGIN_POINT = 'Dashboard Connector Status';

/**
 * Permission constants
 */
export const DASHBOARD_STATUS_PERMISSION_VIEW = 'View Dashboard Connector Status';
