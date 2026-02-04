/**
 * DICOM Connection Management
 *
 * Purpose: Handles DICOM network associations for DIMSE operations
 *
 * This module provides:
 * - DICOM association establishment and release
 * - DIMSE message handling (C-STORE, C-FIND, C-ECHO)
 * - PDU (Protocol Data Unit) encoding/decoding
 * - Transfer syntax negotiation
 */

import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';
import { TransferSyntax, SopClass, DicomTlsMode } from './DICOMReceiverProperties.js';

/**
 * DICOM PDU Types
 */
export enum PduType {
  /** Association Request */
  A_ASSOCIATE_RQ = 0x01,
  /** Association Accept */
  A_ASSOCIATE_AC = 0x02,
  /** Association Reject */
  A_ASSOCIATE_RJ = 0x03,
  /** Data Transfer */
  P_DATA_TF = 0x04,
  /** Association Release Request */
  A_RELEASE_RQ = 0x05,
  /** Association Release Response */
  A_RELEASE_RP = 0x06,
  /** Association Abort */
  A_ABORT = 0x07,
}

/**
 * DIMSE Command Types
 */
export enum DimseCommandType {
  C_STORE_RQ = 0x0001,
  C_STORE_RSP = 0x8001,
  C_GET_RQ = 0x0010,
  C_GET_RSP = 0x8010,
  C_FIND_RQ = 0x0020,
  C_FIND_RSP = 0x8020,
  C_MOVE_RQ = 0x0021,
  C_MOVE_RSP = 0x8021,
  C_ECHO_RQ = 0x0030,
  C_ECHO_RSP = 0x8030,
  N_EVENT_REPORT_RQ = 0x0100,
  N_EVENT_REPORT_RSP = 0x8100,
  N_GET_RQ = 0x0110,
  N_GET_RSP = 0x8110,
  N_SET_RQ = 0x0120,
  N_SET_RSP = 0x8120,
  N_ACTION_RQ = 0x0130,
  N_ACTION_RSP = 0x8130,
  N_CREATE_RQ = 0x0140,
  N_CREATE_RSP = 0x8140,
  N_DELETE_RQ = 0x0150,
  N_DELETE_RSP = 0x8150,
  C_CANCEL_RQ = 0x0FFF,
}

/**
 * DICOM Status Codes
 */
export enum DicomStatus {
  SUCCESS = 0x0000,
  PENDING = 0xFF00,
  PENDING_WARNING = 0xFF01,
  CANCEL = 0xFE00,
  WARNING_COERCION = 0xB000,
  WARNING_ELEMENT_COERCION = 0xB006,
  WARNING_DATA_TRUNCATION = 0xB007,
  REFUSED_OUT_OF_RESOURCES = 0xA700,
  REFUSED_SOP_CLASS_NOT_SUPPORTED = 0xA800,
  REFUSED_NOT_AUTHORIZED = 0x0124,
  PROCESSING_FAILURE = 0x0110,
  DUPLICATE_SOP_INSTANCE = 0x0111,
  NO_SUCH_SOP_CLASS = 0x0118,
  INVALID_SOP_INSTANCE = 0x0117,
  MISSING_ATTRIBUTE = 0x0120,
  MISSING_ATTRIBUTE_VALUE = 0x0121,
}

/**
 * Association parameters for DICOM connections
 */
export interface AssociationParams {
  /** Calling Application Entity title (local) */
  callingAE: string;
  /** Called Application Entity title (remote) */
  calledAE: string;
  /** Remote host */
  host: string;
  /** Remote port */
  port: number;
  /** Max PDU length for sending */
  maxPduLengthSend: number;
  /** Max PDU length for receiving */
  maxPduLengthReceive: number;
  /** Supported SOP classes */
  sopClasses: string[];
  /** Supported transfer syntaxes */
  transferSyntaxes: string[];
  /** TLS mode */
  tlsMode: DicomTlsMode;
  /** TLS options */
  tlsOptions?: tls.ConnectionOptions;
  /** Connection timeout (ms) */
  connectTimeout: number;
  /** Association timeout (ms) */
  associationTimeout: number;
}

/**
 * Presentation Context for DICOM associations
 */
