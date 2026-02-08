import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { FileReceiver } from '../../../../src/connectors/file/FileReceiver';
import { FileDispatcher } from '../../../../src/connectors/file/FileDispatcher';
import { FileScheme, AfterProcessingAction, FileSortBy } from '../../../../src/connectors/file/FileConnectorProperties';
import { Channel as ChannelModel } from '../../../../src/api/models/Channel';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';

function createChannelConfig(overrides: Partial<ChannelModel> = {}): ChannelModel {
  return {
    id: 'test-channel-id',
    name: 'Test Channel',
    revision: 1,
    enabled: true,
    sourceConnector: {
      metaDataId: 0,
      name: 'Source',
      enabled: true,
      transportName: 'HTTP Listener',
      properties: {},
    },
    destinationConnectors: [],
    properties: {
      clearGlobalChannelMap: true,
      messageStorageMode: 'DEVELOPMENT',
      initialState: DeployedState.STARTED,
    },
    ...overrides,
  };
}

describe('ChannelBuilder - File Reader source', () => {
  it('should create FileReceiver for File Reader transport name', () => {
    const config = createChannelConfig({
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {
          scheme: 'FILE',
          host: '/tmp/input',
          fileFilter: '*.hl7',
        },
      },
    });

    const channel = buildChannel(config);
    const source = channel.getSourceConnector();

    expect(source).toBeInstanceOf(FileReceiver);
  });

  it('should parse FILE scheme properties correctly', () => {
    const config = createChannelConfig({
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {
          scheme: 'FILE',
          host: '/data/inbound',
          fileFilter: '*.txt',
          regex: 'false',
          afterProcessingAction: 'DELETE',
          ignoreDot: 'true',
          binary: 'false',
          charsetEncoding: 'UTF-8',
          directoryRecursion: 'false',
          sortBy: 'NAME',
          pollConnectorProperties: {
            pollingFrequency: '3000',
          },
          schemeProperties: {
            scheme: 'FILE',
            host: '/data/inbound',
          },
        },
      },
    });

    const channel = buildChannel(config);
    const source = channel.getSourceConnector() as FileReceiver;
    const props = source.getProperties();

    expect(props.scheme).toBe(FileScheme.FILE);
    expect(props.directory).toBe('/data/inbound');
    expect(props.fileFilter).toBe('*.txt');
    expect(props.regex).toBe(false);
    expect(props.afterProcessingAction).toBe(AfterProcessingAction.DELETE);
    expect(props.sortBy).toBe(FileSortBy.NAME);
    expect(props.pollInterval).toBe(3000);
  });

  it('should parse SFTP scheme properties correctly', () => {
    const config = createChannelConfig({
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {
          scheme: 'SFTP',
          host: 'sftp.example.com',
          username: 'sftpuser',
          password: 'secret123',
          fileFilter: '*.hl7',
          afterProcessingAction: 'MOVE',
          moveToDirectory: '/archive',
          schemeProperties: {
            scheme: 'SFTP',
            host: '/home/sftpuser/input',
            sftpHost: 'sftp.example.com',
            port: '2222',
            sftpSchemeProperties: {
              passwordAuth: 'true',
              keyAuth: 'false',
              hostKeyChecking: 'no',
            },
          },
        },
      },
    });

    const channel = buildChannel(config);
    const source = channel.getSourceConnector() as FileReceiver;
    const props = source.getProperties();

    expect(props.scheme).toBe(FileScheme.SFTP);
    expect(props.directory).toBe('/home/sftpuser/input');
    expect(props.host).toBe('sftp.example.com');
    expect(props.port).toBe(2222);
    expect(props.username).toBe('sftpuser');
    expect(props.password).toBe('secret123');
    expect(props.afterProcessingAction).toBe(AfterProcessingAction.MOVE);
    expect(props.moveToDirectory).toBe('/archive');
    expect(props.sftpSchemeProperties).toBeDefined();
    expect(props.sftpSchemeProperties?.passwordAuth).toBe(true);
    expect(props.sftpSchemeProperties?.hostKeyChecking).toBe('no');
  });

  it('should use sensible defaults for missing properties', () => {
    const config = createChannelConfig({
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {},
      },
    });

    const channel = buildChannel(config);
    const source = channel.getSourceConnector() as FileReceiver;
    const props = source.getProperties();

    expect(props.scheme).toBe(FileScheme.FILE);
    expect(props.fileFilter).toBe('*');
    expect(props.regex).toBe(false);
    expect(props.afterProcessingAction).toBe(AfterProcessingAction.NONE);
    expect(props.pollInterval).toBe(5000);
    expect(props.ignoreDot).toBe(true);
    expect(props.binary).toBe(false);
    expect(props.charsetEncoding).toBe('UTF-8');
  });

  it('should handle ${} variable references in directory', () => {
    const config = createChannelConfig({
      sourceConnector: {
        metaDataId: 0,
        name: 'Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {
          scheme: 'FILE',
          host: '${inputDir}',
          schemeProperties: {
            host: '${inputDir}',
          },
        },
      },
    });

    const channel = buildChannel(config);
    const source = channel.getSourceConnector() as FileReceiver;
    const props = source.getProperties();

    // Should fall back to /tmp for variable references
    expect(props.directory).toBe('/tmp');
  });
});

