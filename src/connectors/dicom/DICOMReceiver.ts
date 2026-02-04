/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/dimse/DICOMReceiver.java
 *
 * Purpose: DICOM source connector that receives DICOM messages (C-STORE SCP)
 *
 * Key behaviors to replicate:
 * - Listen for DICOM associations
 * - Accept C-STORE requests
 * - Handle C-ECHO for verification
 * - Support multiple simultaneous associations
 * - TLS support
 */

import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  DICOMReceiverProperties,
  getDefaultDICOMReceiverProperties,
  TransferSyntax,
  SopClass,
  DicomTlsMode,
} from './DICOMReceiverProperties.js';
import {
  PduType,
  DimseCommandType,
  DicomStatus,
  AssociationState,
} from './DicomConnection.js';

/**
 * Configuration for DICOM Receiver
 */
export interface DICOMReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<DICOMReceiverProperties>;
}

/**
 * Active association tracking
 */
interface ActiveAssociation {
  socket: net.Socket | tls.TLSSocket;
  state: AssociationState;
  callingAE: string;
  calledAE: string;
  presentationContexts: Map<number, AcceptedPresentationContext>;
  receiveBuffer: Buffer;
  maxPduLength: number;
  receivingData: Map<number, ReceivedDataState>;
}

/**
 * Accepted presentation context
 */
interface AcceptedPresentationContext {
  id: number;
  abstractSyntax: string;
  transferSyntax: string;
}

/**
 * State for receiving data across multiple PDVs
 */
interface ReceivedDataState {
  commandBuffer: Buffer[];
  dataBuffer: Buffer[];
  commandComplete: boolean;
  dataComplete: boolean;
  dimseCommand?: DimseCommandType;
  messageId?: number;
  affectedSopClassUid?: string;
  affectedSopInstanceUid?: string;
}

/**
 * DICOM Receiver (SCP - Service Class Provider)
 * Accepts incoming DICOM associations and processes DIMSE commands
 */
export class DICOMReceiver extends SourceConnector {
  private properties: DICOMReceiverProperties;
  private server: net.Server | tls.Server | null = null;
  private associations: Map<net.Socket, ActiveAssociation> = new Map();
  private acceptedSopClasses: Set<string> = new Set();
  private acceptedTransferSyntaxes: string[] = [];

  constructor(config: DICOMReceiverConfig = {}) {
    super({
      name: config.name ?? 'DICOM Listener',
      transportName: 'DICOM',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultDICOMReceiverProperties(),
      ...config.properties,
    };

    // Initialize accepted SOP classes and transfer syntaxes
    this.initializeAcceptedContexts();
  }

  /**
   * Initialize the accepted SOP classes and transfer syntaxes
   */
  private initializeAcceptedContexts(): void {
    // Accept common storage SOP classes
    this.acceptedSopClasses.add(SopClass.VERIFICATION);
    this.acceptedSopClasses.add(SopClass.CT_IMAGE_STORAGE);
    this.acceptedSopClasses.add(SopClass.MR_IMAGE_STORAGE);
    this.acceptedSopClasses.add(SopClass.US_IMAGE_STORAGE);
    this.acceptedSopClasses.add(SopClass.SECONDARY_CAPTURE_IMAGE_STORAGE);
    this.acceptedSopClasses.add(SopClass.XA_IMAGE_STORAGE);
    this.acceptedSopClasses.add(SopClass.DX_IMAGE_STORAGE);

    // Setup transfer syntaxes based on configuration
    if (this.properties.defts) {
      this.acceptedTransferSyntaxes = [TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN];
    } else if (this.properties.nativeData) {
      if (this.properties.bigEndian) {
        this.acceptedTransferSyntaxes = [
          TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN,
          TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN,
          TransferSyntax.EXPLICIT_VR_BIG_ENDIAN,
        ];
      } else {
        this.acceptedTransferSyntaxes = [
          TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN,
          TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN,
        ];
      }
    } else {
      this.acceptedTransferSyntaxes = [
        TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN,
        TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN,
      ];
      if (this.properties.bigEndian) {
        this.acceptedTransferSyntaxes.push(TransferSyntax.EXPLICIT_VR_BIG_ENDIAN);
      }
    }
  }

  /**
   * Get the connector properties
   */
  getProperties(): DICOMReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DICOMReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
    this.initializeAcceptedContexts();
  }

