/**
 * Tests for DICOM Storage Commitment protocol support.
 *
 * Validates:
 * - Protocol constants (SOP class UID, action type IDs, event type IDs)
 * - DicomConnection.requestStorageCommitment() behavior
 * - DicomDispatcher integration (stgcmt property wiring)
 */

import {
  DicomConnection,
  DicomStatus,
  DimseCommandType,
  StorageCommitment,
  AssociationState,
} from '../../../../src/connectors/dicom/DicomConnection.js';
import { DICOMDispatcher } from '../../../../src/connectors/dicom/DICOMDispatcher.js';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage.js';
import { Status } from '../../../../src/model/Status.js';

// Helper to build a minimal DIMSE command buffer with specified fields
function buildCommandBuffer(fields: Array<{ group: number; element: number; value: number; type: 'US' | 'UL' }>): Buffer {
  const elements: Buffer[] = [];
  for (const f of fields) {
    if (f.type === 'US') {
      const buf = Buffer.alloc(10);
      buf.writeUInt16LE(f.group, 0);
      buf.writeUInt16LE(f.element, 2);
      buf.writeUInt32LE(2, 4);
      buf.writeUInt16LE(f.value, 8);
      elements.push(buf);
    } else {
      const buf = Buffer.alloc(12);
      buf.writeUInt16LE(f.group, 0);
      buf.writeUInt16LE(f.element, 2);
      buf.writeUInt32LE(4, 4);
      buf.writeUInt32LE(f.value, 8);
      elements.push(buf);
    }
  }
  return Buffer.concat(elements);
}

