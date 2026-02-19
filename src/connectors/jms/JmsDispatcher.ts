/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsDispatcher.java
 *
 * Purpose: JMS destination connector that sends messages to queues/topics
 *
 * Key behaviors to replicate:
 * - Send messages to JMS queues or topics
 * - Connection pooling per unique connection configuration (ConcurrentHashMap pattern)
 * - Retry on connection failure with new connection
 * - Message properties (headers, priority, TTL, correlation ID)
 * - Delivery modes (persistent/non-persistent)
 * - Connection status event dispatching (IDLE, SENDING → IDLE in finally)
 * - ALWAYS return QUEUED on error (Donkey engine handles queue vs error)
 * - replaceConnectorProperties for template variable resolution
 */

import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
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
 *
 * Event dispatching matches Java Mirth JmsDispatcher.java:
 * - onDeploy: IDLE (line 61)
 * - send():   SENDING (line 116) → IDLE (line 185, in finally)
 * - onStop:   closes all pooled connections
 *
 * Error handling matches Java: ALWAYS set Status.QUEUED on error (line 181).
 * The Donkey engine's queue/retry logic decides if it actually queues or errors out.
 *
 * Connection pooling matches Java: ConcurrentHashMap<String, JmsConnection>
 * keyed by composite connection key, max 1000 connections (lines 55-56).
 */
export class JmsDispatcher extends DestinationConnector {
  private properties: JmsDispatcherProperties;

  /**
   * CPC-JMS-003: Connection pool keyed by composite connection key.
   * Matches Java: Map<String, JmsConnection> jmsConnections = new ConcurrentHashMap<>()
   * Max 1000 connections (Java line 56).
   */
  private jmsConnections = new Map<string, JmsClient>();
  private static readonly MAX_CONNECTIONS = 1000;

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
   * Called on deploy. Matches Java JmsDispatcher.onDeploy() — dispatches IDLE.
   */
  onDeploy(): void {
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Start the JMS dispatcher.
   * Java's onStart() is empty — connections are created lazily per-message.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
  }

  /**
   * Stop the JMS dispatcher.
   * Matches Java JmsDispatcher.onStop() — closes all pooled connections.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // CPC-JMS-003: Close all pooled connections (matches Java lines 72-87)
    let firstError: Error | null = null;
    for (const [connectionKey, client] of this.jmsConnections.entries()) {
      try {
        await this.closeJmsConnection(connectionKey, client);
      } catch (error) {
        if (!firstError) {
          firstError = error instanceof Error ? error : new Error(String(error));
        }
      }
    }
    this.jmsConnections.clear();

    this.running = false;

    if (firstError) {
      throw new Error(
        `Error closing JMS connection (${this.name} "${this.properties.destinationName}"): ${firstError.message}`
      );
    }
  }

  /**
   * CPC-JMS-006: Resolve connector properties with message context variables.
   * Matches Java JmsDispatcher.replaceConnectorProperties():
   * Resolves ${} variables in template, destinationName, connectionProperties,
   * username, password, clientId.
   */
  replaceConnectorProperties(
    props: JmsDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): JmsDispatcherProperties {
    const resolved = { ...props };

    // Resolve template, destinationName, username, password, clientId
    resolved.template = this.resolveVariables(resolved.template, connectorMessage);
    resolved.destinationName = this.resolveVariables(resolved.destinationName, connectorMessage);
    resolved.username = this.resolveVariables(resolved.username, connectorMessage);
    resolved.password = this.resolveVariables(resolved.password, connectorMessage);
    resolved.clientId = this.resolveVariables(resolved.clientId, connectorMessage);

    // Resolve connectionProperties values
    const resolvedProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(resolved.connectionProperties)) {
      resolvedProps[key] = this.resolveVariables(value, connectorMessage);
    }
    resolved.connectionProperties = resolvedProps;

    // Resolve JNDI properties if using JNDI
    if (resolved.useJndi) {
      resolved.jndiProviderUrl = this.resolveVariables(resolved.jndiProviderUrl, connectorMessage);
      resolved.jndiInitialContextFactory = this.resolveVariables(
        resolved.jndiInitialContextFactory,
        connectorMessage
      );
      resolved.jndiConnectionFactoryName = this.resolveVariables(
        resolved.jndiConnectionFactoryName,
        connectorMessage
      );
    }

