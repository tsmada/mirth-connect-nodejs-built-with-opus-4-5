/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/DestinationConnector.java
 *
 * Purpose: Base class for destination connectors that send outgoing messages
 *
 * Key behaviors to replicate:
 * - Execute destination filter and transformer
 * - Send messages to external systems
 * - Handle responses
 * - Queue management for retry
 * - Track deployed state with event dispatching
 */

import type { Channel } from './Channel.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ContentType } from '../../model/ContentType.js';
import { Status } from '../../model/Status.js';
import {
  FilterTransformerExecutor,
  FilterTransformerScripts,
} from './FilterTransformerExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DestinationQueue } from '../queue/DestinationQueue.js';
import { ResponseValidator } from '../message/ResponseValidator.js';
import { DeployedState } from '../../api/models/DashboardStatus.js';
import { dashboardStatusController } from '../../plugins/dashboardstatus/DashboardStatusController.js';
import type {
  ConnectionStatusEvent,
  ConnectorCountEvent,
} from '../../plugins/dashboardstatus/DashboardStatusController.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });
}

export interface DestinationConnectorConfig {
  name: string;
  metaDataId: number;
  transportName: string;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
}

export interface DestinationFilterTransformerConfig extends FilterTransformerScripts {
  responseTransformerScripts?: FilterTransformerScripts;
}

export abstract class DestinationConnector {
  protected name: string;
  protected metaDataId: number;
  protected transportName: string;
  protected channel: Channel | null = null;
  protected running = false;
  protected enabled: boolean;

  protected waitForPrevious: boolean;
  protected queueEnabled: boolean;
  protected queueSendFirst: boolean;
  protected retryCount: number;
  protected retryIntervalMillis: number;

  protected filterTransformerExecutor: FilterTransformerExecutor | null = null;
  protected responseTransformerExecutor: FilterTransformerExecutor | null = null;
  protected queue: DestinationQueue | null = null;
  protected responseValidator: ResponseValidator | null = null;

  private queueAbortController: AbortController | null = null;
  private queueProcessingPromise: Promise<void> | null = null;

  /**
   * Current deployed state of this connector.
   * Matches Java Mirth Connector.java:27
   */
  protected currentState: DeployedState = DeployedState.STOPPED;

  constructor(config: DestinationConnectorConfig) {
    this.name = config.name;
    this.metaDataId = config.metaDataId;
    this.transportName = config.transportName;
    this.enabled = config.enabled ?? true;
    this.waitForPrevious = config.waitForPrevious ?? false;
    this.queueEnabled = config.queueEnabled ?? false;
    this.queueSendFirst = config.queueSendFirst ?? false;
    this.retryCount = config.retryCount ?? 0;
    this.retryIntervalMillis = config.retryIntervalMillis ?? 10000;
  }

  getName(): string {
    return this.name;
  }

  getMetaDataId(): number {
    return this.metaDataId;
  }

