/**
 * Data Pruner
 *
 * Prunes old messages from the database based on retention policies.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datapruner/DataPruner.java
 */

import {
  DataPrunerStatus,
  PruneResult,
  PrunerTask,
  createDataPrunerStatus,
  cloneDataPrunerStatus,
  createPruneResult,
  createPrunerTask,
} from './DataPrunerStatus.js';
import * as DonkeyDao from '../../db/DonkeyDao.js';

/**
 * Default block sizes for pruning operations
 */
export const DEFAULT_PRUNING_BLOCK_SIZE = 1000;
export const DEFAULT_ARCHIVING_BLOCK_SIZE = 50;
const ID_RETRIEVE_LIMIT = 100000;

/**
 * Message statuses to skip during pruning
 */
export enum SkipStatus {
  ERROR = 'E',
  QUEUED = 'Q',
  PENDING = 'P',
}

/**
 * Data Pruner class
 */
export class DataPruner {
  private numExported: number = 0;
  private retryCount: number = 3;
  private skipIncomplete: boolean = true;
  private skipStatuses: SkipStatus[] = [SkipStatus.ERROR, SkipStatus.QUEUED, SkipStatus.PENDING];
  private prunerBlockSize: number = DEFAULT_PRUNING_BLOCK_SIZE;
  private archiveEnabled: boolean = false;
  private archiverBlockSize: number = DEFAULT_ARCHIVING_BLOCK_SIZE;
  private pruneEvents: boolean = false;
  private maxEventAge: number | null = null;

  private running: boolean = false;
  private status: DataPrunerStatus = createDataPrunerStatus();
  private lastStatus: DataPrunerStatus | null = null;
  private abortController: AbortController | null = null;

  // Getters and setters
  getNumExported(): number {
    return this.numExported;
  }

  setNumExported(value: number): void {
    this.numExported = value;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  setRetryCount(value: number): void {
    this.retryCount = value;
  }

  isSkipIncomplete(): boolean {
    return this.skipIncomplete;
  }

  setSkipIncomplete(value: boolean): void {
    this.skipIncomplete = value;
  }

  getSkipStatuses(): SkipStatus[] {
    return this.skipStatuses;
  }

  setSkipStatuses(value: SkipStatus[]): void {
    this.skipStatuses = value;
  }

  getPrunerBlockSize(): number {
    return this.prunerBlockSize;
  }

  setPrunerBlockSize(value: number): void {
    this.prunerBlockSize = value;
  }

  isArchiveEnabled(): boolean {
    return this.archiveEnabled;
  }

  setArchiveEnabled(value: boolean): void {
    this.archiveEnabled = value;
  }

  getArchiverBlockSize(): number {
    return this.archiverBlockSize;
  }

  setArchiverBlockSize(value: number): void {
    this.archiverBlockSize = value;
  }

  isPruneEvents(): boolean {
    return this.pruneEvents;
  }

  setPruneEvents(value: boolean): void {
    this.pruneEvents = value;
  }

  getMaxEventAge(): number | null {
    return this.maxEventAge;
  }

  setMaxEventAge(value: number | null): void {
    this.maxEventAge = value;
  }

  getPrunerStatus(): DataPrunerStatus {
    return this.status;
  }

  getLastPrunerStatus(): DataPrunerStatus | null {
    return this.lastStatus;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the pruning process
   */
  async start(): Promise<boolean> {
    if (this.running) {
      console.warn('The data pruner is already running');
      return false;
    }

    this.running = true;
    this.status = createDataPrunerStatus();
    this.status.startTime = new Date();
    this.abortController = new AbortController();

    console.log('Triggering data pruner task');

    // Run pruning asynchronously
    this.run().catch((error) => {
      console.error('Data pruner error:', error);
    });

    return true;
  }

  /**
   * Stop the pruning process
   */
  async stop(): Promise<void> {
    if (this.running && this.abortController) {
      console.log('Halting Data Pruner');
      this.abortController.abort();
      this.running = false;
    }
  }

  /**
   * Main pruning execution
   */
  private async run(): Promise<void> {
    try {
      console.log(`Executing pruner, started at ${new Date().toLocaleString()}`);

      // Prune events if enabled
      if (this.pruneEvents && this.maxEventAge !== null) {
        await this.pruneEventData();
      }

      // Build task queue
      const taskQueue = await this.buildTaskQueue();

      console.log(`Pruner task queue built, ${taskQueue.length} channels will be processed`);

      if (taskQueue.length === 0) {
        console.log('No messages to prune');
      }

      // Process each channel
      while (taskQueue.length > 0) {
        this.checkAborted();

        const task = taskQueue.shift()!;

        try {
          this.status.currentChannelId = task.channelId;
          this.status.currentChannelName = task.channelName;
          this.status.taskStartTime = new Date();

          const result = await this.pruneChannel(task);

          this.status.processedChannelIds.add(task.channelId);

          console.log(
            `Pruned channel ${task.channelName}: ` +
              `${result.numMessagesPruned} messages, ${result.numContentPruned} content rows`
          );
        } catch (error) {
          if (error instanceof AbortError) {
            throw error;
          }
          this.status.failedChannelIds.add(task.channelId);
          console.error(`Failed to prune messages for channel ${task.channelName}:`, error);
        } finally {
          this.status.pendingChannelIds.delete(task.channelId);
          this.status.currentChannelId = null;
          this.status.currentChannelName = null;
        }
      }

      console.log('Pruner job finished executing');
    } catch (error) {
      if (error instanceof AbortError) {
        console.log('Data Pruner halted');
      } else {
        console.error('An error occurred while executing the data pruner:', error);
      }
    } finally {
      this.status.endTime = new Date();
      this.lastStatus = cloneDataPrunerStatus(this.status);
      this.running = false;
    }
  }

  /**
   * Check if pruning was aborted
   */
  private checkAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new AbortError();
    }
  }

