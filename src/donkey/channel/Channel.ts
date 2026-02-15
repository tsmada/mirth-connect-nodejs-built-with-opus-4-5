/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Channel.java
 *
 * Purpose: Channel runtime managing message flow through source and destinations
 *
 * Key behaviors to replicate:
 * - Message dispatch from source through destinations
 * - Filter/transformer execution
 * - Pre/post processor execution
 * - Status tracking and persistence
 * - Event-driven state changes via EventEmitter
 */

import { EventEmitter } from 'events';
import { PoolConnection } from 'mysql2/promise';
import { Message, MessageData } from '../../model/Message.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { SourceConnector } from './SourceConnector.js';
import { DestinationConnector } from './DestinationConnector.js';
import { SourceQueue } from '../queue/SourceQueue.js';
import { ConnectorMessageQueueDataSource } from '../queue/ConnectorMessageQueue.js';
import {
  JavaScriptExecutor,
  getDefaultExecutor,
} from '../../javascript/runtime/JavaScriptExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DeployedState, ChannelStatistics } from '../../api/models/DashboardStatus.js';
import { MetaDataColumn } from '../../api/models/ServerSettings.js';
import { DESTINATION_SET_KEY } from '../../javascript/userutil/DestinationSet.js';
import { StorageSettings } from './StorageSettings.js';
import { setMetaDataMap } from './MetaDataReplacer.js';
import { runRecoveryTask } from './RecoveryTask.js';
import { AttachmentHandler, NoOpAttachmentHandler } from '../message/AttachmentHandler.js';
import {
  insertMessage,
  insertConnectorMessage,
  insertContent,
  storeContent,
  updateConnectorMessageStatus,
  updateMessageProcessed,
  updateErrors,
  updateMaps,
  updateResponseMap,
  updateSendAttempts,
  getNextMessageId,
  channelTablesExist,
  getStatistics,
  pruneMessageContent,
  pruneMessageAttachments,
  insertCustomMetaData,
  getConnectorMessageStatuses,
} from '../../db/DonkeyDao.js';
import { transaction } from '../../db/pool.js';
import { StatisticsAccumulator } from './StatisticsAccumulator.js';
import { getServerId } from '../../cluster/ClusterIdentity.js';
import { getClusterConfig } from '../../cluster/ClusterConfig.js';
import { SequenceAllocator } from '../../cluster/SequenceAllocator.js';

// Module-level singleton for block-allocated message IDs in cluster mode
const sequenceAllocator = new SequenceAllocator(getClusterConfig().sequenceBlockSize);

export interface ChannelConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  preprocessorScript?: string;
  postprocessorScript?: string;
  deployScript?: string;
  undeployScript?: string;
  storageSettings?: StorageSettings;
  metaDataColumns?: MetaDataColumn[];
  encryptData?: boolean;
}

/**
 * @deprecated Use DeployedState enum instead
 */
export type ChannelState = 'STOPPED' | 'STARTING' | 'STARTED' | 'PAUSING' | 'PAUSED' | 'STOPPING';

/**
 * State change event data emitted when channel state changes
 */
export interface StateChangeEvent {
  channelId: string;
  channelName: string;
  state: DeployedState;
  previousState: DeployedState;
}

/**
 * Channel runtime class - manages message flow and connector lifecycle.
 * Extends EventEmitter to broadcast state changes to listeners (dashboard, WebSocket, etc.)
 */
export class Channel extends EventEmitter {
  private id: string;
  private name: string;
  private description: string;
  private enabled: boolean;
  private currentState: DeployedState = DeployedState.STOPPED;
  private serverId: string = getServerId();

  private sourceConnector: SourceConnector | null = null;
  private destinationConnectors: DestinationConnector[] = [];

  // Scripts
  private preprocessorScript?: string;
  private postprocessorScript?: string;
  private deployScript?: string;
  private undeployScript?: string;

  // Storage settings — controls which content types are persisted
  private storageSettings: StorageSettings;

  // Custom metadata column definitions (persisted to D_MCM tables)
  private metaDataColumns: MetaDataColumn[];

  // Whether to encrypt content in D_MC tables (channel-level setting)
  private encryptData: boolean = false;

  // JavaScript executor
  private executor: JavaScriptExecutor;

  // Message ID sequence
  private nextMessageId = 1;

  // Cached flag: do D_M/D_MM/D_MC/D_MS tables exist for this channel?
  private tablesExist: boolean | null = null;

  // Attachment handler for extracting attachments before content storage
  private attachmentHandler: AttachmentHandler = new NoOpAttachmentHandler();

  // In-memory statistics counters (matches Java Mirth Statistics.java)
  private stats: ChannelStatistics = {
    received: 0,
    sent: 0,
    error: 0,
    filtered: 0,
    queued: 0,
  };

  // Batch accumulator for statistics — reduces DB calls per message
  // (matches Java Mirth Statistics.java batching pattern)
  private statsAccumulator = new StatisticsAccumulator();

  // Source queue for async processing mode (respondAfterProcessing=false)
  private sourceQueue: SourceQueue | null = null;
  private sourceQueueAbortController: AbortController | null = null;
  private sourceQueuePromise: Promise<void> | null = null;

  constructor(config: ChannelConfig) {
    super(); // Initialize EventEmitter
    this.id = config.id;
    this.name = config.name;
    this.description = config.description ?? '';
    this.enabled = config.enabled;
    this.preprocessorScript = config.preprocessorScript;
    this.postprocessorScript = config.postprocessorScript;
    this.deployScript = config.deployScript;
    this.undeployScript = config.undeployScript;
    this.storageSettings = config.storageSettings ?? new StorageSettings();
    this.metaDataColumns = config.metaDataColumns ?? [];
    this.encryptData = config.encryptData ?? false;
    this.executor = getDefaultExecutor();
  }

  /**
   * Set a custom JavaScript executor (useful for testing)
   */
  setExecutor(executor: JavaScriptExecutor): void {
    this.executor = executor;
  }

