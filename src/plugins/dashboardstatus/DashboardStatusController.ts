/**
 * Dashboard Status Controller
 *
 * Manages connector connection status and logs.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/dashboardstatus/DefaultConnectionLogController.java
 *
 * Key behaviors:
 * - Track connection state for each connector
 * - Maintain connection count with max limits
 * - Circular buffer of connection log entries per channel
 * - Event-driven updates for real-time monitoring
 */

import { EventEmitter } from 'events';
import {
  ConnectionLogItem,
  ConnectionStatusEventType,
  createConnectionLogItem,
  serializeConnectionLogItem,
  SerializableConnectionLogItem,
  isStateEvent,
} from './ConnectionLogItem.js';
import {
  ConnectionStateItem,
  createConnectionStateItem,
  serializeConnectionStateItem,
  SerializableConnectionStateItem,
  getStateColor,
} from './ConnectionStateItem.js';

/**
 * Maximum log entries per channel
 */
const MAX_LOG_SIZE = 1000;

/**
 * Dashboard status events
 */
export interface DashboardStatusEvents {
  connectionLog: (item: ConnectionLogItem) => void;
  stateChange: (connectorId: string, state: ConnectionStateItem) => void;
}

/**
 * Connection status event for processing
 */
export interface ConnectionStatusEvent {
  channelId: string;
  metadataId: number;
  state: ConnectionStatusEventType;
  message?: string;
  channelName?: string;
  connectorType?: string;
}

/**
 * Connector count event (extends ConnectionStatusEvent)
 */
export interface ConnectorCountEvent extends ConnectionStatusEvent {
  increment?: boolean;
  maximum?: number;
}

/**
 * Dashboard Status Controller
 */
export class DashboardStatusController extends EventEmitter {
  private serverId: string = '';
  private nextLogId: number = 1;

  /** State map: connectorId (channelId_metadataId) -> [color, stateString] */
  private connectorStateMap: Map<string, [string, string]> = new Map();

  /** State type map: connectorId -> ConnectionStatusEventType */
  private connectorStateTypeMap: Map<string, ConnectionStatusEventType> = new Map();

  /** Connection count map: connectorId -> count */
  private connectorCountMap: Map<string, number> = new Map();

  /** Max connection map: connectorId -> max */
  private maxConnectionMap: Map<string, number> = new Map();

  /** Log entries per channel */
  private connectorInfoLogs: Map<string, ConnectionLogItem[]> = new Map();

  /** All log entries (across all channels) */
  private entireConnectorInfoLogs: ConnectionLogItem[] = [];

  constructor() {
    super();
  }

  /**
   * Set the server ID
   */
  setServerId(serverId: string): void {
    this.serverId = serverId;
  }

  /**
   * Get the server ID
   */
  getServerId(): string {
    return this.serverId;
  }

  /**
   * Process a connection status event
   */
  processEvent(event: ConnectionStatusEvent | ConnectorCountEvent): void {
    const { channelId, metadataId, message, channelName, connectorType } = event;
    const connectorId = `${channelId}_${metadataId}`;
    const timestamp = new Date();

    let eventType = event.state;
    let connectorCount: number | null = null;
    let maximum: number | null = null;

    // Handle connector count events
    if ('increment' in event || 'maximum' in event) {
      const countEvent = event as ConnectorCountEvent;

      if (countEvent.maximum !== undefined) {
        this.maxConnectionMap.set(connectorId, countEvent.maximum);
        maximum = countEvent.maximum;
      } else {
        maximum = this.maxConnectionMap.get(connectorId) ?? null;
      }

      let count = this.connectorCountMap.get(connectorId) ?? 0;

      if (countEvent.increment !== undefined) {
        if (countEvent.increment) {
          count++;
        } else {
          count = Math.max(0, count - 1);
        }
        this.connectorCountMap.set(connectorId, count);
      }

      connectorCount = count;

      // Update event type based on count
      if (connectorCount === 0) {
        eventType = ConnectionStatusEventType.IDLE;
      } else {
        eventType = ConnectionStatusEventType.CONNECTED;
      }
    }

    // Build state string
    let stateString: string | null = null;
    if (isStateEvent(eventType)) {
      const color = getStateColor(eventType);
      stateString = eventType.toString();

      if (connectorCount !== null && connectorCount > 0) {
        if (maximum !== null && connectorCount >= maximum) {
          stateString += ` <span style="color:red">(${connectorCount})</span>`;
        } else {
          stateString += ` (${connectorCount})`;
        }
      }

      this.connectorStateMap.set(connectorId, [color, stateString]);
      this.connectorStateTypeMap.set(connectorId, eventType);
    }

    // Create log entry
    const logItem = createConnectionLogItem(this.nextLogId++, channelId, metadataId, eventType, message ?? '', {
      serverId: this.serverId,
      channelName: channelName ?? '',
      connectorType: connectorType ?? '',
      dateAdded: timestamp,
    });

    // Add to channel-specific log
    let channelLog = this.connectorInfoLogs.get(channelId);
    if (!channelLog) {
      channelLog = [];
      this.connectorInfoLogs.set(channelId, channelLog);
    }

    // Add to front (most recent first)
    channelLog.unshift(logItem);
    if (channelLog.length > MAX_LOG_SIZE) {
      channelLog.pop();
    }

    // Add to global log
    this.entireConnectorInfoLogs.unshift(logItem);
    if (this.entireConnectorInfoLogs.length > MAX_LOG_SIZE) {
      this.entireConnectorInfoLogs.pop();
    }

    // Emit events
    this.emit('connectionLog', logItem);

    if (isStateEvent(eventType)) {
      const stateItem = this.getConnectorState(channelId, metadataId);
      if (stateItem) {
        this.emit('stateChange', connectorId, stateItem);
      }
    }
  }

