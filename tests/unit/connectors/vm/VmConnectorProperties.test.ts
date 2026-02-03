import {
  VmDispatcherProperties,
  getDefaultVmReceiverProperties,
  getDefaultVmDispatcherProperties,
  formatVmDispatcherProperties,
  getSourceChannelIds,
  getSourceMessageIds,
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
  SOURCE_MESSAGE_ID,
  SOURCE_MESSAGE_IDS,
} from '../../../../src/connectors/vm/VmConnectorProperties';

describe('VmConnectorProperties', () => {
  describe('getDefaultVmReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultVmReceiverProperties();

      expect(props.canBatch).toBe(true);
    });

    it('should return a new object each time', () => {
      const props1 = getDefaultVmReceiverProperties();
      const props2 = getDefaultVmReceiverProperties();

      expect(props1).not.toBe(props2);
      expect(props1).toEqual(props2);
    });
  });

  describe('getDefaultVmDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultVmDispatcherProperties();

      expect(props.channelId).toBe('none');
      expect(props.channelTemplate).toBe('${message.encodedData}');
      expect(props.mapVariables).toEqual([]);
      expect(props.validateResponse).toBe(false);
      expect(props.reattachAttachments).toBe(true);
    });

    it('should return a new object each time', () => {
      const props1 = getDefaultVmDispatcherProperties();
      const props2 = getDefaultVmDispatcherProperties();

      expect(props1).not.toBe(props2);
      expect(props1).toEqual(props2);
    });

    it('should return a new array for mapVariables each time', () => {
      const props1 = getDefaultVmDispatcherProperties();
      const props2 = getDefaultVmDispatcherProperties();

      // Modify one array
      props1.mapVariables.push('test');

      // Other should be unaffected
      expect(props2.mapVariables).toEqual([]);
    });
  });

  describe('formatVmDispatcherProperties', () => {
    it('should format properties with no map variables', () => {
      const props: VmDispatcherProperties = {
        channelId: 'abc-123',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const formatted = formatVmDispatcherProperties(props);

      expect(formatted).toContain('CHANNEL ID: abc-123');
      expect(formatted).toContain('[MAP VARIABLES]');
      expect(formatted).toContain('[CONTENT]');
      expect(formatted).toContain('${message.encodedData}');
    });

    it('should format properties with map variables', () => {
      const props: VmDispatcherProperties = {
        channelId: 'target-channel',
        channelTemplate: '<data>${message.rawData}</data>',
        mapVariables: ['patientId', 'visitId', 'accessionNumber'],
        validateResponse: false,
        reattachAttachments: true,
      };

      const formatted = formatVmDispatcherProperties(props);

      expect(formatted).toContain('CHANNEL ID: target-channel');
      expect(formatted).toContain('[MAP VARIABLES]');
      expect(formatted).toContain('patientId');
      expect(formatted).toContain('visitId');
      expect(formatted).toContain('accessionNumber');
      expect(formatted).toContain('[CONTENT]');
      expect(formatted).toContain('<data>${message.rawData}</data>');
    });
  });

  describe('getSourceChannelIds', () => {
    it('should return null for empty source map', () => {
      const sourceMap = new Map<string, unknown>();
      const result = getSourceChannelIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should return null if SOURCE_CHANNEL_ID is not set', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('someOtherKey', 'value');

      const result = getSourceChannelIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should return array with single channel ID if no list exists', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_CHANNEL_ID, 'channel-1');

      const result = getSourceChannelIds(sourceMap);

      expect(result).toEqual(['channel-1']);
    });

    it('should return existing list of channel IDs', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_CHANNEL_ID, 'channel-3');
      sourceMap.set(SOURCE_CHANNEL_IDS, ['channel-1', 'channel-2']);

      const result = getSourceChannelIds(sourceMap);

      expect(result).toEqual(['channel-1', 'channel-2']);
    });

    it('should handle invalid SOURCE_CHANNEL_ID type', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_CHANNEL_ID, 123); // Not a string

      const result = getSourceChannelIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should fallback to single ID if list is not an array', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_CHANNEL_ID, 'channel-1');
      sourceMap.set(SOURCE_CHANNEL_IDS, 'not-an-array');

      const result = getSourceChannelIds(sourceMap);

      expect(result).toEqual(['channel-1']);
    });
  });

  describe('getSourceMessageIds', () => {
    it('should return null for empty source map', () => {
      const sourceMap = new Map<string, unknown>();
      const result = getSourceMessageIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should return null if SOURCE_MESSAGE_ID is not set', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('someOtherKey', 'value');

      const result = getSourceMessageIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should return array with single message ID if no list exists', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_MESSAGE_ID, 100);

      const result = getSourceMessageIds(sourceMap);

      expect(result).toEqual([100]);
    });

    it('should return existing list of message IDs', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_MESSAGE_ID, 300);
      sourceMap.set(SOURCE_MESSAGE_IDS, [100, 200]);

      const result = getSourceMessageIds(sourceMap);

      expect(result).toEqual([100, 200]);
    });

    it('should handle invalid SOURCE_MESSAGE_ID type', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_MESSAGE_ID, 'not-a-number');

      const result = getSourceMessageIds(sourceMap);

      expect(result).toBeNull();
    });

    it('should fallback to single ID if list is not an array', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_MESSAGE_ID, 100);
      sourceMap.set(SOURCE_MESSAGE_IDS, 'not-an-array');

      const result = getSourceMessageIds(sourceMap);

      expect(result).toEqual([100]);
    });
  });

  describe('Source tracking constants', () => {
    it('should export correct constants', () => {
      expect(SOURCE_CHANNEL_ID).toBe('sourceChannelId');
      expect(SOURCE_CHANNEL_IDS).toBe('sourceChannelIds');
      expect(SOURCE_MESSAGE_ID).toBe('sourceMessageId');
      expect(SOURCE_MESSAGE_IDS).toBe('sourceMessageIds');
    });
  });
});
