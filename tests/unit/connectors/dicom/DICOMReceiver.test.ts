/**
 * Tests for DICOMReceiver
 */

import { DICOMReceiver } from '../../../../src/connectors/dicom/DICOMReceiver.js';

describe('DICOMReceiver', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const receiver = new DICOMReceiver();

      expect(receiver.getName()).toBe('DICOM Listener');
      expect(receiver.getTransportName()).toBe('DICOM');
      expect(receiver.isRunning()).toBe(false);
    });

    it('should accept custom name', () => {
      const receiver = new DICOMReceiver({ name: 'Custom DICOM Receiver' });

      expect(receiver.getName()).toBe('Custom DICOM Receiver');
    });

    it('should accept custom properties', () => {
      const receiver = new DICOMReceiver({
        properties: {
          listenerConnectorProperties: {
            host: '127.0.0.1',
            port: '11112',
          },
        },
      });

      const props = receiver.getProperties();
      expect(props.listenerConnectorProperties.host).toBe('127.0.0.1');
      expect(props.listenerConnectorProperties.port).toBe('11112');
    });
  });

  describe('getProperties', () => {
    it('should return default properties', () => {
      const receiver = new DICOMReceiver();
      const props = receiver.getProperties();

      expect(props.listenerConnectorProperties.port).toBe('104');
      expect(props.tls).toBe('notls');
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const receiver = new DICOMReceiver();

      receiver.setProperties({
        listenerConnectorProperties: {
          host: '0.0.0.0',
          port: '11112',
        },
      });

      const props = receiver.getProperties();
      expect(props.listenerConnectorProperties.port).toBe('11112');
    });
  });

  describe('addAcceptedSopClass', () => {
    it('should add a SOP class', () => {
      const receiver = new DICOMReceiver();

      // Add a custom SOP class
      receiver.addAcceptedSopClass('1.2.3.4.5.6.7.8.9');

      // No error means success (internal set)
    });
  });

  describe('getAssociationCount', () => {
    it('should return 0 when not running', () => {
      const receiver = new DICOMReceiver();

      expect(receiver.getAssociationCount()).toBe(0);
    });
  });

  describe('getServer', () => {
    it('should return null when not running', () => {
      const receiver = new DICOMReceiver();

      expect(receiver.getServer()).toBeNull();
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop successfully', async () => {
      const receiver = new DICOMReceiver({
        properties: {
          listenerConnectorProperties: {
            host: '127.0.0.1',
            port: '0', // Use any available port
          },
        },
      });

      // Start should work
      await receiver.start();
      expect(receiver.isRunning()).toBe(true);
      expect(receiver.getServer()).not.toBeNull();

      // Stop should work
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
      expect(receiver.getServer()).toBeNull();
    });

    it('should throw if started twice', async () => {
      const receiver = new DICOMReceiver({
        properties: {
          listenerConnectorProperties: {
            host: '127.0.0.1',
            port: '0',
          },
        },
      });

      await receiver.start();

      await expect(receiver.start()).rejects.toThrow('already running');

      await receiver.stop();
    });

    it('should handle stop when not running', async () => {
      const receiver = new DICOMReceiver();

      // Should not throw
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });
  });
});
