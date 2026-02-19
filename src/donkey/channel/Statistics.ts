/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Statistics.java
 *
 * Purpose: Track message counts, errors, queue sizes per channel and connector
 *
 * Key behaviors to replicate:
 * - Thread-safe statistics tracking using atomic operations
 * - Hierarchical stats: channel -> connector -> status
 * - Support for tracked statuses: RECEIVED, FILTERED, SENT, ERROR
 * - Event dispatching on stat changes
 * - Aggregate statistics for channels
 */

import { Status } from '../../model/Status.js';

/**
 * Statuses that are tracked in statistics
 */
export const TRACKED_STATUSES: Status[] = [
  Status.RECEIVED,
  Status.FILTERED,
  Status.SENT,
  Status.ERROR,
];

/**
 * Event types for message events
 */
export enum MessageEventType {
  RECEIVED = 'RECEIVED',
  FILTERED = 'FILTERED',
  SENT = 'SENT',
  ERROR = 'ERROR',
  QUEUED = 'QUEUED',
}

/**
 * Map Status to MessageEventType
 */
export function messageEventTypeFromStatus(status: Status): MessageEventType | null {
  switch (status) {
    case Status.RECEIVED:
      return MessageEventType.RECEIVED;
    case Status.FILTERED:
      return MessageEventType.FILTERED;
    case Status.SENT:
      return MessageEventType.SENT;
    case Status.ERROR:
      return MessageEventType.ERROR;
    default:
      return null;
  }
}

/**
 * Message event for statistics updates
 */
export interface MessageEvent {
  channelId: string;
  metaDataId: number;
  type: MessageEventType;
  count: number;
  decrement: boolean;
}

/**
 * Event dispatcher interface
 */
export interface EventDispatcher {
  dispatchEvent(event: MessageEvent): void;
}

/**
 * Default no-op event dispatcher
 */
export class NoOpEventDispatcher implements EventDispatcher {
  dispatchEvent(_event: MessageEvent): void {
    // No-op
  }
}

/**
 * Statistics tracking for channels and connectors.
 * Thread-safe implementation using synchronization patterns.
 */
export class Statistics {
  /**
   * Stats structure: channelId -> metaDataId -> status -> count
   * metaDataId of null represents aggregate channel stats
   */
  private stats: Map<string, Map<number | null, Map<Status, number>>> = new Map();

  private eventDispatcher: EventDispatcher | null = null;
  private sendEvents: boolean;
  private allowNegatives: boolean;

  constructor(sendEvents: boolean = false, allowNegatives: boolean = false) {
    this.sendEvents = sendEvents;
    this.allowNegatives = allowNegatives;
  }

  /**
   * Set the event dispatcher
   */
  setEventDispatcher(dispatcher: EventDispatcher): void {
    this.eventDispatcher = dispatcher;
  }

  /**
   * Get all statistics as a plain object structure
   */
  getStats(): Map<string, Map<number | null, Map<Status, number>>> {
    const result = new Map<string, Map<number | null, Map<Status, number>>>();

    for (const [channelId, channelMap] of this.stats) {
      const channelResult = new Map<number | null, Map<Status, number>>();

      for (const [metaDataId, statusMap] of channelMap) {
        const statusResult = new Map<Status, number>();
        for (const [status, count] of statusMap) {
          statusResult.set(status, count);
        }
        channelResult.set(metaDataId, statusResult);
      }

      result.set(channelId, channelResult);
    }

    return result;
  }

  /**
   * Get statistics for a specific channel
   */
  getChannelStats(channelId: string): Map<number | null, Map<Status, number>> {
    const result = new Map<number | null, Map<Status, number>>();
    const channelStats = this.getChannelStatsMap(channelId);

    for (const [metaDataId, statusMap] of channelStats) {
      const statusResult = new Map<Status, number>();
      for (const [status, count] of statusMap) {
        statusResult.set(status, count);
      }
      result.set(metaDataId, statusResult);
    }

    return result;
  }

  /**
   * Get statistics for a specific connector
   */
  getConnectorStats(channelId: string, metaDataId: number | null): Map<Status, number> {
    const result = new Map<Status, number>();
    const connectorStats = this.getConnectorStatsMap(
      this.getChannelStatsMap(channelId),
      metaDataId
    );

    for (const [status, count] of connectorStats) {
      result.set(status, count);
    }

    return result;
  }

