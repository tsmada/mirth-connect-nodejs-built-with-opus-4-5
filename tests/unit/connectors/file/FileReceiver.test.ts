import { FileReceiver } from '../../../../src/connectors/file/FileReceiver';
import {
  FileScheme,
  AfterProcessingAction,
  FileSortBy,
} from '../../../../src/connectors/file/FileConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require actual filesystem
// These tests focus on configuration and property handling

describe('FileReceiver', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const receiver = new FileReceiver({ name: 'Test File Receiver' });

      expect(receiver.getName()).toBe('Test File Receiver');
      expect(receiver.getTransportName()).toBe('File');
      expect(receiver.isRunning()).toBe(false);

      const props = receiver.getProperties();
      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.directory).toBe('');
      expect(props.fileFilter).toBe('*');
    });

    it('should create with custom values', () => {
      const receiver = new FileReceiver({
        name: 'Custom File Receiver',
        properties: {
          directory: '/data/input',
          fileFilter: '*.xml',
          regex: false,
          binary: true,
          pollInterval: 10000,
        },
      });

      const props = receiver.getProperties();
      expect(props.directory).toBe('/data/input');
      expect(props.fileFilter).toBe('*.xml');
      expect(props.binary).toBe(true);
      expect(props.pollInterval).toBe(10000);
    });
  });

  describe('properties', () => {
    let receiver: FileReceiver;

    beforeEach(() => {
      receiver = new FileReceiver({});
    });

    it('should get default properties', () => {
      const props = receiver.getProperties();

      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.directoryRecursion).toBe(false);
      expect(props.ignoreDot).toBe(true);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.afterProcessingAction).toBe(AfterProcessingAction.NONE);
      expect(props.sortBy).toBe(FileSortBy.DATE);
    });

    it('should update properties', () => {
      receiver.setProperties({
        directory: '/new/path',
        directoryRecursion: true,
        fileFilter: '*.csv',
      });

      const props = receiver.getProperties();
      expect(props.directory).toBe('/new/path');
      expect(props.directoryRecursion).toBe(true);
      expect(props.fileFilter).toBe('*.csv');
    });
  });

  describe('lifecycle without filesystem', () => {
    let receiver: FileReceiver;

    beforeEach(() => {
      receiver = new FileReceiver({
        name: 'Test Receiver',
        properties: {
          directory: '', // Empty directory will cause validation to fail
        },
      });
    });

    it('should be stopped initially', () => {
      expect(receiver.isRunning()).toBe(false);
    });

    it('should fail to start without directory', async () => {
      await expect(receiver.start()).rejects.toThrow('Directory is required');
    });

    it('should fail to start with non-existent directory', async () => {
      receiver.setProperties({
        directory: '/non/existent/path/that/should/not/exist',
      });

      await expect(receiver.start()).rejects.toThrow();
    });

    it('should not fail when stopping a stopped receiver', async () => {
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });
  });

  describe('file filter configuration', () => {
    it('should configure glob filter', () => {
      const receiver = new FileReceiver({
        properties: {
          fileFilter: '*.hl7',
          regex: false,
        },
      });

      const props = receiver.getProperties();
      expect(props.fileFilter).toBe('*.hl7');
      expect(props.regex).toBe(false);
    });

    it('should configure regex filter', () => {
      const receiver = new FileReceiver({
        properties: {
          fileFilter: 'file_\\d{4}\\.xml',
          regex: true,
        },
      });

      const props = receiver.getProperties();
      expect(props.fileFilter).toBe('file_\\d{4}\\.xml');
      expect(props.regex).toBe(true);
    });
  });

  describe('after processing actions', () => {
    it('should configure DELETE action', () => {
      const receiver = new FileReceiver({
        properties: {
          afterProcessingAction: AfterProcessingAction.DELETE,
        },
      });

      expect(receiver.getProperties().afterProcessingAction).toBe(
        AfterProcessingAction.DELETE
      );
    });

    it('should configure MOVE action with directory', () => {
      const receiver = new FileReceiver({
        properties: {
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: '/data/processed',
        },
      });

      const props = receiver.getProperties();
      expect(props.afterProcessingAction).toBe(AfterProcessingAction.MOVE);
      expect(props.moveToDirectory).toBe('/data/processed');
    });

    it('should configure error action', () => {
      const receiver = new FileReceiver({
        properties: {
          errorAction: AfterProcessingAction.MOVE,
          errorDirectory: '/data/errors',
        },
      });

      const props = receiver.getProperties();
      expect(props.errorAction).toBe(AfterProcessingAction.MOVE);
      expect(props.errorDirectory).toBe('/data/errors');
    });
  });

  describe('sorting configuration', () => {
    it('should configure sort by name', () => {
      const receiver = new FileReceiver({
        properties: {
          sortBy: FileSortBy.NAME,
          sortDescending: false,
        },
      });

      const props = receiver.getProperties();
      expect(props.sortBy).toBe(FileSortBy.NAME);
      expect(props.sortDescending).toBe(false);
    });

    it('should configure sort by size descending', () => {
      const receiver = new FileReceiver({
        properties: {
          sortBy: FileSortBy.SIZE,
          sortDescending: true,
        },
      });

      const props = receiver.getProperties();
      expect(props.sortBy).toBe(FileSortBy.SIZE);
      expect(props.sortDescending).toBe(true);
    });

    it('should configure sort by date', () => {
      const receiver = new FileReceiver({
        properties: {
          sortBy: FileSortBy.DATE,
          sortDescending: false,
        },
      });

      expect(receiver.getProperties().sortBy).toBe(FileSortBy.DATE);
    });
  });

  describe('batch configuration', () => {
    it('should configure unlimited batch', () => {
      const receiver = new FileReceiver({
        properties: {
          batchSize: 0,
        },
      });

      expect(receiver.getProperties().batchSize).toBe(0);
    });

    it('should configure limited batch', () => {
      const receiver = new FileReceiver({
        properties: {
          batchSize: 100,
        },
      });

      expect(receiver.getProperties().batchSize).toBe(100);
    });
  });

  describe('file age configuration', () => {
    it('should configure file age check', () => {
      const receiver = new FileReceiver({
        properties: {
          fileAge: 5000, // 5 seconds
        },
      });

      expect(receiver.getProperties().fileAge).toBe(5000);
    });
  });

  describe('remote schemes', () => {
    it('should require host for FTP scheme', async () => {
      const receiver = new FileReceiver({
        properties: {
          scheme: FileScheme.FTP,
          directory: '/path',
          // host is missing
        },
      });

      await expect(receiver.start()).rejects.toThrow('Host is required for FTP connections');
    });

    it('should require host for SFTP scheme', async () => {
      const receiver = new FileReceiver({
        properties: {
          scheme: FileScheme.SFTP,
          directory: '/path',
          // host is missing
        },
      });

      await expect(receiver.start()).rejects.toThrow('Host is required for SFTP');
    });

    it('should require host for SMB scheme', async () => {
      const receiver = new FileReceiver({
        properties: {
          scheme: FileScheme.SMB,
          directory: '/path',
          // host is missing
        },
      });

      await expect(receiver.start()).rejects.toThrow('Host is required for SMB connections');
    });

    it('should not require host for S3 scheme (uses bucket from directory)', async () => {
      const receiver = new FileReceiver({
        properties: {
          scheme: FileScheme.S3,
          directory: '/path',
          maxRetryCount: 0, // No retries to avoid test timeout
          // host is optional for S3 (custom endpoint)
        },
      });

      // S3 will attempt to connect and fail on canRead (no real S3 available)
      // but should NOT fail with "Host is required"
      await expect(receiver.start()).rejects.not.toThrow('Host is required');
    }, 10000);
  });
});