  /**
   * Add an accepted SOP class
   */
  addAcceptedSopClass(sopClassUid: string): void {
    this.acceptedSopClasses.add(sopClassUid);
  }

  /**
   * Start the DICOM receiver
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('DICOM Receiver is already running');
    }

    const port = parseInt(this.properties.listenerConnectorProperties.port, 10);
    const host = this.properties.listenerConnectorProperties.host;

    if (this.properties.tls !== DicomTlsMode.NO_TLS) {
      await this.startTlsServer(host, port);
    } else {
      await this.startServer(host, port);
    }

    this.running = true;
  }

  /**
   * Start TCP server
   */
  private async startServer(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        if (!this.running) {
          reject(error);
        } else {
          console.error('DICOM Server error:', error);
        }
      });

      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  /**
   * Start TLS server
   */
  private async startTlsServer(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: tls.TlsOptions = {
        requestCert: !this.properties.noClientAuth,
        rejectUnauthorized: !this.properties.noClientAuth,
      };

      if (this.properties.keyStore && this.properties.keyStorePW) {
        options.pfx = fs.readFileSync(this.properties.keyStore);
        options.passphrase = this.properties.keyStorePW;
      }

      if (this.properties.trustStore && this.properties.trustStorePW) {
        options.ca = fs.readFileSync(this.properties.trustStore);
      }

      this.server = tls.createServer(options, (socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        if (!this.running) {
          reject(error);
        } else {
          console.error('DICOM TLS Server error:', error);
        }
      });

      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the DICOM receiver
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Close all associations
    for (const [socket, _association] of this.associations) {
      try {
        await this.sendAbort(socket, 0, 0);
      } catch (e) {
        // Ignore errors during shutdown
      }
      socket.destroy();
    }
    this.associations.clear();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.running = false;
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: net.Socket | tls.TLSSocket): void {
    const association: ActiveAssociation = {
      socket,
      state: AssociationState.IDLE,
      callingAE: '',
      calledAE: '',
      presentationContexts: new Map(),
      receiveBuffer: Buffer.alloc(0),
      maxPduLength: parseInt(this.properties.rcvpdulen, 10) * 1024,
      receivingData: new Map(),
    };

    this.associations.set(socket, association);

    socket.on('data', (data) => this.handleData(socket, data));
    socket.on('close', () => this.handleClose(socket));
    socket.on('error', (error) => this.handleError(socket, error));

    // Set idle timeout
    const idleTimeout = parseInt(this.properties.idleTo, 10) * 1000;
    if (idleTimeout > 0) {
      socket.setTimeout(idleTimeout, () => {
        this.handleTimeout(socket);
      });
    }
  }

  /**
   * Handle incoming data
   */
  private handleData(socket: net.Socket, data: Buffer): void {
    const association = this.associations.get(socket);
    if (!association) return;

    association.receiveBuffer = Buffer.concat([association.receiveBuffer, data]);
    this.processPdus(socket, association);
  }

  /**
   * Process complete PDUs from buffer
   */
  private processPdus(socket: net.Socket, association: ActiveAssociation): void {
    while (association.receiveBuffer.length >= 6) {
      const pduType = association.receiveBuffer[0]!;
      const pduLength = association.receiveBuffer.readUInt32BE(2);
      const totalLength = pduLength + 6;

      if (association.receiveBuffer.length < totalLength) {
        break; // Incomplete PDU
      }

      const pduData = association.receiveBuffer.subarray(0, totalLength);
      association.receiveBuffer = association.receiveBuffer.subarray(totalLength);

      this.handlePdu(socket, association, pduType, pduData);
    }
  }

  /**
   * Handle a complete PDU
   */
  private handlePdu(
    socket: net.Socket,
    association: ActiveAssociation,
    pduType: number,
    pduData: Buffer
  ): void {
    switch (pduType) {
      case PduType.A_ASSOCIATE_RQ:
        this.handleAssociateRq(socket, association, pduData);
        break;
      case PduType.P_DATA_TF:
        this.handleDataTf(socket, association, pduData);
        break;
      case PduType.A_RELEASE_RQ:
        this.handleReleaseRq(socket, association);
        break;
      case PduType.A_ABORT:
        this.handleAbort(socket, association, pduData);
        break;
      default:
        console.warn(`Unknown PDU type: ${pduType}`);
    }
  }

  /**
   * Handle A-ASSOCIATE-RQ PDU
   */
  private async handleAssociateRq(
    socket: net.Socket,
    association: ActiveAssociation,
    pduData: Buffer
  ): Promise<void> {
    // Parse Association Request
    let offset = 10; // Skip PDU header and protocol version

    // Called AE Title (16 bytes)
    association.calledAE = pduData.toString('ascii', offset, offset + 16).trim();
    offset += 16;

    // Calling AE Title (16 bytes)
    association.callingAE = pduData.toString('ascii', offset, offset + 16).trim();
    offset += 16;

    // Reserved (32 bytes)
    offset += 32;

    // Parse variable items
    const proposedContexts: Map<number, { abstractSyntax: string; transferSyntaxes: string[] }> = new Map();
    let remoteMaxPduLength = 16384;

    while (offset < pduData.length) {
      const itemType = pduData[offset]!;
      const itemLength = pduData.readUInt16BE(offset + 2);

      if (itemType === 0x20) {
        // Presentation Context Item (proposed)
        const contextId = pduData[offset + 4]!;
        const context = this.parsePresentationContext(pduData.subarray(offset + 8, offset + 4 + itemLength));
        proposedContexts.set(contextId, context);
      } else if (itemType === 0x50) {
        // User Information Item
        const userInfo = this.parseUserInformation(pduData.subarray(offset + 4, offset + 4 + itemLength));
        if (userInfo.maxPduLength) {
          remoteMaxPduLength = userInfo.maxPduLength;
        }
      }

      offset += 4 + itemLength;
    }

    // Check if we should accept this association
    const localAE = this.properties.applicationEntity || this.properties.localApplicationEntity;
    if (localAE && association.calledAE !== localAE) {
      await this.sendAssociateRj(socket, 1, 1, 7); // Called AE not recognized
      return;
    }

    // Negotiate presentation contexts
    const acceptedContexts = this.negotiatePresentationContexts(proposedContexts);

    if (acceptedContexts.size === 0) {
      await this.sendAssociateRj(socket, 1, 1, 1); // No acceptable presentation contexts
      return;
    }

    // Store accepted contexts
    for (const [id, context] of acceptedContexts) {
      association.presentationContexts.set(id, context);
    }

    // Update max PDU length (use smaller of local and remote)
    association.maxPduLength = Math.min(
      association.maxPduLength,
      remoteMaxPduLength
    );

    // Send Association Accept
    await this.sendAssociateAc(socket, association, acceptedContexts);
    association.state = AssociationState.ASSOCIATED;
  }

  /**
   * Parse Presentation Context Item from A-ASSOCIATE-RQ
   */
  private parsePresentationContext(data: Buffer): { abstractSyntax: string; transferSyntaxes: string[] } {
    let offset = 0;
    let abstractSyntax = '';
    const transferSyntaxes: string[] = [];

    while (offset < data.length) {
      const itemType = data[offset]!;
      const itemLength = data.readUInt16BE(offset + 2);

      if (itemType === 0x30) {
        // Abstract Syntax
        abstractSyntax = data.toString('ascii', offset + 4, offset + 4 + itemLength);
      } else if (itemType === 0x40) {
        // Transfer Syntax
        transferSyntaxes.push(data.toString('ascii', offset + 4, offset + 4 + itemLength));
      }

      offset += 4 + itemLength;
    }

    return { abstractSyntax, transferSyntaxes };
  }

  /**
   * Parse User Information Item
   */
  private parseUserInformation(data: Buffer): { maxPduLength?: number; implementationUid?: string } {
    const result: { maxPduLength?: number; implementationUid?: string } = {};
    let offset = 0;

    while (offset < data.length) {
      const itemType = data[offset]!;
      const itemLength = data.readUInt16BE(offset + 2);

      if (itemType === 0x51) {
        // Maximum Length
        result.maxPduLength = data.readUInt32BE(offset + 4);
      } else if (itemType === 0x52) {
        // Implementation Class UID
        result.implementationUid = data.toString('ascii', offset + 4, offset + 4 + itemLength);
      }

      offset += 4 + itemLength;
    }

    return result;
  }

  /**
   * Negotiate presentation contexts
   */
  private negotiatePresentationContexts(
    proposed: Map<number, { abstractSyntax: string; transferSyntaxes: string[] }>
  ): Map<number, AcceptedPresentationContext> {
    const accepted = new Map<number, AcceptedPresentationContext>();

    for (const [contextId, context] of proposed) {
      // Check if we accept this SOP class
      if (!this.acceptedSopClasses.has(context.abstractSyntax)) {
        continue; // Reject: abstract syntax not supported
      }

      // Find a common transfer syntax
      let acceptedTs: string | null = null;
      for (const ts of context.transferSyntaxes) {
        if (this.acceptedTransferSyntaxes.includes(ts)) {
          acceptedTs = ts;
          break;
        }
      }

      if (acceptedTs) {
        accepted.set(contextId, {
          id: contextId,
          abstractSyntax: context.abstractSyntax,
          transferSyntax: acceptedTs,
        });
      }
    }

    return accepted;
  }

  /**
   * Send A-ASSOCIATE-AC PDU
   */
  private async sendAssociateAc(
    socket: net.Socket,
    association: ActiveAssociation,
    acceptedContexts: Map<number, AcceptedPresentationContext>
  ): Promise<void> {
    const items: Buffer[] = [];

    // Application Context Item
    const appContextUid = '1.2.840.10008.3.1.1.1';
    const appContextItem = Buffer.alloc(4 + appContextUid.length);
    appContextItem[0] = 0x10;
    appContextItem[1] = 0x00;
    appContextItem.writeUInt16BE(appContextUid.length, 2);
    appContextItem.write(appContextUid, 4, 'ascii');
    items.push(appContextItem);

    // Presentation Context Items (acceptance)
    for (const [contextId, context] of acceptedContexts) {
      const tsLength = context.transferSyntax.length;
      const pcItem = Buffer.alloc(8 + 4 + tsLength);
      pcItem[0] = 0x21; // Presentation Context Item (AC)
      pcItem[1] = 0x00;
      pcItem.writeUInt16BE(4 + 4 + tsLength, 2);
      pcItem[4] = contextId;
      pcItem[5] = 0x00;
      pcItem[6] = 0x00; // Result: acceptance
      pcItem[7] = 0x00;
      // Transfer Syntax sub-item
      pcItem[8] = 0x40;
      pcItem[9] = 0x00;
      pcItem.writeUInt16BE(tsLength, 10);
      pcItem.write(context.transferSyntax, 12, 'ascii');
      items.push(pcItem);
    }

    // User Information Item
    const userInfoItems: Buffer[] = [];

    // Max PDU Length
    const maxLengthItem = Buffer.alloc(8);
    maxLengthItem[0] = 0x51;
    maxLengthItem[1] = 0x00;
    maxLengthItem.writeUInt16BE(4, 2);
    maxLengthItem.writeUInt32BE(association.maxPduLength, 4);
    userInfoItems.push(maxLengthItem);

    // Implementation Class UID
    const implUid = '1.2.40.0.13.1.1.1';
    const implUidItem = Buffer.alloc(4 + implUid.length);
    implUidItem[0] = 0x52;
    implUidItem[1] = 0x00;
    implUidItem.writeUInt16BE(implUid.length, 2);
    implUidItem.write(implUid, 4, 'ascii');
    userInfoItems.push(implUidItem);

    // Implementation Version Name
    const implVersion = 'MIRTH_NODE_1.0';
    const implVersionItem = Buffer.alloc(4 + implVersion.length);
    implVersionItem[0] = 0x55;
    implVersionItem[1] = 0x00;
    implVersionItem.writeUInt16BE(implVersion.length, 2);
    implVersionItem.write(implVersion, 4, 'ascii');
    userInfoItems.push(implVersionItem);

    const userInfoData = Buffer.concat(userInfoItems);
    const userInfoItem = Buffer.alloc(4 + userInfoData.length);
    userInfoItem[0] = 0x50;
    userInfoItem[1] = 0x00;
    userInfoItem.writeUInt16BE(userInfoData.length, 2);
    userInfoData.copy(userInfoItem, 4);
    items.push(userInfoItem);

    const variableItems = Buffer.concat(items);
    const pduLength = 68 + variableItems.length;

    const pdu = Buffer.alloc(pduLength + 6);
    let offset = 0;

    pdu[offset++] = PduType.A_ASSOCIATE_AC;
    pdu[offset++] = 0x00;
    pdu.writeUInt32BE(pduLength, offset);
    offset += 4;

    // Protocol Version
    pdu.writeUInt16BE(0x0001, offset);
    offset += 2;

    // Reserved
    pdu.writeUInt16BE(0x0000, offset);
    offset += 2;

    // Called AE Title (16 bytes)
    pdu.write(association.calledAE.padEnd(16, ' '), offset, 16, 'ascii');
    offset += 16;

    // Calling AE Title (16 bytes)
    pdu.write(association.callingAE.padEnd(16, ' '), offset, 16, 'ascii');
    offset += 16;

    // Reserved (32 bytes)
    offset += 32;

    variableItems.copy(pdu, offset);

    await this.sendPdu(socket, pdu);
  }

  /**
   * Send A-ASSOCIATE-RJ PDU
   */
  private async sendAssociateRj(
    socket: net.Socket,
    result: number,
    source: number,
    reason: number
  ): Promise<void> {
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_ASSOCIATE_RJ;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);
    pdu[7] = result;
    pdu[8] = source;
    pdu[9] = reason;

    await this.sendPdu(socket, pdu);
    socket.destroy();
  }

  /**
   * Handle P-DATA-TF PDU
   */
  private async handleDataTf(
    socket: net.Socket,
    association: ActiveAssociation,
    pduData: Buffer
  ): Promise<void> {
    let offset = 6; // Skip PDU header

    while (offset < pduData.length) {
      const pdvLength = pduData.readUInt32BE(offset);
      const contextId = pduData[offset + 4]!;
      const messageControlHeader = pduData[offset + 5]!;

      const isCommand = (messageControlHeader & 0x01) === 1;
      const isLast = (messageControlHeader & 0x02) === 2;

      const pdvData = pduData.subarray(offset + 6, offset + 4 + pdvLength);

      // Get or create receiving state for this context
      let receivingState = association.receivingData.get(contextId);
      if (!receivingState) {
        receivingState = {
          commandBuffer: [],
          dataBuffer: [],
          commandComplete: false,
          dataComplete: false,
        };
        association.receivingData.set(contextId, receivingState);
      }

      if (isCommand) {
        receivingState.commandBuffer.push(pdvData);
        if (isLast) {
          receivingState.commandComplete = true;
          // Parse command
          const command = Buffer.concat(receivingState.commandBuffer);
          this.parseCommand(receivingState, command);

          // Check if this is a command with no data set
          const dataSetType = this.getDataSetType(command);
          if (dataSetType === 0x0101) {
            // No data set, process immediately
            await this.processDimseMessage(socket, association, contextId, receivingState);
          }
        }
      } else {
        receivingState.dataBuffer.push(pdvData);
        if (isLast) {
          receivingState.dataComplete = true;
          await this.processDimseMessage(socket, association, contextId, receivingState);
        }
      }

      offset += 4 + pdvLength;
    }
  }

  /**
   * Parse DIMSE command
   */
  private parseCommand(state: ReceivedDataState, command: Buffer): void {
    let offset = 0;

    while (offset < command.length - 8) {
      const group = command.readUInt16LE(offset);
      const element = command.readUInt16LE(offset + 2);
      const length = command.readUInt32LE(offset + 4);

      if (group === 0x0000 && element === 0x0100) {
        // Command Field
        state.dimseCommand = command.readUInt16LE(offset + 8);
      } else if (group === 0x0000 && element === 0x0110) {
        // Message ID
        state.messageId = command.readUInt16LE(offset + 8);
      } else if (group === 0x0008 && element === 0x0016) {
        // Affected SOP Class UID
        state.affectedSopClassUid = command.toString('ascii', offset + 8, offset + 8 + length).replace(/\0/g, '').trim();
      } else if (group === 0x0008 && element === 0x0018) {
        // Affected SOP Instance UID
        state.affectedSopInstanceUid = command.toString('ascii', offset + 8, offset + 8 + length).replace(/\0/g, '').trim();
      }

      offset += 8 + length;
      // Ensure even boundary
      if (length % 2 !== 0) offset++;
    }
  }

  /**
   * Get Data Set Type from command
   */
  private getDataSetType(command: Buffer): number {
    let offset = 0;

    while (offset < command.length - 8) {
      const group = command.readUInt16LE(offset);
      const element = command.readUInt16LE(offset + 2);
      const length = command.readUInt32LE(offset + 4);

      if (group === 0x0000 && element === 0x0800) {
        return command.readUInt16LE(offset + 8);
      }

      offset += 8 + length;
      if (length % 2 !== 0) offset++;
    }

    return 0x0101; // Default: no data set
  }

  /**
   * Process complete DIMSE message
   */
  private async processDimseMessage(
    socket: net.Socket,
    association: ActiveAssociation,
    contextId: number,
    state: ReceivedDataState
  ): Promise<void> {
    const context = association.presentationContexts.get(contextId);
    if (!context) {
      console.warn(`Unknown presentation context: ${contextId}`);
      return;
    }

    switch (state.dimseCommand) {
      case DimseCommandType.C_STORE_RQ:
        await this.handleCStoreRq(socket, association, contextId, state);
        break;
      case DimseCommandType.C_ECHO_RQ:
        await this.handleCEchoRq(socket, association, contextId, state);
        break;
      default:
        console.warn(`Unsupported DIMSE command: ${state.dimseCommand}`);
        // Send error response
        break;
    }

    // Clear receiving state
    association.receivingData.delete(contextId);
  }

  /**
   * Handle C-STORE-RQ (store request)
   */
  private async handleCStoreRq(
    socket: net.Socket,
    association: ActiveAssociation,
    contextId: number,
    state: ReceivedDataState
  ): Promise<void> {
    const context = association.presentationContexts.get(contextId);
    if (!context) return;

    // Combine data buffers
    const dataSet = Buffer.concat(state.dataBuffer);

    // Create message for channel processing
    const dicomMessage = {
      sopClassUid: state.affectedSopClassUid,
      sopInstanceUid: state.affectedSopInstanceUid,
      transferSyntax: context.transferSyntax,
      callingAE: association.callingAE,
      calledAE: association.calledAE,
      data: dataSet.toString('base64'),
    };

    // Build source map
    const sourceMapData = new Map<string, unknown>();
    sourceMapData.set('callingAE', association.callingAE);
    sourceMapData.set('calledAE', association.calledAE);
    sourceMapData.set('sopClassUid', state.affectedSopClassUid);
    sourceMapData.set('sopInstanceUid', state.affectedSopInstanceUid);
    sourceMapData.set('transferSyntax', context.transferSyntax);
    sourceMapData.set('remoteAddress', socket.remoteAddress);
    sourceMapData.set('remotePort', socket.remotePort);

    try {
      // Dispatch to channel (base64 encoded DICOM data)
      await this.dispatchRawMessage(JSON.stringify(dicomMessage), sourceMapData);

      // Send success response
      await this.sendCStoreRsp(socket, contextId, state.messageId!, DicomStatus.SUCCESS);
    } catch (error) {
      console.error('Error processing C-STORE:', error);
      await this.sendCStoreRsp(socket, contextId, state.messageId!, DicomStatus.PROCESSING_FAILURE);
    }
  }

  /**
   * Send C-STORE-RSP
   */
  private async sendCStoreRsp(
    socket: net.Socket,
    contextId: number,
    messageIdBeingRespondedTo: number,
    status: DicomStatus
  ): Promise<void> {
    const elements: Buffer[] = [];

    // Command Field (0000,0100) = C-STORE-RSP
    elements.push(this.encodeElementUL(0x0000, 0x0100, DimseCommandType.C_STORE_RSP));

    // Message ID Being Responded To (0000,0120)
    elements.push(this.encodeElementUS(0x0000, 0x0120, messageIdBeingRespondedTo));

    // Status (0000,0900)
    elements.push(this.encodeElementUS(0x0000, 0x0900, status));

    // Data Set Type (0000,0800) = 0x0101 (no data)
    elements.push(this.encodeElementUS(0x0000, 0x0800, 0x0101));

    const command = Buffer.concat(elements);
    await this.sendDataTf(socket, contextId, true, true, command);
  }

  /**
   * Handle C-ECHO-RQ (verification)
   */
  private async handleCEchoRq(
    socket: net.Socket,
    _association: ActiveAssociation,
    contextId: number,
    state: ReceivedDataState
  ): Promise<void> {
    await this.sendCEchoRsp(socket, contextId, state.messageId!, DicomStatus.SUCCESS);
  }

  /**
   * Send C-ECHO-RSP
   */
  private async sendCEchoRsp(
    socket: net.Socket,
    contextId: number,
    messageIdBeingRespondedTo: number,
    status: DicomStatus
  ): Promise<void> {
    const elements: Buffer[] = [];

    // Affected SOP Class UID
    elements.push(this.encodeElement(0x0008, 0x0016, SopClass.VERIFICATION));

    // Command Field (0000,0100) = C-ECHO-RSP
    elements.push(this.encodeElementUL(0x0000, 0x0100, DimseCommandType.C_ECHO_RSP));

    // Message ID Being Responded To (0000,0120)
    elements.push(this.encodeElementUS(0x0000, 0x0120, messageIdBeingRespondedTo));

    // Status (0000,0900)
    elements.push(this.encodeElementUS(0x0000, 0x0900, status));

    // Data Set Type (0000,0800) = 0x0101 (no data)
    elements.push(this.encodeElementUS(0x0000, 0x0800, 0x0101));

    const command = Buffer.concat(elements);
    await this.sendDataTf(socket, contextId, true, true, command);
  }

  /**
   * Handle A-RELEASE-RQ
   */
  private async handleReleaseRq(socket: net.Socket, association: ActiveAssociation): Promise<void> {
    // Send A-RELEASE-RP
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_RELEASE_RP;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);

    await this.sendPdu(socket, pdu);

    association.state = AssociationState.CLOSED;
    socket.end();
  }

  /**
   * Handle A-ABORT
   */
  private handleAbort(socket: net.Socket, association: ActiveAssociation, _pduData: Buffer): void {
    association.state = AssociationState.CLOSED;
    this.associations.delete(socket);
    socket.destroy();
  }

  /**
   * Handle socket close
   */
  private handleClose(socket: net.Socket): void {
    this.associations.delete(socket);
  }

  /**
   * Handle socket error
   */
  private handleError(socket: net.Socket, error: Error): void {
    console.error('DICOM socket error:', error);
    this.associations.delete(socket);
  }

  /**
   * Handle idle timeout
   */
  private async handleTimeout(socket: net.Socket): Promise<void> {
    try {
      await this.sendAbort(socket, 0, 0);
    } catch (e) {
      // Ignore
    }
    socket.destroy();
    this.associations.delete(socket);
  }

  /**
   * Send A-ABORT
   */
  private async sendAbort(socket: net.Socket, source: number, reason: number): Promise<void> {
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_ABORT;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);
    pdu[8] = source;
    pdu[9] = reason;

    await this.sendPdu(socket, pdu);
  }

  /**
   * Send P-DATA-TF PDU
   */
  private async sendDataTf(
    socket: net.Socket,
    contextId: number,
    isCommand: boolean,
    isLast: boolean,
    data: Buffer
  ): Promise<void> {
    const association = this.associations.get(socket);
    const maxDataLength = (association?.maxPduLength || 16384) - 12;
    let offset = 0;

    while (offset < data.length) {
      const chunk = data.subarray(offset, Math.min(offset + maxDataLength, data.length));
      const isLastChunk = offset + chunk.length >= data.length;

      const pdvHeader = Buffer.alloc(6);
      pdvHeader.writeUInt32BE(chunk.length + 2, 0);
      pdvHeader[4] = contextId;
      pdvHeader[5] = (isCommand ? 0x01 : 0x00) | (isLast && isLastChunk ? 0x02 : 0x00);

      const pduData = Buffer.concat([pdvHeader, chunk]);

      const pdu = Buffer.alloc(6 + pduData.length);
      pdu[0] = PduType.P_DATA_TF;
      pdu[1] = 0x00;
      pdu.writeUInt32BE(pduData.length, 2);
      pduData.copy(pdu, 6);

      await this.sendPdu(socket, pdu);
      offset += chunk.length;
    }
  }

  /**
   * Send PDU
   */
  private async sendPdu(socket: net.Socket, pdu: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.write(pdu, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Encode a DICOM string element (Implicit VR Little Endian)
   */
  private encodeElement(group: number, element: number, value: string): Buffer {
    const valueBuffer = Buffer.from(value, 'ascii');
    const paddedLength = valueBuffer.length + (valueBuffer.length % 2);
    const buffer = Buffer.alloc(8 + paddedLength);

    buffer.writeUInt16LE(group, 0);
    buffer.writeUInt16LE(element, 2);
    buffer.writeUInt32LE(paddedLength, 4);
    valueBuffer.copy(buffer, 8);
    if (paddedLength > valueBuffer.length) {
      buffer[8 + valueBuffer.length] = 0x20;
    }

    return buffer;
  }

  /**
   * Encode a DICOM UL element
   */
  private encodeElementUL(group: number, element: number, value: number): Buffer {
    const buffer = Buffer.alloc(12);

    buffer.writeUInt16LE(group, 0);
    buffer.writeUInt16LE(element, 2);
    buffer.writeUInt32LE(4, 4);
    buffer.writeUInt32LE(value, 8);

    return buffer;
  }

  /**
   * Encode a DICOM US element
   */
  private encodeElementUS(group: number, element: number, value: number): Buffer {
    const buffer = Buffer.alloc(10);

    buffer.writeUInt16LE(group, 0);
    buffer.writeUInt16LE(element, 2);
    buffer.writeUInt32LE(2, 4);
    buffer.writeUInt16LE(value, 8);

    return buffer;
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): net.Server | tls.Server | null {
    return this.server;
  }

  /**
   * Get the number of active associations
   */
  getAssociationCount(): number {
    return this.associations.size;
  }
}
