/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/dimse/DICOMDispatcherProperties.java
 *
 * Purpose: Configuration properties for DICOM destination (dispatcher) connector
 *
 * Key behaviors to replicate:
 * - All DICOM/DIMSE configuration options for sending
 * - TLS/SSL configuration
 * - Priority and authentication settings
 * - Storage commitment support
 */

import { DicomTlsMode, TransferSyntax, SopClass, DimseCommand } from './DICOMReceiverProperties.js';

/**
 * Priority levels for DICOM operations
 */
export enum DicomPriority {
  /** Low priority */
  LOW = 'low',
  /** Medium priority (default) */
  MEDIUM = 'med',
  /** High priority */
  HIGH = 'high',
}

/**
 * Destination connector properties interface
 */
export interface DestinationConnectorProperties {
  /** Queue enabled */
  queueEnabled: boolean;
  /** Send first then queue */
  sendFirst: boolean;
  /** Retry count */
  retryCount: number;
  /** Rotate queue on error */
  rotate: boolean;
  /** Include filter for transformed content */
  includeFilterTransformer: boolean;
  /** Thread count */
  threadCount: number;
  /** Thread assignment variable */
  threadAssignmentVariable: string;
  /** Validate response */
  validateResponse: boolean;
  /** Reattach attachments */
  reattachAttachments: boolean;
}

/**
 * DICOM Dispatcher (Destination) Properties
 */
export interface DICOMDispatcherProperties {
  /** Destination connector properties */
  destinationConnectorProperties: DestinationConnectorProperties;

  /** Remote DICOM host */
  host: string;
  /** Remote DICOM port */
  port: string;
  /** Remote Application Entity title */
  applicationEntity: string;

  /** Local host for outbound connections */
  localHost: string;
  /** Local port for outbound connections */
  localPort: string;
  /** Local Application Entity title */
  localApplicationEntity: string;

  /** Message template (DICOM data to send) */
  template: string;

  // Connection timeouts (in milliseconds unless noted)
  /** A-ASSOCIATE-AC timeout (ms) */
  acceptTo: string;
  /** Max async operations */
  async: string;
  /** Transcoder buffer size (KB) */
  bufSize: string;
  /** Socket connect timeout (ms) */
  connectTo: string;
  /** Priority level */
  priority: string;
  /** User passcode for authentication */
  passcode: string;
  /** Pack command and data PDV */
  pdv1: boolean;
  /** Max receive PDU length (KB) */
  rcvpdulen: string;
  /** Association reaper period (s) */
  reaper: string;
  /** Release timeout (s) */
  releaseTo: string;
  /** DIMSE-RSP timeout (s) */
  rspTo: string;
  /** Shutdown delay (ms) */
  shutdownDelay: string;
  /** Max send PDU length (KB) */
  sndpdulen: string;
  /** Socket close delay (ms) */
  soCloseDelay: string;
  /** Socket receive buffer (KB) */
  sorcvbuf: string;
  /** Socket send buffer (KB) */
  sosndbuf: string;
  /** Request storage commitment */
  stgcmt: boolean;
  /** Storage commitment N-EVENT-REPORT timeout (ms) */
  stgcmtTimeout: number;
  /** TCP no-delay (disable Nagle) */
  tcpDelay: boolean;
  /** Offer default transfer syntax in separate presentation context */
  ts1: boolean;
  /** Request positive user identity response */
  uidnegrsp: boolean;
  /** Username for authentication */
  username: string;

  // TLS settings
  /** Key password */
  keyPW: string;
  /** Keystore path */
  keyStore: string;
  /** Keystore password */
  keyStorePW: string;
  /** Do not require client authentication */
  noClientAuth: boolean;
  /** Disable SSLv2 */
  nossl2: boolean;
  /** TLS mode */
  tls: string;
  /** Truststore path */
  trustStore: string;
  /** Truststore password */
  trustStorePW: string;
}

/**
 * Default DICOM Dispatcher properties
 * Matches Java DICOMDispatcherProperties constructor defaults
 */
export function getDefaultDICOMDispatcherProperties(): DICOMDispatcherProperties {
  return {
    destinationConnectorProperties: {
      queueEnabled: false,
      sendFirst: false,
      retryCount: 0,
      rotate: false,
      includeFilterTransformer: true,
      threadCount: 1,
      threadAssignmentVariable: '',
      validateResponse: false,
      reattachAttachments: true,
    },

    host: '127.0.0.1',
    port: '104',
    applicationEntity: '',
    localHost: '',
    localPort: '',
    localApplicationEntity: '',
    template: '${DICOMMESSAGE}',

    // Timeouts and connection settings
    acceptTo: '5000',
    async: '0',
    bufSize: '1',
    connectTo: '0',
    priority: DicomPriority.MEDIUM,
    passcode: '',
    pdv1: false,
    rcvpdulen: '16',
    reaper: '10',
    releaseTo: '5',
    rspTo: '60',
    shutdownDelay: '1000',
    sndpdulen: '16',
    soCloseDelay: '50',
    sorcvbuf: '0',
    sosndbuf: '0',
    stgcmt: false,
    stgcmtTimeout: 30000,
    tcpDelay: true,
    ts1: false,
    uidnegrsp: false,
    username: '',

    // TLS (disabled by default)
    keyPW: '',
    keyStore: '',
    keyStorePW: '',
    noClientAuth: true,
    nossl2: true,
    tls: DicomTlsMode.NO_TLS,
    trustStore: '',
    trustStorePW: '',
  };
}

/**
 * Get the protocol name for the connector
 */
export function getProtocol(): string {
  return 'DICOM';
}

/**
 * Get the display name for the connector
 */
export function getName(): string {
  return 'DICOM Sender';
}

/**
 * Re-export constants from receiver properties for convenience
 */
export { DicomTlsMode, TransferSyntax, SopClass, DimseCommand };