    return resolved;
  }

  /**
   * Simple ${variable} resolution using connector message maps.
   * Checks channelMap, then sourceMap, then connectorMap.
   */
  private resolveVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template || !template.includes('${')) return template;

    return template.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // Built-in message variables (matches Java ValueReplacer)
      if (varName === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        if (encoded?.content) return encoded.content;
        // Fall back to raw data when encoded content not available
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.rawData') {
        return connectorMessage.getRawData() ?? match;
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const channelValue = channelMap.get(varName);
        if (channelValue !== undefined && channelValue !== null) return String(channelValue);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const sourceValue = sourceMap.get(varName);
        if (sourceValue !== undefined && sourceValue !== null) return String(sourceValue);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const connectorValue = connectorMap.get(varName);
        if (connectorValue !== undefined && connectorValue !== null) return String(connectorValue);
      }

      return match; // Leave unresolved variables as-is
    });
  }

  /**
   * Build a connection key from resolved properties.
   * Matches Java JmsDispatcher.getConnectionKey() (lines 195-233).
   */
  private getConnectionKey(props: JmsDispatcherProperties): string {
    const parts: string[] = [String(props.useJndi)];

    if (props.useJndi) {
      parts.push(props.jndiProviderUrl);
      parts.push(props.jndiInitialContextFactory);
      parts.push(props.jndiConnectionFactoryName);
    } else {
      parts.push(props.host);
      parts.push(String(props.port));
      parts.push(String(props.topic));
    }

    // Add connection properties
    for (const value of Object.values(props.connectionProperties)) {
      parts.push(value);
    }

    parts.push(props.username);
    parts.push(props.password);
    parts.push(props.clientId);

    return parts.join(':');
  }

  /**
   * CPC-JMS-003: Get or create a JMS connection from the pool.
   * Matches Java JmsDispatcher.getJmsConnection() — synchronized, keyed by connection properties.
   */
  private async getOrCreatePooledClient(
    props: JmsDispatcherProperties,
    connectionKey: string,
    replace: boolean
  ): Promise<JmsClient> {
    // If replacing, close the old connection
    if (replace) {
      const existing = this.jmsConnections.get(connectionKey);
      if (existing) {
        try {
          await existing.disconnect();
        } catch (_e) {
          // Quiet close
        }
        this.jmsConnections.delete(connectionKey);
      }
    }

    let client = this.jmsConnections.get(connectionKey);
    if (!client) {
      if (this.jmsConnections.size >= JmsDispatcher.MAX_CONNECTIONS) {
        throw new Error(
          `Cannot create new connection. Maximum number (${JmsDispatcher.MAX_CONNECTIONS}) of cached connections reached.`
        );
      }

      const channelId = this.channel?.getId() ?? 'unknown';
      client = new JmsClient(props, channelId, this.name);
      await client.connect();
      this.jmsConnections.set(connectionKey, client);
    }

    return client;
  }

  /**
   * Close a specific pooled JMS connection.
   */
  private async closeJmsConnection(connectionKey: string, client: JmsClient): Promise<void> {
    try {
      await client.disconnect();
    } finally {
      this.jmsConnections.delete(connectionKey);
    }
  }

  /**
   * Send message to the JMS destination.
   * Matches Java JmsDispatcher.send() (lines 115-188):
   * - Dispatches SENDING event before send
   * - On error, ALWAYS sets Status.QUEUED (not ERROR) — Donkey engine handles retry logic
   * - Dispatches IDLE in finally block
   * - Uses connection pool with retry-on-new-connection pattern
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-JMS-007: Dispatch SENDING event (matches Java line 116)
    this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING);

    // CPC-JMS-006: Resolve variables in properties for this message
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);
    const connectionKey = this.getConnectionKey(resolvedProps);

    let connectionCreated = false;
    let responseError: string | undefined;

    try {
      try {
        // Check if connection exists in pool
        let client = this.jmsConnections.get(connectionKey);
        if (!client) {
          connectionCreated = true;
          client = await this.getOrCreatePooledClient(resolvedProps, connectionKey, false);
        }

        await this.sendMessage(client, resolvedProps);
      } catch (firstError) {
        // If connection wasn't just created, try with a fresh connection
        if (!connectionCreated) {
          const client = await this.getOrCreatePooledClient(resolvedProps, connectionKey, true);
          await this.sendMessage(client, resolvedProps);
        } else {
          throw firstError;
        }
      }

      // Success
      connectorMessage.setSendDate(new Date());
      connectorMessage.setStatus(Status.SENT);

      // Store metadata in connector map
      connectorMessage.getConnectorMap().set('jmsHost', resolvedProps.host);
      connectorMessage.getConnectorMap().set('jmsPort', resolvedProps.port);
      connectorMessage.getConnectorMap().set('jmsDestination', resolvedProps.destinationName);
      connectorMessage.getConnectorMap().set('jmsIsTopic', resolvedProps.topic);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Dispatch error event
      if (this.channel) {
        this.channel.emit('connectorError', {
          channelId: this.channel.getId(),
          metaDataId: this.metaDataId,
          connectorName: this.name,
          errorType: 'DESTINATION_CONNECTOR',
          errorMessage: `Error occurred when attempting to send JMS message: ${errorMessage}`,
        });
      }

      // CPC-JMS-002: ALWAYS set QUEUED on error (matches Java line 181).
      // Java: responseStatus = Status.QUEUED (unconditionally).
      // The Donkey engine's queue/retry infrastructure decides whether to
      // actually queue or transition to ERROR based on queue configuration.
      connectorMessage.setStatus(Status.QUEUED);

      responseError = `Error occurred when attempting to send JMS message: ${errorMessage}`;
      connectorMessage.setProcessingError(responseError);

      throw error;
    } finally {
      // CPC-JMS-007: Dispatch IDLE event in finally (matches Java line 185)
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Send the actual message to JMS using resolved properties.
   */
  private async sendMessage(
    client: JmsClient,
    resolvedProps: JmsDispatcherProperties
  ): Promise<void> {
    await client.send(resolvedProps.destinationName, resolvedProps.topic, resolvedProps.template, {
      contentType: 'text/plain',
      correlationId: resolvedProps.correlationId || undefined,
      replyTo: resolvedProps.replyTo || undefined,
      priority: resolvedProps.priority,
      timeToLive: resolvedProps.timeToLive,
      persistent: resolvedProps.deliveryMode === DeliveryMode.PERSISTENT,
      headers: resolvedProps.headers,
    });
  }

  /**
   * Get response from the last send
   * JMS is typically fire-and-forget; response would come from reply-to queue
   */
  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }

  /**
   * Check if connected to broker (any pooled connection)
   */
  isConnected(): boolean {
    for (const client of this.jmsConnections.values()) {
      if (client.isConnected()) return true;
    }
    return false;
  }

  /**
   * Get the number of pooled connections (for testing)
   */
  getConnectionPoolSize(): number {
    return this.jmsConnections.size;
  }

  /**
   * Get a specific pooled client by connection key (for testing)
   */
  getPooledClient(connectionKey: string): JmsClient | undefined {
    return this.jmsConnections.get(connectionKey);
  }
}
