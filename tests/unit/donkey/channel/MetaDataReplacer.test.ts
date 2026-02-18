const mockLogWarn = jest.fn();
jest.mock('../../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: mockLogWarn, debug: jest.fn(), isDebugEnabled: () => false }),
}));

import {
  setMetaDataMap,
  getMetaDataValue,
  castValue,
} from '../../../../src/donkey/channel/MetaDataReplacer';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { MetaDataColumn, MetaDataColumnType } from '../../../../src/api/models/ServerSettings';
import { Status } from '../../../../src/model/Status';

function createConnectorMessage(maps?: {
  connectorMap?: Map<string, unknown>;
  channelMap?: Map<string, unknown>;
  sourceMap?: Map<string, unknown>;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 0,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Source',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (maps?.connectorMap) {
    for (const [k, v] of maps.connectorMap) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (maps?.channelMap) {
    for (const [k, v] of maps.channelMap) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (maps?.sourceMap) {
    for (const [k, v] of maps.sourceMap) {
      msg.getSourceMap().set(k, v);
    }
  }

  return msg;
}

function col(name: string, type: MetaDataColumnType, mappingName: string): MetaDataColumn {
  return { name, type, mappingName };
}

describe('MetaDataReplacer', () => {
  describe('setMetaDataMap', () => {
    it('should extract STRING values from connectorMap', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['patientName', 'John Doe']]),
      });
      const columns = [col('PATIENT_NAME', MetaDataColumnType.STRING, 'patientName')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('PATIENT_NAME')).toBe('John Doe');
    });

    it('should extract NUMBER values from channelMap', () => {
      const msg = createConnectorMessage({
        channelMap: new Map([['age', '42']]),
      });
      const columns = [col('AGE', MetaDataColumnType.NUMBER, 'age')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('AGE')).toBe(42);
    });

    it('should extract BOOLEAN values from sourceMap', () => {
      const msg = createConnectorMessage({
        sourceMap: new Map([['isVIP', 'true']]),
      });
      const columns = [col('IS_VIP', MetaDataColumnType.BOOLEAN, 'isVIP')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('IS_VIP')).toBe(true);
    });

    it('should extract TIMESTAMP values', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['admitDate', '2026-01-15T10:30:00Z']]),
      });
      const columns = [col('ADMIT_DATE', MetaDataColumnType.TIMESTAMP, 'admitDate')];

      const result = setMetaDataMap(msg, columns);

      const date = result.get('ADMIT_DATE') as Date;
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe('2026-01-15T10:30:00.000Z');
    });

    it('should respect priority: connectorMap wins over channelMap', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['key', 'from-connector']]),
        channelMap: new Map([['key', 'from-channel']]),
        sourceMap: new Map([['key', 'from-source']]),
      });
      const columns = [col('KEY_COL', MetaDataColumnType.STRING, 'key')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('KEY_COL')).toBe('from-connector');
    });

    it('should respect priority: channelMap wins over sourceMap', () => {
      const msg = createConnectorMessage({
        channelMap: new Map([['key', 'from-channel']]),
        sourceMap: new Map([['key', 'from-source']]),
      });
      const columns = [col('KEY_COL', MetaDataColumnType.STRING, 'key')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('KEY_COL')).toBe('from-channel');
    });

    it('should fall back to sourceMap when others do not have key', () => {
      const msg = createConnectorMessage({
        sourceMap: new Map([['onlyInSource', 'source-value']]),
      });
      const columns = [col('SRC_COL', MetaDataColumnType.STRING, 'onlyInSource')];

      const result = setMetaDataMap(msg, columns);

      expect(result.get('SRC_COL')).toBe('source-value');
    });

    it('should return empty map when no matches found', () => {
      const msg = createConnectorMessage();
      const columns = [col('MISSING', MetaDataColumnType.STRING, 'nonExistent')];

      const result = setMetaDataMap(msg, columns);

      expect(result.size).toBe(0);
    });

    it('should return empty map for empty columns array', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['key', 'value']]),
      });

      const result = setMetaDataMap(msg, []);

      expect(result.size).toBe(0);
    });

    it('should skip columns with empty mappingName', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['key', 'value']]),
      });
      const columns = [col('COL', MetaDataColumnType.STRING, '')];

      const result = setMetaDataMap(msg, columns);

      expect(result.size).toBe(0);
    });

    it('should handle multiple columns at once', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map<string, unknown>([
          ['name', 'Jane'],
          ['age', 30],
        ]),
        channelMap: new Map<string, unknown>([['active', true]]),
      });
      const columns = [
        col('NAME', MetaDataColumnType.STRING, 'name'),
        col('AGE', MetaDataColumnType.NUMBER, 'age'),
        col('ACTIVE', MetaDataColumnType.BOOLEAN, 'active'),
      ];

      const result = setMetaDataMap(msg, columns);

      expect(result.size).toBe(3);
      expect(result.get('NAME')).toBe('Jane');
      expect(result.get('AGE')).toBe(30);
      expect(result.get('ACTIVE')).toBe(true);
    });

    it('should skip null/undefined values without error', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['key', null]]),
      });
      const columns = [col('COL', MetaDataColumnType.STRING, 'key')];

      const result = setMetaDataMap(msg, columns);

      expect(result.size).toBe(0);
    });

    it('should log warning but continue on cast errors', () => {
      mockLogWarn.mockClear();

      const msg = createConnectorMessage({
        connectorMap: new Map([
          ['badNum', 'not-a-number'],
          ['goodStr', 'hello'],
        ]),
      });
      const columns = [
        col('BAD', MetaDataColumnType.NUMBER, 'badNum'),
        col('GOOD', MetaDataColumnType.STRING, 'goodStr'),
      ];

      const result = setMetaDataMap(msg, columns);

      // Should still have the good value
      expect(result.get('GOOD')).toBe('hello');
      // Bad value should be skipped
      expect(result.has('BAD')).toBe(false);
      // Warning should have been logged
      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      expect(mockLogWarn.mock.calls[0]![0]).toContain('not-a-number');
    });
  });

  describe('getMetaDataValue', () => {
    it('should return undefined when key is not in any map', () => {
      const msg = createConnectorMessage();
      const column = col('COL', MetaDataColumnType.STRING, 'missing');

      expect(getMetaDataValue(msg, column)).toBeUndefined();
    });

    it('should find value in connectorMap first', () => {
      const msg = createConnectorMessage({
        connectorMap: new Map([['key', 'connector']]),
        channelMap: new Map([['key', 'channel']]),
      });
      const column = col('COL', MetaDataColumnType.STRING, 'key');

      expect(getMetaDataValue(msg, column)).toBe('connector');
    });

    it('should find value in channelMap when not in connectorMap', () => {
      const msg = createConnectorMessage({
        channelMap: new Map([['key', 'channel']]),
      });
      const column = col('COL', MetaDataColumnType.STRING, 'key');

      expect(getMetaDataValue(msg, column)).toBe('channel');
    });

    it('should find value in sourceMap as last resort', () => {
      const msg = createConnectorMessage({
        sourceMap: new Map([['key', 'source']]),
      });
      const column = col('COL', MetaDataColumnType.STRING, 'key');

      expect(getMetaDataValue(msg, column)).toBe('source');
    });
  });

  describe('castValue', () => {
    describe('STRING', () => {
      it('should convert value to string', () => {
        expect(castValue(MetaDataColumnType.STRING, 42)).toBe('42');
        expect(castValue(MetaDataColumnType.STRING, true)).toBe('true');
        expect(castValue(MetaDataColumnType.STRING, 'hello')).toBe('hello');
      });

      it('should truncate strings longer than 255 characters', () => {
        const longStr = 'x'.repeat(300);
        const result = castValue(MetaDataColumnType.STRING, longStr);
        expect(result).toBe('x'.repeat(255));
      });

      it('should not truncate strings at or under 255 characters', () => {
        const str = 'x'.repeat(255);
        expect(castValue(MetaDataColumnType.STRING, str)).toBe(str);
      });

      it('should return null for null input', () => {
        expect(castValue(MetaDataColumnType.STRING, null)).toBeNull();
      });
    });

    describe('NUMBER', () => {
      it('should convert numeric strings to numbers', () => {
        expect(castValue(MetaDataColumnType.NUMBER, '42')).toBe(42);
        expect(castValue(MetaDataColumnType.NUMBER, '3.14')).toBe(3.14);
        expect(castValue(MetaDataColumnType.NUMBER, '-7')).toBe(-7);
      });

      it('should pass through number values', () => {
        expect(castValue(MetaDataColumnType.NUMBER, 42)).toBe(42);
      });

      it('should throw on non-numeric strings', () => {
        expect(() => castValue(MetaDataColumnType.NUMBER, 'abc')).toThrow(
          "Cannot convert 'abc' to number"
        );
      });

      it('should throw on numbers >= 10^16', () => {
        expect(() => castValue(MetaDataColumnType.NUMBER, 1e16)).toThrow(
          'greater than or equal to the maximum allowed value'
        );
        expect(() => castValue(MetaDataColumnType.NUMBER, 1e17)).toThrow(
          'greater than or equal to the maximum allowed value'
        );
      });

      it('should allow numbers less than 10^16', () => {
        expect(castValue(MetaDataColumnType.NUMBER, 9999999999999)).toBe(9999999999999);
      });

      it('should return null for null input', () => {
        expect(castValue(MetaDataColumnType.NUMBER, null)).toBeNull();
      });
    });

    describe('BOOLEAN', () => {
      it('should pass through boolean values', () => {
        expect(castValue(MetaDataColumnType.BOOLEAN, true)).toBe(true);
        expect(castValue(MetaDataColumnType.BOOLEAN, false)).toBe(false);
      });

      it('should convert truthy strings to true', () => {
        for (const val of ['true', 'yes', '1', 'on', 'y', 'TRUE', 'Yes', 'ON']) {
          expect(castValue(MetaDataColumnType.BOOLEAN, val)).toBe(true);
        }
      });

      it('should convert falsy strings to false', () => {
        for (const val of ['false', 'no', '0', 'off', 'n', 'FALSE', 'No', 'OFF']) {
          expect(castValue(MetaDataColumnType.BOOLEAN, val)).toBe(false);
        }
      });

      it('should throw on unrecognized boolean strings', () => {
        expect(() => castValue(MetaDataColumnType.BOOLEAN, 'maybe')).toThrow(
          "Cannot convert 'maybe' to boolean"
        );
      });

      it('should return null for null input', () => {
        expect(castValue(MetaDataColumnType.BOOLEAN, null)).toBeNull();
      });
    });

    describe('TIMESTAMP', () => {
      it('should pass through valid Date objects', () => {
        const date = new Date('2026-01-15T10:30:00Z');
        expect(castValue(MetaDataColumnType.TIMESTAMP, date)).toBe(date);
      });

      it('should parse date strings', () => {
        const result = castValue(MetaDataColumnType.TIMESTAMP, '2026-01-15T10:30:00Z') as Date;
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toBe('2026-01-15T10:30:00.000Z');
      });

      it('should throw on invalid date strings', () => {
        expect(() => castValue(MetaDataColumnType.TIMESTAMP, 'not-a-date')).toThrow(
          "Cannot parse 'not-a-date' as timestamp"
        );
      });

      it('should throw on invalid Date objects', () => {
        expect(() => castValue(MetaDataColumnType.TIMESTAMP, new Date('invalid'))).toThrow(
          'Invalid Date object'
        );
      });

      it('should return null for null input', () => {
        expect(castValue(MetaDataColumnType.TIMESTAMP, null)).toBeNull();
      });
    });
  });
});
