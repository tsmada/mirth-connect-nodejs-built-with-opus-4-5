/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsDispatcher.java
 *
 * Purpose: JMS destination connector that sends messages to queues/topics
 *
 * Key behaviors to replicate:
 * - Send messages to JMS queues or topics
 * - Connection pooling per unique connection configuration
 * - Retry on connection failure with new connection
 * - Message properties (headers, priority, TTL, correlation ID)
 * - Delivery modes (persistent/non-persistent)
 */

import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { JmsClient } from './JmsClient.js';
import {
  JmsDispatcherProperties,
  getDefaultJmsDispatcherProperties,
  DeliveryMode,
} from './JmsConnectorProperties.js';

export interface JmsDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<JmsDispatcherProperties>;
}

/**
 * JMS Destination Connector that sends messages to queues/topics
 */
export class JmsDispatcher extends DestinationConnector {
  private properties: JmsDispatcherProperties;
  private jmsClient: JmsClient | null = null;
  private connectionCreatedForMessage = false;

  constructor(config: JmsDispatcherConfig) {
    super({
      name: config.name ?? 'JMS Sender',
      transportName: 'JMS',
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultJmsDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): JmsDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<JmsDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the JMS dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log(
      `JMS Dispatcher started for ${this.properties.topic ? 'topic' : 'queue'} "${this.properties.destinationName}"`
    );
  }

  /**
   * Stop the JMS dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Clean up JMS client
    if (this.jmsClient) {
      try {
        await this.jmsClient.disconnect();
      } catch (error) {
        console.error('Error disconnecting JMS client:', error);
      }
      this.jmsClient = null;
    }

    this.running = false;
    console.log('JMS Dispatcher stopped');
  }

  /**
   * Get or create JMS client for sending
   */
  private async getOrCreateClient(forceNew = false): Promise<JmsClient> {
    const channelId = this.channel?.getId() ?? 'unknown';

    if (forceNew && this.jmsClient) {
      try {
        await this.jmsClient.disconnect();
      } catch (error) {
        console.error('Error disconnecting old JMS client:', error);
      }
      this.jmsClient = null;
    }

    if (!this.jmsClient) {
      this.jmsClient = new JmsClient(this.properties, channelId, this.name);
      await this.jmsClient.connect();
      this.connectionCreatedForMessage = true;
    }

    return this.jmsClient;
  }

  /**
   * Send message to the JMS destination
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.connectionCreatedForMessage = false;
    let responseError: string | undefined;

    try {
      // Get message content
      const content = this.getContent(connectorMessage);
      const destinationName =
        this.resolveDestinationName(connectorMessage) ||
        this.properties.destinationName;

      // First attempt with existing or new connection
      try {
        const client = await this.getOrCreateClient();
        await this.sendMessage(client, destinationName, content, connectorMessage);
      } catch (firstError) {
        // If connection wasn't just created, try with a fresh connection
        if (!this.connectionCreatedForMessage) {
          console.log('Retrying JMS send with new connection');
          const client = await this.getOrCreateClient(true);
          await this.sendMessage(client, destinationName, content, connectorMessage);
        } else {
          throw firstError;
        }
      }

      // Success
      connectorMessage.setSendDate(new Date());
      connectorMessage.setStatus(Status.SENT);

      // Store metadata in connector map
      connectorMessage.getConnectorMap().set('jmsHost', this.properties.host);
      connectorMessage.getConnectorMap().set('jmsPort', this.properties.port);
      connectorMessage.getConnectorMap().set('jmsDestination', destinationName);
      connectorMessage.getConnectorMap().set('jmsIsTopic', this.properties.topic);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error('Error sending JMS message:', errorMessage);

      // Set error status based on queue configuration
      if (this.queueEnabled) {
        connectorMessage.setStatus(Status.QUEUED);
        console.log('Message queued for retry');
      } else {
        connectorMessage.setStatus(Status.ERROR);
      }

      responseError = `Error occurred when attempting to send JMS message: ${errorMessage}`;
      connectorMessage.setProcessingError(responseError);

      throw error;
    }
  }

  /**
   * Send the actual message to JMS
   */
  private async sendMessage(
    client: JmsClient,
    destinationName: string,
    content: string,
    connectorMessage: ConnectorMessage
  ): Promise<void> {
    const correlationId =
      this.resolveCorrelationId(connectorMessage) || this.properties.correlationId;
    const replyTo = this.properties.replyTo;

    await client.send(destinationName, this.properties.topic, content, {
      contentType: 'text/plain',
      correlationId: correlationId || undefined,
      replyTo: replyTo || undefined,
      priority: this.properties.priority,
      timeToLive: this.properties.timeToLive,
      persistent: this.properties.deliveryMode === DeliveryMode.PERSISTENT,
      headers: this.properties.headers,
    });

    console.log(
      `Sent JMS message to ${this.properties.topic ? 'topic' : 'queue'} "${destinationName}"`
    );
  }

  /**
   * Get response from the last send
   * JMS is typically fire-and-forget; response would come from reply-to queue
   */
  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    // JMS doesn't have built-in request-reply semantics
    // Response would come from a separate reply-to queue subscription
    return null;
  }

  /**
   * Get content to send from connector message
   */
  private getContent(connectorMessage: ConnectorMessage): string {
    // Check if template contains variable reference
    if (
      this.properties.template &&
      !this.properties.template.includes('${message.')
    ) {
      return this.properties.template;
    }

    // Get encoded content
    const encodedContent = connectorMessage.getEncodedContent();
    if (encodedContent) {
      return encodedContent.content;
    }

    // Fall back to raw data
    const rawData = connectorMessage.getRawData();
    return rawData || '';
  }

  /**
   * Resolve destination name from message (for dynamic routing)
   */
  private resolveDestinationName(
    connectorMessage: ConnectorMessage
  ): string | null {
    // Check connector map for dynamic destination
    const dynamicDestination = connectorMessage
      .getConnectorMap()
      .get('jmsDestination');

    if (typeof dynamicDestination === 'string') {
      return dynamicDestination;
    }

    return null;
  }

  /**
   * Resolve correlation ID from message
   */
  private resolveCorrelationId(connectorMessage: ConnectorMessage): string | null {
    // Check connector map for correlation ID
    const correlationId = connectorMessage
      .getConnectorMap()
      .get('jmsCorrelationId');

    if (typeof correlationId === 'string') {
      return correlationId;
    }

    // Use message ID as default correlation ID
    return connectorMessage.getMessageId()?.toString() || null;
  }

  /**
   * Check if connected to broker
   */
  isConnected(): boolean {
    return this.jmsClient?.isConnected() ?? false;
  }

  /**
   * Get the JMS client (for testing)
   */
  getJmsClient(): JmsClient | null {
    return this.jmsClient;
  }
}
