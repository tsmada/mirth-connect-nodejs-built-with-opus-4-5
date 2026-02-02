import { FileDispatcher } from '../../../../src/connectors/file/FileDispatcher';
import { FileScheme } from '../../../../src/connectors/file/FileConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require actual filesystem
// These tests focus on configuration and property handling

describe('FileDispatcher', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const dispatcher = new FileDispatcher({
        name: 'Test File Dispatcher',
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Test File Dispatcher');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.getTransportName()).toBe('File');
      expect(dispatcher.isRunning()).toBe(false);

      const props = dispatcher.getProperties();
      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.directory).toBe('');
      expect(props.outputAppend).toBe(false);
    });

    it('should create with custom values', () => {
      const dispatcher = new FileDispatcher({
        name: 'Custom File Dispatcher',
        metaDataId: 2,
        properties: {
          directory: '/data/output',
          outputPattern: 'msg_${date:yyyyMMdd}.txt',
          outputAppend: true,
          binary: true,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.directory).toBe('/data/output');
      expect(props.outputPattern).toBe('msg_${date:yyyyMMdd}.txt');
      expect(props.outputAppend).toBe(true);
      expect(props.binary).toBe(true);
    });
  });

  describe('properties', () => {
    let dispatcher: FileDispatcher;

    beforeEach(() => {
      dispatcher = new FileDispatcher({ metaDataId: 1 });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.scheme).toBe(FileScheme.FILE);
      expect(props.directory).toBe('');
      expect(props.outputAppend).toBe(false);
      expect(props.binary).toBe(false);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.tempFilename).toBe('');
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        directory: '/new/output',
        outputPattern: 'custom_${UUID}.xml',
        outputAppend: true,
      });

      const props = dispatcher.getProperties();
      expect(props.directory).toBe('/new/output');
      expect(props.outputPattern).toBe('custom_${UUID}.xml');
      expect(props.outputAppend).toBe(true);
    });
  });

  describe('lifecycle without filesystem', () => {
    let dispatcher: FileDispatcher;

    beforeEach(() => {
      dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          directory: '', // Empty directory will cause validation to fail
        },
      });
    });

    it('should be stopped initially', () => {
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should fail to start without directory', async () => {
      await expect(dispatcher.start()).rejects.toThrow('Directory is required');
    });

    it('should not fail when stopping a stopped dispatcher', async () => {
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
  });

  describe('output pattern configuration', () => {
    it('should configure date-based pattern', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputPattern: 'log_${date:yyyy-MM-dd_HH-mm-ss}.txt',
        },
      });

      expect(dispatcher.getProperties().outputPattern).toBe(
        'log_${date:yyyy-MM-dd_HH-mm-ss}.txt'
      );
    });

    it('should configure UUID-based pattern', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputPattern: 'msg_${UUID}.xml',
        },
      });

      expect(dispatcher.getProperties().outputPattern).toBe('msg_${UUID}.xml');
    });

    it('should configure variable-based pattern', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputPattern: '${messageId}_${channelId}.hl7',
        },
      });

      expect(dispatcher.getProperties().outputPattern).toBe(
        '${messageId}_${channelId}.hl7'
      );
    });

    it('should configure static filename', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputPattern: 'output.txt',
          outputAppend: true,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.outputPattern).toBe('output.txt');
      expect(props.outputAppend).toBe(true);
    });
  });

  describe('write mode configuration', () => {
    it('should configure overwrite mode', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputAppend: false,
        },
      });

      expect(dispatcher.getProperties().outputAppend).toBe(false);
    });

    it('should configure append mode', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          outputAppend: true,
        },
      });

      expect(dispatcher.getProperties().outputAppend).toBe(true);
    });

    it('should configure error on exists', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          errorOnExists: true,
        },
      });

      expect(dispatcher.getProperties().errorOnExists).toBe(true);
    });
  });

  describe('temp file configuration', () => {
    it('should configure temp file extension', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          tempFilename: '.tmp',
        },
      });

      expect(dispatcher.getProperties().tempFilename).toBe('.tmp');
    });
  });

  describe('template configuration', () => {
    it('should configure output template', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          template: '<message>${message}</message>',
        },
      });

      expect(dispatcher.getProperties().template).toBe(
        '<message>${message}</message>'
      );
    });
  });

  describe('encoding configuration', () => {
    it('should configure charset encoding', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          charsetEncoding: 'ISO-8859-1',
        },
      });

      expect(dispatcher.getProperties().charsetEncoding).toBe('ISO-8859-1');
    });

    it('should configure binary mode', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          binary: true,
        },
      });

      expect(dispatcher.getProperties().binary).toBe(true);
    });
  });

  describe('destination connector options', () => {
    it('should configure queue settings', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        queueSendFirst: true,
        retryCount: 5,
        retryIntervalMillis: 15000,
      });

      expect(dispatcher.isQueueEnabled()).toBe(true);
    });

    it('should configure enabled state', () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        enabled: false,
      });

      expect(dispatcher.isEnabled()).toBe(false);
    });
  });

  describe('remote schemes (not implemented)', () => {
    it('should reject FTP scheme', async () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          scheme: FileScheme.FTP,
          directory: '/path',
        },
      });

      await expect(dispatcher.start()).rejects.toThrow('not yet implemented');
    });

    it('should require host for SFTP scheme', async () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          scheme: FileScheme.SFTP,
          directory: '/path',
          // host is missing
        },
      });

      await expect(dispatcher.start()).rejects.toThrow('Host is required for SFTP');
    });

    it('should reject S3 scheme', async () => {
      const dispatcher = new FileDispatcher({
        metaDataId: 1,
        properties: {
          scheme: FileScheme.S3,
          directory: '/path',
        },
      });

      await expect(dispatcher.start()).rejects.toThrow('not yet implemented');
    });
  });
});
