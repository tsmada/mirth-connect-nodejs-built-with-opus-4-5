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
import { FilterTransformerExecutor, FilterTransformerScripts } from './FilterTransformerExecutor.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { DeployedState } from '../../api/models/DashboardStatus.js';

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
   * Start the source connector (begin listening/polling)
   */
  abstract start(): Promise<void>;

  /**
   * Stop the source connector
   */
  abstract stop(): Promise<void>;

  /** Override in subclasses for custom start logic */
  protected async onStart(): Promise<void> {}

  /** Override in subclasses for custom stop logic */
  protected async onStop(): Promise<void> {}

  /**
   * Dispatch a raw message to the channel
   */
  protected async dispatchRawMessage(
    rawData: string,
    sourceMap?: Map<string, unknown>
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('Source connector is not attached to a channel');
    }

    await this.channel.dispatchRawMessage(rawData, sourceMap);
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
      return;
    }

    const result = await this.filterTransformerExecutor.executeTransformer(connectorMessage);

    // Set transformed content on connector message
    if (result.transformedData !== undefined) {
      connectorMessage.setTransformedData(result.transformedData, result.transformedDataType ?? 'XML');
    }
  }
}
