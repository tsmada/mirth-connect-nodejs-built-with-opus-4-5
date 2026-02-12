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
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  DICOMDispatcherProperties,
  getDefaultDICOMDispatcherProperties,
  DicomTlsMode,
  TransferSyntax,
  SopClass,
} from './DICOMDispatcherProperties.js';
import {
  DicomConnection,
  DicomStatus,
  AssociationParams,
} from './DicomConnection.js';

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
   * Send a DICOM message
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-W18-004: Resolve ${variable} placeholders before each send
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);

    // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., ConnectionStatusEventType.WRITING, info))
    const info = `Host: ${resolvedProps.host}`;
    this.dispatchConnectionEvent(ConnectionStatusEventType.WRITING, info);

    let connection: DicomConnection | null = null;
    let tempFile: string | null = null;

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
      const status = await connection.cStore(sopClassUid, sopInstanceUid, dicomData);

      // Handle response
      this.handleStoreResponse(connectorMessage, status);

      // Handle storage commitment if configured
      if (resolvedProps.stgcmt && status === DicomStatus.SUCCESS) {
        // Storage commitment handling would go here
        // For now, just log that it was requested
        console.log('Storage commitment requested but not yet implemented');
      }

      // Release association gracefully
      await connection.release();
    } catch (error) {
      this.handleSendError(connectorMessage, error);
      throw error;
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
      console.warn('Error parsing DICOM UIDs, using defaults:', e);
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
      sopClasses: [SopClass.VERIFICATION, sopClassUid],
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

    // Configure TLS if enabled
    if (p.tls !== DicomTlsMode.NO_TLS) {
      params.tlsMode = p.tls as DicomTlsMode;
      params.tlsOptions = {
        rejectUnauthorized: !p.noClientAuth,
      };

      if (p.keyStore && p.keyStorePW) {
        params.tlsOptions.pfx = fs.readFileSync(p.keyStore);
        params.tlsOptions.passphrase = p.keyStorePW;
      }

      if (p.trustStore && p.trustStorePW) {
        params.tlsOptions.ca = fs.readFileSync(p.trustStore);
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

  /**
   * Handle C-STORE response
   */
  private handleStoreResponse(connectorMessage: ConnectorMessage, status: DicomStatus): void {
    const statusHex = '0x' + status.toString(16).padStart(4, '0').toUpperCase();

    // Build response data as XML (similar to Java implementation)
    const responseXml = `<dicom>
  <tag00000900 tag="00000900" vr="US" len="2">${status}</tag00000900>
</dicom>`;

    if (status === DicomStatus.SUCCESS) {
      // Set sent content
      connectorMessage.setContent({
        contentType: ContentType.SENT,
        content: responseXml,
        dataType: 'XML',
        encrypted: false,
      });
      // Store response message in connector map
      connectorMessage.getConnectorMap().set('dicomResponse', `DICOM message successfully sent (status: ${statusHex})`);
    } else if (
      status === DicomStatus.WARNING_COERCION ||
      status === DicomStatus.WARNING_ELEMENT_COERCION ||
      status === DicomStatus.WARNING_DATA_TRUNCATION
    ) {
      connectorMessage.setContent({
        contentType: ContentType.SENT,
        content: responseXml,
        dataType: 'XML',
        encrypted: false,
      });
      connectorMessage.getConnectorMap().set('dicomResponse', `DICOM message sent with warning (status: ${statusHex})`);
    } else {
      throw new Error(`DICOM send failed with status: ${statusHex}`);
    }
  }

  /**
   * Handle send error
   */
  private handleSendError(connectorMessage: ConnectorMessage, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    connectorMessage.setContent({
      contentType: ContentType.RAW,
      content: '',
      dataType: 'ERROR',
      encrypted: false,
    });
    connectorMessage.getConnectorMap().set('dicomError', `DICOM send failed: ${errorMessage}`);
  }

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
      console.error('DICOM verification failed:', error);
      return false;
    } finally {
      if (connection) {
        connection.close();
      }
    }
  }
}
