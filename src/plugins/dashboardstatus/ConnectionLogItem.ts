/**
 * Connection Log Item
 *
 * Represents a single connection status log entry.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/dashboardstatus/ConnectionLogItem.java
 */

/**
 * Connection status event types
 */
export enum ConnectionStatusEventType {
  IDLE = 'IDLE',
  READING = 'READING',
  WRITING = 'WRITING',
  POLLING = 'POLLING',
  RECEIVING = 'RECEIVING',
  SENDING = 'SENDING',
  WAITING = 'WAITING',
  WAITING_FOR_RESPONSE = 'WAITING_FOR_RESPONSE',
  CONNECTED = 'CONNECTED',
  CONNECTING = 'CONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  INFO = 'INFO',
  FAILURE = 'FAILURE',
}

/**
 * Check if an event type represents a state (vs. a transient event)
 */
export function isStateEvent(eventType: ConnectionStatusEventType): boolean {
  switch (eventType) {
    case ConnectionStatusEventType.IDLE:
    case ConnectionStatusEventType.CONNECTED:
    case ConnectionStatusEventType.CONNECTING:
    case ConnectionStatusEventType.DISCONNECTED:
    case ConnectionStatusEventType.WAITING:
    case ConnectionStatusEventType.WAITING_FOR_RESPONSE:
      return true;
    default:
      return false;
  }
}

/**
 * Connection log item interface
 */
export interface ConnectionLogItem {
  /** Unique log ID */
  logId: number;
  /** Server ID that generated this log */
  serverId: string | null;
  /** Channel ID */
  channelId: string;
  /** Connector metadata ID (0 = source, 1+ = destinations) */
  metadataId: number;
  /** Timestamp when the log was created */
  dateAdded: string;
  /** Channel name */
  channelName: string;
  /** Connector type description */
  connectorType: string;
  /** Event state */
  eventState: ConnectionStatusEventType;
  /** Additional information */
  information: string;
}

/**
 * Serializable version for API responses
 */
export interface SerializableConnectionLogItem {
  logId: number;
  serverId: string | null;
  channelId: string;
  metadataId: number;
  dateAdded: string;
  channelName: string;
  connectorType: string;
  eventState: string;
  information: string;
}

/**
 * Create a connection log item
 */
export function createConnectionLogItem(
  logId: number,
  channelId: string,
  metadataId: number,
  eventState: ConnectionStatusEventType,
  information: string,
  options?: {
    serverId?: string;
    channelName?: string;
    connectorType?: string;
    dateAdded?: Date;
  }
): ConnectionLogItem {
  return {
    logId,
    serverId: options?.serverId ?? null,
    channelId,
    metadataId,
    dateAdded: formatDate(options?.dateAdded ?? new Date()),
    channelName: options?.channelName ?? '',
    connectorType: options?.connectorType ?? '',
    eventState,
    information,
  };
}

/**
 * Format date for log display
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * Serialize a connection log item for API response
 */
export function serializeConnectionLogItem(item: ConnectionLogItem): SerializableConnectionLogItem {
  return {
    logId: item.logId,
    serverId: item.serverId,
    channelId: item.channelId,
    metadataId: item.metadataId,
    dateAdded: item.dateAdded,
    channelName: item.channelName,
    connectorType: item.connectorType,
    eventState: item.eventState,
    information: item.information,
  };
}

/**
 * Parse event type from string
 */
export function parseConnectionStatusEventType(str: string): ConnectionStatusEventType {
  const upper = str.toUpperCase();
  if (upper in ConnectionStatusEventType) {
    return ConnectionStatusEventType[upper as keyof typeof ConnectionStatusEventType];
  }
  return ConnectionStatusEventType.INFO;
}
