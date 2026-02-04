/**
 * Tests for DICOMDispatcher
 */

import { DICOMDispatcher } from '../../../../src/connectors/dicom/DICOMDispatcher.js';
import { DicomPriority } from '../../../../src/connectors/dicom/DICOMDispatcherProperties.js';

describe('DICOMDispatcher', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const dispatcher = new DICOMDispatcher();

      expect(dispatcher.getName()).toBe('DICOM Sender');
      expect(dispatcher.getTransportName()).toBe('DICOM');
      expect(dispatcher.isEnabled()).toBe(true);
    });

    it('should accept custom name', () => {
      const dispatcher = new DICOMDispatcher({ name: 'Custom DICOM Sender' });

      expect(dispatcher.getName()).toBe('Custom DICOM Sender');
    });

    it('should accept custom metaDataId', () => {
      const dispatcher = new DICOMDispatcher({ metaDataId: 5 });

      expect(dispatcher.getMetaDataId()).toBe(5);
    });

    it('should accept custom properties', () => {
      const dispatcher = new DICOMDispatcher({
        properties: {
          host: '192.168.1.100',
          port: '11112',
          applicationEntity: 'MY_SCP',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('192.168.1.100');
      expect(props.port).toBe('11112');
      expect(props.applicationEntity).toBe('MY_SCP');
    });
  });

  describe('getProperties', () => {
    it('should return default properties', () => {
      const dispatcher = new DICOMDispatcher();
      const props = dispatcher.getProperties();

      expect(props.host).toBe('127.0.0.1');
      expect(props.port).toBe('104');
      expect(props.template).toBe('${DICOMMESSAGE}');
      expect(props.priority).toBe(DicomPriority.MEDIUM);
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const dispatcher = new DICOMDispatcher();

      dispatcher.setProperties({
        host: '10.0.0.1',
        port: '104',
        priority: DicomPriority.HIGH,
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('10.0.0.1');
      expect(props.priority).toBe(DicomPriority.HIGH);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop successfully', async () => {
      const dispatcher = new DICOMDispatcher();

      await dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);

      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
  });

  describe('verifyConnection', () => {
    it('should return false when cannot connect', async () => {
      const dispatcher = new DICOMDispatcher({
        properties: {
          host: '127.0.0.1',
          port: '9999', // Non-existent server
          connectTo: '1000', // 1 second timeout
        },
      });

      const result = await dispatcher.verifyConnection();

      // Should return false since no server is running
      expect(result).toBe(false);
    });
  });
});