export interface PresentationContext {
  /** Context ID (odd numbers 1-255) */
  id: number;
  /** Abstract syntax (SOP Class UID) */
  abstractSyntax: string;
  /** Transfer syntaxes */
  transferSyntaxes: string[];
  /** Result (0=acceptance, 1-4=rejection reasons) */
  result?: number;
  /** Accepted transfer syntax */
  acceptedTransferSyntax?: string;
}

/**
 * DIMSE Message structure
 */
export interface DimseMessage {
  /** Command type */
  commandType: DimseCommandType;
  /** Affected SOP Class UID */
  affectedSopClassUid?: string;
  /** Affected SOP Instance UID */
  affectedSopInstanceUid?: string;
  /** Message ID */
  messageId: number;
  /** Message ID being responded to */
  messageIdBeingRespondedTo?: number;
  /** Status code */
  status?: DicomStatus;
  /** Priority */
  priority?: number;
  /** Data set present flag */
  dataSetPresent: boolean;
  /** Command data (DICOM attributes) */
  commandData?: Buffer;
  /** Dataset (DICOM attributes) */
  dataSet?: Buffer;
}

/**
 * Association state
 */
export enum AssociationState {
  IDLE = 'IDLE',
  AWAITING_ASSOCIATE_AC = 'AWAITING_ASSOCIATE_AC',
  ASSOCIATED = 'ASSOCIATED',
  AWAITING_RELEASE_RP = 'AWAITING_RELEASE_RP',
  CLOSED = 'CLOSED',
}

/**
 * DICOM Association/Connection class
 * Manages a single DICOM network association
 */