describe('ChannelBuilder - File Writer SFTP destination', () => {
  it('should parse SFTP scheme on File Writer destination', () => {
    const config = createChannelConfig({
      destinationConnectors: [
        {
          metaDataId: 1,
          name: 'SFTP Writer',
          enabled: true,
          transportName: 'File Writer',
          properties: {
            scheme: 'SFTP',
            host: 'sftp.example.com',
            username: 'sftpuser',
            password: 'secret123',
            outputPattern: 'result.hl7',
            template: '${message.encodedData}',
            schemeProperties: {
              scheme: 'SFTP',
              host: '/home/sftpuser/output',
              sftpHost: 'sftp.example.com',
              port: '2222',
              sftpSchemeProperties: {
                passwordAuth: 'true',
                keyAuth: 'false',
                hostKeyChecking: 'no',
              },
            },
          },
        },
      ],
    });

    const channel = buildChannel(config);
    const destinations = channel.getDestinationConnectors();

    expect(destinations).toHaveLength(1);
    const dest = destinations[0] as FileDispatcher;
    expect(dest).toBeInstanceOf(FileDispatcher);

    const props = dest.getProperties();
    expect(props.scheme).toBe(FileScheme.SFTP);
    expect(props.directory).toBe('/home/sftpuser/output');
    expect(props.host).toBe('sftp.example.com');
    expect(props.port).toBe(2222);
    expect(props.username).toBe('sftpuser');
    expect(props.password).toBe('secret123');
    expect(props.outputPattern).toBe('result.hl7');
    expect(props.sftpSchemeProperties).toBeDefined();
  });

  it('should preserve FILE scheme behavior (backward compat)', () => {
    const config = createChannelConfig({
      destinationConnectors: [
        {
          metaDataId: 1,
          name: 'Local Writer',
          enabled: true,
          transportName: 'File Writer',
          properties: {
            outputPattern: 'output.txt',
            outputAppend: 'true',
            template: 'hello',
            charsetEncoding: 'UTF-8',
            schemeProperties: {
              host: '/tmp/output',
            },
          },
        },
      ],
    });

    const channel = buildChannel(config);
    const destinations = channel.getDestinationConnectors();
    const dest = destinations[0] as FileDispatcher;
    const props = dest.getProperties();

    expect(props.scheme).toBe(FileScheme.FILE);
    expect(props.directory).toBe('/tmp/output');
    expect(props.outputPattern).toBe('output.txt');
    expect(props.outputAppend).toBe(true);
    expect(props.template).toBe('hello');
    // No SFTP properties for FILE scheme
    expect(props.sftpSchemeProperties).toBeUndefined();
  });
});

describe('ChannelBuilder - Integration: File Reader source + File Writer dest', () => {
  it('should build complete channel with File Reader source and File Writer SFTP dest', () => {
    const config = createChannelConfig({
      id: 'sftp-test-channel',
      name: 'SFTP Lab Channel',
      sourceConnector: {
        metaDataId: 0,
        name: 'SFTP Source',
        enabled: true,
        transportName: 'File Reader',
        properties: {
          scheme: 'SFTP',
          host: 'localhost',
          username: 'testuser',
          password: 'testpass',
          fileFilter: '*.hl7',
          afterProcessingAction: 'DELETE',
          schemeProperties: {
            scheme: 'SFTP',
            host: '/home/testuser/input',
            port: '2222',
          },
        },
      },
      destinationConnectors: [
        {
          metaDataId: 1,
          name: 'SFTP Output',
          enabled: true,
          transportName: 'File Writer',
          properties: {
            scheme: 'SFTP',
            host: 'localhost',
            username: 'testuser',
            password: 'testpass',
            outputPattern: 'result.hl7',
            template: '${message.encodedData}',
            schemeProperties: {
              scheme: 'SFTP',
              host: '/home/testuser/output',
              port: '2222',
            },
          },
        },
      ],
    });

    const channel = buildChannel(config);

    expect(channel.getId()).toBe('sftp-test-channel');
    expect(channel.getName()).toBe('SFTP Lab Channel');
    expect(channel.getSourceConnector()).toBeInstanceOf(FileReceiver);
    expect(channel.getDestinationConnectors()).toHaveLength(1);
    expect(channel.getDestinationConnectors()[0]).toBeInstanceOf(FileDispatcher);
  });
});
