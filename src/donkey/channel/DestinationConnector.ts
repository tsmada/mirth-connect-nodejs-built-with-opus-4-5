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
import { FilterTransformerExecutor, FilterTransformerScripts } from './FilterTransformerExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DestinationQueue } from '../queue/DestinationQueue.js';
import { ResponseValidator } from '../message/ResponseValidator.js';
import { DeployedState } from '../../api/models/DashboardStatus.js';

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
    this.running = true;
  }

  /**
   * Stop the destination connector
   */
  async stop(): Promise<void> {
    this.running = false;
  }

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
   * Execute the response transformer
   */
  async executeResponseTransformer(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.responseTransformerExecutor) {
      return;
    }

    await this.responseTransformerExecutor.executeTransformer(connectorMessage);
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