  /**
   * Build the task queue from channel configurations
   */
  private async buildTaskQueue(): Promise<PrunerTask[]> {
    const tasks: PrunerTask[] = [];

    // Get all channel IDs that have message tables
    const localChannelIds = await DonkeyDao.getLocalChannelIds();

    for (const [channelId] of localChannelIds) {
      // Get channel metadata (would normally come from ConfigurationController)
      // For now, use default retention policies
      const pruneMetaDataDays = 30; // Default: 30 days for metadata
      const pruneContentDays = 7; // Default: 7 days for content

      let messageDateThreshold: Date | null = null;
      let contentDateThreshold: Date | null = null;

      if (pruneMetaDataDays !== null) {
        messageDateThreshold = new Date();
        messageDateThreshold.setDate(messageDateThreshold.getDate() - pruneMetaDataDays);
      }

      if (pruneContentDays !== null) {
        contentDateThreshold = new Date();
        contentDateThreshold.setDate(contentDateThreshold.getDate() - pruneContentDays);
      }

      if (messageDateThreshold || contentDateThreshold) {
        tasks.push(
          createPrunerTask(
            channelId,
            `Channel ${channelId.substring(0, 8)}...`,
            messageDateThreshold,
            contentDateThreshold,
            false // archiveEnabled
          )
        );
        this.status.pendingChannelIds.add(channelId);
      }
    }

    return tasks;
  }