  /**
   * Get the script context for this channel
   */
  private getScriptContext(): ScriptContext {
    return {
      channelId: this.id,
      channelName: this.name,
    };
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStorageSettings(): StorageSettings {
    return this.storageSettings;
  }

  /**
   * @deprecated Use getCurrentState() instead
   */
  getState(): ChannelState {
    // Map DeployedState to legacy ChannelState for backwards compatibility
    const stateMap: Record<DeployedState, ChannelState> = {
      [DeployedState.STOPPED]: 'STOPPED',
      [DeployedState.STARTING]: 'STARTING',
      [DeployedState.STARTED]: 'STARTED',
      [DeployedState.PAUSING]: 'PAUSING',
      [DeployedState.PAUSED]: 'PAUSED',
      [DeployedState.STOPPING]: 'STOPPING',
      [DeployedState.DEPLOYING]: 'STOPPED',
      [DeployedState.UNDEPLOYING]: 'STOPPING',
      [DeployedState.SYNCING]: 'STARTED',
      [DeployedState.UNKNOWN]: 'STOPPED',
    };
    return stateMap[this.currentState];
  }

  /**
   * Get the current deployed state of the channel
   */
  getCurrentState(): DeployedState {
    return this.currentState;
  }

  /**
   * Update the current state and emit a stateChange event.
   * This is the single source of truth for channel state.
   *
   * Matches Java Mirth pattern in Channel.java:217-220
   */
  updateCurrentState(newState: DeployedState): void {
    const previousState = this.currentState;
    this.currentState = newState;

    const event: StateChangeEvent = {
      channelId: this.id,
      channelName: this.name,
      state: newState,
      previousState,
    };

    this.emit('stateChange', event);
  }

  /**
   * Check if the channel is active (not stopped/stopping)
   * Matches Java Mirth Channel.isActive()
   */
  isActive(): boolean {
    return this.currentState !== DeployedState.STOPPED &&
           this.currentState !== DeployedState.STOPPING;
  }

  /**
   * Get current message processing statistics.
   * Matches Java Mirth Statistics.getStats() pattern.
   */
  getStatistics(): ChannelStatistics {
    return { ...this.stats };
  }

  /**
   * Reset all statistics counters to zero.
   */
  resetStatistics(): void {
    this.stats = { received: 0, sent: 0, error: 0, filtered: 0, queued: 0 };
  }

  /**
   * Set the attachment handler for this channel.
   * Called by ChannelBuilder based on channel configuration.
   */
  setAttachmentHandler(handler: AttachmentHandler): void {
    this.attachmentHandler = handler;
  }

  /**
   * Get the current attachment handler.
   */
  getAttachmentHandler(): AttachmentHandler {
    return this.attachmentHandler;
  }

  /**
   * Load accumulated statistics from the D_MS table.
   * Called during start() so dashboard counters survive restarts.
   * Matches Java Mirth Statistics.loadFromDatabase() pattern.
   */
  public async loadStatisticsFromDb(): Promise<void> {
    try {
      if (this.tablesExist === null) {
        this.tablesExist = await channelTablesExist(this.id);
      }
      if (!this.tablesExist) return;

      const rows = await getStatistics(this.id);
      let received = 0, sent = 0, error = 0, filtered = 0, queued = 0;
      for (const row of rows) {
        received += Number(row.RECEIVED) || 0;
        filtered += Number(row.FILTERED) || 0;
        sent += Number(row.SENT) || 0;
        error += Number(row.ERROR) || 0;
        queued += Number(row.PENDING) || 0;
      }
      this.stats = { received, sent, error, filtered, queued };
    } catch (err) {
      console.error(`[${this.name}] Failed to load statistics: ${err}`);
    }
  }

  setSourceConnector(connector: SourceConnector): void {
    this.sourceConnector = connector;
    connector.setChannel(this);
  }

  getSourceConnector(): SourceConnector | null {
    return this.sourceConnector;
  }

  addDestinationConnector(connector: DestinationConnector): void {
    connector.setChannel(this);
    this.destinationConnectors.push(connector);
  }

  getDestinationConnectors(): DestinationConnector[] {
    return this.destinationConnectors;
  }

  /**
   * Start the channel and all of its connectors.
   *
   * Implements proper rollback on partial failure - if any connector fails to start,
   * all previously started connectors are stopped before throwing the error.
   *
   * Matches Java Mirth pattern in Channel.java:664-762
   */
  async start(): Promise<void> {
    if (this.currentState !== DeployedState.STOPPED &&
        this.currentState !== DeployedState.PAUSED &&
        this.currentState !== DeployedState.DEPLOYING) {
      throw new Error(`Cannot start channel in state: ${this.currentState}`);
    }

    // Track what we've started for rollback on failure
    const startedConnectors: Array<SourceConnector | DestinationConnector> = [];

    try {
      this.updateCurrentState(DeployedState.STARTING);

      // Execute deploy script
      if (this.deployScript) {
        await this.executeScript(this.deployScript, 'deploy');
      }

      // Load accumulated statistics from DB so dashboard counters survive restarts
      await this.loadStatisticsFromDb();

      // Run recovery task to handle messages left unfinished from a previous crash
      if (this.storageSettings.messageRecoveryEnabled) {
        try {
          await runRecoveryTask(this.id, this.serverId);
        } catch (err) {
          console.error(`[${this.name}] Recovery task failed: ${err}`);
        }
      }

      // Deploy connectors (matches Java Channel.deploy() → connector.onDeploy())
      // Destinations first, then source — same order as Java
      for (const dest of this.destinationConnectors) {
        if (typeof (dest as any).onDeploy === 'function') {
          await (dest as any).onDeploy();
        }
      }
      if (this.sourceConnector && typeof (this.sourceConnector as any).onDeploy === 'function') {
        await (this.sourceConnector as any).onDeploy();
      }

      // Start destination connectors first (they need to be ready to receive)
      for (const dest of this.destinationConnectors) {
        await dest.start();
        startedConnectors.push(dest);
      }

      // Start queue processing for queue-enabled destinations
      for (const dest of this.destinationConnectors) {
        if (dest.isQueueEnabled()) {
          dest.startQueueProcessing();
        }
      }

      // Start source connector last
      if (this.sourceConnector) {
        await this.sourceConnector.start();
        startedConnectors.push(this.sourceConnector);

        // Start source queue processing if in async mode
        if (!this.sourceConnector.getRespondAfterProcessing()) {
          this.sourceQueue = new SourceQueue();
          // Provide an in-memory data source so the queue's size tracking works.
          // setDataSource calls invalidate(), so we fillBuffer() to clear that state
          // and initialize size to 0 before any add() calls.
          this.sourceQueue.setDataSource(this.createInMemoryQueueDataSource());
          this.sourceQueue.fillBuffer();
          this.startSourceQueueProcessing();
        }
      }

      this.updateCurrentState(DeployedState.STARTED);
    } catch (error) {
      // Rollback: stop all connectors that were started (in reverse order)
      try {
        this.updateCurrentState(DeployedState.STOPPING);

        // Stop in reverse order (LIFO) - source first, then destinations
        for (let i = startedConnectors.length - 1; i >= 0; i--) {
          const connector = startedConnectors[i];
          try {
            if (connector) {
              await connector.stop();
            }
          } catch (stopError) {
            // Log but continue stopping other connectors
            console.error(`Error stopping connector during rollback: ${stopError}`);
          }
        }

        this.updateCurrentState(DeployedState.STOPPED);
      } catch (rollbackError) {
        // Even if rollback fails, ensure we end up in STOPPED state
        this.updateCurrentState(DeployedState.STOPPED);
      }

      throw error;
    }
  }

  /**
   * Stop the channel and all of its connectors.
   *
   * Matches Java Mirth pattern in Channel.java:766-785
   */
  async stop(): Promise<void> {
    if (this.currentState === DeployedState.STOPPED) {
      return;
    }

    try {
      this.updateCurrentState(DeployedState.STOPPING);

      // Stop source queue processing before stopping source connector
      await this.stopSourceQueueProcessing();
      this.sourceQueue = null;

      // Stop source connector first (stop receiving new messages)
      if (this.sourceConnector) {
        await this.sourceConnector.stop();
      }

      // Stop queue processing first
      for (const dest of this.destinationConnectors) {
        await dest.stopQueueProcessing();
      }

      // Stop destination connectors
      for (const dest of this.destinationConnectors) {
        await dest.stop();
      }

      // Execute undeploy script
      if (this.undeployScript) {
        await this.executeScript(this.undeployScript, 'undeploy');
      }

      this.updateCurrentState(DeployedState.STOPPED);
    } catch (error) {
      // Even on error, ensure we end up in STOPPED state
      this.updateCurrentState(DeployedState.STOPPED);
      throw error;
    }
  }

  /**
   * Pause the channel (stop receiving new messages but keep destinations running).
   *
   * Matches Java Mirth pattern in Channel.java:857-876
   */
  async pause(): Promise<void> {
    if (this.currentState !== DeployedState.STARTED) {
      if (this.currentState === DeployedState.PAUSED) {
        console.warn(`Channel ${this.name} (${this.id}) is already paused.`);
        return;
      }
      throw new Error(`Cannot pause channel in state: ${this.currentState}`);
    }

    try {
      this.updateCurrentState(DeployedState.PAUSING);

      if (this.sourceConnector) {
        await this.sourceConnector.stop();
      }

      this.updateCurrentState(DeployedState.PAUSED);
    } catch (error) {
      // On failure, try to remain in STARTED state
      this.updateCurrentState(DeployedState.STARTED);
      throw error;
    }
  }

  /**
   * Resume the channel (start receiving messages again).
   *
   * Matches Java Mirth pattern in Channel.java:879-904
   */
  async resume(): Promise<void> {
    if (this.currentState !== DeployedState.PAUSED) {
      throw new Error(`Cannot resume channel in state: ${this.currentState}`);
    }

    try {
      this.updateCurrentState(DeployedState.STARTING);

      if (this.sourceConnector) {
        await this.sourceConnector.start();
      }

      this.updateCurrentState(DeployedState.STARTED);
    } catch (error) {
      // On failure, try to return to PAUSED state
      try {
        this.updateCurrentState(DeployedState.PAUSING);
        if (this.sourceConnector) {
          await this.sourceConnector.stop();
        }
        this.updateCurrentState(DeployedState.PAUSED);
      } catch {
        // Ignore errors during rollback
      }
      throw error;
    }
  }

  /**
   * Safely execute a database persistence operation.
   * Never throws — logs errors and returns silently so the message pipeline continues.
   */
  private async persistToDb(operation: () => Promise<void>): Promise<void> {
    try {
      if (this.tablesExist === null) {
        this.tablesExist = await channelTablesExist(this.id);
      }
      if (!this.tablesExist) return;
      await operation();
    } catch (err) {
      console.error(`[${this.name}] DB persist error: ${err}`);
    }
  }

  /**
   * Execute multiple DB operations in a single database transaction.
   * Each operation receives a PoolConnection to use for queries, ensuring
   * all operations share the same connection and transaction boundary.
   *
   * Never throws — logs errors and returns silently like persistToDb().
   */
  private async persistInTransaction(
    operations: Array<(conn: PoolConnection) => Promise<void>>
  ): Promise<void> {
    try {
      if (this.tablesExist === null) {
        this.tablesExist = await channelTablesExist(this.id);
      }
      if (!this.tablesExist) return;
      if (operations.length === 0) return;

      await transaction(async (conn) => {
        for (const op of operations) {
          await op(conn);
        }
      });
    } catch (err) {
      console.error(`[${this.name}] DB transaction error: ${err}`);
    }
  }

  /**
   * Execute multiple DB operations in a single transaction.
   * Matches Java Mirth's transactional grouping pattern — each pipeline phase
   * (source processing, per-destination, finish) is wrapped in a transaction
   * so a crash mid-phase leaves the DB in a consistent state.
   *
   * Never throws — logs errors and returns silently like persistToDb().
   * Falls back to sequential persistToDb() calls if transaction() fails to initialize.
   *
   * Used by external callers (RecoveryTask, reprocessing) that need atomic multi-step DB ops.
   */
  async persistBatch(operations: Array<() => Promise<void>>): Promise<void> {
    try {
      if (this.tablesExist === null) {
        this.tablesExist = await channelTablesExist(this.id);
      }
      if (!this.tablesExist) return;
      if (operations.length === 0) return;

      await transaction(async () => {
        for (const op of operations) {
          await op();
        }
      });
    } catch (err) {
      console.error(`[${this.name}] DB transaction error, falling back to sequential: ${err}`);
      // Fallback: execute each operation individually
      for (const op of operations) {
        await this.persistToDb(op);
      }
    }
  }

  /**
   * Dispatch a raw message through the channel pipeline
   */
  async dispatchRawMessage(
    rawData: string,
    sourceMapData?: Map<string, unknown>
  ): Promise<Message> {
    const serverId = this.serverId;

    // Get message ID from DB sequence if tables exist, else use in-memory counter
    let messageId: number;
    try {
      if (this.tablesExist === null) {
        this.tablesExist = await channelTablesExist(this.id);
      }
      // Use block allocation in cluster mode for reduced contention
      if (getClusterConfig().clusterEnabled) {
        messageId = await sequenceAllocator.allocateId(this.id);
      } else {
        messageId = this.tablesExist ? await getNextMessageId(this.id) : this.nextMessageId++;
      }
    } catch {
      messageId = this.nextMessageId++;
    }

    // Create message
    const messageData: MessageData = {
      messageId,
      serverId,
      channelId: this.id,
      receivedDate: new Date(),
      processed: false,
    };
    const message = new Message(messageData);

    // Create source connector message
    const sourceMessage = new ConnectorMessage({
      messageId,
      metaDataId: 0,
      channelId: this.id,
      channelName: this.name,
      connectorName: this.sourceConnector?.getName() ?? 'Source',
      serverId,
      receivedDate: new Date(),
      status: Status.RECEIVED,
    });

    // Set raw content
    const sourceDataType = this.sourceConnector?.getInboundDataType() ?? 'RAW';
    sourceMessage.setContent({
      contentType: ContentType.RAW,
      content: rawData,
      dataType: sourceDataType,
      encrypted: false,
    });

    // Copy source map data
    if (sourceMapData) {
      for (const [key, value] of sourceMapData) {
        sourceMessage.getSourceMap().set(key, value);
      }
    }

    message.setConnectorMessage(0, sourceMessage);

    // Extract attachments before persisting raw content
    if (this.storageSettings.storeAttachments) {
      try {
        const modifiedContent = await this.attachmentHandler.extractAttachments(
          this.id, messageId, sourceMessage
        );
        if (modifiedContent !== rawData) {
          rawData = modifiedContent;
          sourceMessage.setContent({
            contentType: ContentType.RAW,
            content: modifiedContent,
            dataType: sourceDataType,
            encrypted: false,
          });
        }
      } catch (err) {
        console.error(`[${this.name}] Attachment extraction error: ${err}`);
        // Continue with original content if extraction fails
      }
    }

    // Transaction 1: Source intake — persist message + source connector + raw content + stats
    // Pass maps during source insert when rawDurable or storeMaps is set (matches Java Mirth's storeMaps=true behavior)
    const sourceInsertOptions = (this.storageSettings.rawDurable || this.storageSettings.storeMaps)
      ? {
          storeMaps: {
            sourceMap: sourceMessage.getSourceMap(),
            connectorMap: sourceMessage.getConnectorMap(),
            channelMap: sourceMessage.getChannelMap(),
            responseMap: sourceMessage.getResponseMap(),
          },
        }
      : undefined;
    this.statsAccumulator.increment(0, Status.RECEIVED);
    await this.persistInTransaction([
      (conn) => insertMessage(this.id, messageId, serverId, messageData.receivedDate, conn),
      (conn) => insertConnectorMessage(this.id, messageId, 0, sourceMessage.getConnectorName(), sourceMessage.getReceivedDate(), Status.RECEIVED, 0, sourceInsertOptions, conn),
      ...(this.storageSettings.storeRaw ? [
        (conn: PoolConnection) => insertContent(this.id, messageId, 0, ContentType.RAW, rawData, sourceDataType, this.encryptData, conn),
      ] : []),
      ...this.statsAccumulator.getFlushOps(this.id, serverId),
    ]);
    this.statsAccumulator.reset();

    // Increment received counter after DB persist completes
    this.stats.received++;

    // Source queue mode: persist raw + return immediately for background processing
    if (this.sourceConnector && !this.sourceConnector.getRespondAfterProcessing() && this.sourceQueue) {
      sourceMessage.getSourceMap().set('__rawData', rawData);
      this.sourceQueue.add(sourceMessage);
      message.setProcessed(false);
      return message;
    }

    try {
      // Execute preprocessor
      let processedData = rawData;
      if (this.preprocessorScript) {
        processedData = await this.executePreprocessor(rawData, sourceMessage);
        sourceMessage.setContent({
          contentType: ContentType.PROCESSED_RAW,
          content: processedData,
          dataType: sourceDataType,
          encrypted: false,
        });

        // Persist PROCESSED_RAW content
        if (this.storageSettings.storeProcessedRaw) {
          await this.persistToDb(() => insertContent(this.id, messageId, 0, ContentType.PROCESSED_RAW, processedData, sourceDataType, this.encryptData));
        }
      }

      // Initialize DestinationSet in sourceMap before filter/transformer runs
      // Java Mirth: Channel.java — populates destination metaDataIds so user scripts
      // can call destinationSet.remove() to selectively skip destinations
      const destMetaDataIds = new Set<number>(
        this.destinationConnectors.map((_, i) => i + 1)
      );
      sourceMessage.getSourceMap().set(DESTINATION_SET_KEY, destMetaDataIds);

      // Also build destinationIdMap (connector name → metaDataId) for name-based removal
      const destIdMap = new Map<string, number>();
      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dc = this.destinationConnectors[i];
        if (dc) destIdMap.set(dc.getName(), i + 1);
      }
      sourceMessage.setDestinationIdMap(destIdMap);

      // Execute source filter/transformer
      if (this.sourceConnector) {
        const filtered = await this.sourceConnector.executeFilter(sourceMessage);
        if (filtered) {
          sourceMessage.setStatus(Status.FILTERED);
          this.stats.filtered++;
          this.statsAccumulator.increment(0, Status.FILTERED);
          await this.persistInTransaction([
            (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.FILTERED, conn),
            ...this.statsAccumulator.getFlushOps(this.id, serverId),
          ]);
          this.statsAccumulator.reset();
          message.setProcessed(true);
          return message;
        }

        await this.sourceConnector.executeTransformer(sourceMessage);
        sourceMessage.setStatus(Status.TRANSFORMED);

        // Transaction 2: Source processing — status + content + sourceMap + custom metadata
        const txn2Ops: Array<(conn: PoolConnection) => Promise<void>> = [
          (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.TRANSFORMED, conn),
        ];

        if (this.storageSettings.storeTransformed) {
          const transformedContent = sourceMessage.getTransformedContent();
          if (transformedContent) {
            txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.TRANSFORMED,
              transformedContent.content, transformedContent.dataType, this.encryptData, conn));
          }
        }

        if (this.storageSettings.storeSourceEncoded) {
          const encodedContent = sourceMessage.getEncodedContent();
          if (encodedContent) {
            txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.ENCODED,
              encodedContent.content, encodedContent.dataType, this.encryptData, conn));
          }
        }

        // sourceMap: no early INSERT — written once at end of pipeline (PC-MJM-001)

        // Custom metadata after source transformer
        if (this.storageSettings.storeCustomMetaData && this.metaDataColumns.length > 0) {
          const metaData = setMetaDataMap(sourceMessage, this.metaDataColumns);
          if (metaData.size > 0) {
            txn2Ops.push((conn) => insertCustomMetaData(this.id, messageId, 0, Object.fromEntries(metaData), conn));
          }
        }

        await this.persistInTransaction(txn2Ops);
      }

      // Dispatch to destinations
      // Java Mirth: Channel.java:1665-1699 — source's encoded content becomes destination's RAW
      const sourceEncoded = sourceMessage.getEncodedContent()
        ?? sourceMessage.getTransformedContent()
        ?? sourceMessage.getRawContent();

      // Read back DestinationSet after filter/transformer — user may have removed destinations
      const activeDestIds = sourceMessage.getSourceMap().get(DESTINATION_SET_KEY) as Set<number> | undefined;

      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dest = this.destinationConnectors[i];
        if (!dest) continue;

        // Check DestinationSet — skip destinations removed by user scripts
        const destMetaId = i + 1;
        if (activeDestIds && !activeDestIds.has(destMetaId)) {
          // Destination was removed by DestinationSet — mark as FILTERED
          const filteredMsg = sourceMessage.clone(destMetaId, dest.getName());
          filteredMsg.setStatus(Status.FILTERED);
          message.setConnectorMessage(destMetaId, filteredMsg);
          this.stats.filtered++;
          this.statsAccumulator.increment(destMetaId, Status.FILTERED);
          await this.persistInTransaction([
            (conn) => insertConnectorMessage(this.id, messageId, destMetaId, dest.getName(), filteredMsg.getReceivedDate(), Status.RECEIVED, 0, {}, conn),
            (conn) => updateConnectorMessageStatus(this.id, messageId, destMetaId, Status.FILTERED, conn),
            ...this.statsAccumulator.getFlushOps(this.id, serverId),
          ]);
          this.statsAccumulator.reset();
          continue;
        }

        const destMessage = sourceMessage.clone(i + 1, dest.getName());

        // Set RAW content on destination from source's encoded content
        // Java Mirth: Channel.java:1699 — "create the raw content from the source's encoded content"
        if (sourceEncoded) {
          destMessage.setContent({
            contentType: ContentType.RAW,
            content: sourceEncoded.content,
            dataType: sourceEncoded.dataType,
            encrypted: sourceEncoded.encrypted,
          });
        }

        message.setConnectorMessage(i + 1, destMessage);

        // Persist destination connector message
        await this.persistToDb(() => insertConnectorMessage(this.id, messageId, i + 1, dest.getName(), destMessage.getReceivedDate(), Status.RECEIVED));

        try {
          // Execute destination filter
          const filtered = await dest.executeFilter(destMessage);
          if (filtered) {
            destMessage.setStatus(Status.FILTERED);
            this.stats.filtered++;
            this.statsAccumulator.increment(i + 1, Status.FILTERED);
            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.FILTERED, conn),
              ...this.statsAccumulator.getFlushOps(this.id, serverId),
            ]);
            this.statsAccumulator.reset();
            continue;
          }

          // Execute destination transformer
          await dest.executeTransformer(destMessage);
          destMessage.setStatus(Status.TRANSFORMED);
          await this.persistToDb(() => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.TRANSFORMED));

          // Persist destination ENCODED content (ContentType=4)
          if (this.storageSettings.storeDestinationEncoded) {
            const destEncoded = destMessage.getEncodedContent();
            if (destEncoded) {
              await this.persistToDb(() => insertContent(this.id, messageId, i + 1, ContentType.ENCODED,
                destEncoded.content, destEncoded.dataType, this.encryptData));
            }
          }

          // Send to destination
          destMessage.incrementSendAttempts();
          await dest.send(destMessage);
          const sendDate = new Date();
          destMessage.setStatus(Status.SENT);
          destMessage.setSendDate(sendDate);
          this.stats.sent++;

          // Capture response before building the transaction (response transformer may modify maps)
          if (this.storageSettings.storeResponse) {
            const responseData = await dest.getResponse(destMessage);
            if (responseData) {
              destMessage.setContent({
                contentType: ContentType.RESPONSE,
                content: responseData,
                dataType: dest.getResponseDataType(),
                encrypted: false,
              });
              destMessage.setResponseDate(new Date());

              // PENDING checkpoint — crash recovery marker
              // If server crashes between send and response transformer,
              // recovery can re-run response transformer for PENDING messages
              destMessage.setStatus(Status.PENDING);
              await this.persistToDb(() => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.PENDING));

              // Execute response transformer
              await dest.executeResponseTransformer(destMessage);

              // Restore SENT status after response transformer completes
              destMessage.setStatus(Status.SENT);
            }
          }

          // Transaction 3: Per-destination — status + content + maps + custom metadata
          this.statsAccumulator.increment(i + 1, Status.SENT);
          const destOps: Array<(conn: PoolConnection) => Promise<void>> = [
            (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.SENT, conn),
          ];

          if (this.storageSettings.storeSent) {
            const sentData = destMessage.getEncodedContent();
            if (sentData) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.SENT,
                sentData.content, sentData.dataType, this.encryptData, conn));
            }
          }

          // Persist RESPONSE content (ContentType=6)
          if (this.storageSettings.storeResponse) {
            const respContent = destMessage.getResponseContent();
            if (respContent) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE,
                respContent.content, respContent.dataType, this.encryptData, conn));
            }

            // Persist RESPONSE_TRANSFORMED content (ContentType=7)
            if (this.storageSettings.storeResponseTransformed) {
              const responseTransformed = destMessage.getContent(ContentType.RESPONSE_TRANSFORMED);
              if (responseTransformed) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE_TRANSFORMED,
                  responseTransformed.content, responseTransformed.dataType, this.encryptData, conn));
              }
            }

            // Persist PROCESSED_RESPONSE content (ContentType=8)
            if (this.storageSettings.storeProcessedResponse) {
              const processedResponse = destMessage.getContent(ContentType.PROCESSED_RESPONSE);
              if (processedResponse) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.PROCESSED_RESPONSE,
                  processedResponse.content, processedResponse.dataType, this.encryptData, conn));
              }
            }
          }

          // Update send attempts and dates
          destOps.push((conn) => updateSendAttempts(this.id, messageId, i + 1,
            destMessage.getSendAttempts(), sendDate, destMessage.getResponseDate(), conn));

          // Persist destination maps
          if (this.storageSettings.storeMaps) {
            destOps.push((conn) => updateMaps(this.id, messageId, i + 1,
              destMessage.getConnectorMap(), destMessage.getChannelMap(), destMessage.getResponseMap(), conn));
          }

          // Custom metadata after destination transformer
          if (this.storageSettings.storeCustomMetaData && this.metaDataColumns.length > 0) {
            const destMetaData = setMetaDataMap(destMessage, this.metaDataColumns);
            if (destMetaData.size > 0) {
              destOps.push((conn) => insertCustomMetaData(this.id, messageId, i + 1, Object.fromEntries(destMetaData), conn));
            }
          }

          destOps.push(...this.statsAccumulator.getFlushOps(this.id, serverId));
          await this.persistInTransaction(destOps);
          this.statsAccumulator.reset();
        } catch (error) {
          this.statsAccumulator.reset();
          if (dest.isQueueEnabled()) {
            // Queue-enabled: set QUEUED status instead of ERROR
            destMessage.setStatus(Status.QUEUED);
            const queue = dest.getQueue();
            if (queue) {
              queue.add(destMessage);
            }
            this.stats.queued++;

            this.statsAccumulator.increment(i + 1, Status.QUEUED);
            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.QUEUED, conn),
              ...this.statsAccumulator.getFlushOps(this.id, serverId),
            ]);
            this.statsAccumulator.reset();
          } else {
            // Non-queue destination: ERROR handling (original behavior)
            destMessage.setStatus(Status.ERROR);
            destMessage.setProcessingError(String(error));
            const errorCode = destMessage.updateErrorCode();
            this.stats.error++;

            // Error transaction: status + stats + error content + maps
            this.statsAccumulator.increment(i + 1, Status.ERROR);
            const errOps: Array<(conn: PoolConnection) => Promise<void>> = [
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.ERROR, conn),
              (conn) => updateErrors(this.id, messageId, i + 1,
                String(error), undefined, errorCode, undefined, conn),
            ];

            if (this.storageSettings.storeMaps) {
              errOps.push((conn) => updateMaps(this.id, messageId, i + 1,
                destMessage.getConnectorMap(), destMessage.getChannelMap(), destMessage.getResponseMap(), conn));
            }

            errOps.push(...this.statsAccumulator.getFlushOps(this.id, serverId));
            await this.persistInTransaction(errOps);
            this.statsAccumulator.reset();
          }
        }
      }

      // Transaction 4: Finish — source response + merged maps + mark processed

      // Select response from first successful destination and store as source RESPONSE
      const txn4Ops: Array<(conn: PoolConnection) => Promise<void>> = [];

      if (this.storageSettings.storeResponse) {
        for (let i = 0; i < this.destinationConnectors.length; i++) {
          const destMsg = message.getConnectorMessage(i + 1);
          if (destMsg && destMsg.getStatus() === Status.SENT) {
            const respContent = destMsg.getResponseContent();
            if (respContent) {
              sourceMessage.setContent({
                contentType: ContentType.RESPONSE,
                content: respContent.content,
                dataType: respContent.dataType,
                encrypted: false,
              });
              txn4Ops.push((conn) => storeContent(this.id, messageId, 0, ContentType.RESPONSE,
                respContent.content, respContent.dataType, this.encryptData, conn));
              break;
            }
          }
        }
      }

      // finishDispatch equivalent: update source connector metadata
      // Java Mirth's SourceConnector.finishDispatch() sets sendAttempts=1, sendDate, responseDate
      const sourceFinishDate = new Date();
      sourceMessage.setSendAttempts(1);
      sourceMessage.setSendDate(sourceFinishDate);
      sourceMessage.setResponseDate(sourceFinishDate);
      txn4Ops.push((conn) => updateSendAttempts(this.id, messageId, 0, 1, sourceFinishDate, sourceFinishDate, conn));

      // Persist source response error if present
      if (sourceMessage.getResponseError()) {
        txn4Ops.push((conn) => updateErrors(this.id, messageId, 0,
          undefined, undefined, sourceMessage.updateErrorCode(), sourceMessage.getResponseError(), conn));
      }

      // Execute postprocessor (runs outside transaction — errors caught separately)
      if (this.postprocessorScript) {
        try {
          await this.executePostprocessor(message);
        } catch (postError) {
          sourceMessage.setPostProcessorError(String(postError));
          const errorCode = sourceMessage.updateErrorCode();
          await this.persistToDb(() => updateErrors(this.id, messageId, 0,
            undefined, String(postError), errorCode));
        }
      }

      // Merged response map from all destinations
      if (this.storageSettings.storeMergedResponseMap) {
        const mergedMap = new Map<string, unknown>();
        for (let i = 0; i < this.destinationConnectors.length; i++) {
          const destMsg = message.getConnectorMessage(i + 1);
          if (destMsg) {
            for (const [k, v] of destMsg.getResponseMap()) {
              mergedMap.set(k, v);
            }
          }
        }
        if (mergedMap.size > 0) {
          txn4Ops.push((conn) => updateResponseMap(this.id, messageId, 0, mergedMap, conn));
        }
      }

      // Source maps
      if (this.storageSettings.storeMaps) {
        txn4Ops.push((conn) => updateMaps(this.id, messageId, 0,
          sourceMessage.getConnectorMap(), sourceMessage.getChannelMap(), sourceMessage.getResponseMap(), conn));
      }

      // Mark processed
      message.setProcessed(true);
      txn4Ops.push((conn) => updateMessageProcessed(this.id, messageId, true, conn));

      // Content/attachment removal
      if (this.storageSettings.removeContentOnCompletion) {
        let shouldRemove = false;

        if (!this.storageSettings.removeOnlyFilteredOnCompletion ||
            sourceMessage.getStatus() === Status.FILTERED) {
          // DB check: verify all destination connectors are in terminal state
          // before removing content. This prevents removing content for messages
          // still being processed by queue-enabled destinations.
          try {
            const statuses = await getConnectorMessageStatuses(this.id, messageId);
            shouldRemove = true;
            for (const [metaDataId, status] of statuses) {
              if (metaDataId === 0) continue; // Skip source connector
              if (status !== Status.SENT && status !== Status.FILTERED &&
                  status !== Status.ERROR) {
                shouldRemove = false;
                break;
              }
            }
          } catch {
            // If we can't verify, don't remove (safe default)
            shouldRemove = false;
          }
        }

        if (shouldRemove) {
          txn4Ops.push(async () => { await pruneMessageContent(this.id, [messageId]); });
        }
      }
      if (this.storageSettings.removeAttachmentsOnCompletion) {
        txn4Ops.push(async () => { await pruneMessageAttachments(this.id, [messageId]); });
      }

      await this.persistInTransaction(txn4Ops);
    } catch (error) {
      this.statsAccumulator.reset();
      sourceMessage.setStatus(Status.ERROR);
      sourceMessage.setProcessingError(String(error));
      const errorCode = sourceMessage.updateErrorCode();
      this.stats.error++;

      this.statsAccumulator.increment(0, Status.ERROR);
      await this.persistInTransaction([
        (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.ERROR, conn),
        (conn) => updateErrors(this.id, messageId, 0,
          String(error), undefined, errorCode, undefined, conn),
        ...this.statsAccumulator.getFlushOps(this.id, serverId),
      ]);
      this.statsAccumulator.reset();
    }

    // Final SOURCE_MAP write — upsert because storeMaps may have already INSERTed it during source intake
    // Always persisted regardless of storeMaps flag — needed for trace feature
    const srcMap = sourceMessage.getSourceMap();
    if (srcMap.size > 0) {
      const mapObj = Object.fromEntries(srcMap);
      await this.persistToDb(() => storeContent(this.id, messageId, 0, ContentType.SOURCE_MAP, JSON.stringify(mapObj), 'JSON', false));
    }

    this.emit('messageComplete', { channelId: this.id, channelName: this.name, messageId });

    return message;
  }

  /**
   * Execute a deploy or undeploy script
   */
  private async executeScript(script: string, phase: 'deploy' | 'undeploy'): Promise<void> {
    const context = this.getScriptContext();

    if (phase === 'deploy') {
      const result = this.executor.executeDeploy(script, context);
      if (!result.success) {
        throw result.error ?? new Error('Deploy script failed');
      }
    } else {
      const result = this.executor.executeUndeploy(script, context);
      if (!result.success) {
        throw result.error ?? new Error('Undeploy script failed');
      }
    }
  }

  /**
   * Execute the preprocessor script
   * @returns The processed message (may be modified by script)
   */
  private async executePreprocessor(
    rawData: string,
    connectorMessage: ConnectorMessage
  ): Promise<string> {
    if (!this.preprocessorScript) {
      return rawData;
    }

    const context = this.getScriptContext();
    const result = this.executor.executePreprocessor(
      this.preprocessorScript,
      rawData,
      connectorMessage,
      context
    );

    if (!result.success) {
      throw result.error ?? new Error('Preprocessor script failed');
    }

    return result.result ?? rawData;
  }

  /**
   * Execute the postprocessor script
   */
  private async executePostprocessor(message: Message): Promise<void> {
    if (!this.postprocessorScript) {
      return;
    }

    const context = this.getScriptContext();
    const result = this.executor.executePostprocessor(
      this.postprocessorScript,
      message,
      context
    );

    if (!result.success) {
      throw result.error ?? new Error('Postprocessor script failed');
    }
  }

  // ---------- Source Queue Background Processing ----------

  /**
   * Create an in-memory data source for the source queue.
   * Returns size 0 and empty items — the queue is purely in-memory via add().
   */
  private createInMemoryQueueDataSource(): ConnectorMessageQueueDataSource {
    return {
      getChannelId: () => this.id,
      getMetaDataId: () => 0,
      getSize: () => 0,
      getItems: () => new Map(),
      isQueueRotated: () => false,
      setLastItem: () => {},
      rotateQueue: () => {},
      getRotateThreadMap: () => new Map(),
    };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('aborted')); return; }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    });
  }

  /**
   * Start the source queue background processing loop.
   * Ported from Java Channel.java lines 1836-1881.
   */
  private startSourceQueueProcessing(): void {
    if (!this.sourceQueue) return;
    this.sourceQueueAbortController = new AbortController();
    this.sourceQueuePromise = this.runSourceQueueLoop(this.sourceQueueAbortController.signal);
  }

  private async stopSourceQueueProcessing(): Promise<void> {
    if (this.sourceQueueAbortController) {
      this.sourceQueueAbortController.abort();
      try {
        await this.sourceQueuePromise;
      } catch {
        // Expected abort
      }
      this.sourceQueueAbortController = null;
      this.sourceQueuePromise = null;
    }
  }

  private async runSourceQueueLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const connectorMessage = this.sourceQueue?.poll() ?? null;

        if (!connectorMessage) {
          await this.sleep(100, signal);
          continue;
        }

        const rawData = (connectorMessage.getSourceMap().get('__rawData') as string) ??
                         connectorMessage.getRawContent()?.content ?? '';

        await this.processFromSourceQueue(connectorMessage, rawData);

      } catch (error) {
        if (signal.aborted) break;
        console.error(`[${this.name}] Source queue processing error: ${error}`);
      }
    }
  }

  /**
   * Process a message that was dequeued from the source queue.
   * Runs the remaining pipeline steps: preprocessor -> filter/transform -> destinations -> postprocessor.
   */
  private async processFromSourceQueue(
    sourceMessage: ConnectorMessage,
    rawData: string,
  ): Promise<void> {
    const messageId = sourceMessage.getMessageId();
    const serverId = this.serverId;

    // Reconstruct Message wrapper
    const message = new Message({
      messageId,
      serverId,
      channelId: this.id,
      receivedDate: sourceMessage.getReceivedDate(),
      processed: false,
    });
    message.setConnectorMessage(0, sourceMessage);

    // Clean up the internal marker from sourceMap
    sourceMessage.getSourceMap().delete('__rawData');

    try {
      // Execute preprocessor
      let processedData = rawData;
      if (this.preprocessorScript) {
        const queueDataType = this.sourceConnector?.getInboundDataType() ?? 'RAW';
        processedData = await this.executePreprocessor(rawData, sourceMessage);
        sourceMessage.setContent({
          contentType: ContentType.PROCESSED_RAW,
          content: processedData,
          dataType: queueDataType,
          encrypted: false,
        });

        if (this.storageSettings.storeProcessedRaw) {
          await this.persistToDb(() => insertContent(this.id, messageId, 0, ContentType.PROCESSED_RAW, processedData, queueDataType, this.encryptData));
        }
      }

      // Initialize DestinationSet in sourceMap before filter/transformer runs (same as dispatchRawMessage)
      const destMetaDataIds2 = new Set<number>(
        this.destinationConnectors.map((_, i) => i + 1)
      );
      sourceMessage.getSourceMap().set(DESTINATION_SET_KEY, destMetaDataIds2);

      const destIdMap2 = new Map<string, number>();
      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dc = this.destinationConnectors[i];
        if (dc) destIdMap2.set(dc.getName(), i + 1);
      }
      sourceMessage.setDestinationIdMap(destIdMap2);

      // Execute source filter/transformer
      if (this.sourceConnector) {
        const filtered = await this.sourceConnector.executeFilter(sourceMessage);
        if (filtered) {
          sourceMessage.setStatus(Status.FILTERED);
          this.stats.filtered++;
          this.statsAccumulator.increment(0, Status.FILTERED);
          await this.persistInTransaction([
            (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.FILTERED, conn),
            ...this.statsAccumulator.getFlushOps(this.id, serverId),
          ]);
          this.statsAccumulator.reset();
          message.setProcessed(true);
          await this.persistToDb(() => updateMessageProcessed(this.id, messageId, true));
          return;
        }

        await this.sourceConnector.executeTransformer(sourceMessage);
        sourceMessage.setStatus(Status.TRANSFORMED);

        const txn2Ops: Array<(conn: PoolConnection) => Promise<void>> = [
          (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.TRANSFORMED, conn),
        ];

        if (this.storageSettings.storeTransformed) {
          const transformedContent = sourceMessage.getTransformedContent();
          if (transformedContent) {
            txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.TRANSFORMED,
              transformedContent.content, transformedContent.dataType, this.encryptData, conn));
          }
        }

        if (this.storageSettings.storeSourceEncoded) {
          const encodedContent = sourceMessage.getEncodedContent();
          if (encodedContent) {
            txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.ENCODED,
              encodedContent.content, encodedContent.dataType, this.encryptData, conn));
          }
        }

        // sourceMap: no early INSERT — written once at end of pipeline (PC-MJM-001)

        if (this.storageSettings.storeCustomMetaData && this.metaDataColumns.length > 0) {
          const metaData = setMetaDataMap(sourceMessage, this.metaDataColumns);
          if (metaData.size > 0) {
            txn2Ops.push((conn) => insertCustomMetaData(this.id, messageId, 0, Object.fromEntries(metaData), conn));
          }
        }

        await this.persistInTransaction(txn2Ops);
      }

      // Dispatch to destinations
      // Java Mirth: source's encoded content becomes destination's RAW
      const sourceEncoded2 = sourceMessage.getEncodedContent()
        ?? sourceMessage.getTransformedContent()
        ?? sourceMessage.getRawContent();

      // Read back DestinationSet after filter/transformer (same as dispatchRawMessage)
      const activeDestIds2 = sourceMessage.getSourceMap().get(DESTINATION_SET_KEY) as Set<number> | undefined;

      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dest = this.destinationConnectors[i];
        if (!dest) continue;

        // Check DestinationSet — skip destinations removed by user scripts
        const destMetaId2 = i + 1;
        if (activeDestIds2 && !activeDestIds2.has(destMetaId2)) {
          const filteredMsg = sourceMessage.clone(destMetaId2, dest.getName());
          filteredMsg.setStatus(Status.FILTERED);
          message.setConnectorMessage(destMetaId2, filteredMsg);
          this.stats.filtered++;
          this.statsAccumulator.increment(destMetaId2, Status.FILTERED);
          await this.persistInTransaction([
            (conn) => insertConnectorMessage(this.id, messageId, destMetaId2, dest.getName(), filteredMsg.getReceivedDate(), Status.RECEIVED, 0, {}, conn),
            (conn) => updateConnectorMessageStatus(this.id, messageId, destMetaId2, Status.FILTERED, conn),
            ...this.statsAccumulator.getFlushOps(this.id, serverId),
          ]);
          this.statsAccumulator.reset();
          continue;
        }

        const destMessage = sourceMessage.clone(i + 1, dest.getName());

        // Set RAW content on destination from source's encoded content
        if (sourceEncoded2) {
          destMessage.setContent({
            contentType: ContentType.RAW,
            content: sourceEncoded2.content,
            dataType: sourceEncoded2.dataType,
            encrypted: sourceEncoded2.encrypted,
          });
        }

        message.setConnectorMessage(i + 1, destMessage);

        await this.persistToDb(() => insertConnectorMessage(this.id, messageId, i + 1, dest.getName(), destMessage.getReceivedDate(), Status.RECEIVED));

        try {
          const filtered = await dest.executeFilter(destMessage);
          if (filtered) {
            destMessage.setStatus(Status.FILTERED);
            this.stats.filtered++;
            this.statsAccumulator.increment(i + 1, Status.FILTERED);
            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.FILTERED, conn),
              ...this.statsAccumulator.getFlushOps(this.id, serverId),
            ]);
            this.statsAccumulator.reset();
            continue;
          }

          await dest.executeTransformer(destMessage);
          destMessage.setStatus(Status.TRANSFORMED);
          await this.persistToDb(() => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.TRANSFORMED));

          if (this.storageSettings.storeDestinationEncoded) {
            const destEncoded = destMessage.getEncodedContent();
            if (destEncoded) {
              await this.persistToDb(() => insertContent(this.id, messageId, i + 1, ContentType.ENCODED,
                destEncoded.content, destEncoded.dataType, this.encryptData));
            }
          }

          destMessage.incrementSendAttempts();
          await dest.send(destMessage);
          const sendDate = new Date();
          destMessage.setStatus(Status.SENT);
          destMessage.setSendDate(sendDate);
          this.stats.sent++;

          if (this.storageSettings.storeResponse) {
            const responseData = await dest.getResponse(destMessage);
            if (responseData) {
              destMessage.setContent({
                contentType: ContentType.RESPONSE,
                content: responseData,
                dataType: dest.getResponseDataType(),
                encrypted: false,
              });
              destMessage.setResponseDate(new Date());

              // PENDING checkpoint — crash recovery marker (matching dispatchRawMessage path)
              destMessage.setStatus(Status.PENDING);
              await this.persistToDb(() => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.PENDING));

              // Execute response transformer
              await dest.executeResponseTransformer(destMessage);

              // Restore SENT status after response transformer completes
              destMessage.setStatus(Status.SENT);
            }
          }

          this.statsAccumulator.increment(i + 1, Status.SENT);
          const destOps: Array<(conn: PoolConnection) => Promise<void>> = [
            (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.SENT, conn),
          ];

          if (this.storageSettings.storeSent) {
            const sentData = destMessage.getEncodedContent();
            if (sentData) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.SENT,
                sentData.content, sentData.dataType, this.encryptData, conn));
            }
          }

          if (this.storageSettings.storeResponse) {
            const respContent = destMessage.getResponseContent();
            if (respContent) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE,
                respContent.content, respContent.dataType, this.encryptData, conn));
            }
            if (this.storageSettings.storeResponseTransformed) {
              const responseTransformed = destMessage.getContent(ContentType.RESPONSE_TRANSFORMED);
              if (responseTransformed) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE_TRANSFORMED,
                  responseTransformed.content, responseTransformed.dataType, this.encryptData, conn));
              }
            }
            if (this.storageSettings.storeProcessedResponse) {
              const processedResponse = destMessage.getContent(ContentType.PROCESSED_RESPONSE);
              if (processedResponse) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.PROCESSED_RESPONSE,
                  processedResponse.content, processedResponse.dataType, this.encryptData, conn));
              }
            }
          }

          destOps.push((conn) => updateSendAttempts(this.id, messageId, i + 1,
            destMessage.getSendAttempts(), sendDate, destMessage.getResponseDate(), conn));

          if (this.storageSettings.storeMaps) {
            destOps.push((conn) => updateMaps(this.id, messageId, i + 1,
              destMessage.getConnectorMap(), destMessage.getChannelMap(), destMessage.getResponseMap(), conn));
          }

          if (this.storageSettings.storeCustomMetaData && this.metaDataColumns.length > 0) {
            const destMetaData = setMetaDataMap(destMessage, this.metaDataColumns);
            if (destMetaData.size > 0) {
              destOps.push((conn) => insertCustomMetaData(this.id, messageId, i + 1, Object.fromEntries(destMetaData), conn));
            }
          }

          destOps.push(...this.statsAccumulator.getFlushOps(this.id, serverId));
          await this.persistInTransaction(destOps);
          this.statsAccumulator.reset();
        } catch (error) {
          this.statsAccumulator.reset();
          if (dest.isQueueEnabled()) {
            // Queue-enabled: set QUEUED status instead of ERROR (matching dispatchRawMessage path)
            destMessage.setStatus(Status.QUEUED);
            const queue = dest.getQueue();
            if (queue) {
              queue.add(destMessage);
            }
            this.stats.queued++;

            this.statsAccumulator.increment(i + 1, Status.QUEUED);
            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.QUEUED, conn),
              ...this.statsAccumulator.getFlushOps(this.id, serverId),
            ]);
            this.statsAccumulator.reset();
          } else {
            // Non-queue destination: ERROR handling
            destMessage.setStatus(Status.ERROR);
            destMessage.setProcessingError(String(error));
            const errorCode = destMessage.updateErrorCode();
            this.stats.error++;

            this.statsAccumulator.increment(i + 1, Status.ERROR);
            const errOps: Array<(conn: PoolConnection) => Promise<void>> = [
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.ERROR, conn),
              (conn) => updateErrors(this.id, messageId, i + 1,
                String(error), undefined, errorCode, undefined, conn),
            ];

            if (this.storageSettings.storeMaps) {
              errOps.push((conn) => updateMaps(this.id, messageId, i + 1,
                destMessage.getConnectorMap(), destMessage.getChannelMap(), destMessage.getResponseMap(), conn));
            }

            errOps.push(...this.statsAccumulator.getFlushOps(this.id, serverId));
            await this.persistInTransaction(errOps);
            this.statsAccumulator.reset();
          }
        }
      }

      // Finish: source response + merged maps + mark processed
      const txn4Ops: Array<(conn: PoolConnection) => Promise<void>> = [];

      if (this.storageSettings.storeResponse) {
        for (let i = 0; i < this.destinationConnectors.length; i++) {
          const destMsg = message.getConnectorMessage(i + 1);
          if (destMsg && destMsg.getStatus() === Status.SENT) {
            const respContent = destMsg.getResponseContent();
            if (respContent) {
              sourceMessage.setContent({
                contentType: ContentType.RESPONSE,
                content: respContent.content,
                dataType: respContent.dataType,
                encrypted: false,
              });
              txn4Ops.push((conn) => storeContent(this.id, messageId, 0, ContentType.RESPONSE,
                respContent.content, respContent.dataType, this.encryptData, conn));
              break;
            }
          }
        }
      }

      // finishDispatch equivalent: update source connector metadata
      const sourceFinishDate2 = new Date();
      sourceMessage.setSendAttempts(1);
      sourceMessage.setSendDate(sourceFinishDate2);
      sourceMessage.setResponseDate(sourceFinishDate2);
      txn4Ops.push((conn) => updateSendAttempts(this.id, messageId, 0, 1, sourceFinishDate2, sourceFinishDate2, conn));

      // Persist source response error if present
      if (sourceMessage.getResponseError()) {
        txn4Ops.push((conn) => updateErrors(this.id, messageId, 0,
          undefined, undefined, sourceMessage.updateErrorCode(), sourceMessage.getResponseError(), conn));
      }

      if (this.postprocessorScript) {
        try {
          await this.executePostprocessor(message);
        } catch (postError) {
          sourceMessage.setPostProcessorError(String(postError));
          const errorCode = sourceMessage.updateErrorCode();
          await this.persistToDb(() => updateErrors(this.id, messageId, 0,
            undefined, String(postError), errorCode));
        }
      }

      if (this.storageSettings.storeMergedResponseMap) {
        const mergedMap = new Map<string, unknown>();
        for (let i = 0; i < this.destinationConnectors.length; i++) {
          const destMsg = message.getConnectorMessage(i + 1);
          if (destMsg) {
            for (const [k, v] of destMsg.getResponseMap()) {
              mergedMap.set(k, v);
            }
          }
        }
        if (mergedMap.size > 0) {
          txn4Ops.push((conn) => updateResponseMap(this.id, messageId, 0, mergedMap, conn));
        }
      }

      if (this.storageSettings.storeMaps) {
        txn4Ops.push((conn) => updateMaps(this.id, messageId, 0,
          sourceMessage.getConnectorMap(), sourceMessage.getChannelMap(), sourceMessage.getResponseMap(), conn));
      }

      message.setProcessed(true);
      txn4Ops.push((conn) => updateMessageProcessed(this.id, messageId, true, conn));

      if (this.storageSettings.removeContentOnCompletion) {
        const shouldRemove = !this.storageSettings.removeOnlyFilteredOnCompletion ||
          sourceMessage.getStatus() === Status.FILTERED;
        if (shouldRemove) {
          txn4Ops.push(async () => { await pruneMessageContent(this.id, [messageId]); });
        }
      }
      if (this.storageSettings.removeAttachmentsOnCompletion) {
        txn4Ops.push(async () => { await pruneMessageAttachments(this.id, [messageId]); });
      }

      await this.persistInTransaction(txn4Ops);
    } catch (error) {
      this.statsAccumulator.reset();
      sourceMessage.setStatus(Status.ERROR);
      sourceMessage.setProcessingError(String(error));
      const errorCode = sourceMessage.updateErrorCode();
      this.stats.error++;

      this.statsAccumulator.increment(0, Status.ERROR);
      await this.persistInTransaction([
        (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.ERROR, conn),
        (conn) => updateErrors(this.id, messageId, 0,
          String(error), undefined, errorCode, undefined, conn),
        ...this.statsAccumulator.getFlushOps(this.id, serverId),
      ]);
      this.statsAccumulator.reset();
    }

    // Final SOURCE_MAP write — upsert because storeMaps may have already INSERTed it during source intake
    const srcMap = sourceMessage.getSourceMap();
    if (srcMap.size > 0) {
      const mapObj = Object.fromEntries(srcMap);
      await this.persistToDb(() => storeContent(this.id, messageId, 0, ContentType.SOURCE_MAP, JSON.stringify(mapObj), 'JSON', false));
    }

    this.emit('messageComplete', { channelId: this.id, channelName: this.name, messageId });
  }
}
