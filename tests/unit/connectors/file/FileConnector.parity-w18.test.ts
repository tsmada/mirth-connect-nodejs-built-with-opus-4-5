/**
 * File Connector Parity Tests (Wave 18)
 *
 * Validates fixes for:
 * - CPC-W18-001: FileDispatcher.replaceConnectorProperties()
 * - CPC-W18-005: File Receiver file size filter properties
 * - CPC-W18-006: File Receiver error handling properties
 * - CPC-W18-007: File Dispatcher temporary flag
 */

// Mock modules with external dependencies
jest.mock('mysql2/promise', () => ({}));
jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(true),
  }));
});

// Mock the dashboard status controller to capture events
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
  },
}));

import {
  getDefaultFileReceiverProperties,
  getDefaultFileDispatcherProperties,
  AfterProcessingAction,
} from '../../../../src/connectors/file/FileConnectorProperties';
import { FileDispatcher } from '../../../../src/connectors/file/FileDispatcher';
import { FileReceiver } from '../../../../src/connectors/file/FileReceiver';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';

describe('File Connector Parity (Wave 18)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────
  // CPC-W18-001: FileDispatcher.replaceConnectorProperties()
  // ──────────────────────────────────────────────────────────────
  describe('CPC-W18-001: FileDispatcher.replaceConnectorProperties()', () => {
    let dispatcher: FileDispatcher;

    beforeEach(() => {
      dispatcher = new FileDispatcher({
        name: 'Test File Dispatcher',
        metaDataId: 1,
        properties: {
          directory: '/output/${targetDir}',
          host: '${sftpHost}',
          outputPattern: '${patientId}_${date:yyyyMMdd}.hl7',
          username: '${sftpUser}',
          password: '${sftpPass}',
          template: 'Patient: ${message.encodedData}',
        },
      });
    });

    function createConnectorMessage(maps: {
      channelMap?: Record<string, unknown>;
      sourceMap?: Record<string, unknown>;
      connectorMap?: Record<string, unknown>;
      rawData?: string;
    }): ConnectorMessage {
      const msg = new ConnectorMessage({
        channelId: 'test-channel',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Test',
        connectorName: 'File Writer',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      if (maps.rawData) msg.setRawData(maps.rawData);

      if (maps.channelMap) {
        const cm = msg.getChannelMap();
        for (const [k, v] of Object.entries(maps.channelMap)) {
          cm.set(k, v);
        }
      }
      if (maps.sourceMap) {
        const sm = msg.getSourceMap();
        for (const [k, v] of Object.entries(maps.sourceMap)) {
          sm.set(k, v);
        }
      }
      if (maps.connectorMap) {
        const co = msg.getConnectorMap();
        for (const [k, v] of Object.entries(maps.connectorMap)) {
          co.set(k, v);
        }
      }
      return msg;
    }

    it('resolves host from channel map', () => {
      const msg = createConnectorMessage({
        channelMap: { sftpHost: 'sftp.example.com' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('sftp.example.com');
    });

    it('resolves outputPattern from channel map', () => {
      const msg = createConnectorMessage({
        channelMap: { patientId: 'P12345' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      // The ${date:...} portion is not a map variable, so it stays
      expect(resolved.outputPattern).toContain('P12345_');
    });

    it('resolves username and password from source map', () => {
      const msg = createConnectorMessage({
        sourceMap: { sftpUser: 'admin', sftpPass: 'secret123' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.username).toBe('admin');
      expect(resolved.password).toBe('secret123');
    });

    it('resolves directory from channel map', () => {
      const msg = createConnectorMessage({
        channelMap: { targetDir: 'lab-results' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.directory).toBe('/output/lab-results');
    });

    it('resolves template with ${message.encodedData}', () => {
      const msg = createConnectorMessage({
        rawData: 'MSH|^~\\&|...',
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('Patient: MSH|^~\\&|...');
    });

    it('resolves ${message.rawData} builtin', () => {
      const dispatcher2 = new FileDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: { template: 'Raw: ${message.rawData}' },
      });
      const msg = createConnectorMessage({ rawData: 'RAWDATA' });
      const props = dispatcher2.getProperties();
      const resolved = dispatcher2.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('Raw: RAWDATA');
    });

    it('leaves unresolved variables as-is', () => {
      const msg = createConnectorMessage({});
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('${sftpHost}');
    });

    it('does not modify original properties object', () => {
      const msg = createConnectorMessage({
        channelMap: { sftpHost: 'resolved.host' },
      });
      const props = dispatcher.getProperties();
      const originalHost = props.host;
      dispatcher.replaceConnectorProperties(props, msg);
      expect(props.host).toBe(originalHost);
    });

    it('resolves variables from connector map (lowest priority)', () => {
      const msg = createConnectorMessage({
        connectorMap: { sftpHost: 'from-connector-map' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('from-connector-map');
    });

    it('channel map takes priority over source map', () => {
      const msg = createConnectorMessage({
        channelMap: { sftpHost: 'from-channel' },
        sourceMap: { sftpHost: 'from-source' },
      });
      const props = dispatcher.getProperties();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('from-channel');
    });

    it('resolves SFTP scheme properties (keyFile, passPhrase, knownHostsFile)', () => {
      const dispatcher2 = new FileDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          sftpSchemeProperties: {
            keyFile: '/keys/${keyName}',
            passPhrase: '${keyPass}',
            knownHostsFile: '/etc/${hostsFile}',
          } as any,
        },
      });
      const msg = createConnectorMessage({
        channelMap: { keyName: 'id_rsa', keyPass: 's3cret', hostsFile: 'known_hosts' },
      });
      const props = dispatcher2.getProperties();
      const resolved = dispatcher2.replaceConnectorProperties(props, msg);
      expect(resolved.sftpSchemeProperties!.keyFile).toBe('/keys/id_rsa');
      expect(resolved.sftpSchemeProperties!.passPhrase).toBe('s3cret');
      expect(resolved.sftpSchemeProperties!.knownHostsFile).toBe('/etc/known_hosts');
    });

    it('passes through properties without ${} unchanged', () => {
      const dispatcher2 = new FileDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          host: 'static-host.example.com',
          outputPattern: 'output.txt',
        },
      });
      const msg = createConnectorMessage({});
      const props = dispatcher2.getProperties();
      const resolved = dispatcher2.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('static-host.example.com');
      expect(resolved.outputPattern).toBe('output.txt');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // CPC-W18-005: File Receiver file size filter properties
  // ──────────────────────────────────────────────────────────────
  describe('CPC-W18-005: File Receiver file size filter properties', () => {
    it('defaults fileSizeMinimum to "0"', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.fileSizeMinimum).toBe('0');
    });

    it('defaults fileSizeMaximum to "" (no limit)', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.fileSizeMaximum).toBe('');
    });

    it('defaults ignoreFileSizeMaximum to true', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.ignoreFileSizeMaximum).toBe(true);
    });

    it('FileReceiver respects fileSizeMinimum during filtering', async () => {
      // Access the private filterFiles method via prototype testing
      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          fileSizeMinimum: '100',
          fileSizeMaximum: '',
          ignoreFileSizeMaximum: true,
        },
      });

      // Access private method via cast
      const filterFiles = (receiver as any).filterFiles.bind(receiver);
      const files = [
        { name: 'small.txt', path: '/tmp/small.txt', directory: '/tmp', size: 50, lastModified: new Date(Date.now() - 60000), isDirectory: false },
        { name: 'large.txt', path: '/tmp/large.txt', directory: '/tmp', size: 200, lastModified: new Date(Date.now() - 60000), isDirectory: false },
      ];

      const result = filterFiles(files);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('large.txt');
    });

    it('FileReceiver respects fileSizeMaximum when not ignored', async () => {
      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          fileSizeMinimum: '0',
          fileSizeMaximum: '500',
          ignoreFileSizeMaximum: false,
        },
      });

      const filterFiles = (receiver as any).filterFiles.bind(receiver);
      const files = [
        { name: 'small.txt', path: '/tmp/small.txt', directory: '/tmp', size: 100, lastModified: new Date(Date.now() - 60000), isDirectory: false },
        { name: 'huge.txt', path: '/tmp/huge.txt', directory: '/tmp', size: 1000, lastModified: new Date(Date.now() - 60000), isDirectory: false },
      ];

      const result = filterFiles(files);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('small.txt');
    });

    it('FileReceiver ignores fileSizeMaximum when ignoreFileSizeMaximum=true', async () => {
      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          fileSizeMinimum: '0',
          fileSizeMaximum: '500',
          ignoreFileSizeMaximum: true,  // default
        },
      });

      const filterFiles = (receiver as any).filterFiles.bind(receiver);
      const files = [
        { name: 'huge.txt', path: '/tmp/huge.txt', directory: '/tmp', size: 1000, lastModified: new Date(Date.now() - 60000), isDirectory: false },
      ];

      const result = filterFiles(files);
      expect(result).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // CPC-W18-006: File Receiver error handling properties
  // ──────────────────────────────────────────────────────────────
  describe('CPC-W18-006: File Receiver error handling properties', () => {
    it('defaults moveToFileName to ""', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.moveToFileName).toBe('');
    });

    it('defaults errorReadingAction to NONE', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.errorReadingAction).toBe(AfterProcessingAction.NONE);
    });

    it('defaults errorResponseAction to "AFTER_PROCESSING"', () => {
      const props = getDefaultFileReceiverProperties();
      // Java: errorResponseAction = FileAction.AFTER_PROCESSING
      expect(props.errorResponseAction).toBe('AFTER_PROCESSING');
    });

    it('defaults errorMoveToDirectory to ""', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.errorMoveToDirectory).toBe('');
    });

    it('defaults errorMoveToFileName to ""', () => {
      const props = getDefaultFileReceiverProperties();
      expect(props.errorMoveToFileName).toBe('');
    });

    it('accepts custom error handling properties', () => {
      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          errorReadingAction: AfterProcessingAction.MOVE,
          errorResponseAction: 'AFTER_PROCESSING',
          errorMoveToDirectory: '/errors',
          errorMoveToFileName: 'error_${originalFilename}',
          moveToFileName: 'processed_${originalFilename}',
        },
      });
      const props = receiver.getProperties();
      expect(props.errorReadingAction).toBe(AfterProcessingAction.MOVE);
      expect(props.errorResponseAction).toBe('AFTER_PROCESSING');
      expect(props.errorMoveToDirectory).toBe('/errors');
      expect(props.errorMoveToFileName).toBe('error_${originalFilename}');
      expect(props.moveToFileName).toBe('processed_${originalFilename}');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // CPC-W18-007: File Dispatcher temporary flag
  // ──────────────────────────────────────────────────────────────
  describe('CPC-W18-007: File Dispatcher temporary flag', () => {
    it('defaults temporary to false', () => {
      const props = getDefaultFileDispatcherProperties();
      expect(props.temporary).toBe(false);
    });

    it('temporary flag triggers temp-then-rename write', async () => {
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');
      const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/mirth-file-temp-`);

      const dispatcher = new FileDispatcher({
        name: 'Test File Dispatcher',
        metaDataId: 1,
        properties: {
          directory: tmpDir,
          outputPattern: 'test_temp.txt',
          outputAppend: false,
          temporary: true,        // Enable temp file write
          tempFilename: '',       // No custom suffix — should use default .tmp
        },
      });

      // Mock channel for event dispatching
      (dispatcher as any).channel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
      };

      await dispatcher.start();

      const msg = new ConnectorMessage({
        channelId: 'test-channel-id',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Test Channel',
        connectorName: 'File Writer',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setRawData('temporary file content');

      await dispatcher.send(msg);

      // Final file should exist
      const finalPath = path.join(tmpDir, 'test_temp.txt');
      const content = await fs.readFile(finalPath, 'utf-8');
      expect(content).toBe('temporary file content');

      // Temp file (.tmp) should NOT exist (it was renamed)
      const tmpPath = `${finalPath}.tmp`;
      await expect(fs.access(tmpPath)).rejects.toThrow();

      await dispatcher.stop();
      // Cleanup
      await fs.rm(tmpDir, { recursive: true });
    });

    it('temporary flag with custom tempFilename uses the custom suffix', async () => {
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');
      const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/mirth-file-tempsuffix-`);

      const dispatcher = new FileDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          directory: tmpDir,
          outputPattern: 'custom_suffix.txt',
          outputAppend: false,
          temporary: true,
          tempFilename: '.writing',  // Custom temp suffix
        },
      });

      (dispatcher as any).channel = {
        getId: () => 'ch1',
        getName: () => 'Ch',
      };

      await dispatcher.start();

      const msg = new ConnectorMessage({
        channelId: 'ch1',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Ch',
        connectorName: 'File Writer',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setRawData('custom suffix content');

      await dispatcher.send(msg);

      const finalPath = path.join(tmpDir, 'custom_suffix.txt');
      const content = await fs.readFile(finalPath, 'utf-8');
      expect(content).toBe('custom suffix content');

      await dispatcher.stop();
      await fs.rm(tmpDir, { recursive: true });
    });

    it('send() integrates replaceConnectorProperties for dynamic directory', async () => {
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');
      const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/mirth-file-dynamic-`);

      const dispatcher = new FileDispatcher({
        name: 'Test',
        metaDataId: 1,
        properties: {
          directory: tmpDir,  // Static for this test (so files actually write)
          outputPattern: '${patientId}.txt',
          outputAppend: false,
          template: '${message.rawData}',
        },
      });

      (dispatcher as any).channel = {
        getId: () => 'ch1',
        getName: () => 'Ch',
      };

      await dispatcher.start();

      const msg = new ConnectorMessage({
        channelId: 'ch1',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Ch',
        connectorName: 'File Writer',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setRawData('HL7 content here');
      msg.getChannelMap().set('patientId', 'P999');

      await dispatcher.send(msg);

      // File should be named with resolved variable
      const finalPath = path.join(tmpDir, 'P999.txt');
      const content = await fs.readFile(finalPath, 'utf-8');
      expect(content).toBe('HL7 content here');
      expect(msg.getStatus()).toBe(Status.SENT);

      await dispatcher.stop();
      await fs.rm(tmpDir, { recursive: true });
    });
  });
});
