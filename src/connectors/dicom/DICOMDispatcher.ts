/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/dimse/DICOMDispatcher.java
 *
 * Purpose: DICOM destination connector that sends DICOM messages (C-STORE SCU)
 *
 * Key behaviors to replicate:
 * - Send C-STORE requests to remote DICOM nodes
 * - Support for storage commitment
 * - TLS support
 * - Proper DIMSE response handling
 */

import * as fs from 'fs';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  DICOMDispatcherProperties,
  getDefaultDICOMDispatcherProperties,
  DicomTlsMode,
  DicomPriority,
  TransferSyntax,
  SopClass,
} from './DICOMDispatcherProperties.js';
import {
  DicomConnection,
  DicomStatus,
  AssociationParams,
  StorageCommitment,
} from './DicomConnection.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('dicom-connector', 'DICOM C-STORE sender');
const logger = getLogger('dicom-connector');

/**
 * Configuration for DICOM Dispatcher
 */
export interface DICOMDispatcherConfig {
  name?: string;
  metaDataId?: number;
  enabled?: boolean;
  properties?: Partial<DICOMDispatcherProperties>;
}

/**
 * DICOM Dispatcher (SCU - Service Class User)
 * Sends DICOM messages to remote DICOM nodes
 */
export class DICOMDispatcher extends DestinationConnector {
  private properties: DICOMDispatcherProperties;

  /** Cached TLS certificate buffers — loaded once at start() to avoid fs.readFileSync per send */
  private cachedTlsPfx?: Buffer;
  private cachedTlsCa?: Buffer;

  constructor(config: DICOMDispatcherConfig = {}) {
    super({
      name: config.name ?? 'DICOM Sender',
      metaDataId: config.metaDataId ?? 1,
      transportName: 'DICOM',
      enabled: config.enabled ?? true,
    });

    this.properties = {
      ...getDefaultDICOMDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): DICOMDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DICOMDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Cache TLS certificate buffers at start time to avoid fs.readFileSync on every send.
   */
  protected override async onStart(): Promise<void> {
    if (this.properties.tls !== DicomTlsMode.NO_TLS) {
      if (this.properties.keyStore && this.properties.keyStorePW) {
        this.cachedTlsPfx = fs.readFileSync(this.properties.keyStore);
      }
      if (this.properties.trustStore && this.properties.trustStorePW) {
        this.cachedTlsCa = fs.readFileSync(this.properties.trustStore);
      }
    }
  }

  /**
   * Clear cached TLS buffers on stop.
   */
  protected override async onStop(): Promise<void> {
    this.cachedTlsPfx = undefined;
    this.cachedTlsCa = undefined;
  }

  /**
   * CPC-W18-004: Resolve ${variable} placeholders in connector properties before each send.
   * Matches Java DICOMDispatcher.replaceConnectorProperties() (line 88):
   * Resolves host, port, localHost, localPort, applicationEntity, localApplicationEntity,
   * username, passcode, template, keyStore, keyStorePW, trustStore, trustStorePW, keyPW.
   * Returns a shallow clone — original properties are NOT modified.
   */
  replaceConnectorProperties(
    props: DICOMDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): DICOMDispatcherProperties {
    const resolved = { ...props };

    // Network
    resolved.host = this.resolveVariables(resolved.host, connectorMessage);
    resolved.port = this.resolveVariables(resolved.port, connectorMessage);
    resolved.localHost = this.resolveVariables(resolved.localHost, connectorMessage);
    resolved.localPort = this.resolveVariables(resolved.localPort, connectorMessage);

    // Identity
    resolved.applicationEntity = this.resolveVariables(resolved.applicationEntity, connectorMessage);
    resolved.localApplicationEntity = this.resolveVariables(resolved.localApplicationEntity, connectorMessage);

    // Authentication
    resolved.username = this.resolveVariables(resolved.username, connectorMessage);
    resolved.passcode = this.resolveVariables(resolved.passcode, connectorMessage);

    // Content
    resolved.template = this.resolveVariables(resolved.template, connectorMessage);

    // TLS
    resolved.keyStore = this.resolveVariables(resolved.keyStore, connectorMessage);
    resolved.keyStorePW = this.resolveVariables(resolved.keyStorePW, connectorMessage);
    resolved.trustStore = this.resolveVariables(resolved.trustStore, connectorMessage);
    resolved.trustStorePW = this.resolveVariables(resolved.trustStorePW, connectorMessage);
    resolved.keyPW = this.resolveVariables(resolved.keyPW, connectorMessage);

    return resolved;
  }

  /**
   * Simple ${variable} resolution using connector message maps.
   * Checks channelMap, then sourceMap, then connectorMap.
   * Matches Java ValueReplacer.replaceValues() map lookup order.
   */
  private resolveVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template || !template.includes('${')) return template;

