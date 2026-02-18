import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock the pool module before importing SchemaManager
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock DonkeyDao
jest.mock('../../../src/db/DonkeyDao.js', () => ({
  createChannelTables: jest.fn(),
  channelTablesExist: jest.fn(),
}));

import {
  detectMode,
  verifySchema,
  ensureCoreTables,
  ensureNodeJsTables,
  ensureChannelTables,
  channelTablesExist,
} from '../../../src/db/SchemaManager.js';
import { getPool, transaction } from '../../../src/db/pool.js';
import {
  createChannelTables,
  channelTablesExist as donkeyChannelTablesExist,
} from '../../../src/db/DonkeyDao.js';

// Type helpers for mocks
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;
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

  describe('ensureNodeJsTables', () => {
    const NODE_JS_TABLES = [
      'D_CHANNELS',
      'D_SERVERS',
      'D_CHANNEL_DEPLOYMENTS',
      'D_CLUSTER_EVENTS',
      'D_GLOBAL_MAP',
      'D_ARTIFACT_SYNC',
    ];

    it('should create all 6 Node.js-only tables', async () => {
      const queriedSql: string[] = [];
      const mockConnection = {
        query: jest.fn<(sql: string) => Promise<unknown>>().mockImplementation(async (sql: string) => {
          queriedSql.push(sql);
          return [[]];
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTransaction.mockImplementation(async (cb: any) => {
        return cb(mockConnection);
      });

      await ensureNodeJsTables();

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.query).toHaveBeenCalledTimes(6);

      for (const tableName of NODE_JS_TABLES) {
        const found = queriedSql.some(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${tableName}`));
        expect(found).toBe(true);
      }
    });

    it('should be idempotent (calling twice does not error)', async () => {
      const mockConnection = {
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTransaction.mockImplementation(async (cb: any) => {
        return cb(mockConnection);
      });

      await ensureNodeJsTables();
      await ensureNodeJsTables();

      expect(mockTransaction).toHaveBeenCalledTimes(2);
      // Each call creates 6 tables
      expect(mockConnection.query).toHaveBeenCalledTimes(12);
    });
  });

  describe('ensureCoreTables', () => {
    it('should call ensureNodeJsTables after creating Java-compatible tables', async () => {
      const queriedSql: string[] = [];
      const mockConnection = {
        query: jest.fn<(sql: string) => Promise<unknown>>().mockImplementation(async (sql: string) => {
          queriedSql.push(sql);
          return [[]];
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTransaction.mockImplementation(async (cb: any) => {
        return cb(mockConnection);
      });

      await ensureCoreTables();

      // Should be called twice: once for Java tables, once for Node.js tables
      expect(mockTransaction).toHaveBeenCalledTimes(2);

      // Node.js-only tables should be present in the SQL
      const allSql = queriedSql.join('\n');
      expect(allSql).toContain('D_SERVERS');
      expect(allSql).toContain('D_CHANNELS');
      expect(allSql).toContain('D_ARTIFACT_SYNC');

      // Java-compatible tables should also be present
      expect(allSql).toContain('SCHEMA_INFO');
      expect(allSql).toContain('CHANNEL');
      expect(allSql).toContain('PERSON');
    });
  });

  describe('ensureChannelTables', () => {
    it('should register channel and create tables', async () => {
      const mockPool = {
        query: jest.fn<() => Promise<unknown>>()
          // First call: check if channel exists (empty = not found)
          .mockResolvedValueOnce([[]])
          // Second call: get max LOCAL_CHANNEL_ID
          .mockResolvedValueOnce([[{ next_id: 3 }]]),
        execute: jest.fn<() => Promise<unknown>>()
          .mockResolvedValue([{ affectedRows: 1 }]),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
      mockCreateChannelTables.mockResolvedValue(undefined);

      await ensureChannelTables('test-channel-123');

      // Should check if channel exists
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS'),
        ['test-channel-123']
      );
      // Should INSERT with explicit LOCAL_CHANNEL_ID
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO D_CHANNELS'),
        [3, 'test-channel-123']
      );
      expect(mockCreateChannelTables).toHaveBeenCalledWith('test-channel-123');
    });

    it('should skip INSERT if channel already registered', async () => {
      const mockPool = {
        query: jest.fn<() => Promise<unknown>>()
          // First call: channel already exists
          .mockResolvedValueOnce([[{ LOCAL_CHANNEL_ID: 5 }]]),
        execute: jest.fn<() => Promise<unknown>>(),
      };
      mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
      mockCreateChannelTables.mockResolvedValue(undefined);

      await ensureChannelTables('existing-channel');

      // Should NOT call execute (no INSERT needed)
      expect(mockPool.execute).not.toHaveBeenCalled();
      // Should still create channel tables
      expect(mockCreateChannelTables).toHaveBeenCalledWith('existing-channel');
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