  /**
   * Get connection log for a channel
   */
  getChannelLog(
    channelId: string | null,
    fetchSize: number = MAX_LOG_SIZE,
    lastLogId?: number | null
  ): ConnectionLogItem[] {
    let sourceLog: ConnectionLogItem[];

    if (channelId === null) {
      // Return all logs
      sourceLog = this.entireConnectorInfoLogs;
    } else {
      // Return channel-specific logs
      sourceLog = this.connectorInfoLogs.get(channelId) ?? [];
    }

    // Filter by lastLogId
    const result: ConnectionLogItem[] = [];
    for (const item of sourceLog) {
      if (lastLogId !== undefined && lastLogId !== null && item.logId <= lastLogId) {
        continue;
      }
      result.push(item);
      if (result.length >= fetchSize) {
        break;
      }
    }

    return result;
  }

  /**
   * Get serializable channel log for API response
   */
  getSerializableChannelLog(
    channelId: string | null,
    fetchSize: number = MAX_LOG_SIZE,
    lastLogId?: number | null
  ): SerializableConnectionLogItem[] {
    return this.getChannelLog(channelId, fetchSize, lastLogId).map(serializeConnectionLogItem);
  }

  /**
   * Get connector state map (raw format)
   */
  getConnectorStateMap(): Map<string, [string, string]> {
    return new Map(this.connectorStateMap);
  }

  /**
   * Get connector state map as object for API response
   */
  getConnectorStateMapForApi(): Record<string, { color: string; state: string }> {
    const result: Record<string, { color: string; state: string }> = {};
    for (const [connectorId, [color, state]] of this.connectorStateMap) {
      result[connectorId] = { color, state };
    }
    return result;
  }

  /**
   * Get state for a specific connector
   */
  getConnectorState(channelId: string, metadataId: number): ConnectionStateItem | null {
    const connectorId = `${channelId}_${metadataId}`;
    const status = this.connectorStateTypeMap.get(connectorId);

    if (!status) {
      return null;
    }

    return createConnectionStateItem(
      this.serverId,
      channelId,
      metadataId.toString(),
      status,
      this.connectorCountMap.get(connectorId) ?? 0,
      this.maxConnectionMap.get(connectorId) ?? 0
    );
  }

  /**
   * Get all connection states for all channels
   */
  getConnectionStates(): Map<string, ConnectionStateItem[]> {
    const result = new Map<string, ConnectionStateItem[]>();

    for (const connectorId of this.connectorStateMap.keys()) {
      const parts = connectorId.split('_');
      const channelId = parts.slice(0, -1).join('_');
      const metadataId = parseInt(parts[parts.length - 1]!, 10);

      const state = this.getConnectorState(channelId, metadataId);
      if (state) {
        let channelStates = result.get(channelId);
        if (!channelStates) {
          channelStates = [];
          result.set(channelId, channelStates);
        }
        channelStates.push(state);
      }
    }

    return result;
  }

  /**
   * Get connection states for API response
   */
  getConnectionStatesForApi(): Record<string, SerializableConnectionStateItem[]> {
    const states = this.getConnectionStates();
    const result: Record<string, SerializableConnectionStateItem[]> = {};

    for (const [channelId, items] of states) {
      result[channelId] = items.map(serializeConnectionStateItem);
    }

    return result;
  }

  /**
   * Clear logs for a channel
   */
  clearChannelLog(channelId: string): void {
    this.connectorInfoLogs.delete(channelId);
  }

  /**
   * Clear all logs
   */
  clearAllLogs(): void {
    this.connectorInfoLogs.clear();
    this.entireConnectorInfoLogs = [];
  }

  /**
   * Reset state for a connector
   */
  resetConnectorState(channelId: string, metadataId: number): void {
    const connectorId = `${channelId}_${metadataId}`;
    this.connectorStateMap.delete(connectorId);
    this.connectorStateTypeMap.delete(connectorId);
    this.connectorCountMap.delete(connectorId);
    this.maxConnectionMap.delete(connectorId);
  }

  /**
   * Reset all state for a channel
   */
  resetChannelState(channelId: string): void {
    for (const connectorId of Array.from(this.connectorStateMap.keys())) {
      if (connectorId.startsWith(`${channelId}_`)) {
        this.connectorStateMap.delete(connectorId);
        this.connectorStateTypeMap.delete(connectorId);
        this.connectorCountMap.delete(connectorId);
        this.maxConnectionMap.delete(connectorId);
      }
    }
    this.connectorInfoLogs.delete(channelId);
  }

  /**
   * Add listener for connection log events
   */
  onConnectionLog(listener: (item: ConnectionLogItem) => void): void {
    this.on('connectionLog', listener);
  }

  /**
   * Remove connection log listener
   */
  offConnectionLog(listener: (item: ConnectionLogItem) => void): void {
    this.off('connectionLog', listener);
  }

  /**
   * Add listener for state change events
   */
  onStateChange(listener: (connectorId: string, state: ConnectionStateItem) => void): void {
    this.on('stateChange', listener);
  }

  /**
   * Remove state change listener
   */
  offStateChange(listener: (connectorId: string, state: ConnectionStateItem) => void): void {
    this.off('stateChange', listener);
  }

  /**
   * Get statistics about the controller
   */
  getStats(): {
    totalLogs: number;
    channelCount: number;
    connectorCount: number;
  } {
    return {
      totalLogs: this.entireConnectorInfoLogs.length,
      channelCount: this.connectorInfoLogs.size,
      connectorCount: this.connectorStateMap.size,
    };
  }
}

/**
 * Singleton dashboard status controller instance
 */
export const dashboardStatusController = new DashboardStatusController();
