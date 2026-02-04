/**
 * Tests for DICOMReceiverProperties
 */

import {
  getDefaultDICOMReceiverProperties,
  DicomTlsMode,
  DimseCommand,
  TransferSyntax,
  SopClass,
  getProtocol,
  getName,
} from '../../../../src/connectors/dicom/DICOMReceiverProperties.js';

describe('DICOMReceiverProperties', () => {
  describe('getDefaultDICOMReceiverProperties', () => {
    it('should return default properties', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props).toBeDefined();
      expect(props.listenerConnectorProperties.host).toBe('0.0.0.0');
      expect(props.listenerConnectorProperties.port).toBe('104');
    });

    it('should have correct default timeout values', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props.soCloseDelay).toBe('50');
      expect(props.releaseTo).toBe('5');
      expect(props.requestTo).toBe('5');
      expect(props.idleTo).toBe('60');
      expect(props.reaper).toBe('10');
      expect(props.rspDelay).toBe('0');
    });

    it('should have TLS disabled by default', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props.tls).toBe(DicomTlsMode.NO_TLS);
      expect(props.noClientAuth).toBe(true);
      expect(props.nossl2).toBe(true);
    });

    it('should have correct PDU settings', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props.pdv1).toBe(false);
      expect(props.sndpdulen).toBe('16');
      expect(props.rcvpdulen).toBe('16');
      expect(props.async).toBe('0');
    });

    it('should have correct transfer syntax settings', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props.bigEndian).toBe(false);
      expect(props.defts).toBe(false);
      expect(props.nativeData).toBe(false);
    });

    it('should have TCP delay enabled by default', () => {
      const props = getDefaultDICOMReceiverProperties();

      expect(props.tcpDelay).toBe(true);
    });
  });

  describe('DicomTlsMode', () => {
    it('should have correct TLS mode values', () => {
      expect(DicomTlsMode.NO_TLS).toBe('notls');
      expect(DicomTlsMode.TLS_3DES).toBe('3des');
      expect(DicomTlsMode.TLS_AES).toBe('aes');
    });
  });

  describe('DimseCommand', () => {
    it('should have correct DIMSE command values', () => {
      expect(DimseCommand.C_STORE).toBe('C-STORE');
      expect(DimseCommand.C_FIND).toBe('C-FIND');
      expect(DimseCommand.C_MOVE).toBe('C-MOVE');
      expect(DimseCommand.C_GET).toBe('C-GET');
      expect(DimseCommand.C_ECHO).toBe('C-ECHO');
    });
  });

  describe('TransferSyntax', () => {
    it('should have correct transfer syntax UIDs', () => {
      expect(TransferSyntax.IMPLICIT_VR_LITTLE_ENDIAN).toBe('1.2.840.10008.1.2');
      expect(TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN).toBe('1.2.840.10008.1.2.1');
      expect(TransferSyntax.EXPLICIT_VR_BIG_ENDIAN).toBe('1.2.840.10008.1.2.2');
    });

    it('should have JPEG transfer syntaxes', () => {
      expect(TransferSyntax.JPEG_BASELINE).toBe('1.2.840.10008.1.2.4.50');
      expect(TransferSyntax.JPEG_LOSSLESS).toBe('1.2.840.10008.1.2.4.70');
    });
  });

  describe('SopClass', () => {
    it('should have verification SOP class', () => {
      expect(SopClass.VERIFICATION).toBe('1.2.840.10008.1.1');
    });

    it('should have storage SOP classes', () => {
      expect(SopClass.CT_IMAGE_STORAGE).toBe('1.2.840.10008.5.1.4.1.1.2');
      expect(SopClass.MR_IMAGE_STORAGE).toBe('1.2.840.10008.5.1.4.1.1.4');
      expect(SopClass.US_IMAGE_STORAGE).toBe('1.2.840.10008.5.1.4.1.1.6.1');
    });

    it('should have query/retrieve SOP classes', () => {
      expect(SopClass.PATIENT_ROOT_FIND).toBe('1.2.840.10008.5.1.4.1.2.1.1');
      expect(SopClass.PATIENT_ROOT_MOVE).toBe('1.2.840.10008.5.1.4.1.2.1.2');
    });
  });

  describe('getProtocol', () => {
    it('should return DICOM', () => {
      expect(getProtocol()).toBe('DICOM');
    });
  });

  describe('getName', () => {
    it('should return DICOM Listener', () => {
      expect(getName()).toBe('DICOM Listener');
    });
  });
});
