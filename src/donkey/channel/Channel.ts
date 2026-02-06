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

export interface ChannelConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  preprocessorScript?: string;
  postprocessorScript?: string;
  deployScript?: string;
  undeployScript?: string;
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
  private serverId: string = 'node-1';

  private sourceConnector: SourceConnector | null = null;
  private destinationConnectors: DestinationConnector[] = [];

  // Scripts
  private preprocessorScript?: string;
  private postprocessorScript?: string;
  private deployScript?: string;
  private undeployScript?: string;

  // JavaScript executor
  private executor: JavaScriptExecutor;

  // Message ID sequence
  private nextMessageId = 1;

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

      // Start destination connectors first (they need to be ready to receive)
      for (const dest of this.destinationConnectors) {
        await dest.start();
        startedConnectors.push(dest);
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
   * Dispatch a raw message through the channel pipeline
   */
  async dispatchRawMessage(
    rawData: string,
    sourceMapData?: Map<string, unknown>
  ): Promise<Message> {
    const messageId = this.nextMessageId++;
    const serverId = this.serverId;

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
      dataType: 'RAW', // TODO: Get from source connector config
      encrypted: false,
    });

    // Copy source map data
    if (sourceMapData) {
      for (const [key, value] of sourceMapData) {
        sourceMessage.getSourceMap().set(key, value);
      }
    }

    message.setConnectorMessage(0, sourceMessage);

    // Increment received counter as soon as message enters the pipeline
    this.stats.received++;

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
      }

      // Execute source filter/transformer
      if (this.sourceConnector) {
        const filtered = await this.sourceConnector.executeFilter(sourceMessage);
        if (filtered) {
          sourceMessage.setStatus(Status.FILTERED);
          this.stats.filtered++;
          message.setProcessed(true);
          return message;
        }

        await this.sourceConnector.executeTransformer(sourceMessage);
        sourceMessage.setStatus(Status.TRANSFORMED);
      }

      // Dispatch to destinations
      for (let i = 0; i < this.destinationConnectors.length; i++) {
        const dest = this.destinationConnectors[i];
        if (!dest) continue;

        const destMessage = sourceMessage.clone(i + 1, dest.getName());
        message.setConnectorMessage(i + 1, destMessage);

        try {
          // Execute destination filter
          const filtered = await dest.executeFilter(destMessage);
          if (filtered) {
            destMessage.setStatus(Status.FILTERED);
            this.stats.filtered++;
            continue;
          }

          // Execute destination transformer
          await dest.executeTransformer(destMessage);
          destMessage.setStatus(Status.TRANSFORMED);

          // Send to destination
          await dest.send(destMessage);
          destMessage.setStatus(Status.SENT);
          destMessage.setSendDate(new Date());
          this.stats.sent++;
        } catch (error) {
          destMessage.setStatus(Status.ERROR);
          destMessage.setProcessingError(String(error));
          this.stats.error++;
        }
      }

      // Execute postprocessor
      if (this.postprocessorScript) {
        await this.executePostprocessor(message);
      }

      message.setProcessed(true);
    } catch (error) {
      sourceMessage.setStatus(Status.ERROR);
      sourceMessage.setProcessingError(String(error));
      this.stats.error++;
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
