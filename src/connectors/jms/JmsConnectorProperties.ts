/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsConnectorProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/JmsDispatcherProperties.java
 *
 * Purpose: Configuration properties for JMS source and destination connectors
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - STOMP protocol support (since Node.js has no native JMS)
 */

/**
 * JMS Acknowledgment Modes
 */
export enum AcknowledgeMode {
  /** Message is automatically acknowledged when received */
  AUTO = 'auto',
  /** Message must be explicitly acknowledged by client */
  CLIENT = 'client',
  /** Duplicate delivery is possible, broker assumes acknowledgment */
  CLIENT_INDIVIDUAL = 'client-individual',
}

/**
 * Message delivery mode
 */
export enum DeliveryMode {
  /** Message survives broker restart */
  PERSISTENT = 'persistent',
  /** Message may be lost on broker restart */
  NON_PERSISTENT = 'non-persistent',
}

/**
 * Destination type
 */
export enum DestinationType {
  /** Point-to-point messaging */
  QUEUE = 'queue',
  /** Publish/subscribe messaging */
  TOPIC = 'topic',
}

/**
 * Base JMS connection properties shared between receiver and dispatcher
 */
export interface JmsConnectionProperties {
  /** Whether to use JNDI lookup for connection factory */
  useJndi: boolean;

  /** JNDI provider URL (when useJndi is true) */
  jndiProviderUrl: string;

  /** JNDI initial context factory class (when useJndi is true) */
  jndiInitialContextFactory: string;

  /** JNDI connection factory name (when useJndi is true) */
  jndiConnectionFactoryName: string;

  /** Direct connection host (when useJndi is false) */
  host: string;

  /** Direct connection port (when useJndi is false) */
  port: number;

  /** Additional connection properties for the ConnectionFactory */
  connectionProperties: Record<string, string>;

  /** Authentication username */
  username: string;

  /** Authentication password */
  password: string;

  /** Destination name (queue or topic name) */
  destinationName: string;

  /** Whether destination is a topic (true) or queue (false) */
  topic: boolean;

  /** Client ID for durable subscriptions */
  clientId: string;

  /** Use SSL/TLS for connection */
  useSsl: boolean;

  /** Virtual host (for some brokers like RabbitMQ) */
  virtualHost: string;
}

/**
 * JMS Receiver (Source) Properties
 */
export interface JmsReceiverProperties extends JmsConnectionProperties {
  /** Message selector (SQL-like filter expression) */
  selector: string;

  /** Reconnect interval in milliseconds */
  reconnectIntervalMillis: number;

  /** Whether to create durable subscriber for topics */
  durableTopic: boolean;

  /** Subscription name for durable topics */
  subscriptionName: string;

  /** Acknowledgment mode */
  acknowledgeMode: AcknowledgeMode;

  /** Prefetch count (number of messages to buffer) */
  prefetchCount: number;
}

/**
 * JMS Dispatcher (Destination) Properties
 */
export interface JmsDispatcherProperties extends JmsConnectionProperties {
  /** Message template (content to send) */
  template: string;

  /** Message delivery mode */
  deliveryMode: DeliveryMode;

  /** Message priority (0-9, higher is more important) */
  priority: number;

  /** Time to live in milliseconds (0 = never expires) */
  timeToLive: number;

  /** Correlation ID for request-reply patterns */
  correlationId: string;

  /** Reply-to destination name */
  replyTo: string;

  /** Additional message headers */
  headers: Record<string, string>;

  /** Send timeout in milliseconds */
  sendTimeout: number;
}

/**
 * Default base connection properties
 */
function getDefaultConnectionProperties(): JmsConnectionProperties {
  return {
    useJndi: false,
    jndiProviderUrl: '',
    jndiInitialContextFactory: '',
    jndiConnectionFactoryName: '',
    host: 'localhost',
    port: 61613, // Default STOMP port
    connectionProperties: {},
    username: '',
    password: '',
    destinationName: '',
    topic: false,
    clientId: '',
    useSsl: false,
    virtualHost: '/',
  };
}

/**
 * Default JMS Receiver properties
 */
export function getDefaultJmsReceiverProperties(): JmsReceiverProperties {
  return {
    ...getDefaultConnectionProperties(),
    selector: '',
    reconnectIntervalMillis: 10000,
    durableTopic: false,
    subscriptionName: '',
    acknowledgeMode: AcknowledgeMode.CLIENT,
    prefetchCount: 1,
  };
}

/**
 * Default JMS Dispatcher properties
 */
export function getDefaultJmsDispatcherProperties(): JmsDispatcherProperties {
  return {
    ...getDefaultConnectionProperties(),
    template: '${message.encodedData}',
    deliveryMode: DeliveryMode.PERSISTENT,
    priority: 4, // Default JMS priority
    timeToLive: 0, // Never expires
    correlationId: '',
    replyTo: '',
    headers: {},
    sendTimeout: 30000,
  };
}

/**
 * Build STOMP destination path from properties
 * Different brokers use different naming conventions:
 * - ActiveMQ: /queue/name or /topic/name
 * - RabbitMQ: /queue/name or /topic/name (or /exchange/name)
 * - Apollo: /queue/name or /topic/name
 */
export function buildDestinationPath(
  destinationName: string,
  isTopic: boolean
): string {
  // If destination already has a prefix, use as-is
  if (
    destinationName.startsWith('/queue/') ||
    destinationName.startsWith('/topic/') ||
    destinationName.startsWith('/exchange/')
  ) {
    return destinationName;
  }

  // Add appropriate prefix
  return isTopic ? `/topic/${destinationName}` : `/queue/${destinationName}`;
}

/**
 * Generate a unique client ID based on channel context
 */
export function generateClientId(
  channelId: string,
  connectorName: string
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `mirth-${channelId.substring(0, 8)}-${connectorName}-${timestamp}-${random}`;
}

/**
 * Parse STOMP headers from message headers
 */
export function parseStompHeaders(
  headers: Record<string, string | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert acknowledgment mode to STOMP ack value
 */
export function acknowledgeModeTodStompAck(mode: AcknowledgeMode): string {
  switch (mode) {
    case AcknowledgeMode.AUTO:
      return 'auto';
    case AcknowledgeMode.CLIENT:
      return 'client';
    case AcknowledgeMode.CLIENT_INDIVIDUAL:
      return 'client-individual';
    default:
      return 'client';
  }
}

/**
 * Convert delivery mode to STOMP persistent header value
 */
export function deliveryModeToStompPersistent(mode: DeliveryMode): string {
  return mode === DeliveryMode.PERSISTENT ? 'true' : 'false';
}
