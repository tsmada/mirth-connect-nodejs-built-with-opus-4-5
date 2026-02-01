/**
 * HTTP Connector Module
 *
 * Provides HTTP source (receiver) and destination (dispatcher) connectors
 * for receiving and sending HTTP requests.
 */

export {
  HttpReceiverProperties,
  HttpDispatcherProperties,
  HttpStaticResource,
  getDefaultHttpReceiverProperties,
  getDefaultHttpDispatcherProperties,
  isBinaryMimeType,
} from './HttpConnectorProperties.js';

export { HttpReceiver, HttpReceiverConfig } from './HttpReceiver.js';

export { HttpDispatcher, HttpDispatcherConfig, HttpResponse } from './HttpDispatcher.js';