  getTransportName(): string {
    return this.transportName;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setChannel(channel: Channel): void {
    this.channel = channel;
    // Create filter/transformer executors with channel context
    this.createFilterTransformerExecutors();
  }

  getChannel(): Channel | null {
    return this.channel;
  }

  private createFilterTransformerExecutors(): void {
    if (!this.channel) return;

    const context: ScriptContext = {
      channelId: this.channel.getId(),
      channelName: this.channel.getName(),
      connectorName: this.name,
      metaDataId: this.metaDataId,
    };

    this.filterTransformerExecutor = new FilterTransformerExecutor(context);
    this.responseTransformerExecutor = new FilterTransformerExecutor(context);
  }

  setFilterTransformer(config: DestinationFilterTransformerConfig): void {
    const context: ScriptContext = this.channel
      ? {
          channelId: this.channel.getId(),
          channelName: this.channel.getName(),
          connectorName: this.name,
          metaDataId: this.metaDataId,
        }
      : {
          channelId: '',
          channelName: '',
          connectorName: this.name,
          metaDataId: this.metaDataId,
        };

    if (!this.filterTransformerExecutor) {
      this.filterTransformerExecutor = new FilterTransformerExecutor(context, config);
    } else {
      this.filterTransformerExecutor.setScripts(config);
    }

    if (config.responseTransformerScripts) {
      if (!this.responseTransformerExecutor) {
        this.responseTransformerExecutor = new FilterTransformerExecutor(
          context,
          config.responseTransformerScripts
        );
      } else {
        this.responseTransformerExecutor.setScripts(config.responseTransformerScripts);
      }
    }
  }

  getFilterTransformerExecutor(): FilterTransformerExecutor | null {
    return this.filterTransformerExecutor;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current deployed state of this connector.
   * Matches Java Mirth Connector.getCurrentState()
   */
  getCurrentState(): DeployedState {
    return this.currentState;
  }

  /**
   * Set the current state (without event dispatch).
   * Matches Java Mirth Connector.setCurrentState()
   */
  setCurrentState(state: DeployedState): void {
    this.currentState = state;
  }

  /**
   * Update current state and dispatch event via channel.
   * Matches Java Mirth DestinationConnector.updateCurrentState() in DestinationConnector.java:270-273
   */
  updateCurrentState(newState: DeployedState): void {
    this.setCurrentState(newState);
    // Dispatch state change event through channel's event emitter
    if (this.channel) {
      this.channel.emit('connectorStateChange', {
        channelId: this.channel.getId(),
        channelName: this.channel.getName(),
        metaDataId: this.metaDataId,
        connectorName: this.name,
        state: newState,
      });
    }
  }

  /**
   * Dispatch a ConnectionStatusEvent to the DashboardStatusController.
   * Matches Java Mirth's eventController.dispatchEvent(new ConnectionStatusEvent(...)) pattern.
   *
   * Subclasses call this at lifecycle boundaries:
   * - onStart: IDLE
   * - onSend: SENDING/WRITING → IDLE (in finally)
   * - onError: with error message
   * - onStop: DISCONNECTED
   */
  protected dispatchConnectionEvent(state: ConnectionStatusEventType, message?: string): void {
    if (!this.channel) return;
    const event: ConnectionStatusEvent = {
      channelId: this.channel.getId(),
      metadataId: this.metaDataId,
      state,
      message,
      channelName: this.channel.getName(),
      connectorType: this.transportName,
    };
    dashboardStatusController.processEvent(event);
  }

  /**
   * Dispatch a ConnectorCountEvent (e.g., persistent connections opened/closed).
   * Matches Java's ConnectorCountEvent pattern for tracking concurrent connections.
   */
  protected dispatchConnectorCountEvent(
    increment: boolean,
    message?: string,
    maximum?: number
  ): void {
    if (!this.channel) return;
    const event: ConnectorCountEvent = {
      channelId: this.channel.getId(),
      metadataId: this.metaDataId,
      state: increment
        ? ConnectionStatusEventType.CONNECTED
        : ConnectionStatusEventType.DISCONNECTED,
      message,
      channelName: this.channel.getName(),
      connectorType: this.transportName,
      increment,
      maximum,
    };
    dashboardStatusController.processEvent(event);
  }

  isQueueEnabled(): boolean {
    return this.queueEnabled;
  }

  /**
   * Check if queue should send first before queuing
   */
  shouldSendFirst(): boolean {
    return this.queueSendFirst;
  }

  /**
   * Get the retry count for queue processing
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Get the retry interval in milliseconds for queue processing
   */
  getRetryIntervalMillis(): number {
    return this.retryIntervalMillis;
  }

  /**
   * Get the destination queue
   */
  getQueue(): DestinationQueue | null {
    return this.queue;
  }

  /**
   * Set the destination queue
   */
  setQueue(queue: DestinationQueue): void {
    this.queue = queue;
  }

  /**
   * Get the response validator
   */
  getResponseValidator(): ResponseValidator | null {
    return this.responseValidator;
  }

  /**
   * Set the response validator.
   * Used to validate responses after send() — e.g., HL7 NAK detection.
   */
  setResponseValidator(validator: ResponseValidator): void {
    this.responseValidator = validator;
  }

  /**
   * Start the destination connector
   */
  async start(): Promise<void> {
    this.updateCurrentState(DeployedState.STARTING);
    await this.onStart();
    this.running = true;
    this.updateCurrentState(DeployedState.STARTED);
  }

  /**
   * Stop the destination connector
   */
  async stop(): Promise<void> {
    this.updateCurrentState(DeployedState.STOPPING);
    await this.onStop();
    this.running = false;
    this.updateCurrentState(DeployedState.STOPPED);
  }

  /** Override in subclasses for custom start logic */
  protected async onStart(): Promise<void> {}

  /** Override in subclasses for custom stop logic */
  protected async onStop(): Promise<void> {}

  /**
   * Execute the destination filter
   * @returns true if message should be filtered (rejected), false to continue processing
   */
  async executeFilter(connectorMessage: ConnectorMessage): Promise<boolean> {
    if (!this.filterTransformerExecutor) {
      return false; // No executor, continue processing
    }

    return this.filterTransformerExecutor.executeFilter(connectorMessage);
  }

  /**
   * Execute the destination transformer
   */
  async executeTransformer(connectorMessage: ConnectorMessage): Promise<void> {
    // Get the input content - prefer transformed content from source, fall back to raw
    const transformed = connectorMessage.getTransformedContent();

    if (!this.filterTransformerExecutor) {
      // If no executor, copy transformed content from source as encoded
      if (transformed) {
        connectorMessage.setContent({
          contentType: ContentType.ENCODED,
          content: transformed.content,
          dataType: transformed.dataType,
          encrypted: false,
        });
      }
      return;
    }

    const result = await this.filterTransformerExecutor.executeTransformer(connectorMessage);

    // Set encoded content on connector message
    // When no transformer steps, use transformed content from source
    if (result.transformedData !== undefined) {
      // If result matches raw content and we have transformed content, use transformed
      const raw = connectorMessage.getRawContent();
      if (
        transformed &&
        result.transformedData === raw?.content &&
        result.transformedData !== transformed.content
      ) {
        connectorMessage.setContent({
          contentType: ContentType.ENCODED,
          content: transformed.content,
          dataType: transformed.dataType,
          encrypted: false,
        });
      } else {
        connectorMessage.setContent({
          contentType: ContentType.ENCODED,
          content: result.transformedData,
          dataType: result.transformedDataType ?? 'XML',
          encrypted: false,
        });
      }
    } else if (transformed) {
      // No transformer output, use transformed content from source
      connectorMessage.setContent({
        contentType: ContentType.ENCODED,
        content: transformed.content,
        dataType: transformed.dataType,
        encrypted: false,
      });
    }
  }

  /**
   * Get the response data type from the response transformer's inbound configuration.
   * Matches Java Mirth: responseTransformerExecutor.getInbound().getType()
   * Falls back to 'RAW' if no response transformer is configured.
   */
  getResponseDataType(): string {
    if (this.responseTransformerExecutor) {
      return this.responseTransformerExecutor.getInboundDataType();
    }
    return 'RAW';
  }

  /**
   * Execute the response transformer
   */
  async executeResponseTransformer(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.responseTransformerExecutor) {
      return;
    }

    await this.responseTransformerExecutor.executeTransformer(connectorMessage);
  }

  /**
   * Start the background queue processing loop.
   * Replaces Java's Thread-based DestinationConnector.run().
   */
  startQueueProcessing(): void {
    if (!this.queueEnabled || !this.queue) return;
    this.queueAbortController = new AbortController();
    this.queueProcessingPromise = this.processQueue(this.queueAbortController.signal);
  }

  /**
   * Stop the background queue processing loop gracefully.
   */
  async stopQueueProcessing(): Promise<void> {
    if (this.queueAbortController) {
      this.queueAbortController.abort();
      try {
        await this.queueProcessingPromise;
      } catch {
        // Expected: abort error
      }
      this.queueAbortController = null;
      this.queueProcessingPromise = null;
    }
  }

  /**
   * Background queue processing loop.
   * Ported from Java DestinationConnector.run() (lines 299-878).
   */
  private async processQueue(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let connectorMessage: ConnectorMessage | null = null;

      try {
        connectorMessage = this.queue!.acquire();

        if (!connectorMessage) {
          // No messages available, wait before polling again
          await sleep(this.retryIntervalMillis, signal);
          continue;
        }

        // Retry delay for messages that have been attempted before
        if (connectorMessage.getSendAttempts() > 0) {
          await sleep(this.retryIntervalMillis, signal);
        }

        // Increment send attempts
        connectorMessage.incrementSendAttempts();

        // Attempt to send
        await this.send(connectorMessage);
        const sendDate = new Date();

        // Get and validate response
        let response = await this.getResponse(connectorMessage);
        if (this.responseValidator) {
          response = this.responseValidator.validate(response, connectorMessage);
        }

        // If validator set status to ERROR, release for retry
        if (connectorMessage.getStatus() === Status.ERROR) {
          if (this.shouldPermanentlyFail(connectorMessage)) {
            this.queue!.release(connectorMessage, true);
          } else {
            this.queue!.release(connectorMessage, false);
          }
          continue;
        }

        // Success
        connectorMessage.setStatus(Status.SENT);
        connectorMessage.setSendDate(sendDate);

        // Persist status update
        if (this.channel) {
          const channelId = this.channel.getId();
          const serverId = connectorMessage.getServerId();
          const messageId = connectorMessage.getMessageId();
          const metaDataId = connectorMessage.getMetaDataId();

          try {
            const { updateConnectorMessageStatus, updateSendAttempts, updateStatistics } =
              await import('../../db/DonkeyDao.js');
            await updateConnectorMessageStatus(channelId, messageId, metaDataId, Status.SENT);
            await updateSendAttempts(
              channelId,
              messageId,
              metaDataId,
              connectorMessage.getSendAttempts(),
              sendDate
            );
            await updateStatistics(channelId, metaDataId, serverId, Status.SENT);
          } catch (dbErr) {
            logger.error(`[${this.name}] Queue DB persist error: ${dbErr}`);
          }
        }

        this.queue!.release(connectorMessage, true);
      } catch (error) {
        if (signal.aborted) break;

        if (connectorMessage) {
          if (this.shouldPermanentlyFail(connectorMessage)) {
            // Max retries exceeded - permanent failure
            connectorMessage.setStatus(Status.ERROR);
            connectorMessage.setProcessingError(String(error));

            if (this.channel) {
              try {
                const { updateConnectorMessageStatus, updateErrors, updateStatistics } =
                  await import('../../db/DonkeyDao.js');
                const channelId = this.channel.getId();
                const messageId = connectorMessage.getMessageId();
                const metaDataId = connectorMessage.getMetaDataId();
                await updateConnectorMessageStatus(channelId, messageId, metaDataId, Status.ERROR);
                await updateErrors(channelId, messageId, metaDataId, String(error));
                await updateStatistics(
                  channelId,
                  metaDataId,
                  connectorMessage.getServerId(),
                  Status.ERROR
                );
              } catch (dbErr) {
                logger.error(`[${this.name}] Queue error persist error: ${dbErr}`);
              }
            }

            this.queue!.release(connectorMessage, true);
          } else {
            // Release for retry
            this.queue!.release(connectorMessage, false);
          }
        }
      }
    }
  }

  private shouldPermanentlyFail(connectorMessage: ConnectorMessage): boolean {
    return this.retryCount > 0 && connectorMessage.getSendAttempts() >= this.retryCount;
  }

  /**
   * Send the message to the destination
   * Must be implemented by concrete connector classes
   */
  abstract send(connectorMessage: ConnectorMessage): Promise<void>;

  /**
   * Get the response for the sent message
   */
  abstract getResponse(connectorMessage: ConnectorMessage): Promise<string | null>;
}
