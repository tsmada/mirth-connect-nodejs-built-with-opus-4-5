/**
 * Data Pruner Status
 *
 * Tracks the current state and progress of the data pruner.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datapruner/DataPrunerStatus.java
 */

export interface DataPrunerStatus {
  startTime: Date | null;
  endTime: Date | null;
  taskStartTime: Date | null;
  currentChannelId: string | null;
  currentChannelName: string | null;
  isArchiving: boolean;
  isPruning: boolean;
  isPruningEvents: boolean;
  pendingChannelIds: Set<string>;
  processedChannelIds: Set<string>;
  failedChannelIds: Set<string>;
}

/**
 * Create an empty data pruner status
 */
export function createDataPrunerStatus(): DataPrunerStatus {
  return {
    startTime: null,
    endTime: null,
    taskStartTime: null,
    currentChannelId: null,
    currentChannelName: null,
    isArchiving: false,
    isPruning: false,
    isPruningEvents: false,
    pendingChannelIds: new Set(),
    processedChannelIds: new Set(),
    failedChannelIds: new Set(),
  };
}

/**
 * Clone a data pruner status
 */
export function cloneDataPrunerStatus(status: DataPrunerStatus): DataPrunerStatus {
  return {
    ...status,
    pendingChannelIds: new Set(status.pendingChannelIds),
    processedChannelIds: new Set(status.processedChannelIds),
    failedChannelIds: new Set(status.failedChannelIds),
  };
}

/**
 * Result of a pruning operation for a single channel
 */
export interface PruneResult {
  numMessagesArchived: number;
  numMessagesPruned: number;
  numContentPruned: number;
}

/**
 * Create an empty prune result
 */
export function createPruneResult(): PruneResult {
  return {
    numMessagesArchived: 0,
    numMessagesPruned: 0,
    numContentPruned: 0,
  };
}

/**
 * Pruner task for a single channel
 */
export interface PrunerTask {
  channelId: string;
  channelName: string;
  messageDateThreshold: Date | null;
  contentDateThreshold: Date | null;
  archiveEnabled: boolean;
}

/**
 * Create a pruner task
 */
export function createPrunerTask(
  channelId: string,
  channelName: string,
  messageDateThreshold: Date | null,
  contentDateThreshold: Date | null,
  archiveEnabled: boolean
): PrunerTask {
  return {
    channelId,
    channelName,
    messageDateThreshold,
    contentDateThreshold,
    archiveEnabled,
  };
}