describe('DICOM Storage Commitment', () => {
  describe('Protocol constants', () => {
    it('should define correct Storage Commitment Push Model SOP Class UID', () => {
      expect(StorageCommitment.SOP_CLASS_UID).toBe('1.2.840.10008.1.20.1');
    });

    it('should define correct well-known SOP Instance UID', () => {
      expect(StorageCommitment.SOP_INSTANCE_UID).toBe('1.2.840.10008.1.20.1.1');
    });

    it('should define correct N-ACTION Action Type ID', () => {
      expect(StorageCommitment.ACTION_TYPE_REQUEST).toBe(1);
    });

    it('should define correct N-EVENT-REPORT Event Type IDs', () => {
      expect(StorageCommitment.EVENT_TYPE_SUCCESS).toBe(1);
      expect(StorageCommitment.EVENT_TYPE_FAILURE).toBe(2);
    });

    it('should define correct DICOM tags for the protocol', () => {
      // Transaction UID (0008,1195)
      expect(StorageCommitment.TAG_TRANSACTION_UID.group).toBe(0x0008);
      expect(StorageCommitment.TAG_TRANSACTION_UID.element).toBe(0x1195);

      // Referenced SOP Sequence (0008,1199)
      expect(StorageCommitment.TAG_REFERENCED_SOP_SEQUENCE.group).toBe(0x0008);
      expect(StorageCommitment.TAG_REFERENCED_SOP_SEQUENCE.element).toBe(0x1199);

      // Referenced SOP Class UID (0008,1150)
      expect(StorageCommitment.TAG_REFERENCED_SOP_CLASS_UID.group).toBe(0x0008);
      expect(StorageCommitment.TAG_REFERENCED_SOP_CLASS_UID.element).toBe(0x1150);

      // Referenced SOP Instance UID (0008,1155)
      expect(StorageCommitment.TAG_REFERENCED_SOP_INSTANCE_UID.group).toBe(0x0008);
      expect(StorageCommitment.TAG_REFERENCED_SOP_INSTANCE_UID.element).toBe(0x1155);
    });

    it('should have N-ACTION and N-EVENT-REPORT DIMSE command types defined', () => {
      expect(DimseCommandType.N_ACTION_RQ).toBe(0x0130);
      expect(DimseCommandType.N_ACTION_RSP).toBe(0x8130);
      expect(DimseCommandType.N_EVENT_REPORT_RQ).toBe(0x0100);
      expect(DimseCommandType.N_EVENT_REPORT_RSP).toBe(0x8100);
    });
  });

  describe('DicomConnection.requestStorageCommitment()', () => {
    it('should return false when not associated', async () => {
      const conn = new DicomConnection();
      // Not associated — should return false immediately
      const result = await conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        1000
      );
      expect(result).toBe(false);
    });

    it('should return false on timeout (safe default)', async () => {
      // Create a connection and hack its internal state to be ASSOCIATED
      // with a presentation context for Storage Commitment
      const conn = new DicomConnection({
        sopClasses: [StorageCommitment.SOP_CLASS_UID],
      });

      // Reach into private state to simulate an established association
      (conn as any).state = AssociationState.ASSOCIATED;
      (conn as any).presentationContexts.set(1, {
        id: 1,
        abstractSyntax: StorageCommitment.SOP_CLASS_UID,
        transferSyntaxes: ['1.2.840.10008.1.2'],
        result: 0,  // Accepted
      });

      // Mock sendDataTf to be a no-op (no real socket)
      (conn as any).sendDataTf = jest.fn().mockResolvedValue(undefined);

      // Request with a very short timeout — no response will come
      const result = await conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        50 // 50ms timeout
      );
      expect(result).toBe(false);
    });

    it('should return false when Storage Commitment SOP Class not negotiated', async () => {
      const conn = new DicomConnection();

      // Simulate ASSOCIATED but only Verification accepted (no Storage Commitment)
      (conn as any).state = AssociationState.ASSOCIATED;
      (conn as any).presentationContexts.set(1, {
        id: 1,
        abstractSyntax: '1.2.840.10008.1.1', // Verification only
        transferSyntaxes: ['1.2.840.10008.1.2'],
        result: 0,
      });

      const result = await conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        1000
      );
      expect(result).toBe(false);
    });

    it('should return true when N-EVENT-REPORT confirms success (Event Type 1)', async () => {
      const conn = new DicomConnection({
        sopClasses: [StorageCommitment.SOP_CLASS_UID],
      });

      (conn as any).state = AssociationState.ASSOCIATED;
      (conn as any).presentationContexts.set(1, {
        id: 1,
        abstractSyntax: StorageCommitment.SOP_CLASS_UID,
        transferSyntaxes: ['1.2.840.10008.1.2'],
        result: 0,
      });

      // Mock sendDataTf to capture calls but not actually send
      const sendCalls: any[] = [];
      (conn as any).sendDataTf = jest.fn().mockImplementation((...args: any[]) => {
        sendCalls.push(args);
        return Promise.resolve();
      });

      // Start the commitment request
      const resultPromise = conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        5000
      );

      // Wait for the N-ACTION to be sent
      await new Promise(r => setTimeout(r, 10));

      // Simulate N-ACTION-RSP (success)
      const actionRsp = buildCommandBuffer([
        { group: 0x0000, element: 0x0100, value: DimseCommandType.N_ACTION_RSP, type: 'UL' },
        { group: 0x0000, element: 0x0900, value: DicomStatus.SUCCESS, type: 'US' },
      ]);
      conn.emit('pdv', { contextId: 1, isCommand: true, isLast: true, data: actionRsp });

      // Wait for phase transition
      await new Promise(r => setTimeout(r, 10));

      // Simulate N-EVENT-REPORT-RQ with Event Type ID = 1 (success)
      const eventReportRq = buildCommandBuffer([
        { group: 0x0000, element: 0x0100, value: DimseCommandType.N_EVENT_REPORT_RQ, type: 'UL' },
        { group: 0x0000, element: 0x0110, value: 42, type: 'US' }, // Message ID
        { group: 0x0000, element: 0x1002, value: StorageCommitment.EVENT_TYPE_SUCCESS, type: 'US' },
      ]);
      conn.emit('pdv', { contextId: 1, isCommand: true, isLast: true, data: eventReportRq });

      const result = await resultPromise;
      expect(result).toBe(true);
    });

    it('should return false when N-EVENT-REPORT reports failure (Event Type 2)', async () => {
      const conn = new DicomConnection({
        sopClasses: [StorageCommitment.SOP_CLASS_UID],
      });

      (conn as any).state = AssociationState.ASSOCIATED;
      (conn as any).presentationContexts.set(1, {
        id: 1,
        abstractSyntax: StorageCommitment.SOP_CLASS_UID,
        transferSyntaxes: ['1.2.840.10008.1.2'],
        result: 0,
      });

      (conn as any).sendDataTf = jest.fn().mockResolvedValue(undefined);

      const resultPromise = conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        5000
      );

      await new Promise(r => setTimeout(r, 10));

      // N-ACTION-RSP success
      const actionRsp = buildCommandBuffer([
        { group: 0x0000, element: 0x0100, value: DimseCommandType.N_ACTION_RSP, type: 'UL' },
        { group: 0x0000, element: 0x0900, value: DicomStatus.SUCCESS, type: 'US' },
      ]);
      conn.emit('pdv', { contextId: 1, isCommand: true, isLast: true, data: actionRsp });

      await new Promise(r => setTimeout(r, 10));

      // N-EVENT-REPORT-RQ with Event Type ID = 2 (failure)
      const eventReportRq = buildCommandBuffer([
        { group: 0x0000, element: 0x0100, value: DimseCommandType.N_EVENT_REPORT_RQ, type: 'UL' },
        { group: 0x0000, element: 0x0110, value: 43, type: 'US' },
        { group: 0x0000, element: 0x1002, value: StorageCommitment.EVENT_TYPE_FAILURE, type: 'US' },
      ]);
      conn.emit('pdv', { contextId: 1, isCommand: true, isLast: true, data: eventReportRq });

      const result = await resultPromise;
      expect(result).toBe(false);
    });

    it('should return false when N-ACTION-RSP has non-success status', async () => {
      const conn = new DicomConnection({
        sopClasses: [StorageCommitment.SOP_CLASS_UID],
      });

      (conn as any).state = AssociationState.ASSOCIATED;
      (conn as any).presentationContexts.set(1, {
        id: 1,
        abstractSyntax: StorageCommitment.SOP_CLASS_UID,
        transferSyntaxes: ['1.2.840.10008.1.2'],
        result: 0,
      });

      (conn as any).sendDataTf = jest.fn().mockResolvedValue(undefined);

      const resultPromise = conn.requestStorageCommitment(
        '1.2.840.10008.5.1.4.1.1.7',
        '1.2.3.4.5.6.7.8.9',
        5000
      );

      await new Promise(r => setTimeout(r, 10));

      // N-ACTION-RSP with FAILURE status
      const actionRsp = buildCommandBuffer([
        { group: 0x0000, element: 0x0100, value: DimseCommandType.N_ACTION_RSP, type: 'UL' },
        { group: 0x0000, element: 0x0900, value: DicomStatus.PROCESSING_FAILURE, type: 'US' },
      ]);
      conn.emit('pdv', { contextId: 1, isCommand: true, isLast: true, data: actionRsp });

      const result = await resultPromise;
      expect(result).toBe(false);
    });
  });

  describe('DICOMDispatcher storage commitment integration', () => {
    it('should skip commitment when stgcmt=false (default)', () => {
      const dispatcher = new DICOMDispatcher();
      const props = dispatcher.getProperties();
      expect(props.stgcmt).toBe(false);
      expect(props.stgcmtTimeout).toBe(30000);
    });

    it('should include Storage Commitment SOP Class in association when stgcmt=true', () => {
      const dispatcher = new DICOMDispatcher({
        properties: { stgcmt: true },
      });

      // Access private createConnection to verify SOP classes
      const connection = (dispatcher as any).createConnection('1.2.840.10008.5.1.4.1.1.7');
      const params = (connection as any).params;

      expect(params.sopClasses).toContain(StorageCommitment.SOP_CLASS_UID);
    });

    it('should NOT include Storage Commitment SOP Class when stgcmt=false', () => {
      const dispatcher = new DICOMDispatcher({
        properties: { stgcmt: false },
      });

      const connection = (dispatcher as any).createConnection('1.2.840.10008.5.1.4.1.1.7');
      const params = (connection as any).params;

      expect(params.sopClasses).not.toContain(StorageCommitment.SOP_CLASS_UID);
    });

    it('should return QUEUED when commitment fails', async () => {
      const dispatcher = new DICOMDispatcher({
        properties: {
          stgcmt: true,
          stgcmtTimeout: 50, // Very short timeout for test
          host: '127.0.0.1',
          port: '104',
        },
      });

      // Create a mock ConnectorMessage
      const connectorMessage = createMockConnectorMessage();

      // Mock the internal methods to simulate a successful C-STORE but failed commitment
      const mockConnection = new DicomConnection();
      (mockConnection as any).state = AssociationState.ASSOCIATED;

      // Mock DicomConnection methods
      jest.spyOn(mockConnection, 'associate').mockResolvedValue(undefined);
      jest.spyOn(mockConnection, 'cStore').mockResolvedValue(DicomStatus.SUCCESS);
      jest.spyOn(mockConnection, 'requestStorageCommitment').mockResolvedValue(false);
      jest.spyOn(mockConnection, 'release').mockResolvedValue(undefined);
      jest.spyOn(mockConnection, 'close').mockImplementation(() => {});

      // Replace createConnection to return our mock
      (dispatcher as any).createConnection = () => mockConnection;

      await dispatcher.send(connectorMessage);

      // Verify QUEUED status because commitment failed
      const statusMap = connectorMessage.getConnectorMap();
      expect(statusMap.get('responseStatus')).toBe(Status.QUEUED);
      expect(statusMap.get('responseStatusMessage')).toBe('Storage commitment not confirmed');
    });

    it('should return SENT when commitment succeeds', async () => {
      const dispatcher = new DICOMDispatcher({
        properties: {
          stgcmt: true,
          stgcmtTimeout: 5000,
          host: '127.0.0.1',
          port: '104',
        },
      });

      const connectorMessage = createMockConnectorMessage();

      const mockConnection = new DicomConnection();
      (mockConnection as any).state = AssociationState.ASSOCIATED;

      jest.spyOn(mockConnection, 'associate').mockResolvedValue(undefined);
      jest.spyOn(mockConnection, 'cStore').mockResolvedValue(DicomStatus.SUCCESS);
      jest.spyOn(mockConnection, 'requestStorageCommitment').mockResolvedValue(true);
      jest.spyOn(mockConnection, 'release').mockResolvedValue(undefined);
      jest.spyOn(mockConnection, 'close').mockImplementation(() => {});

      (dispatcher as any).createConnection = () => mockConnection;

      await dispatcher.send(connectorMessage);

      const statusMap = connectorMessage.getConnectorMap();
      expect(statusMap.get('responseStatus')).toBe(Status.SENT);
      expect(statusMap.get('responseStatusMessage')).toBe('DICOM message successfully sent');
    });
  });
});

/**
 * Create a minimal mock ConnectorMessage for testing.
 */
function createMockConnectorMessage(): ConnectorMessage {
  const connectorMap = new Map<string, unknown>();
  const channelMap = new Map<string, unknown>();
  const sourceMap = new Map<string, unknown>();

  // Minimal DICOM-like content (just enough for the parser to not crash)
  const rawContent = Buffer.from('test-dicom-content').toString('base64');

  return {
    getMessageId: () => 1,
    getMetaDataId: () => 1,
    getRawData: () => rawContent,
    getRawContent: () => ({ content: rawContent, contentType: 0 }),
    getEncodedContent: () => ({ content: rawContent, contentType: 0 }),
    getTransformedContent: () => null,
    getResponseContent: () => null,
    getConnectorMap: () => connectorMap as any,
    getChannelMap: () => channelMap as any,
    getSourceMap: () => sourceMap as any,
    setContent: jest.fn(),
    getContent: () => [],
  } as unknown as ConnectorMessage;
}
