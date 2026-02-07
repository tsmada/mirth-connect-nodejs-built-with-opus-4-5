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
import {
  JavaScriptExecutor,
  getDefaultExecutor,
} from '../../javascript/runtime/JavaScriptExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DeployedState, ChannelStatistics } from '../../api/models/DashboardStatus.js';
import { MetaDataColumn } from '../../api/models/ServerSettings.js';
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
  updateStatistics,
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
  private serverId: string = process.env.MIRTH_SERVER_ID || 'node-1';

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
  private async loadStatisticsFromDb(): Promise<void> {
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
      messageId = this.tablesExist ? await getNextMessageId(this.id) : this.nextMessageId++;
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
    sourceMessage.setContent({
      contentType: ContentType.RAW,
      content: rawData,
      dataType: 'RAW', // Default; connector-specific types applied during serialization
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
            dataType: 'RAW',
            encrypted: false,
          });
        }
      } catch (err) {
        console.error(`[${this.name}] Attachment extraction error: ${err}`);
        // Continue with original content if extraction fails
      }
    }

    // Increment received counter as soon as message enters the pipeline
    this.stats.received++;

    // Transaction 1: Source intake — persist message + source connector + raw content + stats
    await this.persistInTransaction([
      (conn) => insertMessage(this.id, messageId, serverId, messageData.receivedDate, conn),
      (conn) => insertConnectorMessage(this.id, messageId, 0, sourceMessage.getConnectorName(), sourceMessage.getReceivedDate(), Status.RECEIVED, 0, undefined, conn),
      ...(this.storageSettings.storeRaw ? [
        (conn: PoolConnection) => insertContent(this.id, messageId, 0, ContentType.RAW, rawData, 'RAW', false, conn),
      ] : []),
      (conn) => updateStatistics(this.id, 0, serverId, Status.RECEIVED, 1, conn),
    ]);

    try {
      // Execute preprocessor
      let processedData = rawData;
      if (this.preprocessorScript) {
        processedData = await this.executePreprocessor(rawData, sourceMessage);
        sourceMessage.setContent({
          contentType: ContentType.PROCESSED_RAW,
          content: processedData,
          dataType: 'RAW',
          encrypted: false,
        });

        // Persist PROCESSED_RAW content
        if (this.storageSettings.storeProcessedRaw) {
          await this.persistToDb(() => insertContent(this.id, messageId, 0, ContentType.PROCESSED_RAW, processedData, 'RAW', false));
        }
      }

      // Execute source filter/transformer
      if (this.sourceConnector) {
        const filtered = await this.sourceConnector.executeFilter(sourceMessage);
        if (filtered) {
          sourceMessage.setStatus(Status.FILTERED);
          this.stats.filtered++;
          await this.persistInTransaction([
            (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.FILTERED, conn),
            (conn) => updateStatistics(this.id, 0, serverId, Status.FILTERED, 1, conn),
          ]);
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
              transformedContent.content, transformedContent.dataType, false, conn));
          }
        }

        if (this.storageSettings.storeSourceEncoded) {
          const encodedContent = sourceMessage.getEncodedContent();
          if (encodedContent) {
            txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.ENCODED,
              encodedContent.content, encodedContent.dataType, false, conn));
          }
        }

        // Write sourceMap early (will be upserted again at end via storeContent)
        const srcMapEarly = sourceMessage.getSourceMap();
        if (srcMapEarly.size > 0) {
          txn2Ops.push((conn) => insertContent(this.id, messageId, 0, ContentType.SOURCE_MAP,
            JSON.stringify(Object.fromEntries(srcMapEarly)), 'JSON', false, conn));
        }

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
      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dest = this.destinationConnectors[i];
        if (!dest) continue;

        const destMessage = sourceMessage.clone(i + 1, dest.getName());
        message.setConnectorMessage(i + 1, destMessage);

        // Persist destination connector message
        await this.persistToDb(() => insertConnectorMessage(this.id, messageId, i + 1, dest.getName(), destMessage.getReceivedDate(), Status.RECEIVED));

        try {
          // Execute destination filter
          const filtered = await dest.executeFilter(destMessage);
          if (filtered) {
            destMessage.setStatus(Status.FILTERED);
            this.stats.filtered++;
            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.FILTERED, conn),
              (conn) => updateStatistics(this.id, i + 1, serverId, Status.FILTERED, 1, conn),
            ]);
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
                destEncoded.content, destEncoded.dataType, false));
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
                dataType: 'RAW',
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
          const destOps: Array<(conn: PoolConnection) => Promise<void>> = [
            (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.SENT, conn),
            (conn) => updateStatistics(this.id, i + 1, serverId, Status.SENT, 1, conn),
          ];

          if (this.storageSettings.storeSent) {
            const sentData = destMessage.getEncodedContent();
            if (sentData) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.SENT,
                sentData.content, sentData.dataType, false, conn));
            }
          }

          // Persist RESPONSE content (ContentType=6)
          if (this.storageSettings.storeResponse) {
            const respContent = destMessage.getResponseContent();
            if (respContent) {
              destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE,
                respContent.content, respContent.dataType, false, conn));
            }

            // Persist RESPONSE_TRANSFORMED content (ContentType=7)
            if (this.storageSettings.storeResponseTransformed) {
              const responseTransformed = destMessage.getContent(ContentType.RESPONSE_TRANSFORMED);
              if (responseTransformed) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.RESPONSE_TRANSFORMED,
                  responseTransformed.content, responseTransformed.dataType, false, conn));
              }
            }

            // Persist PROCESSED_RESPONSE content (ContentType=8)
            if (this.storageSettings.storeProcessedResponse) {
              const processedResponse = destMessage.getContent(ContentType.PROCESSED_RESPONSE);
              if (processedResponse) {
                destOps.push((conn) => storeContent(this.id, messageId, i + 1, ContentType.PROCESSED_RESPONSE,
                  processedResponse.content, processedResponse.dataType, false, conn));
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

          await this.persistInTransaction(destOps);
        } catch (error) {
          if (dest.isQueueEnabled()) {
            // Queue-enabled: set QUEUED status instead of ERROR
            destMessage.setStatus(Status.QUEUED);
            const queue = dest.getQueue();
            if (queue) {
              queue.add(destMessage);
            }
            this.stats.queued++;

            await this.persistInTransaction([
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.QUEUED, conn),
              (conn) => updateStatistics(this.id, i + 1, serverId, Status.QUEUED, 1, conn),
            ]);
          } else {
            // Non-queue destination: ERROR handling (original behavior)
            destMessage.setStatus(Status.ERROR);
            destMessage.setProcessingError(String(error));
            const errorCode = destMessage.updateErrorCode();
            this.stats.error++;

            // Error transaction: status + stats + error content + maps
            const errOps: Array<(conn: PoolConnection) => Promise<void>> = [
              (conn) => updateConnectorMessageStatus(this.id, messageId, i + 1, Status.ERROR, conn),
              (conn) => updateStatistics(this.id, i + 1, serverId, Status.ERROR, 1, conn),
              (conn) => updateErrors(this.id, messageId, i + 1,
                String(error), undefined, errorCode, undefined, conn),
            ];

            if (this.storageSettings.storeMaps) {
              errOps.push((conn) => updateMaps(this.id, messageId, i + 1,
                destMessage.getConnectorMap(), destMessage.getChannelMap(), destMessage.getResponseMap(), conn));
            }

            await this.persistInTransaction(errOps);
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
                respContent.content, respContent.dataType, false, conn));
              break;
            }
          }
        }
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
      sourceMessage.setStatus(Status.ERROR);
      sourceMessage.setProcessingError(String(error));
      const errorCode = sourceMessage.updateErrorCode();
      this.stats.error++;

      await this.persistInTransaction([
        (conn) => updateConnectorMessageStatus(this.id, messageId, 0, Status.ERROR, conn),
        (conn) => updateStatistics(this.id, 0, serverId, Status.ERROR, 1, conn),
        (conn) => updateErrors(this.id, messageId, 0,
          String(error), undefined, errorCode, undefined, conn),
      ]);
    }

    // Final SOURCE_MAP upsert — captures enrichments from postprocessor/destinations
    // Always persisted regardless of storeMaps flag — needed for trace feature
    const srcMap = sourceMessage.getSourceMap();
    if (srcMap.size > 0) {
      const mapObj = Object.fromEntries(srcMap);
      await this.persistToDb(() => storeContent(this.id, messageId, 0, ContentType.SOURCE_MAP, JSON.stringify(mapObj), 'JSON', false));
    }

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
}
