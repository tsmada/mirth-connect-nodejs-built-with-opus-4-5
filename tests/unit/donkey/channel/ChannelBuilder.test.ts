import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { VmReceiver } from '../../../../src/connectors/vm/VmReceiver';
import { VmDispatcher } from '../../../../src/connectors/vm/VmDispatcher';
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

describe('ChannelBuilder', () => {
  describe('buildChannel with Channel Reader source', () => {
    it('should create VmReceiver for Channel Reader source transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: { canBatch: 'true' },
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector();

      expect(sourceConnector).toBeInstanceOf(VmReceiver);
    });

    it('should set correct default properties on VmReceiver', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: {},
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector() as VmReceiver;

      expect(sourceConnector).toBeInstanceOf(VmReceiver);
      // When canBatch is not 'true', it defaults to false
      expect(sourceConnector.getProperties().canBatch).toBe(false);
    });

    it('should parse canBatch property correctly', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Channel Reader',
          properties: { canBatch: 'true' },
        },
      });

      const channel = buildChannel(config);
      const sourceConnector = channel.getSourceConnector() as VmReceiver;

      expect(sourceConnector.getProperties().canBatch).toBe(true);
    });
  });

  describe('buildChannel with Channel Writer destination', () => {
    it('should create VmDispatcher for Channel Writer destination transport', () => {
      const config = createChannelConfig({
        destinationConnectors: [
          {
            metaDataId: 1,
            name: 'VM Writer',
            enabled: true,
            transportName: 'Channel Writer',
            properties: {
              channelId: 'target-channel',
              channelTemplate: '${message.encodedData}',
            },
          },
        ],
      });

      const channel = buildChannel(config);
      const destinations = channel.getDestinationConnectors();

      expect(destinations).toHaveLength(1);
      expect(destinations[0]).toBeInstanceOf(VmDispatcher);
    });
  });

  describe('unsupported source transport', () => {
    it('should return null for unknown source transport', () => {
      const config = createChannelConfig({
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Unknown Transport',
          properties: {},
        },
      });

      const channel = buildChannel(config);
      // When source connector is null, getSourceConnector returns null
      expect(channel.getSourceConnector()).toBeNull();
    });
  });

  describe('buildChannel preserves channel metadata', () => {
    it('should set channel id, name, and description', () => {
      const config = createChannelConfig({
        id: 'my-channel',
        name: 'My Channel',
        description: 'A test channel',
      });

      const channel = buildChannel(config);

      expect(channel.getId()).toBe('my-channel');
      expect(channel.getName()).toBe('My Channel');
      expect(channel.getDescription()).toBe('A test channel');
    });
  });
});
