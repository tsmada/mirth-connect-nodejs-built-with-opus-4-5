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

// Authentication module (CPC-MAM-002)
export {
  AuthStatus,
  AuthType,
  AuthenticationResult,
  type BasicAuthProperties,
  type DigestAuthProperties,
  DigestAlgorithm,
  DigestQOPMode,
  type HttpAuthProperties,
  type HttpAuthenticator,
  type JavaScriptAuthProperties,
  type RequestInfo,
  createAuthenticator,
  getDefaultBasicAuthProperties,
  getDefaultDigestAuthProperties,
  BasicAuthenticator,
  DigestAuthenticator,
  JavaScriptAuthenticator,
} from './auth/index.js';
