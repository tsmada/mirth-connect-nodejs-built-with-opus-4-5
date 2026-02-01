/**
 * TCP/MLLP Connector Module
 *
 * Provides TCP-based source and destination connectors with MLLP support.
 */

export {
  TransmissionMode,
  ServerMode,
  ResponseMode,
  MLLP_FRAME,
  TcpReceiverProperties,
  TcpDispatcherProperties,
  getDefaultTcpReceiverProperties,
  getDefaultTcpDispatcherProperties,
  frameMessage,
  unframeMessage,
  hasCompleteMessage,
  generateAck,
  extractControlId,
} from './TcpConnectorProperties.js';

export { TcpReceiver, TcpReceiverConfig } from './TcpReceiver.js';
export { TcpDispatcher, TcpDispatcherConfig } from './TcpDispatcher.js';
