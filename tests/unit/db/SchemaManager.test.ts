import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock the pool module before importing SchemaManager
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn(),
}));

// Mock DonkeyDao
jest.mock('../../../src/db/DonkeyDao.js', () => ({
  createChannelTables: jest.fn(),
  channelTablesExist: jest.fn(),
}));

import {
  detectMode,
  verifySchema,
  ensureChannelTables,
  channelTablesExist,
} from '../../../src/db/SchemaManager.js';
import { getPool, execute } from '../../../src/db/pool.js';
import {
  createChannelTables,
  channelTablesExist as donkeyChannelTablesExist,
} from '../../../src/db/DonkeyDao.js';

// Type helpers for mocks
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;
const mockCreateChannelTables = createChannelTables as jest.MockedFunction<typeof createChannelTables>;
const mockDonkeyChannelTablesExist = donkeyChannelTablesExist as jest.MockedFunction<typeof donkeyChannelTablesExist>;

describe('SchemaManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('detectMode', () => {
    it('should return takeover when MIRTH_MODE=takeover', async () => {
      process.env.MIRTH_MODE = 'takeover';

      const mode = await detectMode();

      expect(mode).toBe('takeover');
    });

    it('should return standalone when MIRTH_MODE=standalone', async () => {
      process.env.MIRTH_MODE = 'standalone';

      const mode = await detectMode();

      expect(mode).toBe('standalone');
    });

    it('should be case-insensitive for MIRTH_MODE', async () => {
      process.env.MIRTH_MODE = 'TAKEOVER';

      const mode = await detectMode();

      expect(mode).toBe('takeover');
    });

    it('should auto-detect takeover mode when CHANNEL table exists', async () => {
      delete process.env.MIRTH_MODE;

      const mockPool = {
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[{ TABLE_NAME: 'CHANNEL' }]]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const mode = await detectMode();

      expect(mode).toBe('takeover');
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should auto-detect standalone mode when CHANNEL table does not exist', async () => {
      delete process.env.MIRTH_MODE;

      const mockPool = {
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const mode = await detectMode();

      expect(mode).toBe('standalone');
    });

    it('should default to standalone if database query fails', async () => {
      delete process.env.MIRTH_MODE;

      const mockPool = {
        query: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('Connection failed')),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const mode = await detectMode();

      expect(mode).toBe('standalone');
    });
  });

  describe('verifySchema', () => {
    it('should return compatible=true when all tables exist', async () => {
      const mockPool = {
        query: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce([[{ TABLE_NAME: 'SCHEMA_INFO' }]]) // SCHEMA_INFO exists
          .mockResolvedValueOnce([[{ VERSION: '3.9.1' }]]) // Version query
          .mockResolvedValueOnce([
            // Required tables
            [
              { TABLE_NAME: 'CHANNEL' },
              { TABLE_NAME: 'CONFIGURATION' },
              { TABLE_NAME: 'PERSON' },
              { TABLE_NAME: 'PERSON_PASSWORD' },
              { TABLE_NAME: 'EVENT' },
              { TABLE_NAME: 'ALERT' },
              { TABLE_NAME: 'CODE_TEMPLATE' },
              { TABLE_NAME: 'CODE_TEMPLATE_LIBRARY' },
              { TABLE_NAME: 'CHANNEL_GROUP' },
              { TABLE_NAME: 'SCRIPT' },
            ],
          ]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const result = await verifySchema();

      expect(result.compatible).toBe(true);
      expect(result.version).toBe('3.9.1');
      expect(result.errors).toHaveLength(0);
    });

    it('should return compatible=false when SCHEMA_INFO is missing', async () => {
      const mockPool = {
        query: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce([[]]) // SCHEMA_INFO does not exist
          .mockResolvedValueOnce([
            // Required tables (all present)
            [
              { TABLE_NAME: 'CHANNEL' },
              { TABLE_NAME: 'CONFIGURATION' },
              { TABLE_NAME: 'PERSON' },
              { TABLE_NAME: 'PERSON_PASSWORD' },
              { TABLE_NAME: 'EVENT' },
              { TABLE_NAME: 'ALERT' },
              { TABLE_NAME: 'CODE_TEMPLATE' },
              { TABLE_NAME: 'CODE_TEMPLATE_LIBRARY' },
              { TABLE_NAME: 'CHANNEL_GROUP' },
              { TABLE_NAME: 'SCRIPT' },
            ],
          ]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const result = await verifySchema();

      expect(result.compatible).toBe(false);
      expect(result.version).toBeNull();
      expect(result.errors).toContain('Missing table: SCHEMA_INFO');
    });

    it('should return compatible=false when required tables are missing', async () => {
      const mockPool = {
        query: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce([[{ TABLE_NAME: 'SCHEMA_INFO' }]])
          .mockResolvedValueOnce([[{ VERSION: '3.9.1' }]])
          .mockResolvedValueOnce([
            // Missing ALERT and SCRIPT tables
            [
              { TABLE_NAME: 'CHANNEL' },
              { TABLE_NAME: 'CONFIGURATION' },
              { TABLE_NAME: 'PERSON' },
              { TABLE_NAME: 'PERSON_PASSWORD' },
              { TABLE_NAME: 'EVENT' },
              { TABLE_NAME: 'CODE_TEMPLATE' },
              { TABLE_NAME: 'CODE_TEMPLATE_LIBRARY' },
              { TABLE_NAME: 'CHANNEL_GROUP' },
            ],
          ]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const result = await verifySchema();

      expect(result.compatible).toBe(false);
      expect(result.version).toBe('3.9.1');
      expect(result.errors).toContain('Missing table: ALERT');
      expect(result.errors).toContain('Missing table: SCRIPT');
    });

    it('should handle database errors gracefully', async () => {
      const mockPool = {
        query: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('Connection refused')),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);

      const result = await verifySchema();

      expect(result.compatible).toBe(false);
      expect(result.version).toBeNull();
      expect(result.errors).toContainEqual(expect.stringContaining('Database error:'));
    });
  });

  describe('ensureChannelTables', () => {
    it('should register channel and create tables', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 } as unknown as Awaited<ReturnType<typeof execute>>);
      mockCreateChannelTables.mockResolvedValue(undefined);

      await ensureChannelTables('test-channel-123');

      expect(mockExecute).toHaveBeenCalledWith(
        'INSERT IGNORE INTO D_CHANNELS (CHANNEL_ID) VALUES (?)',
        { channelId: 'test-channel-123' }
      );
      expect(mockCreateChannelTables).toHaveBeenCalledWith('test-channel-123');
    });
  });

  describe('channelTablesExist', () => {
    it('should delegate to DonkeyDao', async () => {
      mockDonkeyChannelTablesExist.mockResolvedValue(true);

      const result = await channelTablesExist('test-channel-456');

      expect(mockDonkeyChannelTablesExist).toHaveBeenCalledWith('test-channel-456');
      expect(result).toBe(true);
    });

    it('should return false when tables do not exist', async () => {
      mockDonkeyChannelTablesExist.mockResolvedValue(false);

      const result = await channelTablesExist('nonexistent-channel');

      expect(result).toBe(false);
    });
  });
});
