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
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
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
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('vm-connector', 'Channel Writer/Reader');
const logger = getLogger('vm-connector');

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
export type DispatcherStatusListener = (status: VmDispatcherStatus, info?: string) => void;

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
   * Set the template value replacer (kept for backward compatibility)
   * Note: replaceConnectorProperties() now handles ${variable} resolution directly.
   * This method is retained for callers that set a templateReplacer.
   */
  setTemplateReplacer(_replacer: TemplateReplacer): void {
    // No-op: resolveVariables() handles ${variable} resolution directly.
    // Kept for API compatibility with existing callers.
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
  private dispatchStatusEvent(status: VmDispatcherStatus, info?: string): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status, info);
      } catch (error) {
        logger.error('Error in dispatcher status listener', error as Error);
      }
    }
  }

  /**
   * Start the VM dispatcher — matches Java onStart() (line 68-70)
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    // Dispatch IDLE via base class (dashboard integration) — matches Java line 69
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    this.dispatchStatusEvent(VmDispatcherStatus.IDLE);
  }

  /**
   * Stop the VM dispatcher — matches Java onStop()/onHalt() (lines 73-80)
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    // Dispatch DISCONNECTED via base class (dashboard integration) — matches Java line 74/79
    this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED);
    this.dispatchStatusEvent(VmDispatcherStatus.DISCONNECTED);
  }

  /**
   * CPC-W18-003: Resolve ${variable} placeholders in connector properties before each send.
   * Matches Java VmDispatcher.replaceConnectorProperties() (line 83-88):
   * Resolves channelId and channelTemplate.
   * Returns a shallow clone — original properties are NOT modified.
   */
  replaceConnectorProperties(
    props: VmDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): VmDispatcherProperties {
    const resolved = { ...props };

    resolved.channelId = this.resolveVariables(resolved.channelId, connectorMessage);
    resolved.channelTemplate = this.resolveVariables(resolved.channelTemplate, connectorMessage);

    return resolved;
  }

  /**
   * Simple ${variable} resolution using connector message maps.
   * Checks channelMap, then sourceMap, then connectorMap.
   * Also handles built-in message variables (message.encodedData, message.rawData).
   * Matches Java ValueReplacer.replaceValues() map lookup order.
   */
  private resolveVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template || !template.includes('${')) return template;

    return template.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // Built-in message variables (matches Java ValueReplacer)
      if (varName === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        if (encoded?.content) return encoded.content;
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.rawData') {
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.transformedData') {
        const transformed = connectorMessage.getTransformedContent?.();
        if (transformed?.content) return transformed.content;
        return match;
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const v = channelMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const v = sourceMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const v = connectorMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      return match; // Leave unresolved variables as-is
    });
  }

  /**
   * Get a map value from various scopes (response, connector, channel, source, globalChannel, global, config)
   */
  private getMapValue(connectorMessage: ConnectorMessage, key: string): unknown {
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
   * Send message to the target channel.
   *
   * Matches Java VmDispatcher.send() behavior:
   * - Always initializes responseStatus = QUEUED (Java line 102)
   * - On success, sets SENT (Java line 167)
   * - On error, leaves status as QUEUED — the Donkey engine layer decides
   *   whether to queue or error based on connector queue configuration (CPC-MEH-006)
   * - Returns a Response object with validateResponse flag for response
   *   validator wiring (CPC-RHG-002)
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-W18-003: Resolve ${variable} placeholders before each send
    const props = this.replaceConnectorProperties(this.properties, connectorMessage);
    const targetChannelId = props.channelId;
    const currentChannelId = connectorMessage.getChannelId();

    // Dispatch SENDING event — matches Java line 97
    this.dispatchConnectionEvent(
      ConnectionStatusEventType.SENDING,
      `Target Channel: ${targetChannelId}`
    );
    this.dispatchStatusEvent(VmDispatcherStatus.SENDING, `Target Channel: ${targetChannelId}`);

    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatusMessage: string | null = null;
    let responseStatus = Status.QUEUED; // Always set to QUEUED — matches Java line 102
    let validateResponse = false;

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
          throw new Error('No engine controller configured for VM dispatcher');
        }

        // Check if response validation is requested — matches Java line 164
        validateResponse = props.validateResponse ?? false;
      }

      responseStatus = Status.SENT;
      responseStatusMessage = `Message routed successfully to channel id: ${targetChannelId}`;
    } catch (error) {
      // CPC-MEH-006: On error, responseStatus stays QUEUED — matches Java line 102/169-172
      // Java's VmDispatcher.send() returns Response(QUEUED, ...) on error.
      // The Donkey engine layer decides whether to actually queue or error.
      const errorMessage = error instanceof Error ? error.message : String(error);

      responseStatusMessage = `Error routing message to channel id: ${targetChannelId} - ${errorMessage}`;
      responseError = errorMessage;
    } finally {
      // Dispatch IDLE event in finally — matches Java line 174
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
      this.dispatchStatusEvent(VmDispatcherStatus.IDLE);
    }

    // Build response matching Java's return statement (line 177):
    //   return new Response(responseStatus, responseData, responseStatusMessage, responseError, validateResponse)
    const response = new Response(
      responseStatus,
      responseData ?? '',
      responseStatusMessage ?? '',
      responseError ?? ''
    );

    // CPC-RHG-002: Wire response validator when validateResponse is true.
    // Java's DestinationConnector.send() calls responseValidator.validate() on the response.
    // The validateResponse flag comes from vmDispatcherProperties.getDestinationConnectorProperties().isValidateResponse()
    if (validateResponse && this.responseValidator) {
      this.responseValidator.validate(response.getMessage() || null, connectorMessage);
    }

    // Update connector message status from response
    connectorMessage.setStatus(response.getStatus());
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
      // Re-throw so the Channel layer's error handler runs
      // (Channel.ts overrides status to SENT after send() returns normally)
      throw new Error(responseError);
    }
  }

  /**
   * Get the message content to send using the template.
   * Note: replaceConnectorProperties() already resolves most ${variable} placeholders
   * including ${message.encodedData}, ${message.rawData}, ${message.transformedData},
   * and map variables. This method handles any remaining unresolved message tokens.
   */
  private getMessageContent(
    connectorMessage: ConnectorMessage,
    props: VmDispatcherProperties
  ): string {
    // Most variables are already resolved by replaceConnectorProperties()
    // This handles any remaining ${message.*} tokens as a fallback

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
      content = content.replace(/\$\{message\.transformedData\}/g, transformedData);
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
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content ?? null;
  }
}
