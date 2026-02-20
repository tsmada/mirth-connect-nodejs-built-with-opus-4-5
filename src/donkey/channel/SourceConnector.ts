/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/SourceConnector.java
 *
 * Purpose: Base class for source connectors that receive incoming messages
 *
 * Key behaviors to replicate:
 * - Receive messages and dispatch to channel
 * - Execute source filter and transformer
 * - Generate responses
 * - Track deployed state with event dispatching
 */

import type { Channel } from './Channel.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ContentType } from '../../model/ContentType.js';
import type { Message } from '../../model/Message.js';
import {
  FilterTransformerExecutor,
  FilterTransformerScripts,
} from './FilterTransformerExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DeployedState } from '../../api/models/DashboardStatus.js';
import type { BatchAdaptor } from '../message/BatchAdaptor.js';
import { dashboardStatusController } from '../../plugins/dashboardstatus/DashboardStatusController.js';
import type {
  ConnectionStatusEvent,
  ConnectorCountEvent,
} from '../../plugins/dashboardstatus/DashboardStatusController.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';

export interface SourceConnectorConfig {
  name: string;
  transportName: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  respondAfterProcessing?: boolean;
}

export abstract class SourceConnector {
  protected name: string;
  protected transportName: string;
  protected channel: Channel | null = null;
  protected running = false;

  protected waitForDestinations: boolean;
  protected queueSendFirst: boolean;
  protected respondAfterProcessing: boolean;

  protected filterTransformerExecutor: FilterTransformerExecutor | null = null;

  protected inboundDataType: string = 'RAW';

  /**
   * Current deployed state of this connector.
   * Matches Java Mirth Connector.java:27
   */
  protected currentState: DeployedState = DeployedState.STOPPED;

  constructor(config: SourceConnectorConfig) {
    this.name = config.name;
    this.transportName = config.transportName;
    this.waitForDestinations = config.waitForDestinations ?? false;
    this.queueSendFirst = config.queueSendFirst ?? false;
    this.respondAfterProcessing = config.respondAfterProcessing ?? true;
  }

  getInboundDataType(): string {
    return this.inboundDataType;
  }

  setInboundDataType(dataType: string): void {
    this.inboundDataType = dataType;
  }

  getRespondAfterProcessing(): boolean {
    return this.respondAfterProcessing;
  }

  setRespondAfterProcessing(value: boolean): void {
    this.respondAfterProcessing = value;
  }

  getName(): string {
    return this.name;
  }

  getTransportName(): string {
    return this.transportName;
  }

  setChannel(channel: Channel): void {
    this.channel = channel;
    // Create filter/transformer executor with channel context
    this.createFilterTransformerExecutor();
  }

  getChannel(): Channel | null {
    return this.channel;
  }

  private createFilterTransformerExecutor(): void {
    if (!this.channel) return;

    const context: ScriptContext = {
      channelId: this.channel.getId(),
      channelName: this.channel.getName(),
      connectorName: this.name,
      metaDataId: 0,
    };

    this.filterTransformerExecutor = new FilterTransformerExecutor(context);
  }

  setFilterTransformer(scripts: FilterTransformerScripts): void {
    if (!this.filterTransformerExecutor) {
      // Create executor with default context if channel not set yet
      const context: ScriptContext = {
        channelId: '',
        channelName: '',
        connectorName: this.name,
        metaDataId: 0,
      };
      this.filterTransformerExecutor = new FilterTransformerExecutor(context, scripts);
    } else {
      this.filterTransformerExecutor.setScripts(scripts);
    }
  }

