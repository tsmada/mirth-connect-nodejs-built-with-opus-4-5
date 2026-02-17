/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/dimse/DICOMReceiverProperties.java
 *
 * Purpose: Configuration properties for DICOM source (receiver) connector
 *
 * Key behaviors to replicate:
 * - All DICOM/DIMSE configuration options
 * - TLS/SSL configuration
 * - Transfer syntax settings
 * - Association/connection timeouts
 */

/**
 * TLS mode for DICOM connections
 */
export enum DicomTlsMode {
  /** No TLS encryption */
  NO_TLS = 'notls',
  /** TLS with 3DES encryption */
  TLS_3DES = '3des',
  /** TLS with AES encryption */
  TLS_AES = 'aes',
}

/**
 * DIMSE service commands
 */
export enum DimseCommand {
  /** Store images (C-STORE) */
  C_STORE = 'C-STORE',
  /** Query for images (C-FIND) */
  C_FIND = 'C-FIND',
  /** Retrieve images (C-MOVE) */
  C_MOVE = 'C-MOVE',
  /** Get images directly (C-GET) */
  C_GET = 'C-GET',
  /** Verify connection (C-ECHO) */
  C_ECHO = 'C-ECHO',
}

/**
 * Transfer Syntax UIDs
 */
export const TransferSyntax = {
  /** Implicit VR Little Endian (default) */
  IMPLICIT_VR_LITTLE_ENDIAN: '1.2.840.10008.1.2',
  /** Explicit VR Little Endian */
  EXPLICIT_VR_LITTLE_ENDIAN: '1.2.840.10008.1.2.1',
  /** Explicit VR Big Endian */
  EXPLICIT_VR_BIG_ENDIAN: '1.2.840.10008.1.2.2',
  /** JPEG Baseline */
  JPEG_BASELINE: '1.2.840.10008.1.2.4.50',
  /** JPEG Extended */
  JPEG_EXTENDED: '1.2.840.10008.1.2.4.51',
  /** JPEG Lossless */
  JPEG_LOSSLESS: '1.2.840.10008.1.2.4.70',
  /** JPEG 2000 Image Compression (Lossless) */
  JPEG_2000_LOSSLESS: '1.2.840.10008.1.2.4.90',
  /** JPEG 2000 Image Compression */
  JPEG_2000: '1.2.840.10008.1.2.4.91',
  /** RLE Lossless */
  RLE_LOSSLESS: '1.2.840.10008.1.2.5',
} as const;

/**
 * SOP Class UIDs for common DICOM services
 */
export const SopClass = {
  /** Verification SOP Class */
  VERIFICATION: '1.2.840.10008.1.1',
  /** CT Image Storage */
  CT_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.2',
  /** MR Image Storage */
  MR_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.4',
  /** Ultrasound Image Storage */
  US_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.6.1',
  /** Secondary Capture Image Storage */
  SECONDARY_CAPTURE_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.7',
  /** X-Ray Angiographic Image Storage */
  XA_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.12.1',
  /** Digital X-Ray Image Storage */
  DX_IMAGE_STORAGE: '1.2.840.10008.5.1.4.1.1.1.1',
  /** Patient Root Query/Retrieve Information Model - FIND */
  PATIENT_ROOT_FIND: '1.2.840.10008.5.1.4.1.2.1.1',
  /** Patient Root Query/Retrieve Information Model - MOVE */
  PATIENT_ROOT_MOVE: '1.2.840.10008.5.1.4.1.2.1.2',
  /** Study Root Query/Retrieve Information Model - FIND */
  STUDY_ROOT_FIND: '1.2.840.10008.5.1.4.1.2.2.1',
  /** Study Root Query/Retrieve Information Model - MOVE */
  STUDY_ROOT_MOVE: '1.2.840.10008.5.1.4.1.2.2.2',
} as const;

/**
 * Listener/network properties for source connectors
 */
export interface ListenerConnectorProperties {
  /** Host to bind to */
  host: string;
  /** Port to listen on */
  port: string;
}

/**
 * Source connector response mode
 */
export interface SourceConnectorProperties {
  /** Response variable */
  responseVariable: string;
  /** Whether to process batch messages */
  processBatch: boolean;
  /** First response only for batch */
  firstResponse: boolean;
}

/**
 * DICOM Receiver (Source) Properties
 */
export interface DICOMReceiverProperties {
  /** Network listener properties */
  listenerConnectorProperties: ListenerConnectorProperties;
  /** Source connector properties */
  sourceConnectorProperties: SourceConnectorProperties;

  /** Application Entity title (remote) */
  applicationEntity: string;
  /** Local host override */
  localHost: string;
  /** Local port override */
  localPort: string;
  /** Local Application Entity title */
  localApplicationEntity: string;

  // Connection timeouts (in seconds unless noted)
  /** Socket close delay (ms) */
  soCloseDelay: string;
  /** Association release timeout */
  releaseTo: string;
  /** A-ASSOCIATE-RQ timeout */
  requestTo: string;
  /** Idle timeout for associations */
  idleTo: string;
  /** Association reaper interval */
  reaper: string;
  /** DIMSE-RSP delay */
  rspDelay: string;

  // PDU settings
  /** Pack command and data in same PDV */
  pdv1: boolean;
  /** Max send PDU length (KB) */
  sndpdulen: string;
  /** Max receive PDU length (KB) */
  rcvpdulen: string;
  /** Max async ops (0 = unlimited) */
  async: string;

  // Transfer syntax settings
  /** Accept big endian explicit */
  bigEndian: boolean;
  /** File buffer size (KB) */
  bufSize: string;
  /** Only accept default transfer syntax */
  defts: boolean;
  /** Destination directory for received files */
  dest: string;
  /** Store received data as native format */
  nativeData: boolean;

  // Socket settings
  /** Socket receive buffer size */
  sorcvbuf: string;
  /** Socket send buffer size */
  sosndbuf: string;
  /** TCP no-delay (Nagle algorithm disabled) */
  tcpDelay: boolean;

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
  /** TLS mode (notls, 3des, aes) */
  tls: string;
  /** Truststore path */
  trustStore: string;
  /** Truststore password */
  trustStorePW: string;
}

/**
 * Default DICOM Receiver properties
 * Matches Java DICOMReceiverProperties constructor defaults
 */
export function getDefaultDICOMReceiverProperties(): DICOMReceiverProperties {
  return {
    listenerConnectorProperties: {
      host: '0.0.0.0',
      port: '104',
    },
    sourceConnectorProperties: {
      responseVariable: 'd0',
      processBatch: false,
      firstResponse: false,
    },

    applicationEntity: '',
    localHost: '',
    localPort: '',
    localApplicationEntity: '',

    // Connection timeouts
    soCloseDelay: '50',
    releaseTo: '5',
    requestTo: '5',
    idleTo: '60',
    reaper: '10',
    rspDelay: '0',

    // PDU settings
    pdv1: false,
    sndpdulen: '16',
    rcvpdulen: '16',
    async: '0',

    // Transfer syntax
    bigEndian: false,
    bufSize: '1',
    defts: false,
    dest: '',
    nativeData: false,

    // Socket settings
    sorcvbuf: '0',
    sosndbuf: '0',
    tcpDelay: true,

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
  return 'DICOM Listener';
}
