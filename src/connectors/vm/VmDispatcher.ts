/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/vm/VmDispatcher.java
 *
 * Purpose: VM destination connector that routes messages to other channels
 *
 * Key behaviors to replicate:
 * - Route messages to target channel via engine controller
 * - Support template variable replacement in channel template
 * - Propagate selected map variables to target channel
 * - Track source channel/message ID chain
 * - Return response from target channel
 */

import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { RawMessage } from '../../model/RawMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import {
  VmDispatcherProperties,
  getDefaultVmDispatcherProperties,
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
  SOURCE_MESSAGE_ID,
  SOURCE_MESSAGE_IDS,
  getSourceChannelIds,
  getSourceMessageIds,
} from './VmConnectorProperties.js';
import {
  GlobalMap,
  GlobalChannelMapStore,
  ConfigurationMap,
} from '../../javascript/userutil/MirthMap.js';

/**
 * Connection status event types for VM dispatcher
 */
export enum VmDispatcherStatus {
  IDLE = 'IDLE',
  SENDING = 'SENDING',
  DISCONNECTED = 'DISCONNECTED',
}

/**
 * Event listener for connection status changes
 */
export type DispatcherStatusListener = (
  status: VmDispatcherStatus,
  info?: string
) => void;

/**
 * Interface for the engine controller that can dispatch messages to channels
 */
export interface EngineController {
  dispatchRawMessage(
    channelId: string,
    rawMessage: RawMessage,
    force?: boolean,
    waitForCompletion?: boolean
  ): Promise<DispatchResult | null>;
}

/**
 * Result of dispatching a message to a channel
 */
export interface DispatchResult {
  messageId?: number;
  selectedResponse?: {
    message: string;
    status?: Status;
  };
}

/**
 * Template value replacer interface
 */
export interface TemplateReplacer {
  replaceValues(template: string, connectorMessage: ConnectorMessage): string;
}

export interface VmDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<VmDispatcherProperties>;
}

/**
 * VM Destination Connector - "Channel Writer"
 *
 * Routes messages to other channels in the same Mirth Connect instance.
 * The target channel receives the message as if it came from an external source.
 */
export class VmDispatcher extends DestinationConnector {
  private properties: VmDispatcherProperties;
  private statusListeners: DispatcherStatusListener[] = [];
  private engineController: EngineController | null = null;
  private templateReplacer: TemplateReplacer | null = null;

  // Maps for variable lookup
  private globalMap = GlobalMap.getInstance();
  private configurationMap = ConfigurationMap.getInstance();