  getFilterTransformerExecutor(): FilterTransformerExecutor | null {
    return this.filterTransformerExecutor;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Whether this source connector uses polling to acquire messages.
   * Override to return true in File and Database receivers.
   * Used by Channel to determine if cluster lease coordination is needed.
   */
  isPollingConnector(): boolean {
    return false;
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
   * Matches Java Mirth SourceConnector.updateCurrentState() in SourceConnector.java:86-88
   */
  updateCurrentState(newState: DeployedState): void {
    this.setCurrentState(newState);
    // Dispatch state change event through channel's event emitter
    if (this.channel) {
      this.channel.emit('connectorStateChange', {
        channelId: this.channel.getId(),
        channelName: this.channel.getName(),
        metaDataId: 0, // Source connector is always metaDataId 0
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
   * - onPoll: POLLING → READING → IDLE
   * - onReceive: RECEIVING → IDLE
   * - onError: use dispatchConnectionEvent with error message
   * - onStop: DISCONNECTED
   */
  protected dispatchConnectionEvent(state: ConnectionStatusEventType, message?: string): void {
    if (!this.channel) return;
    const event: ConnectionStatusEvent = {
      channelId: this.channel.getId(),
      metadataId: 0, // Source connector is always metaDataId 0
      state,
      message,
      channelName: this.channel.getName(),
      connectorType: this.transportName,
    };
    dashboardStatusController.processEvent(event);
  }

  /**
   * Dispatch a ConnectorCountEvent (e.g., TCP connections opened/closed).
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
      metadataId: 0,
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

  /**
   * Start the source connector (begin listening/polling)
   */
  abstract start(): Promise<void>;

  /**
   * Stop the source connector
   */
  abstract stop(): Promise<void>;

  /**
   * Emergency halt the connector.
   * Matches Java SourceConnector.halt() — sets STOPPING, calls onHalt(),
   * dispatches IDLE event, then sets STOPPED.
   *
   * Java: SourceConnector.java:96-107
   */
  async halt(): Promise<void> {
    this.updateCurrentState(DeployedState.STOPPING);
    try {
      await this.onHalt();
    } finally {
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
      this.updateCurrentState(DeployedState.STOPPED);
    }
  }

  /** Override in subclasses for custom start logic */
  protected async onStart(): Promise<void> {}

  /** Override in subclasses for custom stop logic */
  protected async onStop(): Promise<void> {}

  /**
   * Override in subclasses for custom halt logic.
   * Default delegates to stop() — subclasses can override for
   * faster/more aggressive shutdown behavior.
   * Matches Java SourceConnector.onHalt() which is abstract but
   * most implementations delegate to onStop().
   */
  protected async onHalt(): Promise<void> {
    await this.onStop();
  }

  /**
   * Dispatch a raw message to the channel.
   *
   * Returns the processed Message object, matching Java's SourceConnector.dispatchRawMessage()
   * which returns DispatchResult containing the processed message. Subclasses that need
   * the processed message (e.g., DatabaseReceiver for update scripts, TcpReceiver for
   * response handling) can capture the return value.
   */
  protected async dispatchRawMessage(
    rawData: string,
    sourceMap?: Map<string, unknown>
  ): Promise<Message> {
    if (!this.channel) {
      throw new Error('Source connector is not attached to a channel');
    }

    return this.channel.dispatchRawMessage(rawData, sourceMap);
  }

  /**
   * Execute the source filter
   * @returns true if message should be filtered (rejected), false to continue processing
   */
  async executeFilter(connectorMessage: ConnectorMessage): Promise<boolean> {
    if (!this.filterTransformerExecutor) {
      return false; // No executor, continue processing
    }

    return this.filterTransformerExecutor.executeFilter(connectorMessage);
  }

  /**
   * Execute the source transformer
   */
  async executeTransformer(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.filterTransformerExecutor) {
      // No executor — set encoded content from raw content (passthrough)
      // Java Mirth: FilterTransformerExecutor always sets encoded content
      const raw = connectorMessage.getRawContent();
      if (raw) {
        connectorMessage.setContent({
          contentType: ContentType.ENCODED,
          content: raw.content,
          dataType: raw.dataType,
          encrypted: raw.encrypted,
        });
      }
      return;
    }

    const result = await this.filterTransformerExecutor.executeTransformer(connectorMessage);

    // Java Mirth: FilterTransformerExecutor.processConnectorMessage() throws DonkeyException
    // on transformer errors, which stops the pipeline. Match that behavior.
    if (result.error) {
      throw new Error(`Transformer error: ${result.error}`);
    }

    // Set transformed content on connector message
    if (result.transformedData !== undefined) {
      connectorMessage.setTransformedData(
        result.transformedData,
        result.transformedDataType ?? 'XML'
      );

      // Java Mirth: FilterTransformerExecutor.java:142 — always set ENCODED content
      // For RAW serialization type, encoded = transformed
      connectorMessage.setContent({
        contentType: ContentType.ENCODED,
        content: result.transformedData,
        dataType: result.transformedDataType ?? 'RAW',
        encrypted: false,
      });
    }
  }

  /**
   * Dispatch a batch of messages through the channel using a BatchAdaptor.
   *
   * Ported from Java Mirth SourceConnector.dispatchBatchMessage().
   * The adaptor splits a single raw payload into individual sub-messages,
   * each dispatched independently through the full channel pipeline.
   * The sourceMap for each sub-message receives batchSequenceId and batchComplete metadata.
   */
  async dispatchBatchMessage(
    _rawData: string,
    batchAdaptor: BatchAdaptor,
    sourceMap?: Map<string, unknown>
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('Source connector is not attached to a channel');
    }

    while (!batchAdaptor.isBatchComplete()) {
      const subMessage = await batchAdaptor.getMessage();
      if (subMessage === null) break;

      const batchSourceMap = new Map<string, unknown>(sourceMap);
      batchSourceMap.set('batchSequenceId', batchAdaptor.getBatchSequenceId());
      batchSourceMap.set('batchComplete', batchAdaptor.isBatchComplete());

      await this.channel.dispatchRawMessage(subMessage, batchSourceMap);
    }

    batchAdaptor.cleanup();
  }
}
