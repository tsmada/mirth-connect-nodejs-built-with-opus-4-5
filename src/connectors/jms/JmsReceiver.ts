/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsReceiver.java
 *
 * Purpose: JMS source connector that receives messages from queues/topics
 *
 * Key behaviors to replicate:
 * - Subscribe to JMS queues or topics
 * - Support durable subscriptions for topics
 * - Message selectors (SQL-like filters)
 * - Various acknowledgment modes
 * - Automatic reconnection on failure
 * - Batch message processing
 * - Connection status event dispatching (IDLE, CONNECTED, RECEIVING, DISCONNECTED)
 * - Error event dispatching via reportError pattern
 * - Binary (BytesMessage) and ObjectMessage handling
 */

import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import { JmsClient, JmsMessage, MessageListener } from './JmsClient.js';
import {
  JmsReceiverProperties,
  getDefaultJmsReceiverProperties,
  AcknowledgeMode,
} from './JmsConnectorProperties.js';
import type { BatchAdaptor } from '../../donkey/message/BatchAdaptor.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('jms-connector', 'JMS messaging (STOMP)');
const logger = getLogger('jms-connector');

export interface JmsReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  processBatch?: boolean;
  properties?: Partial<JmsReceiverProperties>;
}

/**
 * Simple line-based batch adaptor for JMS text messages.
 * Splits newline-delimited content into individual messages.
 */
class JmsTextBatchAdaptor implements BatchAdaptor {
  private lines: string[];
  private index = 0;

  constructor(rawData: string) {
    this.lines = rawData.split('\n').filter((l) => l.trim().length > 0);
  }

  async getMessage(): Promise<string | null> {
    if (this.index >= this.lines.length) return null;
    return this.lines[this.index++]!;
  }

  getBatchSequenceId(): number {
    return this.index;
  }

  isBatchComplete(): boolean {
    return this.index >= this.lines.length;
  }

  cleanup(): void {
    this.lines = [];
  }
}

/**
 * JMS Source Connector that receives messages from queues/topics
 *
 * Event dispatching matches Java Mirth JmsReceiver.java:
 * - onDeploy:  IDLE
 * - onStart:   CONNECTED
 * - onMessage: RECEIVING → IDLE (in finally)
 * - onStop:    DISCONNECTED
 * - onError:   reportError() dispatches ErrorEvent
 */
export class JmsReceiver extends SourceConnector {
  private properties: JmsReceiverProperties;
  private jmsClient: JmsClient | null = null;
  private subscriptionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _processBatch: boolean;

  constructor(config: JmsReceiverConfig) {
    super({
      name: config.name ?? 'JMS Listener',
      transportName: 'JMS',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultJmsReceiverProperties(),
      ...config.properties,
    };

    this._processBatch = config.processBatch ?? false;
  }

  /**
   * Get the connector properties
   */
  getProperties(): JmsReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<JmsReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Whether batch processing is enabled.
   * Matches Java: isProcessBatch() checks batchAdaptorFactory != null
   */
  isProcessBatch(): boolean {
    return this._processBatch;
  }

  /**
   * Called on deploy. Matches Java JmsReceiver.onDeploy():
   * - Creates JmsClient (validates broker config early)
   * - Dispatches IDLE event
   *
   * CPC-W20-004: Moved JmsClient creation from start() to onDeploy() so that
   * deployment-time configuration errors (bad broker URL, auth failure) are caught
   * during deploy rather than deferred to start().
   */
  async onDeploy(): Promise<void> {
    const channelId = this.channel?.getId() ?? 'unknown';

    // Create JMS client during deploy (matches Java JmsReceiver.onDeploy())
    this.jmsClient = JmsClient.getClient(
      this.properties,
      channelId,
      this.name
    );

    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Start the JMS receiver.
   * Matches Java JmsReceiver.onStart() — connects, subscribes, dispatches CONNECTED.
   *
   * CPC-W20-004: JmsClient is already created in onDeploy(). start() now focuses
   * on connecting and subscribing.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('JMS Receiver is already running');
    }

    try {
      // CPC-W20-004: Client created in onDeploy(); create here as fallback
      // if start() is called without prior onDeploy()
      if (!this.jmsClient) {
        const channelId = this.channel?.getId() ?? 'unknown';
        this.jmsClient = JmsClient.getClient(
          this.properties,
          channelId,
          this.name
        );
      }

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to broker
      await this.jmsClient.connect();

      // Subscribe to destination
      await this.createSubscription();

      this.running = true;

      // CPC-JMS-001: Dispatch CONNECTED event after successful start (matches Java line 92)
      this.dispatchConnectionEvent(ConnectionStatusEventType.CONNECTED);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // CPC-JMS-008: Use reportError pattern instead of console.error
      this.reportError(
        'Failed to start JMS Receiver',
        undefined,
        error instanceof Error ? error : new Error(errorMessage)
      );

      // Clean up on failure
      await this.cleanup();

      throw new Error(
        `Failed to initialize JMS message consumer for destination "${this.properties.destinationName}": ${errorMessage}`
      );
    }
  }

