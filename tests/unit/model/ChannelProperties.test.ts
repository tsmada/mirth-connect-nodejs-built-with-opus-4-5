import { ChannelProperties } from '../../../src/model/ChannelProperties';

describe('ChannelProperties', () => {
  const createTestChannel = (): ChannelProperties => {
    return new ChannelProperties({
      id: 'test-channel-id',
      name: 'Test Channel',
      description: 'A test channel',
      revision: 1,
      enabled: true,
    });
  };

  describe('constructor', () => {
    it('should create a channel with required fields', () => {
      const channel = new ChannelProperties({
        id: 'abc-123',
        name: 'My Channel',
      });

      expect(channel.getId()).toBe('abc-123');
      expect(channel.getName()).toBe('My Channel');
      expect(channel.getDescription()).toBe('');
      expect(channel.getRevision()).toBe(0);
      expect(channel.isEnabled()).toBe(true);
    });

    it('should create a channel with all fields', () => {
      const channel = new ChannelProperties({
        id: 'test-id',
        name: 'Full Channel',
        description: 'Complete configuration',
        revision: 5,
        enabled: false,
        sourceConnector: {
          name: 'Source',
          transportName: 'HTTP Listener',
        },
        destinationConnectors: [
          {
            name: 'Destination 1',
            metaDataId: 1,
            transportName: 'HTTP Sender',
          },
        ],
        preprocessingScript: 'return message;',
        postprocessingScript: 'return;',
        deployScript: 'logger.info("Deployed");',
        undeployScript: 'logger.info("Undeployed");',
        properties: { key: 'value' },
      });

      expect(channel.getId()).toBe('test-id');
      expect(channel.getDescription()).toBe('Complete configuration');
      expect(channel.getRevision()).toBe(5);
      expect(channel.isEnabled()).toBe(false);
      expect(channel.getSourceConnector()?.transportName).toBe('HTTP Listener');
      expect(channel.getDestinationConnectors()).toHaveLength(1);
      expect(channel.getPreprocessingScript()).toBe('return message;');
      expect(channel.getProperty('key')).toBe('value');
    });
  });

  describe('revision management', () => {
    it('should increment revision', () => {
      const channel = createTestChannel();
      expect(channel.getRevision()).toBe(1);

      channel.incrementRevision();
      expect(channel.getRevision()).toBe(2);

      channel.incrementRevision();
      expect(channel.getRevision()).toBe(3);
    });
  });

  describe('destination connectors', () => {
    it('should add destination connectors', () => {
      const channel = createTestChannel();

      channel.addDestinationConnector({
        name: 'Dest 1',
        metaDataId: 1,
        transportName: 'File Writer',
      });

      channel.addDestinationConnector({
        name: 'Dest 2',
        metaDataId: 2,
        transportName: 'Database Writer',
      });

      expect(channel.getDestinationConnectors()).toHaveLength(2);
    });

    it('should find destination by metaDataId', () => {
      const channel = createTestChannel();

      channel.addDestinationConnector({
        name: 'Dest 1',
        metaDataId: 1,
        transportName: 'File Writer',
      });

      channel.addDestinationConnector({
        name: 'Dest 2',
        metaDataId: 2,
        transportName: 'Database Writer',
      });

      const dest = channel.getDestinationConnector(2);
      expect(dest?.name).toBe('Dest 2');
      expect(dest?.transportName).toBe('Database Writer');
    });

    it('should return undefined for unknown metaDataId', () => {
      const channel = createTestChannel();
      expect(channel.getDestinationConnector(999)).toBeUndefined();
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const channel = new ChannelProperties({
        id: 'test-id',
        name: 'Test Channel',
        sourceConnector: {
          name: 'Source',
          transportName: 'HTTP Listener',
        },
        destinationConnectors: [
          {
            name: 'Dest',
            metaDataId: 1,
            transportName: 'HTTP Sender',
          },
        ],
      });

      const json = channel.toJSON();

      expect(json.id).toBe('test-id');
      expect(json.name).toBe('Test Channel');
      expect(json.sourceConnector?.name).toBe('Source');
      expect(json.destinationConnectors).toHaveLength(1);
    });

    it('should round-trip through JSON', () => {
      const original = new ChannelProperties({
        id: 'round-trip-id',
        name: 'Round Trip Channel',
        description: 'Testing round trip',
        revision: 10,
        enabled: false,
        preprocessingScript: 'script1',
        postprocessingScript: 'script2',
      });

      const json = original.toJSON();
      const restored = new ChannelProperties(json);

      expect(restored.getId()).toBe(original.getId());
      expect(restored.getName()).toBe(original.getName());
      expect(restored.getDescription()).toBe(original.getDescription());
      expect(restored.getRevision()).toBe(original.getRevision());
      expect(restored.isEnabled()).toBe(original.isEnabled());
      expect(restored.getPreprocessingScript()).toBe(original.getPreprocessingScript());
    });
  });
});
