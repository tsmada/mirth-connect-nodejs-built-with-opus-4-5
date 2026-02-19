/**
 * JMS Connector - Message queue integration via STOMP protocol
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jms/
 *
 * This module provides JMS (Java Message Service) compatible messaging
 * for Node.js using the STOMP protocol. STOMP is widely supported by
 * JMS-compatible message brokers including:
 *
 * - Apache ActiveMQ
 * - Apache ActiveMQ Artemis
 * - RabbitMQ (with STOMP plugin)
 * - Apollo
 * - HornetQ
 *
 * Usage:
 * ```typescript
 * import { JmsReceiver, JmsDispatcher, getDefaultJmsReceiverProperties } from './connectors/jms';
 *
 * // Create receiver
 * const receiver = new JmsReceiver({
 *   properties: {
 *     host: 'localhost',
 *     port: 61613,
 *     destinationName: 'my-queue',
 *     topic: false,
 *   }
 * });
 *
 * // Create dispatcher
 * const dispatcher = new JmsDispatcher({
 *   metaDataId: 1,
 *   properties: {
 *     host: 'localhost',
 *     port: 61613,
 *     destinationName: 'outbound-queue',
 *   }
 * });
 * ```
 */

// Properties and types
export {
  AcknowledgeMode,
  DeliveryMode,
  DestinationType,
  JmsConnectionProperties,
  JmsReceiverProperties,
  JmsDispatcherProperties,
  getDefaultJmsReceiverProperties,
  getDefaultJmsDispatcherProperties,
  buildDestinationPath,
  generateClientId,
  parseStompHeaders,
  acknowledgeModeTodStompAck,
  deliveryModeToStompPersistent,
} from './JmsConnectorProperties.js';

// Client
export { JmsClient, StompConnection, JmsMessage, MessageListener } from './JmsClient.js';

// Connectors
export { JmsReceiver, JmsReceiverConfig } from './JmsReceiver.js';
export { JmsDispatcher, JmsDispatcherConfig } from './JmsDispatcher.js';