  /**
   * Set up event handlers for JMS client
   */
  private setupEventHandlers(): void {
    if (!this.jmsClient) return;

    this.jmsClient.on('disconnected', (error) => {
      // CPC-JMS-008: Use reportError instead of console.error
      this.reportError(
        'JMS connection lost',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      this.subscriptionId = null;
    });

    this.jmsClient.on('reconnected', async () => {
      try {
        await this.createSubscription();
      } catch (error) {
        this.reportError(
          'Failed to re-subscribe after reconnect',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    this.jmsClient.on('error', (error) => {
      this.reportError(
        'JMS error',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    });
  }

  /**
   * Create subscription to the destination
   */
  private async createSubscription(): Promise<void> {
    if (!this.jmsClient) {
      throw new Error('JMS client not initialized');
    }

    const messageHandler: MessageListener = async (message) => {
      await this.handleMessage(message);
    };

    this.subscriptionId = await this.jmsClient.subscribe(
      this.properties.destinationName,
      this.properties.topic,
      messageHandler,
      {
        selector: this.properties.selector || undefined,
        acknowledgeMode: this.properties.acknowledgeMode,
        durableSubscription: this.properties.durableTopic,
        subscriptionName: this.properties.subscriptionName || undefined,
        prefetchCount: this.properties.prefetchCount,
      }
    );
  }

  /**
   * Handle incoming JMS message.
   * Matches Java JmsReceiverMessageListener.onMessage():
   * - Dispatches RECEIVING event
   * - Handles TextMessage, BytesMessage, ObjectMessage
   * - Supports batch processing via isProcessBatch()
   * - Dispatches IDLE event in finally block
   */
  private async handleMessage(message: JmsMessage): Promise<void> {
    // CPC-JMS-001: Dispatch RECEIVING event (matches Java line 127)
    this.dispatchConnectionEvent(ConnectionStatusEventType.RECEIVING);

    try {
      // Build source map with message metadata
      const sourceMapData = new Map<string, unknown>();
      sourceMapData.set('jmsMessageId', message.messageId);
      sourceMapData.set('jmsDestination', message.destination);
      sourceMapData.set('jmsTimestamp', message.timestamp);
      sourceMapData.set('jmsCorrelationId', message.correlationId);
      sourceMapData.set('jmsReplyTo', message.replyTo);
      sourceMapData.set('jmsContentType', message.contentType);

      // Add all headers to source map
      for (const [key, value] of Object.entries(message.headers)) {
        sourceMapData.set(`jmsHeader.${key}`, value);
      }

      // CPC-JMS-005: Handle binary messages.
      // Java handles TextMessage, BytesMessage, ObjectMessage.
      // STOMP messages arrive as text; binary flag indicates BytesMessage equivalent.
      const messageBody = message.body;
      const isBinary = message.isBinary === true;

      // CPC-JMS-004: Batch message processing (matches Java lines 141-162)
      if (this._processBatch) {
        if (isBinary) {
          this.reportError(
            'Batch processing is not supported for binary data.',
            undefined,
            new Error('Batch processing is not supported for binary data.')
          );
          return;
        }

        const batchAdaptor: BatchAdaptor = new JmsTextBatchAdaptor(messageBody);

        try {
          await this.dispatchBatchMessage(messageBody, batchAdaptor, sourceMapData);

          try {
            message.ack();
          } catch (ackError) {
            this.reportError(
              'Failed to acknowledge JMS message',
              undefined,
              ackError instanceof Error ? ackError : new Error(String(ackError))
            );
          }
        } catch (batchError) {
          this.reportError(
            'Failed to process batch message',
            undefined,
            batchError instanceof Error ? batchError : new Error(String(batchError))
          );
        }
      } else {
        // Single message dispatch (matches Java lines 163-178)
        try {
          await this.dispatchRawMessage(messageBody, sourceMapData);

          // Acknowledge message
          try {
            if (this.properties.acknowledgeMode !== AcknowledgeMode.AUTO) {
              message.ack();
            }
          } catch (ackError) {
            this.reportError(
              'Failed to acknowledge JMS message',
              undefined,
              ackError instanceof Error ? ackError : new Error(String(ackError))
            );
          }
        } catch (error) {
          // CPC-JMS-008: Use reportError pattern
          this.reportError(
            'Failed to process message',
            undefined,
            error instanceof Error ? error : new Error(String(error))
          );

          // Negative acknowledge on processing error
          message.nack();
        }
      }
    } finally {
      // CPC-JMS-001: Dispatch IDLE event in finally (matches Java line 181)
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Stop the JMS receiver.
   * Matches Java JmsReceiver.onStop() — disconnects, dispatches DISCONNECTED.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await this.cleanup();
    this.running = false;

    // CPC-JMS-001: Dispatch DISCONNECTED event (matches Java line 103)
    this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED);
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Unsubscribe
    if (this.jmsClient && this.subscriptionId) {
      try {
        await this.jmsClient.unsubscribe(this.subscriptionId);
      } catch (_error) {
        // Quiet cleanup - errors during teardown are logged but not propagated
      }
      this.subscriptionId = null;
    }

    // Disconnect client
    if (this.jmsClient) {
      try {
        await this.jmsClient.disconnect();
      } catch (_error) {
        // Quiet cleanup
      }
      this.jmsClient = null;
    }
  }

  /**
   * Report errors matching Java JmsReceiver.reportError() pattern.
   * Dispatches an error event for the dashboard and logs the error.
   * Matches Java: eventController.dispatchEvent(new ErrorEvent(...))
   */
  private reportError(
    errorMessage: string,
    _messageId: number | undefined,
    error: Error
  ): void {
    const channelId = this.channel?.getId() ?? 'unknown';
    const channelName = this.channel?.getName() ?? 'unknown';
    // Log in format matching Java: "message (channel: name)"
    logger.error(`${errorMessage} (channel: ${channelName}): ${error.message}`);

    // Dispatch error event through channel event emitter (for dashboard integration)
    if (this.channel) {
      this.channel.emit('connectorError', {
        channelId,
        metaDataId: 0,
        connectorName: this.name,
        errorType: 'SOURCE_CONNECTOR',
        errorMessage: `${errorMessage}: ${error.message}`,
      });
    }
  }

  /**
   * Check if connected to broker
   */
  isConnected(): boolean {
    return this.jmsClient?.isConnected() ?? false;
  }

  /**
   * Get the subscription ID
   */
  getSubscriptionId(): string | null {
    return this.subscriptionId;
  }

  /**
   * Get the JMS client (for testing)
   */
  getJmsClient(): JmsClient | null {
    return this.jmsClient;
  }
}
