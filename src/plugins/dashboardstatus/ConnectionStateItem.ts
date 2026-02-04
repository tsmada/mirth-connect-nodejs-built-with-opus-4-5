/**
 * Connection State Item
 *
 * Represents the current connection state of a connector.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/dashboardstatus/ConnectionStateItem.java
 */

import { ConnectionStatusEventType } from './ConnectionLogItem.js';

/**
 * Connection state item interface
 */
export interface ConnectionStateItem {
  /** Server ID */
  serverId: string;
  /** Channel ID */
  channelId: string;
  /** Connector metadata ID (0 = source, 1+ = destinations) */
  metadataId: string;
  /** Current connection status */
  status: ConnectionStatusEventType;
  /** Number of active connections */
  connectionCount: number;
  /** Maximum allowed connections */
  maxConnectionCount: number;
}

/**
 * Serializable version for API responses
 */
export interface SerializableConnectionStateItem {
  serverId: string;
  channelId: string;
  metadataId: string;
  status: string;
  connectionCount: number;
  maxConnectionCount: number;
}

/**
 * Create a connection state item
 */
export function createConnectionStateItem(
  serverId: string,
  channelId: string,
  metadataId: string | number,
  status: ConnectionStatusEventType,
  connectionCount: number = 0,
  maxConnectionCount: number = 0
): ConnectionStateItem {
  return {
    serverId,
    channelId,
    metadataId: String(metadataId),
    status,
    connectionCount,
    maxConnectionCount,
  };
}

/**
 * Serialize a connection state item for API response
 */
export function serializeConnectionStateItem(
  item: ConnectionStateItem
): SerializableConnectionStateItem {
  return {
    serverId: item.serverId,
    channelId: item.channelId,
    metadataId: item.metadataId,
    status: item.status,
    connectionCount: item.connectionCount,
    maxConnectionCount: item.maxConnectionCount,
  };
}

/**
 * Get state display color (hex color for UI)
 */
export function getStateColor(status: ConnectionStatusEventType): string {
  switch (status) {
    case ConnectionStatusEventType.IDLE:
      return '#808080'; // Gray
    case ConnectionStatusEventType.READING:
    case ConnectionStatusEventType.WRITING:
    case ConnectionStatusEventType.POLLING:
    case ConnectionStatusEventType.RECEIVING:
    case ConnectionStatusEventType.SENDING:
      return '#00FF00'; // Green (active)
    case ConnectionStatusEventType.WAITING:
      return '#FFFF00'; // Yellow
    case ConnectionStatusEventType.CONNECTED:
      return '#00FF00'; // Green
    case ConnectionStatusEventType.CONNECTING:
      return '#FFFF00'; // Yellow
    case ConnectionStatusEventType.DISCONNECTED:
      return '#FF0000'; // Red
    case ConnectionStatusEventType.INFO:
      return '#0000FF'; // Blue
    default:
      return '#808080'; // Gray
  }
}

/**
 * Format state display string with connection count
 */
export function formatStateDisplay(item: ConnectionStateItem): string {
  let display = item.status.toString();

  if (item.connectionCount > 0) {
    if (item.maxConnectionCount > 0 && item.connectionCount >= item.maxConnectionCount) {
      // At max connections - highlight in red
      display += ` <span style="color:red">(${item.connectionCount})</span>`;
    } else {
      display += ` (${item.connectionCount})`;
    }
  }

  return display;
}