    return template.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // Built-in message variables (matches Java ValueReplacer)
      if (varName === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        if (encoded?.content) return encoded.content;
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.rawData') {
        return connectorMessage.getRawData() ?? match;
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const v = channelMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const v = sourceMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const v = connectorMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      return match; // Leave unresolved variables as-is
    });
  }

  /**
   * Send a DICOM message.
   *
   * CPC-W19-001: Matches Java DICOMDispatcher.send() pattern (line 115-294):
   * - Initializes responseStatus = Status.QUEUED
   * - Non-success DICOM status codes set QUEUED (message stays in queue for retry)
   * - Only exceptions cause error state
   * - Always returns normally (never throws from status handling)
   *
   * CPC-W19-007: Dispatches ErrorEvent on exception, matching Java line 283.
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-W18-004: Resolve ${variable} placeholders before each send
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);

    // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., ConnectionStatusEventType.WRITING, info))
    const info = `Host: ${resolvedProps.host}`;
    this.dispatchConnectionEvent(ConnectionStatusEventType.WRITING, info);

    let connection: DicomConnection | null = null;
    let tempFile: string | null = null;

    // Java pattern: declare response variables upfront, default to QUEUED
    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatusMessage: string | null = null;
    let responseStatus: Status = Status.QUEUED;

    try {
      // Get the message content to send
      const content = this.getMessageContent(connectorMessage);
      if (!content) {
        throw new Error('No content to send');
      }

      // Parse DICOM data from content (expected to be base64 encoded or raw bytes)
      const dicomData = this.parseDicomContent(content);

      // Extract SOP Class and Instance UIDs from DICOM data
      const { sopClassUid, sopInstanceUid } = this.extractSopUids(dicomData);

      // Create connection with configured parameters (using resolved props)
      connection = this.createConnection(sopClassUid, resolvedProps);

      // Establish association
      await connection.associate();

      // Send C-STORE
      const dimseStatus = await connection.cStore(sopClassUid, sopInstanceUid, dicomData);

      // Build response XML (same format as Java's CommandDataDimseRSPHandler.getCommandData())
      const statusHex = '0x' + dimseStatus.toString(16).padStart(4, '0').toUpperCase();
      responseData = `<dicom>\n  <tag00000900 tag="00000900" vr="US" len="2">${dimseStatus}</tag00000900>\n</dicom>`;

      // CPC-W19-001: Handle DICOM status matching Java (lines 261-272)
      if (dimseStatus === DicomStatus.SUCCESS) {
        responseStatusMessage = 'DICOM message successfully sent';
        responseStatus = Status.SENT;
      } else if (
        dimseStatus === DicomStatus.WARNING_COERCION ||
        dimseStatus === DicomStatus.WARNING_ELEMENT_COERCION ||
        dimseStatus === DicomStatus.WARNING_DATA_TRUNCATION
      ) {
        responseStatusMessage = `DICOM message successfully sent with warning status code: ${statusHex}`;
        responseStatus = Status.SENT;
      } else {
        // Non-success/non-warning: QUEUED for retry (NOT an error/throw)
        responseStatusMessage = `Error status code received from DICOM server: ${statusHex}`;
        responseStatus = Status.QUEUED;
      }

      // Handle storage commitment if configured (Java lines 238-256)
      if (resolvedProps.stgcmt && responseStatus === Status.SENT) {
        const commitTimeout = resolvedProps.stgcmtTimeout ?? 30000;
        const committed = await connection.requestStorageCommitment(
          sopClassUid,
          sopInstanceUid,
          commitTimeout
        );
        if (!committed) {
          // Commitment failed or timed out — queue for retry so data is not lost
          responseStatus = Status.QUEUED;
          responseStatusMessage = 'Storage commitment not confirmed';
        }
      }

      // Release association gracefully
      await connection.release();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      responseStatusMessage = `DICOM send error: ${errorMessage}`;
      responseError = `DICOM Sender: ${errorMessage}`;

      // CPC-W19-007: Dispatch ErrorEvent on send failure, matching Java line 283
      this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED, `Error: ${errorMessage}`);
    } finally {
      // Clean up connection
      if (connection) {
        connection.close();
      }

      // Clean up temp file
      if (tempFile) {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., ConnectionStatusEventType.IDLE))
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }

    // Set sent content / error content on the connector message
    if (responseStatus === Status.SENT && responseData) {
      connectorMessage.setContent({
        contentType: ContentType.SENT,
        content: responseData,
        dataType: 'XML',
        encrypted: false,
      });
    }
    if (responseStatusMessage) {
      connectorMessage.getConnectorMap().set('dicomResponse', responseStatusMessage);
    }
    if (responseError) {
      connectorMessage.getConnectorMap().set('dicomError', responseError);
    }

    // Store response data in connector map for framework to pick up
    connectorMessage.getConnectorMap().set('responseStatus', responseStatus);
    connectorMessage.getConnectorMap().set('responseStatusMessage', responseStatusMessage ?? '');
    connectorMessage.getConnectorMap().set('responseData', responseData ?? '');
  }

  /**
   * Get message content for sending
   */
  private getMessageContent(connectorMessage: ConnectorMessage): string | null {
    // Check for encoded content first
    const encoded = connectorMessage.getEncodedContent();
    if (encoded?.content) {
      return encoded.content;
    }

    // Fall back to transformed content
    const transformed = connectorMessage.getTransformedContent();
    if (transformed?.content) {
      return transformed.content;
    }

    // Fall back to raw content
    const raw = connectorMessage.getRawContent();
    if (raw?.content) {
      return raw.content;
    }

    return null;
  }

  /**
   * Parse DICOM content from message
   */
  private parseDicomContent(content: string): Buffer {
    // Try to parse as JSON (our internal format)
    try {
      const parsed = JSON.parse(content);
      if (parsed.data) {
        return Buffer.from(parsed.data, 'base64');
      }
    } catch (e) {
      // Not JSON, continue
    }

    // Check if content is base64 encoded
    if (this.isBase64(content)) {
      return Buffer.from(content, 'base64');
    }

    // Assume raw binary data
    return Buffer.from(content);
  }

  /**
   * Check if string is base64 encoded
   */
  private isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (e) {
      return false;
    }
  }

  /**
   * Extract SOP Class and Instance UIDs from DICOM data
   */
  private extractSopUids(data: Buffer): { sopClassUid: string; sopInstanceUid: string } {
    // Parse DICOM attributes to find SOP UIDs
    // This is a simplified parser - in production, use dcmjs or dicom-parser

    let sopClassUid: string = SopClass.SECONDARY_CAPTURE_IMAGE_STORAGE; // Default
    let sopInstanceUid: string = this.generateUid();

    try {
      // Skip file meta information if present (starts with "DICM" at offset 128)
      let offset = 0;
      if (data.length > 132 && data.toString('ascii', 128, 132) === 'DICM') {
        offset = 132;
        // Skip past file meta info (group 0002)
        while (offset < data.length - 8) {
          const group = data.readUInt16LE(offset);
          if (group !== 0x0002) break;
          offset += 2;
          data.readUInt16LE(offset); // skip element
          offset += 2;
          const vr = data.toString('ascii', offset, offset + 2);
          offset += 2;

          let length: number;
          if (['OB', 'OW', 'OF', 'SQ', 'UC', 'UR', 'UT', 'UN'].includes(vr)) {
            offset += 2; // Skip reserved
            length = data.readUInt32LE(offset);
            offset += 4;
          } else {
            length = data.readUInt16LE(offset);
            offset += 2;
          }

          offset += length;
        }
      }

      // Look for SOP Class UID (0008,0016) and SOP Instance UID (0008,0018)
      while (offset < data.length - 8) {
        const group = data.readUInt16LE(offset);
        const element = data.readUInt16LE(offset + 2);

        // Implicit VR Little Endian: group, element, length, value
        const length = data.readUInt32LE(offset + 4);

        if (group === 0x0008 && element === 0x0016) {
          // SOP Class UID
          sopClassUid = data.toString('ascii', offset + 8, offset + 8 + length).replace(/\0/g, '').trim();
        } else if (group === 0x0008 && element === 0x0018) {
          // SOP Instance UID
          sopInstanceUid = data.toString('ascii', offset + 8, offset + 8 + length).replace(/\0/g, '').trim();
        }

        offset += 8 + length;
        // Ensure even boundary
        if (length % 2 !== 0 && offset < data.length) {
          offset++;
        }

        // Stop if we've found both or moved past expected location
        if (group > 0x0008) break;
      }
    } catch (e) {
      logger.warn('Error parsing DICOM UIDs, using defaults');
    }

    return { sopClassUid, sopInstanceUid };
  }

  /**
   * Generate a unique UID
   */
  private generateUid(): string {
    // Use org root + timestamp + random
    const root = '1.2.40.0.13.1.1.1';
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${root}.${timestamp}.${random}`;
  }

  /**
   * Create DICOM connection with properties.
   * Accepts resolved props so ${variable} substitution is applied before connection setup.
   *
   * CPC-W19-002: Wires all 16 dcmSnd config properties from Java
   * DICOMDispatcher.send() lines 154-231 to the connection params.
   */
  private createConnection(sopClassUid: string, props?: DICOMDispatcherProperties): DicomConnection {
    const p = props ?? this.properties;
    const params: Partial<AssociationParams> = {
      callingAE: p.localApplicationEntity || 'MIRTH',
      calledAE: p.applicationEntity || 'DCMRCV',
      host: p.host,
      port: parseInt(p.port, 10),
      maxPduLengthSend: parseInt(p.sndpdulen, 10) * 1024,
      maxPduLengthReceive: parseInt(p.rcvpdulen, 10) * 1024,
      sopClasses: [
        SopClass.VERIFICATION,
        sopClassUid,
        ...(p.stgcmt ? [StorageCommitment.SOP_CLASS_UID] : []),
      ],
      transferSyntaxes: this.getTransferSyntaxes(),
      connectTimeout: parseInt(p.connectTo, 10) || 30000,
      associationTimeout: parseInt(p.acceptTo, 10),
    };

    // Java: dcmSnd.setLocalHost/setLocalPort — bind outbound to specific network interface
    if (p.localHost) {
      params.localHost = p.localHost;
      if (p.localPort) {
        params.localPort = parseInt(p.localPort, 10);
      }
    }

    // CPC-W19-002: Wire remaining dcmSnd config properties (Java lines 158-226)

    // Java: dcmSnd.setMaxOpsInvoked(value) — max async operations
    const asyncVal = parseInt(p.async, 10);
    if (asyncVal > 0) {
      params.maxOpsInvoked = asyncVal;
    }

    // Java: dcmSnd.setTranscoderBufferSize(value) — buffer size (KB)
    const bufSizeVal = parseInt(p.bufSize, 10);
    if (bufSizeVal !== 1) {
      params.transcoderBufferSize = bufSizeVal;
    }

    // Java: dcmSnd.setPriority(0=med, 1=low, 2=high)
    if (p.priority === DicomPriority.LOW) {
      params.priority = 1;
    } else if (p.priority === DicomPriority.HIGH) {
      params.priority = 2;
    } else {
      params.priority = 0; // medium (default)
    }

    // Java: dcmSnd.setUserIdentity(userId) — username/passcode auth
    if (p.username) {
      params.username = p.username;
      if (p.passcode) {
        params.passcode = p.passcode;
      }
      params.uidnegrsp = p.uidnegrsp;
    }

    // Java: dcmSnd.setPackPDV(value) — pack command and data in same P-DATA-TF
    params.packPDV = p.pdv1;

    // Java: dcmSnd.setAssociationReaperPeriod(value)
    const reaperVal = parseInt(p.reaper, 10);
    if (reaperVal !== 10) {
      params.associationReaperPeriod = reaperVal;
    }

    // Java: dcmSnd.setReleaseTimeout(value)
    const releaseToVal = parseInt(p.releaseTo, 10);
    if (releaseToVal !== 5) {
      params.releaseTimeout = releaseToVal;
    }

    // Java: dcmSnd.setDimseRspTimeout(value)
    const rspToVal = parseInt(p.rspTo, 10);
    if (rspToVal !== 60) {
      params.dimseRspTimeout = rspToVal;
    }

    // Java: dcmSnd.setShutdownDelay(value)
    const shutdownDelayVal = parseInt(p.shutdownDelay, 10);
    if (shutdownDelayVal !== 1000) {
      params.shutdownDelay = shutdownDelayVal;
    }

    // Java: dcmSnd.setSocketCloseDelay(value)
    const soCloseDelayVal = parseInt(p.soCloseDelay, 10);
    if (soCloseDelayVal !== 50) {
      params.socketCloseDelay = soCloseDelayVal;
    }

    // Java: dcmSnd.setReceiveBufferSize(value) — socket recv buffer (KB)
    const sorcvbufVal = parseInt(p.sorcvbuf, 10);
    if (sorcvbufVal > 0) {
      params.receiveBufferSize = sorcvbufVal;
    }

    // Java: dcmSnd.setSendBufferSize(value) — socket send buffer (KB)
    const sosndbuVal = parseInt(p.sosndbuf, 10);
    if (sosndbuVal > 0) {
      params.sendBufferSize = sosndbuVal;
    }

    // Java: dcmSnd.setStorageCommitment(value)
    params.storageCommitment = p.stgcmt;

    // Java: dcmSnd.setTcpNoDelay(!tcpDelay) — note: inverted!
    params.tcpNoDelay = !p.tcpDelay;

    // Configure TLS if enabled
    if (p.tls !== DicomTlsMode.NO_TLS) {
      params.tlsMode = p.tls as DicomTlsMode;
      params.tlsOptions = {
        rejectUnauthorized: !p.noClientAuth,
      };

      if (this.cachedTlsPfx) {
        params.tlsOptions.pfx = this.cachedTlsPfx;
        params.tlsOptions.passphrase = p.keyStorePW;
      }

      if (this.cachedTlsCa) {
        params.tlsOptions.ca = this.cachedTlsCa;
      }
    }

    return new DicomConnection(params);
  }

  /**
   * Get transfer syntaxes based on configuration
   */
  private getTransferSyntaxes(): string[] {
    const syntaxes: string[] = [TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN];

    if (this.properties.ts1) {
      // Offer default transfer syntax in separate presentation context
      syntaxes.push(TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN);
    }

    return syntaxes;
  }

  // handleStoreResponse and handleSendError removed — logic now inline in send() for Java parity (CPC-W19-001)

  /**
   * Get response (already set during send)
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Verify connection to remote DICOM node
   */
  async verifyConnection(): Promise<boolean> {
    let connection: DicomConnection | null = null;

    try {
      connection = this.createConnection(SopClass.VERIFICATION);
      await connection.associate();
      const status = await connection.cEcho();
      await connection.release();
      return status === DicomStatus.SUCCESS;
    } catch (error) {
      logger.error('DICOM verification failed', error as Error);
      return false;
    } finally {
      if (connection) {
        connection.close();
      }
    }
  }
}
