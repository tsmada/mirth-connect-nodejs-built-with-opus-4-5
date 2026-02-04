/**
 * Tests for DicomConnection
 */

import {
  DicomConnection,
  PduType,
  DimseCommandType,
  DicomStatus,
  AssociationState,
} from '../../../../src/connectors/dicom/DicomConnection.js';

describe('DicomConnection', () => {
  describe('PduType', () => {
    it('should have correct PDU type values', () => {
      expect(PduType.A_ASSOCIATE_RQ).toBe(0x01);
      expect(PduType.A_ASSOCIATE_AC).toBe(0x02);
      expect(PduType.A_ASSOCIATE_RJ).toBe(0x03);
      expect(PduType.P_DATA_TF).toBe(0x04);
      expect(PduType.A_RELEASE_RQ).toBe(0x05);
      expect(PduType.A_RELEASE_RP).toBe(0x06);
      expect(PduType.A_ABORT).toBe(0x07);
    });
  });

  describe('DimseCommandType', () => {
    it('should have correct DIMSE command values', () => {
      expect(DimseCommandType.C_STORE_RQ).toBe(0x0001);
      expect(DimseCommandType.C_STORE_RSP).toBe(0x8001);
      expect(DimseCommandType.C_ECHO_RQ).toBe(0x0030);
      expect(DimseCommandType.C_ECHO_RSP).toBe(0x8030);
      expect(DimseCommandType.C_FIND_RQ).toBe(0x0020);
      expect(DimseCommandType.C_FIND_RSP).toBe(0x8020);
      expect(DimseCommandType.C_MOVE_RQ).toBe(0x0021);
      expect(DimseCommandType.C_MOVE_RSP).toBe(0x8021);
    });
  });

  describe('DicomStatus', () => {
    it('should have correct status codes', () => {
      expect(DicomStatus.SUCCESS).toBe(0x0000);
      expect(DicomStatus.PENDING).toBe(0xFF00);
      expect(DicomStatus.CANCEL).toBe(0xFE00);
    });

    it('should have warning status codes', () => {
      expect(DicomStatus.WARNING_COERCION).toBe(0xB000);
      expect(DicomStatus.WARNING_ELEMENT_COERCION).toBe(0xB006);
      expect(DicomStatus.WARNING_DATA_TRUNCATION).toBe(0xB007);
    });

    it('should have error status codes', () => {
      expect(DicomStatus.REFUSED_OUT_OF_RESOURCES).toBe(0xA700);
      expect(DicomStatus.REFUSED_SOP_CLASS_NOT_SUPPORTED).toBe(0xA800);
      expect(DicomStatus.PROCESSING_FAILURE).toBe(0x0110);
    });
  });

  describe('AssociationState', () => {
    it('should have correct state values', () => {
      expect(AssociationState.IDLE).toBe('IDLE');
      expect(AssociationState.AWAITING_ASSOCIATE_AC).toBe('AWAITING_ASSOCIATE_AC');
      expect(AssociationState.ASSOCIATED).toBe('ASSOCIATED');
      expect(AssociationState.AWAITING_RELEASE_RP).toBe('AWAITING_RELEASE_RP');
      expect(AssociationState.CLOSED).toBe('CLOSED');
    });
  });

  describe('constructor', () => {
    it('should create with default parameters', () => {
      const conn = new DicomConnection();

      expect(conn.getState()).toBe(AssociationState.IDLE);
      expect(conn.isAssociated()).toBe(false);
    });

    it('should accept custom parameters', () => {
      const conn = new DicomConnection({
        callingAE: 'MY_SCU',
        calledAE: 'MY_SCP',
        host: '192.168.1.100',
        port: 11112,
      });

      expect(conn.getState()).toBe(AssociationState.IDLE);
    });
  });

  describe('getNextMessageId', () => {
    it('should return incrementing message IDs', () => {
      const conn = new DicomConnection();

      const id1 = conn.getNextMessageId();
      const id2 = conn.getNextMessageId();
      const id3 = conn.getNextMessageId();

      expect(id2).toBe(id1 + 1);
      expect(id3).toBe(id2 + 1);
    });
  });

  describe('close', () => {
    it('should set state to CLOSED', () => {
      const conn = new DicomConnection();

      conn.close();

      expect(conn.getState()).toBe(AssociationState.CLOSED);
      expect(conn.isAssociated()).toBe(false);
    });
  });
});
