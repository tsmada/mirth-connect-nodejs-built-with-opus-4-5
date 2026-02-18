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
import type { MessageRow, ConnectorMessageRow, ContentRow, AttachmentRow } from '../../db/DonkeyDao.js';
import { ConfigurationController } from '../../controllers/ConfigurationController.js';
import { ChannelController } from '../../controllers/ChannelController.js';
import { MessageStorageMode, parseMessageStorageMode } from '../../donkey/channel/StorageSettings.js';
import * as EventDao from '../../db/EventDao.js';
import {
  messageArchiver,
  type ArchiveMessage,
  type ArchiveConnectorMessage,
  type ArchiveContent,
  type MessageWriterOptions,
} from './MessageArchiver.js';
import { ContentType } from '../../model/ContentType.js';
import { messagesPruned } from '../../telemetry/metrics.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('data-pruner', 'Pruning engine');
const logger = getLogger('data-pruner');

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
 * Find a content row matching the given metadata ID and content type,
 * and convert it to an ArchiveContent object.
 */
function findContent(
  contentRows: ContentRow[],
  metaDataId: number,
  contentType: ContentType
): ArchiveContent | undefined {
  const row = contentRows.find(
    (r) => r.METADATA_ID === metaDataId && r.CONTENT_TYPE === contentType
  );
  if (!row) return undefined;
  return {
    contentType: row.DATA_TYPE ?? 'text/plain',
    content: row.CONTENT ?? '',
    encrypted: row.IS_ENCRYPTED === 1,
  };
}

/**
 * Find a content row's string content for map types.
 */
function findContentString(
  contentRows: ContentRow[],
  metaDataId: number,
  contentType: ContentType
): string | undefined {
  const row = contentRows.find(
    (r) => r.METADATA_ID === metaDataId && r.CONTENT_TYPE === contentType
  );
  return row?.CONTENT ?? undefined;
}

/**
 * Build an ArchiveMessage from raw DAO rows.
 * Exported for testability.
 */
