/**
 * Tests for DICOMDispatcherProperties
 */

import {
  getDefaultDICOMDispatcherProperties,
  DicomPriority,
  DicomTlsMode,
  getProtocol,
  getName,
} from '../../../../src/connectors/dicom/DICOMDispatcherProperties.js';

describe('DICOMDispatcherProperties', () => {
  describe('getDefaultDICOMDispatcherProperties', () => {
    it('should return default properties', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props).toBeDefined();
      expect(props.host).toBe('127.0.0.1');
      expect(props.port).toBe('104');
    });

    it('should have correct default template', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.template).toBe('${DICOMMESSAGE}');
    });

    it('should have correct timeout values', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.acceptTo).toBe('5000');
      expect(props.connectTo).toBe('0');
      expect(props.releaseTo).toBe('5');
      expect(props.rspTo).toBe('60');
      expect(props.shutdownDelay).toBe('1000');
      expect(props.soCloseDelay).toBe('50');
    });

    it('should have medium priority by default', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.priority).toBe(DicomPriority.MEDIUM);
    });

    it('should have TLS disabled by default', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.tls).toBe(DicomTlsMode.NO_TLS);
    });

    it('should have storage commitment disabled by default', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.stgcmt).toBe(false);
    });

    it('should have destination connector properties', () => {
      const props = getDefaultDICOMDispatcherProperties();

      expect(props.destinationConnectorProperties).toBeDefined();
      expect(props.destinationConnectorProperties.queueEnabled).toBe(false);
      expect(props.destinationConnectorProperties.reattachAttachments).toBe(true);
    });
  });

  describe('DicomPriority', () => {
    it('should have correct priority values', () => {
      expect(DicomPriority.LOW).toBe('low');
      expect(DicomPriority.MEDIUM).toBe('med');
      expect(DicomPriority.HIGH).toBe('high');
    });
  });

  describe('getProtocol', () => {
    it('should return DICOM', () => {
      expect(getProtocol()).toBe('DICOM');
    });
  });

  describe('getName', () => {
    it('should return DICOM Sender', () => {
      expect(getName()).toBe('DICOM Sender');
    });
  });
});