  /**
   * Prune messages for a single channel
   */
  private async pruneChannel(task: PrunerTask): Promise<PruneResult> {
    console.log(`Executing pruner for channel: ${task.channelId}`);

    if (!task.messageDateThreshold && !task.contentDateThreshold) {
      return createPruneResult();
    }

    // If content threshold is earlier than message threshold, use message threshold only
    let contentDateThreshold = task.contentDateThreshold;
    if (
      task.messageDateThreshold &&
      contentDateThreshold &&
      contentDateThreshold.getTime() <= task.messageDateThreshold.getTime()
    ) {
      contentDateThreshold = null;
    }

    const result = createPruneResult();
    let retries = this.retryCount;

    while (true) {
      this.checkAborted();

      try {
        // Check if channel tables exist
        const tablesExist = await DonkeyDao.channelTablesExist(task.channelId);
        if (!tablesExist) {
          console.warn(`No message tables found for ${task.channelId}`);
          return result;
        }

        // Get message IDs to prune
        const threshold = contentDateThreshold ?? task.messageDateThreshold;
        const messageIds = await this.getMessageIdsToPrune(
          task.channelId,
          threshold!,
          this.skipStatuses
        );

        if (messageIds.length === 0) {
          console.log(`No messages to prune for channel ${task.channelId}`);
          return result;
        }

        // Prune in batches
        for (let i = 0; i < messageIds.length; i += this.prunerBlockSize) {
          this.checkAborted();

          const batch = messageIds.slice(i, i + this.prunerBlockSize);
          const batchResult = await this.pruneMessageBatch(
            task.channelId,
            batch,
            contentDateThreshold !== null && task.messageDateThreshold !== null
          );

          result.numMessagesPruned += batchResult.numMessagesPruned;
          result.numContentPruned += batchResult.numContentPruned;

          this.status.isPruning = true;
        }

        this.status.isPruning = false;
        return result;
      } catch (error) {
        if (error instanceof AbortError) {
          throw error;
        }

        if (retries > 0) {
          console.warn(
            `Failed to prune messages for channel ${task.channelName}. Retries remaining: ${retries}`
          );
          retries--;
        } else {
          throw new Error(`Failed to prune messages after ${this.retryCount} retries: ${error}`);
        }
      }
    }
  }

  /**
   * Get message IDs to prune based on date threshold
   */
  private async getMessageIdsToPrune(
    channelId: string,
    dateThreshold: Date,
    skipStatuses: SkipStatus[]
  ): Promise<number[]> {
    try {
      const messages = await DonkeyDao.getMessagesToPrune(
        channelId,
        dateThreshold,
        ID_RETRIEVE_LIMIT,
        skipStatuses
      );
      return messages.map((m) => m.messageId);
    } catch (error) {
      console.error('Failed to get messages to prune:', error);
      return [];
    }
  }

  /**
   * Prune a batch of messages
   */
  private async pruneMessageBatch(
    channelId: string,
    messageIds: number[],
    contentOnly: boolean
  ): Promise<PruneResult> {
    const result = createPruneResult();

    if (messageIds.length === 0) {
      return result;
    }

    try {
      if (contentOnly) {
        // Only prune content, not metadata
        result.numContentPruned = await DonkeyDao.pruneMessageContent(channelId, messageIds);
      } else {
        // Prune full messages (content, attachments, connector messages, and messages)
        result.numMessagesPruned = await DonkeyDao.pruneMessages(channelId, messageIds);
        // pruneMessages handles content deletion internally
        result.numContentPruned = messageIds.length; // Approximate
      }
    } catch (error) {
      console.error('Failed to prune message batch:', error);
    }

    return result;
  }

  /**
   * Prune old events
   */
  private async pruneEventData(): Promise<void> {
    console.log('Pruning events');
    this.status.isPruningEvents = true;

    try {
      this.status.taskStartTime = new Date();

      if (this.maxEventAge === null) {
        return;
      }

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - this.maxEventAge);

      // Prune events older than threshold
      // This would be implemented in MirthDao
      console.log(`Would prune events older than ${dateThreshold.toISOString()}`);
    } finally {
      this.status.isPruningEvents = false;
    }
  }

  /**
   * Get elapsed time string
   */
  getTimeElapsed(): string {
    if (!this.status.taskStartTime) {
      return '0 minutes';
    }

    const ms = Date.now() - this.status.taskStartTime.getTime();
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);

    return `${mins} minute${mins === 1 ? '' : 's'}, ${secs} second${secs === 1 ? '' : 's'}`;
  }
}

/**
 * Error thrown when pruning is aborted
 */
class AbortError extends Error {
  constructor() {
    super('Pruning aborted');
    this.name = 'AbortError';
  }
}

/**
 * Singleton data pruner instance
 */
export const dataPruner = new DataPruner();