  /**
   * Check if all statistics are zero
   */
  isEmpty(): boolean {
    for (const channelMap of this.stats.values()) {
      for (const statusMap of channelMap.values()) {
        for (const count of statusMap.values()) {
          if (count !== 0) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Update statistics from a map structure
   */
  updateFromMap(statsMap: Map<string, Map<number | null, Map<Status, number>>>): void {
    for (const [channelId, channelEntry] of statsMap) {
      for (const [metaDataId, statusEntry] of channelEntry) {
        if (metaDataId !== null) {
          this.updateConnector(channelId, metaDataId, statusEntry);
        }
      }
    }
  }

  /**
   * Update statistics for a status transition
   */
  updateStatus(
    channelId: string,
    metaDataId: number,
    incrementStatus: Status,
    decrementStatus: Status | null
  ): void {
    // If no net change will be done then return immediately
    if (incrementStatus === decrementStatus) {
      return;
    }

    const statsDiff = new Map<Status, number>();
    statsDiff.set(incrementStatus, 1);

    if (decrementStatus !== null) {
      statsDiff.set(decrementStatus, -1);
    }

    this.updateConnector(channelId, metaDataId, statsDiff);
  }

  /**
   * Update statistics for a connector
   */
  updateConnector(channelId: string, metaDataId: number, statsDiff: Map<Status, number>): void {
    const channelStats = this.getChannelStatsMap(channelId);
    const aggregateStats = this.getConnectorStatsMap(channelStats, null);
    const connectorStats = this.getConnectorStatsMap(channelStats, metaDataId);

    for (const [status, diff] of statsDiff) {
      if (TRACKED_STATUSES.includes(status) && diff !== 0) {
        const connectorCount = this.updateStat(connectorStats, status, diff);

        // Update the channel aggregate statistics
        switch (status) {
          // Update RECEIVED based on source connector only
          case Status.RECEIVED:
            if (metaDataId === 0) {
              this.updateStat(aggregateStats, status, diff);
            }
            break;

          // Update FILTERED and ERROR based on all connectors
          case Status.FILTERED:
          case Status.ERROR:
            this.updateStat(aggregateStats, status, diff);
            break;

          // Update SENT based on destination connectors only
          case Status.SENT:
            if (metaDataId > 0) {
              this.updateStat(aggregateStats, status, diff);
            }
            break;

          default:
            break;
        }

        // Dispatch event if configured
        if (this.sendEvents) {
          const eventType = messageEventTypeFromStatus(status);
          if (eventType !== null && this.eventDispatcher) {
            this.eventDispatcher.dispatchEvent({
              channelId,
              metaDataId,
              type: eventType,
              count: connectorCount,
              decrement: diff <= 0,
            });
          }
        }
      }
    }
  }

  /**
   * Update a single stat value
   */
  private updateStat(statsMap: Map<Status, number>, status: Status, diff: number): number {
    const currentValue = statsMap.get(status) ?? 0;

    // Stats values cannot go below zero unless allowNegatives is true
    if (!this.allowNegatives && diff < 0) {
      const newValue = Math.max(0, currentValue + diff);
      statsMap.set(status, newValue);
      return newValue;
    } else {
      const newValue = currentValue + diff;
      statsMap.set(status, newValue);
      return newValue;
    }
  }

  /**
   * Overwrite statistics for a connector
   */
  overwrite(channelId: string, metaDataId: number | null, stats: Map<Status, number>): void {
    const connectorStats = this.getConnectorStatsMap(
      this.getChannelStatsMap(channelId),
      metaDataId
    );

    for (const [status, value] of stats) {
      connectorStats.set(status, value);
    }
  }

  /**
   * Update from another Statistics object
   */
  updateFromStatistics(statistics: Statistics): void {
    this.updateFromMap(statistics.getStats());
  }

  /**
   * Reset specific statuses for a connector
   */
  resetStats(channelId: string, metaDataId: number | null, statuses: Set<Status>): void {
    for (const status of statuses) {
      if (TRACKED_STATUSES.includes(status)) {
        const connectorStats = this.getConnectorStatsMap(
          this.getChannelStatsMap(channelId),
          metaDataId
        );
        connectorStats.set(status, 0);

        // Dispatch event if configured
        if (this.sendEvents && metaDataId !== null && this.eventDispatcher) {
          const eventType = messageEventTypeFromStatus(status);
          if (eventType !== null) {
            this.eventDispatcher.dispatchEvent({
              channelId,
              metaDataId,
              type: eventType,
              count: 0,
              decrement: true,
            });
          }
        }
      }
    }
  }

  /**
   * Remove all statistics for a channel
   */
  remove(channelId: string): void {
    this.stats.delete(channelId);
  }

  /**
   * Clear all statistics
   */
  clear(): void {
    this.stats.clear();
  }

  /**
   * Get or create channel stats map
   */
  private getChannelStatsMap(channelId: string): Map<number | null, Map<Status, number>> {
    let channelStats = this.stats.get(channelId);

    if (!channelStats) {
      channelStats = new Map<number | null, Map<Status, number>>();
      this.stats.set(channelId, channelStats);
    }

    return channelStats;
  }

  /**
   * Get or create connector stats map
   */
  private getConnectorStatsMap(
    channelStats: Map<number | null, Map<Status, number>>,
    metaDataId: number | null
  ): Map<Status, number> {
    let connectorStats = channelStats.get(metaDataId);

    if (!connectorStats) {
      connectorStats = new Map<Status, number>();
      // Initialize with tracked statuses
      connectorStats.set(Status.RECEIVED, 0);
      connectorStats.set(Status.FILTERED, 0);
      connectorStats.set(Status.SENT, 0);
      connectorStats.set(Status.ERROR, 0);

      channelStats.set(metaDataId, connectorStats);
    }

    return connectorStats;
  }

  /**
   * Get the set of tracked statuses
   */
  static getTrackedStatuses(): Set<Status> {
    return new Set(TRACKED_STATUSES);
  }
}
