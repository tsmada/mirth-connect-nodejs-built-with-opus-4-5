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
 */

import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { JmsClient, JmsMessage, MessageListener } from './JmsClient.js';
import {
  JmsReceiverProperties,
  getDefaultJmsReceiverProperties,
  AcknowledgeMode,
} from './JmsConnectorProperties.js';

export interface JmsReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<JmsReceiverProperties>;
}

/**
 * JMS Source Connector that receives messages from queues/topics
 */
export class JmsReceiver extends SourceConnector {
  private properties: JmsReceiverProperties;
  private jmsClient: JmsClient | null = null;
  private subscriptionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

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
   * Start the JMS receiver
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('JMS Receiver is already running');
    }

    const channelId = this.channel?.getId() ?? 'unknown';
    // channelName used for debugging

    try {
      // Get or create JMS client
      this.jmsClient = JmsClient.getClient(
        this.properties,
        channelId,
        this.name
      );

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to broker
      await this.jmsClient.connect();

      // Subscribe to destination
      await this.createSubscription();

      this.running = true;
      console.log(
        `JMS Receiver started: ${this.properties.topic ? 'topic' : 'queue'} "${this.properties.destinationName}" on ${this.properties.host}:${this.properties.port}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Failed to start JMS Receiver: ${errorMessage}`);

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
      console.error('JMS connection lost:', error);
      this.subscriptionId = null;
    });

    this.jmsClient.on('reconnected', async () => {
      console.log('JMS connection restored');
      try {
        await this.createSubscription();
      } catch (error) {
        console.error('Failed to re-subscribe after reconnect:', error);
      }
    });

    this.jmsClient.on('error', (error) => {
      console.error('JMS error:', error);
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

    console.log(
      `Subscribed to ${this.properties.topic ? 'topic' : 'queue'} "${this.properties.destinationName}" with ID ${this.subscriptionId}`
    );
  }

  /**
   * Handle incoming JMS message
   */
  private async handleMessage(message: JmsMessage): Promise<void> {
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

      // Dispatch message to channel
      await this.dispatchRawMessage(message.body, sourceMapData);

      // Acknowledge message if using client ack mode
      if (this.properties.acknowledgeMode !== AcknowledgeMode.AUTO) {
        message.ack();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Failed to process JMS message: ${errorMessage}`);

      // Negative acknowledge on processing error
      message.nack();
    }
  }

  /**
   * Stop the JMS receiver
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await this.cleanup();
    this.running = false;

    console.log('JMS Receiver stopped');
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
      } catch (error) {
        console.error('Error unsubscribing:', error);
      }
      this.subscriptionId = null;
    }

    // Disconnect client
    if (this.jmsClient) {
      try {
        await this.jmsClient.disconnect();
      } catch (error) {
        console.error('Error disconnecting JMS client:', error);
      }
      this.jmsClient = null;
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