  constructor(config: VmDispatcherConfig) {
    super({
      name: config.name ?? 'Channel Writer',
      transportName: 'VM',
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultVmDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector name (matches Java implementation)
   */
  static getConnectorName(): string {
    return 'Channel Writer';
  }

  /**
   * Get the protocol name
   */
  static getProtocol(): string {
    return 'VM';
  }

  /**
   * Get the connector properties
   */
  getProperties(): VmDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<VmDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Set the engine controller used to dispatch messages
   */
  setEngineController(controller: EngineController): void {
    this.engineController = controller;
  }

  /**
   * Set the template value replacer
   */
  setTemplateReplacer(replacer: TemplateReplacer): void {
    this.templateReplacer = replacer;
  }

  /**
   * Add a connection status listener
   */
  addStatusListener(listener: DispatcherStatusListener): void {
    this.statusListeners.push(listener);
  }

  /**
   * Remove a connection status listener
   */
  removeStatusListener(listener: DispatcherStatusListener): void {
    const index = this.statusListeners.indexOf(listener);
    if (index !== -1) {
      this.statusListeners.splice(index, 1);
    }
  }

  /**
   * Dispatch a connection status event
   */
  private dispatchStatusEvent(
    status: VmDispatcherStatus,
    info?: string
  ): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status, info);
      } catch (error) {
        console.error('Error in dispatcher status listener:', error);
      }
    }
  }

  /**
   * Start the VM dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.dispatchStatusEvent(VmDispatcherStatus.IDLE);
  }

  /**
   * Stop the VM dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.dispatchStatusEvent(VmDispatcherStatus.DISCONNECTED);
  }

  /**
   * Replace connector properties with values from the connector message
   */
  private replaceProperties(
    connectorMessage: ConnectorMessage
  ): VmDispatcherProperties {
    const replaced = { ...this.properties };

    if (this.templateReplacer) {
      replaced.channelId = this.templateReplacer.replaceValues(
        replaced.channelId,
        connectorMessage
      );
      replaced.channelTemplate = this.templateReplacer.replaceValues(
        replaced.channelTemplate,
        connectorMessage
      );
    }

    return replaced;
  }

  /**
   * Get a map value from various scopes (response, connector, channel, source, globalChannel, global, config)
   */
  private getMapValue(
    connectorMessage: ConnectorMessage,
    key: string
  ): unknown {
    // Check response map
    if (connectorMessage.getResponseMap().has(key)) {
      return connectorMessage.getResponseMap().get(key);
    }

    // Check connector map
    if (connectorMessage.getConnectorMap().has(key)) {
      return connectorMessage.getConnectorMap().get(key);
    }

    // Check channel map
    if (connectorMessage.getChannelMap().has(key)) {
      return connectorMessage.getChannelMap().get(key);
    }

    // Check source map
    if (connectorMessage.getSourceMap().has(key)) {
      return connectorMessage.getSourceMap().get(key);
    }

    // Check global channel map
    const channelId = connectorMessage.getChannelId();
    const globalChannelMap = GlobalChannelMapStore.getInstance().get(channelId);
    if (globalChannelMap.containsKey(key)) {
      return globalChannelMap.get(key);
    }

    // Check global map
    if (this.globalMap.containsKey(key)) {
      return this.globalMap.get(key);
    }

    // Check configuration map (most expensive lookup)
    if (this.configurationMap.containsKey(key)) {
      return this.configurationMap.get(key);
    }

    return undefined;
  }

  /**
   * Send message to the target channel
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // Replace properties with values from connector message
    const props = this.replaceProperties(connectorMessage);
    const targetChannelId = props.channelId;
    const currentChannelId = connectorMessage.getChannelId();

    this.dispatchStatusEvent(
      VmDispatcherStatus.SENDING,
      `Target Channel: ${targetChannelId}`
    );

    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatusMessage: string | null = null;
    let responseStatus = Status.QUEUED; // Always set to QUEUED initially

    try {
      if (targetChannelId !== 'none') {
        // Get the message content (from template)
        const messageContent = this.getMessageContent(connectorMessage, props);

        // Create raw message for target channel
        const rawMessage = new RawMessage({
          rawData: messageContent,
        });

        const rawSourceMap = rawMessage.getSourceMap();
        const sourceMap = connectorMessage.getSourceMap();

        // Build source channel/message ID chains
        const sourceChannelIds = getSourceChannelIds(sourceMap);
        const sourceMessageIds = getSourceMessageIds(sourceMap);

        // Add current channel to the chain if it's built
        if (sourceChannelIds !== null) {
          sourceChannelIds.push(currentChannelId);
          rawSourceMap.set(SOURCE_CHANNEL_IDS, sourceChannelIds);
        }

        // Add current message ID to the chain if it's built
        if (sourceMessageIds !== null) {
          sourceMessageIds.push(connectorMessage.getMessageId());
          rawSourceMap.set(SOURCE_MESSAGE_IDS, sourceMessageIds);
        }

        // Always store the originating channel ID and message ID
        rawSourceMap.set(SOURCE_CHANNEL_ID, currentChannelId);
        rawSourceMap.set(SOURCE_MESSAGE_ID, connectorMessage.getMessageId());

        // Propagate selected map variables
        if (props.mapVariables && props.mapVariables.length > 0) {
          for (const key of props.mapVariables) {
            const value = this.getMapValue(connectorMessage, key);
            if (value !== undefined) {
              rawSourceMap.set(key, value);
            }
          }
        }

        // Dispatch to target channel
        if (this.engineController) {
          const dispatchResult = await this.engineController.dispatchRawMessage(
            targetChannelId,
            rawMessage,
            false, // force
            true // waitForCompletion
          );

          // Get response from dispatch result
          if (dispatchResult?.selectedResponse) {
            responseData = dispatchResult.selectedResponse.message;
          }
        } else {
          throw new Error(
            'No engine controller configured for VM dispatcher'
          );
        }

        responseStatus = Status.SENT;
        responseStatusMessage = `Message routed successfully to channel id: ${targetChannelId}`;
      } else {
        // channelId is "none" - no routing
        responseStatus = Status.SENT;
        responseStatusMessage = 'No target channel configured (channelId = none)';
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      responseStatusMessage = `Error routing message to channel id: ${targetChannelId} - ${errorMessage}`;
      responseError = errorMessage;

      // Don't throw - let the response be set with error status
      console.error(
        `VM Dispatcher error routing to ${targetChannelId}:`,
        error
      );
    } finally {
      this.dispatchStatusEvent(VmDispatcherStatus.IDLE);
    }

    // Update connector message with results
    connectorMessage.setStatus(responseStatus);
    connectorMessage.setSendDate(new Date());

    // Set response content
    if (responseData) {
      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: responseData,
        dataType: 'RAW',
        encrypted: false,
      });
    }

    // Store connector map data
    connectorMessage.getConnectorMap().set('targetChannelId', targetChannelId);
    connectorMessage.getConnectorMap().set('responseStatusMessage', responseStatusMessage);

    if (responseError) {
      connectorMessage.setProcessingError(responseError);
    }
  }

  /**
   * Get the message content to send using the template
   */
  private getMessageContent(
    connectorMessage: ConnectorMessage,
    props: VmDispatcherProperties
  ): string {
    // The template is already replaced by replaceProperties()
    // But we need to handle special tokens like ${message.encodedData}

    let content = props.channelTemplate;

    // Replace ${message.encodedData} with encoded content
    if (content.includes('${message.encodedData}')) {
      const encoded = connectorMessage.getEncodedContent();
      const encodedData = encoded?.content ?? '';
      content = content.replace(/\$\{message\.encodedData\}/g, encodedData);
    }

    // Replace ${message.transformedData} with transformed content
    if (content.includes('${message.transformedData}')) {
      const transformed = connectorMessage.getTransformedContent();
      const transformedData = transformed?.content ?? '';
      content = content.replace(
        /\$\{message\.transformedData\}/g,
        transformedData
      );
    }

    // Replace ${message.rawData} with raw content
    if (content.includes('${message.rawData}')) {
      const raw = connectorMessage.getRawContent();
      const rawData = raw?.content ?? '';
      content = content.replace(/\$\{message\.rawData\}/g, rawData);
    }

    return content;
  }

  /**
   * Get the response for the sent message
   */
  async getResponse(
    connectorMessage: ConnectorMessage
  ): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content ?? null;
  }
}