export class DicomConnection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private params: AssociationParams;
  private state: AssociationState = AssociationState.IDLE;
  private presentationContexts: Map<number, PresentationContext> = new Map();
  private messageIdCounter = 1;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private maxPduLength = 16384; // Default 16KB

  constructor(params: Partial<AssociationParams> = {}) {
    super();
    this.params = {
      callingAE: 'MIRTH',
      calledAE: 'DCMRCV',
      host: 'localhost',
      port: 104,
      maxPduLengthSend: 16384,
      maxPduLengthReceive: 16384,
      sopClasses: [SopClass.VERIFICATION],
      transferSyntaxes: [TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN],
      tlsMode: DicomTlsMode.NO_TLS,
      connectTimeout: 30000,
      associationTimeout: 30000,
      ...params,
    };
  }

  /**
   * Get current association state
   */
  getState(): AssociationState {
    return this.state;
  }

  /**
   * Check if associated
   */
  isAssociated(): boolean {
    return this.state === AssociationState.ASSOCIATED;
  }

  /**
   * Open connection and establish association
   */
  async associate(): Promise<void> {
    if (this.state !== AssociationState.IDLE) {
      throw new Error(`Cannot associate in state ${this.state}`);
    }

    await this.connect();
    await this.sendAssociateRq();
    await this.waitForAssociateAc();
  }

  /**
   * Connect to remote DICOM node
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.params.connectTimeout);

      if (this.params.tlsMode !== DicomTlsMode.NO_TLS && this.params.tlsOptions) {
        this.socket = tls.connect(
          this.params.port,
          this.params.host,
          this.params.tlsOptions,
          () => {
            clearTimeout(connectTimeout);
            this.setupSocketHandlers();
            resolve();
          }
        );
      } else {
        this.socket = new net.Socket();
        this.socket.connect(this.params.port, this.params.host, () => {
          clearTimeout(connectTimeout);
          this.setupSocketHandlers();
          resolve();
        });
      }

      this.socket.on('error', (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      });
    });
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('close', () => this.handleClose());
    this.socket.on('error', (err) => this.emit('error', err));
  }

  /**
   * Handle incoming data
   */
  private handleData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
    this.processPdus();
  }

  /**
   * Process complete PDUs from buffer
   */
  private processPdus(): void {
    while (this.receiveBuffer.length >= 6) {
      const pduType = this.receiveBuffer[0];
      const pduLength = this.receiveBuffer.readUInt32BE(2);
      const totalLength = pduLength + 6;

      if (this.receiveBuffer.length < totalLength) {
        break; // Incomplete PDU
      }

      const pduData = this.receiveBuffer.subarray(0, totalLength);
      this.receiveBuffer = this.receiveBuffer.subarray(totalLength);

      this.handlePdu(pduType!, pduData);
    }
  }

  /**
   * Handle a complete PDU
   */
  private handlePdu(pduType: number, pduData: Buffer): void {
    switch (pduType) {
      case PduType.A_ASSOCIATE_AC:
        this.handleAssociateAc(pduData);
        break;
      case PduType.A_ASSOCIATE_RJ:
        this.handleAssociateRj(pduData);
        break;
      case PduType.P_DATA_TF:
        this.handleDataTf(pduData);
        break;
      case PduType.A_RELEASE_RP:
        this.handleReleaseRp();
        break;
      case PduType.A_RELEASE_RQ:
        this.handleReleaseRq();
        break;
      case PduType.A_ABORT:
        this.handleAbort(pduData);
        break;
      default:
        this.emit('error', new Error(`Unknown PDU type: ${pduType}`));
    }
  }

  /**
   * Send Association Request PDU
   */
  private async sendAssociateRq(): Promise<void> {
    this.state = AssociationState.AWAITING_ASSOCIATE_AC;

    const pdu = this.buildAssociateRqPdu();
    await this.sendPdu(pdu);
  }

  /**
   * Build A-ASSOCIATE-RQ PDU
   */
  private buildAssociateRqPdu(): Buffer {
    const items: Buffer[] = [];

    // Application Context Item (0x10)
    const appContext = this.buildApplicationContextItem();
    items.push(appContext);

    // Presentation Context Items (0x20)
    let contextId = 1;
    for (const sopClass of this.params.sopClasses) {
      const pcItem = this.buildPresentationContextItem(contextId, sopClass, this.params.transferSyntaxes);
      items.push(pcItem);
      this.presentationContexts.set(contextId, {
        id: contextId,
        abstractSyntax: sopClass,
        transferSyntaxes: this.params.transferSyntaxes,
      });
      contextId += 2; // Context IDs are odd numbers
    }

    // User Information Item (0x50)
    const userInfo = this.buildUserInformationItem();
    items.push(userInfo);

    // Build PDU
    const variableItems = Buffer.concat(items);
    const pduLength = 68 + variableItems.length; // Fixed fields + variable items

    const pdu = Buffer.alloc(pduLength + 6);
    let offset = 0;

    // PDU Header
    pdu[offset++] = PduType.A_ASSOCIATE_RQ;
    pdu[offset++] = 0x00; // Reserved
    pdu.writeUInt32BE(pduLength, offset);
    offset += 4;

    // Protocol Version
    pdu.writeUInt16BE(0x0001, offset);
    offset += 2;

    // Reserved
    pdu.writeUInt16BE(0x0000, offset);
    offset += 2;

    // Called AE Title (16 bytes, padded with spaces)
    const calledAE = this.params.calledAE.padEnd(16, ' ').substring(0, 16);
    pdu.write(calledAE, offset, 16, 'ascii');
    offset += 16;

    // Calling AE Title (16 bytes, padded with spaces)
    const callingAE = this.params.callingAE.padEnd(16, ' ').substring(0, 16);
    pdu.write(callingAE, offset, 16, 'ascii');
    offset += 16;

    // Reserved (32 bytes)
    offset += 32;

    // Variable Items
    variableItems.copy(pdu, offset);

    return pdu;
  }

  /**
   * Build Application Context Item
   */
  private buildApplicationContextItem(): Buffer {
    const appContextUid = '1.2.840.10008.3.1.1.1'; // DICOM Application Context
    const item = Buffer.alloc(4 + appContextUid.length);

    item[0] = 0x10; // Item type
    item[1] = 0x00; // Reserved
    item.writeUInt16BE(appContextUid.length, 2);
    item.write(appContextUid, 4, 'ascii');

    return item;
  }

  /**
   * Build Presentation Context Item
   */
  private buildPresentationContextItem(
    contextId: number,
    abstractSyntax: string,
    transferSyntaxes: string[]
  ): Buffer {
    const subItems: Buffer[] = [];

    // Abstract Syntax Sub-Item (0x30)
    const abstractItem = Buffer.alloc(4 + abstractSyntax.length);
    abstractItem[0] = 0x30;
    abstractItem[1] = 0x00;
    abstractItem.writeUInt16BE(abstractSyntax.length, 2);
    abstractItem.write(abstractSyntax, 4, 'ascii');
    subItems.push(abstractItem);

    // Transfer Syntax Sub-Items (0x40)
    for (const ts of transferSyntaxes) {
      const tsItem = Buffer.alloc(4 + ts.length);
      tsItem[0] = 0x40;
      tsItem[1] = 0x00;
      tsItem.writeUInt16BE(ts.length, 2);
      tsItem.write(ts, 4, 'ascii');
      subItems.push(tsItem);
    }

    const subItemsBuffer = Buffer.concat(subItems);
    const item = Buffer.alloc(4 + 4 + subItemsBuffer.length);

    item[0] = 0x20; // Item type
    item[1] = 0x00; // Reserved
    item.writeUInt16BE(4 + subItemsBuffer.length, 2); // Item length
    item[4] = contextId;
    item[5] = 0x00; // Reserved
    item[6] = 0x00; // Reserved
    item[7] = 0x00; // Reserved
    subItemsBuffer.copy(item, 8);

    return item;
  }

  /**
   * Build User Information Item
   */
  private buildUserInformationItem(): Buffer {
    const subItems: Buffer[] = [];

    // Maximum Length Sub-Item (0x51)
    const maxLengthItem = Buffer.alloc(8);
    maxLengthItem[0] = 0x51;
    maxLengthItem[1] = 0x00;
    maxLengthItem.writeUInt16BE(4, 2);
    maxLengthItem.writeUInt32BE(this.params.maxPduLengthReceive, 4);
    subItems.push(maxLengthItem);

    // Implementation Class UID Sub-Item (0x52)
    const implClassUid = '1.2.40.0.13.1.1.1'; // Our implementation class UID
    const implClassItem = Buffer.alloc(4 + implClassUid.length);
    implClassItem[0] = 0x52;
    implClassItem[1] = 0x00;
    implClassItem.writeUInt16BE(implClassUid.length, 2);
    implClassItem.write(implClassUid, 4, 'ascii');
    subItems.push(implClassItem);

    // Implementation Version Name Sub-Item (0x55)
    const implVersionName = 'MIRTH_NODE_1.0';
    const implVersionItem = Buffer.alloc(4 + implVersionName.length);
    implVersionItem[0] = 0x55;
    implVersionItem[1] = 0x00;
    implVersionItem.writeUInt16BE(implVersionName.length, 2);
    implVersionItem.write(implVersionName, 4, 'ascii');
    subItems.push(implVersionItem);

    const subItemsBuffer = Buffer.concat(subItems);
    const item = Buffer.alloc(4 + subItemsBuffer.length);

    item[0] = 0x50; // Item type
    item[1] = 0x00; // Reserved
    item.writeUInt16BE(subItemsBuffer.length, 2);
    subItemsBuffer.copy(item, 4);

    return item;
  }

  /**
   * Wait for Association Accept
   */
  private async waitForAssociateAc(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Association timeout'));
      }, this.params.associationTimeout);

      const onAssociated = () => {
        clearTimeout(timeout);
        this.removeListener('associationRejected', onRejected);
        resolve();
      };

      const onRejected = (reason: string) => {
        clearTimeout(timeout);
        this.removeListener('associated', onAssociated);
        reject(new Error(`Association rejected: ${reason}`));
      };

      this.once('associated', onAssociated);
      this.once('associationRejected', onRejected);
    });
  }

  /**
   * Handle A-ASSOCIATE-AC PDU
   */
  private handleAssociateAc(pduData: Buffer): void {
    // Parse presentation context results
    let offset = 10; // Skip header fields

    // Skip Called AE, Calling AE, Reserved
    offset += 64;

    while (offset < pduData.length) {
      const itemType = pduData[offset];
      const itemLength = pduData.readUInt16BE(offset + 2);

      if (itemType === 0x21) {
        // Presentation Context Item (response)
        const contextId = pduData[offset + 4]!;
        const result = pduData[offset + 6]!;

        const context = this.presentationContexts.get(contextId);
        if (context) {
          context.result = result;
          // Parse accepted transfer syntax
          if (result === 0 && itemLength > 4) {
            const tsLength = pduData.readUInt16BE(offset + 8 + 2);
            const ts = pduData.toString('ascii', offset + 8 + 4, offset + 8 + 4 + tsLength);
            context.acceptedTransferSyntax = ts;
          }
        }
      } else if (itemType === 0x50) {
        // User Information Item
        this.parseUserInformation(pduData.subarray(offset + 4, offset + 4 + itemLength));
      }

      offset += 4 + itemLength;
    }

    this.state = AssociationState.ASSOCIATED;
    this.emit('associated');
  }

  /**
   * Parse User Information sub-items
   */
  private parseUserInformation(data: Buffer): void {
    let offset = 0;
    while (offset < data.length) {
      const itemType = data[offset];
      const itemLength = data.readUInt16BE(offset + 2);

      if (itemType === 0x51) {
        // Maximum Length
        this.maxPduLength = data.readUInt32BE(offset + 4);
      }

      offset += 4 + itemLength;
    }
  }

  /**
   * Handle A-ASSOCIATE-RJ PDU
   */
  private handleAssociateRj(pduData: Buffer): void {
    const result = pduData[7];
    const source = pduData[8];
    const reason = pduData[9];

    this.state = AssociationState.CLOSED;
    this.emit('associationRejected', `Result: ${result}, Source: ${source}, Reason: ${reason}`);
  }

  /**
   * Handle P-DATA-TF PDU
   */
  private handleDataTf(pduData: Buffer): void {
    let offset = 6; // Skip PDU header

    while (offset < pduData.length) {
      const pdvLength = pduData.readUInt32BE(offset);
      const contextId = pduData[offset + 4]!;
      const messageControlHeader = pduData[offset + 5]!;

      const isCommand = (messageControlHeader & 0x01) === 1;
      const isLast = (messageControlHeader & 0x02) === 2;

      const pdvData = pduData.subarray(offset + 6, offset + 4 + pdvLength);

      this.emit('pdv', {
        contextId,
        isCommand,
        isLast,
        data: pdvData,
      });

      offset += 4 + pdvLength;
    }
  }

  /**
   * Handle A-RELEASE-RQ PDU
   */
  private handleReleaseRq(): void {
    // Send release response
    this.sendReleaseRp();
    this.state = AssociationState.CLOSED;
    this.emit('released');
  }

  /**
   * Handle A-RELEASE-RP PDU
   */
  private handleReleaseRp(): void {
    this.state = AssociationState.CLOSED;
    this.emit('released');
  }

  /**
   * Handle A-ABORT PDU
   */
  private handleAbort(pduData: Buffer): void {
    const source = pduData[8];
    const reason = pduData[9];

    this.state = AssociationState.CLOSED;
    this.emit('aborted', `Source: ${source}, Reason: ${reason}`);
  }

  /**
   * Handle socket close
   */
  private handleClose(): void {
    this.state = AssociationState.CLOSED;
    this.emit('closed');
  }

  /**
   * Send a PDU
   */
  private async sendPdu(pdu: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      this.socket.write(pdu, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Send C-STORE request
   */
  async cStore(
    sopClassUid: string,
    sopInstanceUid: string,
    dataSet: Buffer
  ): Promise<DicomStatus> {
    if (!this.isAssociated()) {
      throw new Error('Not associated');
    }

    const context = this.findPresentationContext(sopClassUid);
    if (!context || context.result !== 0) {
      throw new Error(`No accepted presentation context for SOP Class: ${sopClassUid}`);
    }

    const messageId = this.messageIdCounter++;

    // Build C-STORE-RQ command
    const command = this.buildCStoreCommand(
      sopClassUid,
      sopInstanceUid,
      messageId
    );

    // Send command
    await this.sendDataTf(context.id, true, true, command);

    // Send data set
    await this.sendDataTf(context.id, false, true, dataSet);

    // Wait for response
    return this.waitForCStoreResponse(messageId);
  }

  /**
   * Build C-STORE command dataset
   */
  private buildCStoreCommand(
    sopClassUid: string,
    sopInstanceUid: string,
    messageId: number
  ): Buffer {
    // Simplified DICOM command encoding
    // In production, use proper DICOM encoding library
    const elements: Buffer[] = [];

    // Affected SOP Class UID (0008,0016)
    elements.push(this.encodeElement(0x0008, 0x0016, sopClassUid));

    // Command Field (0000,0100) = C-STORE-RQ
    elements.push(this.encodeElementUL(0x0000, 0x0100, DimseCommandType.C_STORE_RQ));

    // Message ID (0000,0110)
    elements.push(this.encodeElementUS(0x0000, 0x0110, messageId));

    // Priority (0000,0700)
    elements.push(this.encodeElementUS(0x0000, 0x0700, 0)); // MEDIUM

    // Data Set Type (0000,0800) = 0x0102 (data present)
    elements.push(this.encodeElementUS(0x0000, 0x0800, 0x0102));

    // Affected SOP Instance UID (0008,0018)
    elements.push(this.encodeElement(0x0008, 0x0018, sopInstanceUid));

    return Buffer.concat(elements);
  }

  /**
   * Encode a DICOM string element (Implicit VR Little Endian)
   */
  private encodeElement(group: number, element: number, value: string): Buffer {
    const valueBuffer = Buffer.from(value, 'ascii');
    const paddedLength = valueBuffer.length + (valueBuffer.length % 2); // Pad to even length
    const buffer = Buffer.alloc(8 + paddedLength);

    buffer.writeUInt16LE(group, 0);
    buffer.writeUInt16LE(element, 2);
    buffer.writeUInt32LE(paddedLength, 4);
    valueBuffer.copy(buffer, 8);
    if (paddedLength > valueBuffer.length) {
      buffer[8 + valueBuffer.length] = 0x20; // Space padding for strings
    }

    return buffer;
  }

  /**
   * Encode a DICOM UL (unsigned long) element
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
   * Encode a DICOM US (unsigned short) element
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
   * Send P-DATA-TF PDU
   */
  private async sendDataTf(
    contextId: number,
    isCommand: boolean,
    isLast: boolean,
    data: Buffer
  ): Promise<void> {
    const maxDataLength = this.maxPduLength - 12; // Reserve space for headers
    let offset = 0;

    while (offset < data.length) {
      const chunk = data.subarray(offset, Math.min(offset + maxDataLength, data.length));
      const isLastChunk = offset + chunk.length >= data.length;

      const pdvHeader = Buffer.alloc(6);
      pdvHeader.writeUInt32BE(chunk.length + 2, 0); // PDV length
      pdvHeader[4] = contextId;
      pdvHeader[5] = (isCommand ? 0x01 : 0x00) | (isLast && isLastChunk ? 0x02 : 0x00);

      const pduData = Buffer.concat([pdvHeader, chunk]);

      const pdu = Buffer.alloc(6 + pduData.length);
      pdu[0] = PduType.P_DATA_TF;
      pdu[1] = 0x00;
      pdu.writeUInt32BE(pduData.length, 2);
      pduData.copy(pdu, 6);

      await this.sendPdu(pdu);
      offset += chunk.length;
    }
  }

  /**
   * Wait for C-STORE response
   */
  private async waitForCStoreResponse(_messageId: number): Promise<DicomStatus> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('C-STORE response timeout'));
      }, 60000); // 60 second timeout

      const responseBuffer: Buffer[] = [];

      const handlePdv = (pdv: { contextId: number; isCommand: boolean; isLast: boolean; data: Buffer }) => {
        responseBuffer.push(pdv.data);

        if (pdv.isLast && pdv.isCommand) {
          clearTimeout(timeout);
          this.removeListener('pdv', handlePdv);

          const response = Buffer.concat(responseBuffer);
          const status = this.parseCommandStatus(response);
          resolve(status);
        }
      };

      this.on('pdv', handlePdv);
    });
  }

  /**
   * Parse status from command response
   */
  private parseCommandStatus(command: Buffer): DicomStatus {
    // Look for Status element (0000,0900)
    let offset = 0;
    while (offset < command.length - 8) {
      const group = command.readUInt16LE(offset);
      const element = command.readUInt16LE(offset + 2);
      const length = command.readUInt32LE(offset + 4);

      if (group === 0x0000 && element === 0x0900) {
        return command.readUInt16LE(offset + 8);
      }

      offset += 8 + length;
    }

    return DicomStatus.SUCCESS;
  }

  /**
   * Find presentation context by SOP Class UID
   */
  private findPresentationContext(sopClassUid: string): PresentationContext | undefined {
    for (const [, context] of this.presentationContexts) {
      if (context.abstractSyntax === sopClassUid) {
        return context;
      }
    }
    return undefined;
  }

  /**
   * Send C-ECHO request (verification)
   */
  async cEcho(): Promise<DicomStatus> {
    if (!this.isAssociated()) {
      throw new Error('Not associated');
    }

    const context = this.findPresentationContext(SopClass.VERIFICATION);
    if (!context || context.result !== 0) {
      throw new Error('Verification SOP Class not accepted');
    }

    const messageId = this.messageIdCounter++;

    // Build C-ECHO-RQ command
    const command = this.buildCEchoCommand(messageId);

    // Send command (no data set)
    await this.sendDataTf(context.id, true, true, command);

    // Wait for response
    return this.waitForCEchoResponse(messageId);
  }

  /**
   * Build C-ECHO command
   */
  private buildCEchoCommand(messageId: number): Buffer {
    const elements: Buffer[] = [];

    // Affected SOP Class UID (0008,0016)
    elements.push(this.encodeElement(0x0008, 0x0016, SopClass.VERIFICATION));

    // Command Field (0000,0100) = C-ECHO-RQ
    elements.push(this.encodeElementUL(0x0000, 0x0100, DimseCommandType.C_ECHO_RQ));

    // Message ID (0000,0110)
    elements.push(this.encodeElementUS(0x0000, 0x0110, messageId));

    // Data Set Type (0000,0800) = 0x0101 (no data)
    elements.push(this.encodeElementUS(0x0000, 0x0800, 0x0101));

    return Buffer.concat(elements);
  }

  /**
   * Wait for C-ECHO response
   */
  private async waitForCEchoResponse(_messageId: number): Promise<DicomStatus> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('C-ECHO response timeout'));
      }, 30000);

      const responseBuffer: Buffer[] = [];

      const handlePdv = (pdv: { contextId: number; isCommand: boolean; isLast: boolean; data: Buffer }) => {
        responseBuffer.push(pdv.data);

        if (pdv.isLast && pdv.isCommand) {
          clearTimeout(timeout);
          this.removeListener('pdv', handlePdv);

          const response = Buffer.concat(responseBuffer);
          const status = this.parseCommandStatus(response);
          resolve(status);
        }
      };

      this.on('pdv', handlePdv);
    });
  }

  /**
   * Release association
   */
  async release(): Promise<void> {
    if (this.state !== AssociationState.ASSOCIATED) {
      return;
    }

    this.state = AssociationState.AWAITING_RELEASE_RP;
    await this.sendReleaseRq();
    await this.waitForReleaseRp();
  }

  /**
   * Send A-RELEASE-RQ PDU
   */
  private async sendReleaseRq(): Promise<void> {
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_RELEASE_RQ;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);
    // Reserved bytes (already zero)

    await this.sendPdu(pdu);
  }

  /**
   * Send A-RELEASE-RP PDU
   */
  private async sendReleaseRp(): Promise<void> {
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_RELEASE_RP;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);

    await this.sendPdu(pdu);
  }

  /**
   * Wait for release response
   */
  private async waitForReleaseRp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Release timeout'));
      }, 10000);

      const onReleased = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.once('released', onReleased);
    });
  }

  /**
   * Abort association
   */
  async abort(source: number = 0, reason: number = 0): Promise<void> {
    const pdu = Buffer.alloc(10);
    pdu[0] = PduType.A_ABORT;
    pdu[1] = 0x00;
    pdu.writeUInt32BE(4, 2);
    pdu[8] = source;
    pdu[9] = reason;

    await this.sendPdu(pdu);
    this.state = AssociationState.CLOSED;
    this.close();
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.state = AssociationState.CLOSED;
  }

  /**
   * Get the next message ID
   */
  getNextMessageId(): number {
    return this.messageIdCounter++;
  }
}