export function buildArchiveMessage(
  channelId: string,
  channelName: string,
  messageRow: MessageRow,
  connectorRows: ConnectorMessageRow[],
  contentRows: ContentRow[],
  attachmentRows: AttachmentRow[]
): ArchiveMessage {
  const connectorMessages: ArchiveConnectorMessage[] = connectorRows.map((cm) => ({
    metaDataId: cm.METADATA_ID,
    channelId,
    channelName,
    connectorName: cm.CONNECTOR_NAME ?? '',
    serverId: messageRow.SERVER_ID,
    receivedDate: cm.RECEIVED_DATE,
    status: cm.STATUS,
    sendAttempts: cm.SEND_ATTEMPTS,
    sendDate: cm.SEND_DATE ?? undefined,
    responseDate: cm.RESPONSE_DATE ?? undefined,
    errorCode: cm.ERROR_CODE ?? undefined,
    raw: findContent(contentRows, cm.METADATA_ID, ContentType.RAW),
    processedRaw: findContent(contentRows, cm.METADATA_ID, ContentType.PROCESSED_RAW),
    transformed: findContent(contentRows, cm.METADATA_ID, ContentType.TRANSFORMED),
    encoded: findContent(contentRows, cm.METADATA_ID, ContentType.ENCODED),
    sent: findContent(contentRows, cm.METADATA_ID, ContentType.SENT),
    response: findContent(contentRows, cm.METADATA_ID, ContentType.RESPONSE),
    responseTransformed: findContent(contentRows, cm.METADATA_ID, ContentType.RESPONSE_TRANSFORMED),
    processedResponse: findContent(contentRows, cm.METADATA_ID, ContentType.PROCESSED_RESPONSE),
    sourceMapContent: findContentString(contentRows, cm.METADATA_ID, ContentType.SOURCE_MAP),
    connectorMapContent: findContentString(contentRows, cm.METADATA_ID, ContentType.CONNECTOR_MAP),
    channelMapContent: findContentString(contentRows, cm.METADATA_ID, ContentType.CHANNEL_MAP),
    responseMapContent: findContentString(contentRows, cm.METADATA_ID, ContentType.RESPONSE_MAP),
    errors: findContentString(contentRows, cm.METADATA_ID, ContentType.PROCESSING_ERROR),
  }));

  return {
    messageId: messageRow.ID,
    serverId: messageRow.SERVER_ID,
    channelId,
    receivedDate: messageRow.RECEIVED_DATE,
    processed: messageRow.PROCESSED === 1,
    originalId: messageRow.ORIGINAL_ID ?? undefined,
    importId: messageRow.IMPORT_ID ?? undefined,
    importChannelId: messageRow.IMPORT_CHANNEL_ID ?? undefined,
    connectorMessages,
    attachments: attachmentRows
      .filter((a) => a.MESSAGE_ID === messageRow.ID)
      .map((a) => ({
        id: a.ID,
        type: a.TYPE ?? 'application/octet-stream',
        content: a.ATTACHMENT?.toString('base64') ?? '',
      })),
  };
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
  private archiverOptions: MessageWriterOptions | null = null;

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

  getArchiverOptions(): MessageWriterOptions | null {
    return this.archiverOptions;
  }

  setArchiverOptions(value: MessageWriterOptions | null): void {
    this.archiverOptions = value;
    if (value) {
      messageArchiver.setOptions(value);
    }
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
      logger.warn('The data pruner is already running');
      return false;
    }

    this.running = true;
    this.status = createDataPrunerStatus();
    this.status.startTime = new Date();
    this.abortController = new AbortController();

    logger.info('Triggering data pruner task');

    // Run pruning asynchronously
    this.run().catch((error) => {
      logger.error('Data pruner error', error as Error);
    });

    return true;
  }

  /**
   * Stop the pruning process
   */
  async stop(): Promise<void> {
    if (this.running && this.abortController) {
      logger.info('Halting Data Pruner');
      this.abortController.abort();
      this.running = false;
    }
  }

  /**
   * Main pruning execution
   */
  private async run(): Promise<void> {
    try {
      logger.info(`Executing pruner, started at ${new Date().toLocaleString()}`);

      // Prune events if enabled
      if (this.pruneEvents && this.maxEventAge !== null) {
        await this.pruneEventData();
      }

      // Build task queue
      const taskQueue = await this.buildTaskQueue();

      logger.info(`Pruner task queue built, ${taskQueue.length} channels will be processed`);

      if (taskQueue.length === 0) {
        logger.info('No messages to prune');
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
          if (result.numMessagesPruned > 0) {
            messagesPruned.add(result.numMessagesPruned, { 'channel.name': task.channelName });
          }

          logger.info(
            `Pruned channel ${task.channelName}: ` +
              `${result.numMessagesArchived} archived, ` +
              `${result.numMessagesPruned} messages, ${result.numContentPruned} content rows`
          );
        } catch (error) {
          if (error instanceof AbortError) {
            throw error;
          }
          this.status.failedChannelIds.add(task.channelId);
          logger.error(`Failed to prune messages for channel ${task.channelName}:`, error as Error);
        } finally {
          this.status.pendingChannelIds.delete(task.channelId);
          this.status.currentChannelId = null;
          this.status.currentChannelName = null;
        }
      }

      logger.info('Pruner job finished executing');
    } catch (error) {
      if (error instanceof AbortError) {
        logger.info('Data Pruner halted');
      } else {
        logger.error('An error occurred while executing the data pruner', error as Error);
      }
    } finally {
      // Finalize archiver (close any open file handles)
      try {
        await messageArchiver.finalize();
      } catch (err) {
        logger.error('Failed to finalize message archiver', err as Error);
      }
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
   * Build the task queue from channel configurations.
   *
   * Per-channel pruning settings are read from ConfigurationController.getChannelMetadata().
   * Channels without explicit settings are skipped (matches Java Mirth behavior).
   * Channels with messageStorageMode=DISABLED are skipped (no messages to prune).
   */
  private async buildTaskQueue(): Promise<PrunerTask[]> {
    const tasks: PrunerTask[] = [];

    // Get all channel IDs that have message tables
    const localChannelIds = await DonkeyDao.getLocalChannelIds();

    // Load per-channel metadata (pruning settings) and channel names
    const [channelMetadata, channelNames, allChannels] = await Promise.all([
      ConfigurationController.getChannelMetadata(),
      ChannelController.getChannelIdsAndNames(),
      ChannelController.getAllChannels(),
    ]);

    // Build a map of channelId -> messageStorageMode for skipping DISABLED channels
    const storageModes = new Map<string, MessageStorageMode>();
    for (const channel of allChannels) {
      storageModes.set(
        channel.id,
        parseMessageStorageMode(channel.properties?.messageStorageMode)
      );
    }

    for (const [channelId] of localChannelIds) {
      // Skip channels with storage disabled (no messages stored, nothing to prune)
      const storageMode = storageModes.get(channelId);
      if (storageMode === MessageStorageMode.DISABLED) {
        continue;
      }

      // Read per-channel pruning settings from metadata
      const metadata = channelMetadata[channelId];
      const pruningSettings = metadata?.pruningSettings;

      // Channels without explicit pruning settings are skipped (Java Mirth behavior)
      if (!pruningSettings) {
        continue;
      }

      const { pruneMetaDataDays, pruneContentDays } = pruningSettings;

      // Both null/undefined means no pruning configured for this channel
      if (pruneMetaDataDays == null && pruneContentDays == null) {
        continue;
      }

      let messageDateThreshold: Date | null = null;
      let contentDateThreshold: Date | null = null;

      if (pruneMetaDataDays != null) {
        messageDateThreshold = new Date();
        messageDateThreshold.setDate(messageDateThreshold.getDate() - pruneMetaDataDays);
      }

      if (pruneContentDays != null) {
        contentDateThreshold = new Date();
        contentDateThreshold.setDate(contentDateThreshold.getDate() - pruneContentDays);
      }

      // For METADATA storage mode, there's no content to prune
      if (storageMode === MessageStorageMode.METADATA) {
        contentDateThreshold = null;
      }

      if (messageDateThreshold || contentDateThreshold) {
        const channelName = channelNames[channelId] ?? `Channel ${channelId.substring(0, 8)}...`;
        tasks.push(
          createPrunerTask(
            channelId,
            channelName,
            messageDateThreshold,
            contentDateThreshold,
            pruningSettings.archiveEnabled ?? false
          )
        );
        this.status.pendingChannelIds.add(channelId);
      }
    }

    return tasks;
  }

  /**
   * Prune messages for a single channel.
   *
   * When archiving is enabled (both global and per-channel), messages are
   * archived to files BEFORE deletion. If archiving fails for a batch,
   * that batch is skipped (data safety — matching Java Mirth behavior).
   */
  private async pruneChannel(task: PrunerTask): Promise<PruneResult> {
    logger.info(`Executing pruner for channel: ${task.channelId}`);

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
          logger.warn(`No message tables found for ${task.channelId}`);
          return result;
        }

        const threshold = contentDateThreshold ?? task.messageDateThreshold;

        // Archive-before-delete path
        if (this.archiveEnabled && task.archiveEnabled) {
          this.status.isArchiving = true;
          const archivedIds = await this.archiveAndGetIdsToPrune(
            task.channelId,
            task.channelName,
            threshold!,
            this.skipStatuses
          );
          this.status.isArchiving = false;

          result.numMessagesArchived = archivedIds.length;

          if (archivedIds.length > 0) {
            // Delete only the successfully archived messages
            for (let i = 0; i < archivedIds.length; i += this.prunerBlockSize) {
              this.checkAborted();
              const batch = archivedIds.slice(i, i + this.prunerBlockSize);
              const contentOnly = contentDateThreshold !== null && task.messageDateThreshold !== null;
              const batchResult = await this.pruneMessageBatch(task.channelId, batch, contentOnly);
              result.numMessagesPruned += batchResult.numMessagesPruned;
              result.numContentPruned += batchResult.numContentPruned;
              this.status.isPruning = true;
            }
            this.status.isPruning = false;
          }

          return result;
        }

        // Standard path (no archiving)
        const messageIds = await this.getMessageIdsToPrune(
          task.channelId,
          threshold!,
          this.skipStatuses
        );

        if (messageIds.length === 0) {
          logger.info(`No messages to prune for channel ${task.channelId}`);
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
          logger.warn(
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
   * Archive messages and return IDs that are safe to prune.
   *
   * Queries messages in archiverBlockSize batches. For each batch:
   * 1. Load full message data (messages, connector messages, content, attachments)
   * 2. Build ArchiveMessage objects
   * 3. Write to archive files via MessageArchiver
   * 4. On success: collect IDs for deletion
   * 5. On failure: log error and SKIP that batch (data safety)
   */
  private async archiveAndGetIdsToPrune(
    channelId: string,
    channelName: string,
    dateThreshold: Date,
    skipStatuses: SkipStatus[]
  ): Promise<number[]> {
    const allMessageRows = await DonkeyDao.getMessagesToPrune(
      channelId,
      dateThreshold,
      ID_RETRIEVE_LIMIT,
      skipStatuses,
      this.skipIncomplete
    );

    if (allMessageRows.length === 0) {
      return [];
    }

    const safeToDeleteIds: number[] = [];

    // Process in archiverBlockSize batches
    for (let i = 0; i < allMessageRows.length; i += this.archiverBlockSize) {
      this.checkAborted();

      const batchRows = allMessageRows.slice(i, i + this.archiverBlockSize);
      const batchIds = batchRows.map((r) => r.messageId);

      try {
        // Batch load all related data
        const [messageRows, connectorRows, contentRows, attachmentRows] = await Promise.all([
          DonkeyDao.getMessages(channelId, batchIds),
          Promise.all(batchIds.map((id) => DonkeyDao.getConnectorMessages(channelId, id))),
          DonkeyDao.getContentBatch(channelId, batchIds),
          DonkeyDao.getAttachmentsBatch(channelId, batchIds),
        ]);

        // Build archive messages
        const archiveMessages: ArchiveMessage[] = [];
        for (let j = 0; j < messageRows.length; j++) {
          const msgRow = messageRows[j]!;
          const cmRows = connectorRows[j] ?? [];
          archiveMessages.push(
            buildArchiveMessage(channelId, channelName, msgRow, cmRows, contentRows, attachmentRows)
          );
        }

        // Archive the batch
        await messageArchiver.archiveMessages(channelId, archiveMessages);

        // Archiving succeeded — these IDs are safe to delete
        safeToDeleteIds.push(...batchIds);
        this.numExported += archiveMessages.length;
      } catch (error) {
        // Archiving failed for this batch — skip deletion (data safety)
        logger.error(
          `Failed to archive batch for channel ${channelName} (messages ${batchIds[0]}-${batchIds[batchIds.length - 1]}), skipping deletion`,
          error as Error
        );
      }
    }

    return safeToDeleteIds;
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
        skipStatuses,
        this.skipIncomplete
      );
      return messages.map((m) => m.messageId);
    } catch (error) {
      logger.error('Failed to get messages to prune', error as Error);
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
      logger.error('Failed to prune message batch', error as Error);
    }

    return result;
  }

  /**
   * Prune old events
   */
  private async pruneEventData(): Promise<void> {
    logger.info('Pruning events');
    this.status.isPruningEvents = true;

    try {
      this.status.taskStartTime = new Date();

      if (this.maxEventAge === null) {
        return;
      }

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - this.maxEventAge);

      const deleted = await EventDao.deleteEventsBeforeDate(dateThreshold);
      logger.info(`Pruned ${deleted} events older than ${dateThreshold.toISOString()}`);
    } catch (error) {
      logger.error('Failed to prune events', error as Error);
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
