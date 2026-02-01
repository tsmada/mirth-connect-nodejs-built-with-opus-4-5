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
 */

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

export type ChannelState = 'STOPPED' | 'STARTING' | 'STARTED' | 'PAUSING' | 'PAUSED' | 'STOPPING';

export class Channel {
  private id: string;
  private name: string;
  private description: string;
  private enabled: boolean;
  private state: ChannelState = 'STOPPED';
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

  constructor(config: ChannelConfig) {
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

  getState(): ChannelState {
    return this.state;
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

  async start(): Promise<void> {
    if (this.state !== 'STOPPED' && this.state !== 'PAUSED') {
      throw new Error(`Cannot start channel in state: ${this.state}`);
    }

    this.state = 'STARTING';

    try {
      // Execute deploy script
      if (this.deployScript) {
        await this.executeScript(this.deployScript, 'deploy');
      }

      // Start source connector
      if (this.sourceConnector) {
        await this.sourceConnector.start();
      }

      // Start destination connectors
      for (const dest of this.destinationConnectors) {
        await dest.start();
      }

      this.state = 'STARTED';
    } catch (error) {
      this.state = 'STOPPED';
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'STOPPED') {
      return;
    }

    this.state = 'STOPPING';

    try {
      // Stop source connector first
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
    } finally {
      this.state = 'STOPPED';
    }
  }

  async pause(): Promise<void> {
    if (this.state !== 'STARTED') {
      throw new Error(`Cannot pause channel in state: ${this.state}`);
    }

    this.state = 'PAUSING';

    if (this.sourceConnector) {
      await this.sourceConnector.stop();
    }

    this.state = 'PAUSED';
  }

  async resume(): Promise<void> {
    if (this.state !== 'PAUSED') {
      throw new Error(`Cannot resume channel in state: ${this.state}`);
    }

    if (this.sourceConnector) {
      await this.sourceConnector.start();
    }

    this.state = 'STARTED';
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
            continue;
          }

          // Execute destination transformer
          await dest.executeTransformer(destMessage);
          destMessage.setStatus(Status.TRANSFORMED);

          // Send to destination
          await dest.send(destMessage);
          destMessage.setStatus(Status.SENT);
          destMessage.setSendDate(new Date());
        } catch (error) {
          destMessage.setStatus(Status.ERROR);
          destMessage.setProcessingError(String(error));
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
