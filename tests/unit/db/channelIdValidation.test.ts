import {
  validateChannelId,
  messageTable,
  connectorMessageTable,
  contentTable,
  statisticsTable,
  sequenceTable,
} from '../../../src/db/DonkeyDao.js';

describe('Channel ID Validation', () => {
  const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const VALID_UUID_UPPER = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';

  describe('validateChannelId', () => {
    test('accepts valid UUID', () => {
      expect(() => validateChannelId(VALID_UUID)).not.toThrow();
    });

    test('accepts valid UUID with uppercase hex', () => {
      expect(() => validateChannelId(VALID_UUID_UPPER)).not.toThrow();
    });

    test('returns underscore-replaced ID on success', () => {
      expect(validateChannelId(VALID_UUID)).toBe('a1b2c3d4_e5f6_7890_abcd_ef1234567890');
    });

    test('rejects SQL injection attempts', () => {
      expect(() => validateChannelId('DROP TABLE users')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId("'; DROP TABLE--")).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('1; DELETE FROM D_M')).toThrow('Invalid channel ID format');
    });

    test('rejects empty string', () => {
      expect(() => validateChannelId('')).toThrow('Invalid channel ID format');
    });

    test('rejects non-UUID strings', () => {
      expect(() => validateChannelId('not-a-uuid')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('hello world')).toThrow('Invalid channel ID format');
    });

    test('rejects UUID with wrong length', () => {
      // Too short (missing last char)
      expect(() => validateChannelId('a1b2c3d4-e5f6-7890-abcd-ef123456789')).toThrow('Invalid channel ID format');
      // Too long (extra char)
      expect(() => validateChannelId('a1b2c3d4-e5f6-7890-abcd-ef12345678901')).toThrow('Invalid channel ID format');
    });

    test('rejects UUID with wrong segment lengths', () => {
      expect(() => validateChannelId('a1b2c3d-e5f6-7890-abcd-ef1234567890')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('a1b2c3d4-e5f-7890-abcd-ef1234567890')).toThrow('Invalid channel ID format');
    });

    test('rejects UUID with non-hex characters', () => {
      expect(() => validateChannelId('g1b2c3d4-e5f6-7890-abcd-ef1234567890')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('a1b2c3d4-e5f6-7890-abcd-zz1234567890')).toThrow('Invalid channel ID format');
    });
  });

  describe('table name helpers use validation', () => {
    test('messageTable uses validated ID', () => {
      expect(messageTable(VALID_UUID)).toBe('D_Ma1b2c3d4_e5f6_7890_abcd_ef1234567890');
      expect(() => messageTable('invalid')).toThrow('Invalid channel ID format');
    });

    test('connectorMessageTable uses validated ID', () => {
      expect(connectorMessageTable(VALID_UUID)).toBe('D_MMa1b2c3d4_e5f6_7890_abcd_ef1234567890');
      expect(() => connectorMessageTable('invalid')).toThrow('Invalid channel ID format');
    });

    test('contentTable uses validated ID', () => {
      expect(contentTable(VALID_UUID)).toBe('D_MCa1b2c3d4_e5f6_7890_abcd_ef1234567890');
      expect(() => contentTable('invalid')).toThrow('Invalid channel ID format');
    });

    test('statisticsTable uses validated ID', () => {
      expect(statisticsTable(VALID_UUID)).toBe('D_MSa1b2c3d4_e5f6_7890_abcd_ef1234567890');
      expect(() => statisticsTable('invalid')).toThrow('Invalid channel ID format');
    });

    test('sequenceTable uses validated ID', () => {
      expect(sequenceTable(VALID_UUID)).toBe('D_MSQa1b2c3d4_e5f6_7890_abcd_ef1234567890');
      expect(() => sequenceTable('invalid')).toThrow('Invalid channel ID format');
    });
  });
});
