import { ValueReplacer, ConnectorMessage, valueReplacer } from '../../../src/util/ValueReplacer';

describe('ValueReplacer', () => {
  let replacer: ValueReplacer;

  beforeEach(() => {
    replacer = new ValueReplacer();
  });

  describe('hasReplaceableValues', () => {
    it('should return true when string contains $', () => {
      expect(ValueReplacer.hasReplaceableValues('Hello ${name}')).toBe(true);
      expect(ValueReplacer.hasReplaceableValues('$variable')).toBe(true);
      expect(ValueReplacer.hasReplaceableValues('text$more')).toBe(true);
    });

    it('should return false when string does not contain $', () => {
      expect(ValueReplacer.hasReplaceableValues('Hello World')).toBe(false);
      expect(ValueReplacer.hasReplaceableValues('')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(ValueReplacer.hasReplaceableValues(null)).toBe(false);
      expect(ValueReplacer.hasReplaceableValues(undefined)).toBe(false);
    });
  });

  describe('getCount', () => {
    it('should return incrementing values', () => {
      expect(replacer.getCount()).toBe(1);
      expect(replacer.getCount()).toBe(2);
      expect(replacer.getCount()).toBe(3);
    });

    it('should reset properly', () => {
      replacer.getCount();
      replacer.getCount();
      replacer.resetCount();
      expect(replacer.getCount()).toBe(1);
    });
  });

  describe('replaceValues', () => {
    it('should return string unchanged if no replaceable values', () => {
      expect(replacer.replaceValues('Hello World')).toBe('Hello World');
    });

    it('should replace UUID variable', () => {
      const result = replacer.replaceValues('ID: ${UUID}');
      expect(result).toMatch(/^ID: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should replace SYSTIME variable', () => {
      const before = Date.now();
      const result = replacer.replaceValues('Time: ${SYSTIME}');
      const after = Date.now();

      const match = result.match(/^Time: (\d+)$/);
      expect(match).not.toBeNull();

      const time = parseInt(match![1]!, 10);
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    });

    it('should replace COUNT variable', () => {
      const result1 = replacer.replaceValues('Count: ${COUNT}');
      const result2 = replacer.replaceValues('Count: ${COUNT}');

      expect(result1).toBe('Count: 1');
      expect(result2).toBe('Count: 2');
    });

    it('should replace DATE variable', () => {
      const result = replacer.replaceValues('Date: ${DATE}');
      // Format: dd-MM-yy_HH-mm-ss.SS
      expect(result).toMatch(/^Date: \d{2}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{2}$/);
    });

    it('should leave unreplaceable variables unchanged', () => {
      const result = replacer.replaceValues('Hello ${unknownVariable}');
      expect(result).toBe('Hello ${unknownVariable}');
    });
  });

  describe('replaceValuesWithMap', () => {
    it('should replace variables from map', () => {
      const map = {
        name: 'John',
        age: 30,
      };
      const result = replacer.replaceValuesWithMap('Hello ${name}, age ${age}', map);
      expect(result).toBe('Hello John, age 30');
    });

    it('should handle mixed map and default variables', () => {
      const map = { name: 'Test' };
      const result = replacer.replaceValuesWithMap('${name} - ${UUID}', map);
      expect(result).toMatch(/^Test - [0-9a-f-]+$/);
    });

    it('should support maps.get syntax', () => {
      const map = { customKey: 'customValue' };
      const result = replacer.replaceValuesWithMap("Value: ${maps.get('customKey')}", map);
      expect(result).toBe('Value: customValue');
    });
  });

  describe('replaceValuesWithMessage', () => {
    it('should replace variables from connector message maps', () => {
      const connectorMessage: ConnectorMessage = {
        channelId: 'channel-123',
        channelName: 'Test Channel',
        sourceMap: { sourceVar: 'sourceValue' },
        channelMap: { channelVar: 'channelValue' },
        connectorMap: { connectorVar: 'connectorValue' },
        responseMap: { responseVar: 'responseValue' },
      };

      expect(replacer.replaceValuesWithMessage('${channelId}', connectorMessage)).toBe('channel-123');
      expect(replacer.replaceValuesWithMessage('${channelName}', connectorMessage)).toBe('Test Channel');
      expect(replacer.replaceValuesWithMessage('${sourceVar}', connectorMessage)).toBe('sourceValue');
      expect(replacer.replaceValuesWithMessage('${channelVar}', connectorMessage)).toBe('channelValue');
      expect(replacer.replaceValuesWithMessage('${connectorVar}', connectorMessage)).toBe('connectorValue');
      expect(replacer.replaceValuesWithMessage('${responseVar}', connectorMessage)).toBe('responseValue');
    });

    it('should set default originalFilename if not present', () => {
      const connectorMessage: ConnectorMessage = {};
      const result = replacer.replaceValuesWithMessage('${originalFilename}', connectorMessage);
      expect(result).toMatch(/^\d+\.dat$/);
    });

    it('should handle Map type for maps', () => {
      const connectorMessage: ConnectorMessage = {
        sourceMap: new Map([['key1', 'value1']]),
      };
      const result = replacer.replaceValuesWithMessage('${key1}', connectorMessage);
      expect(result).toBe('value1');
    });
  });

  describe('replaceValuesInMap', () => {
    it('should replace values in a Record', () => {
      const map = {
        greeting: 'Hello ${name}',
        farewell: 'Goodbye ${name}',
      };

      // First set up context with name
      const result = replacer.replaceValuesInMap(map);

      // Without name in context, variables remain unchanged
      expect(result['greeting']).toBe('Hello ${name}');
      expect(result['farewell']).toBe('Goodbye ${name}');
    });

    it('should replace values in a Map', () => {
      const map = new Map<string, string>();
      map.set('uuid', '${UUID}');

      const result = replacer.replaceValuesInMap(map);

      expect(result.get('uuid')).toMatch(/^[0-9a-f-]+$/);
    });

    it('should not modify original map', () => {
      const original = { key: '${UUID}' };
      replacer.replaceValuesInMap(original);
      expect(original['key']).toBe('${UUID}');
    });
  });

  describe('replaceValuesInMapWithMessage', () => {
    it('should replace values using connector message context', () => {
      const map = {
        key: '${channelName}',
      };
      const connectorMessage: ConnectorMessage = {
        channelName: 'My Channel',
      };

      const result = replacer.replaceValuesInMapWithMessage(map, connectorMessage);
      expect(result['key']).toBe('My Channel');
    });

    it('should handle Map type', () => {
      const map = new Map<string, string>();
      map.set('key', '${channelName}');

      const connectorMessage: ConnectorMessage = {
        channelName: 'My Channel',
      };

      const result = replacer.replaceValuesInMapWithMessage(map, connectorMessage);
      expect(result.get('key')).toBe('My Channel');
    });
  });

  describe('replaceKeysAndValuesInMap', () => {
    it('should replace both keys and values', () => {
      const map = {
        '${keyVar}': ['${value1}', '${value2}'],
      };
      const connectorMessage: ConnectorMessage = {
        sourceMap: {
          keyVar: 'resolvedKey',
          value1: 'resolvedValue1',
          value2: 'resolvedValue2',
        },
      };

      const result = replacer.replaceKeysAndValuesInMap(map, connectorMessage);
      expect(result['resolvedKey']).toEqual(['resolvedValue1', 'resolvedValue2']);
    });

    it('should handle Map type', () => {
      const map = new Map<string, string[]>();
      map.set('${keyVar}', ['${val}']);

      const connectorMessage: ConnectorMessage = {
        sourceMap: { keyVar: 'newKey', val: 'newVal' },
      };

      const result = replacer.replaceKeysAndValuesInMap(map, connectorMessage);
      expect(result.get('newKey')).toEqual(['newVal']);
    });
  });

  describe('replaceValuesInList', () => {
    it('should replace values in list in place', () => {
      const list = ['${UUID}', '${SYSTIME}'];
      replacer.replaceValuesInList(list);

      expect(list[0]).toMatch(/^[0-9a-f-]+$/);
      expect(list[1]).toMatch(/^\d+$/);
    });
  });

  describe('replaceValuesInListWithMessage', () => {
    it('should replace values using connector message context', () => {
      const list = ['${name}'];
      const connectorMessage: ConnectorMessage = {
        sourceMap: { name: 'TestName' },
      };

      replacer.replaceValuesInListWithMessage(list, connectorMessage);
      expect(list[0]).toBe('TestName');
    });
  });

  describe('replaceURLValues', () => {
    it('should decode URL and replace values', () => {
      const connectorMessage: ConnectorMessage = {
        sourceMap: { host: 'example.com' },
      };

      const result = replacer.replaceURLValues('http%3A%2F%2F${host}', connectorMessage);
      expect(result).toBe('http://example.com');
    });

    it('should return empty string for empty input', () => {
      const connectorMessage: ConnectorMessage = {};
      expect(replacer.replaceURLValues('', connectorMessage)).toBe('');
      expect(replacer.replaceURLValues('   ', connectorMessage)).toBe('');
    });

    it('should handle invalid URL encoding gracefully', () => {
      const connectorMessage: ConnectorMessage = {
        sourceMap: { test: 'value' },
      };
      // Invalid percent encoding
      const result = replacer.replaceURLValues('%ZZ${test}', connectorMessage);
      expect(result).toBe('%ZZvalue');
    });
  });

  describe('replaceValuesWithFullMessage', () => {
    it('should replace values using full message context', () => {
      const message = {
        getMergedConnectorMessage: () => ({
          sourceMap: { src: 'sourceVal' },
          channelMap: { ch: 'channelVal' },
          responseMap: { resp: 'responseVal' },
        }),
      };

      expect(replacer.replaceValuesWithFullMessage('${src}', message)).toBe('sourceVal');
      expect(replacer.replaceValuesWithFullMessage('${ch}', message)).toBe('channelVal');
      expect(replacer.replaceValuesWithFullMessage('${resp}', message)).toBe('responseVal');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(valueReplacer).toBeInstanceOf(ValueReplacer);
    });
  });

  describe('nested property access', () => {
    it('should support dot notation for nested objects', () => {
      const map = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
          },
        },
      };

      expect(replacer.replaceValuesWithMap('${user.name}', map)).toBe('John');
      expect(replacer.replaceValuesWithMap('${user.address.city}', map)).toBe('NYC');
    });

    it('should handle null/undefined in property chain', () => {
      const map = {
        user: null,
      };

      const result = replacer.replaceValuesWithMap('${user.name}', map);
      expect(result).toBe('${user.name}');
    });
  });
});
