import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the pool module before importing DonkeyDao
const mockTransaction = jest.fn<(cb: (conn: unknown) => Promise<void>) => Promise<void>>();

jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  transaction: mockTransaction,
}));

import {
  deleteAllMessages,
  getConnectorMessageCount,
  getConnectorMessageStatuses,
  getMaxConnectorMessageId,
  removeMetaDataColumn,
} from '../../../src/db/DonkeyDao.js';
import { getPool } from '../../../src/db/pool.js';
import { Status } from '../../../src/model/Status.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

function createMockPool() {
  return {
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 0 }]),
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
  };
}

function createMockConn() {
  return {
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 0 }]),
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
  };
}

const TEST_CHANNEL = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CH = TEST_CHANNEL.replace(/-/g, '_');

describe('DonkeyDao - New Methods', () => {
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();
    mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  // ==========================================================================
  // deleteAllMessages
  // ==========================================================================
  describe('deleteAllMessages', () => {
    it('should delete from all 5 tables in foreign-key safe order within a transaction', async () => {
      const mockConn = createMockConn();

      // Make transaction execute the callback with our mock connection
      mockTransaction.mockImplementation(async (cb) => {
        await (cb as (conn: typeof mockConn) => Promise<void>)(mockConn);
      });

      await deleteAllMessages(TEST_CHANNEL);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockConn.execute).toHaveBeenCalledTimes(5);

      // Verify deletion order: D_MC, D_MA, D_MCM, D_MM, D_M
      const calls = mockConn.execute.mock.calls as unknown as [string][];
      expect(calls[0]![0]).toContain(`D_MC${CH}`);   // content first
      expect(calls[1]![0]).toContain(`D_MA${CH}`);   // attachments
      expect(calls[2]![0]).toContain(`D_MCM${CH}`);  // custom metadata
      expect(calls[3]![0]).toContain(`D_MM${CH}`);   // connector messages
      expect(calls[4]![0]).toContain(`D_M${CH}`);    // messages last

      // Verify they are DELETE statements
      for (const call of calls) {
        expect(call![0]).toMatch(/^DELETE FROM/);
      }
    });

    it('should not delete from D_MS (statistics) or D_MSQ (sequence) tables', async () => {
      const mockConn = createMockConn();
      mockTransaction.mockImplementation(async (cb) => {
        await (cb as (conn: typeof mockConn) => Promise<void>)(mockConn);
      });

      await deleteAllMessages(TEST_CHANNEL);

      const calls = mockConn.execute.mock.calls as unknown as [string][];
      for (const call of calls) {
        expect(call[0]).not.toContain(`D_MS${CH}`);
        expect(call[0]).not.toContain(`D_MSQ${CH}`);
      }
    });
  });

  // ==========================================================================
  // getConnectorMessageCount
  // ==========================================================================
  describe('getConnectorMessageCount', () => {
    it('should return count from JOIN query with correct parameters', async () => {
      mockPool.query.mockResolvedValue([[{ cnt: 42 }]]);

      const result = await getConnectorMessageCount(TEST_CHANNEL, 'server-1', 1, Status.ERROR);

      expect(result).toBe(42);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
      expect(call[0]).toContain(`D_M${CH}`);
      expect(call[0]).toContain('INNER JOIN');
      expect(call[0]).toContain('m.SERVER_ID = ?');
      expect(call[0]).toContain('mm.METADATA_ID = ?');
      expect(call[0]).toContain('mm.STATUS = ?');
      expect(call[1]).toEqual(['server-1', 1, 'E']);
    });

    it('should return 0 when count is zero', async () => {
      mockPool.query.mockResolvedValue([[{ cnt: 0 }]]);

      const result = await getConnectorMessageCount(TEST_CHANNEL, 'srv', 0, Status.SENT);

      expect(result).toBe(0);
    });

    it('should pass correct status character for each status', async () => {
      mockPool.query.mockResolvedValue([[{ cnt: 0 }]]);

      await getConnectorMessageCount(TEST_CHANNEL, 'srv', 0, Status.QUEUED);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[1][2]).toBe('Q');
    });
  });

  // ==========================================================================
  // getConnectorMessageStatuses
  // ==========================================================================
  describe('getConnectorMessageStatuses', () => {
    it('should return Map of metaDataId to Status', async () => {
      mockPool.query.mockResolvedValue([[
        { METADATA_ID: 0, STATUS: 'R' },
        { METADATA_ID: 1, STATUS: 'S' },
        { METADATA_ID: 2, STATUS: 'E' },
      ]]);

      const result = await getConnectorMessageStatuses(TEST_CHANNEL, 42);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(3);
      expect(result.get(0)).toBe(Status.RECEIVED);
      expect(result.get(1)).toBe(Status.SENT);
      expect(result.get(2)).toBe(Status.ERROR);
    });

    it('should query D_MM table with correct message ID', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getConnectorMessageStatuses(TEST_CHANNEL, 99);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
      expect(call[0]).toContain('SELECT METADATA_ID, STATUS');
      expect(call[0]).toContain('WHERE MESSAGE_ID = ?');
      expect(call[1]).toEqual([99]);
    });

    it('should return empty Map when no connector messages exist', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getConnectorMessageStatuses(TEST_CHANNEL, 1);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should handle all valid status characters', async () => {
      mockPool.query.mockResolvedValue([[
        { METADATA_ID: 0, STATUS: 'R' },
        { METADATA_ID: 1, STATUS: 'F' },
        { METADATA_ID: 2, STATUS: 'T' },
        { METADATA_ID: 3, STATUS: 'S' },
        { METADATA_ID: 4, STATUS: 'Q' },
        { METADATA_ID: 5, STATUS: 'E' },
        { METADATA_ID: 6, STATUS: 'P' },
      ]]);

      const result = await getConnectorMessageStatuses(TEST_CHANNEL, 1);

      expect(result.get(0)).toBe(Status.RECEIVED);
      expect(result.get(1)).toBe(Status.FILTERED);
      expect(result.get(2)).toBe(Status.TRANSFORMED);
      expect(result.get(3)).toBe(Status.SENT);
      expect(result.get(4)).toBe(Status.QUEUED);
      expect(result.get(5)).toBe(Status.ERROR);
      expect(result.get(6)).toBe(Status.PENDING);
    });
  });

  // ==========================================================================
  // getMaxConnectorMessageId
  // ==========================================================================
  describe('getMaxConnectorMessageId', () => {
    it('should return the max MESSAGE_ID from D_MM', async () => {
      mockPool.query.mockResolvedValue([[{ maxId: 100 }]]);

      const result = await getMaxConnectorMessageId(TEST_CHANNEL);

      expect(result).toBe(100);
      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT MAX(MESSAGE_ID) as maxId FROM D_MM${CH}`
      );
    });

    it('should return null when table is empty (MAX returns null)', async () => {
      mockPool.query.mockResolvedValue([[{ maxId: null }]]);

      const result = await getMaxConnectorMessageId(TEST_CHANNEL);

      expect(result).toBeNull();
    });

    it('should return null when no rows returned', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getMaxConnectorMessageId(TEST_CHANNEL);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // removeMetaDataColumn
  // ==========================================================================
  describe('removeMetaDataColumn', () => {
    it('should execute ALTER TABLE DROP COLUMN', async () => {
      await removeMetaDataColumn(TEST_CHANNEL, 'PatientName');

      expect(mockPool.execute).toHaveBeenCalledWith(
        `ALTER TABLE D_MCM${CH} DROP COLUMN \`PatientName\``
      );
    });

    it('should silently ignore ER_CANT_DROP_FIELD_OR_KEY error', async () => {
      const dropError = new Error('Check that column/key exists') as Error & { code: string };
      dropError.code = 'ER_CANT_DROP_FIELD_OR_KEY';
      mockPool.execute.mockRejectedValue(dropError);

      // Should NOT throw
      await expect(removeMetaDataColumn(TEST_CHANNEL, 'Missing')).resolves.toBeUndefined();
    });

    it('should rethrow other errors', async () => {
      const otherError = new Error('Connection lost') as Error & { code: string };
      otherError.code = 'ER_CONN_LOST';
      mockPool.execute.mockRejectedValue(otherError);

      await expect(removeMetaDataColumn(TEST_CHANNEL, 'Bad')).rejects.toThrow('Connection lost');
    });

    it('should use backtick-escaped column name', async () => {
      await removeMetaDataColumn(TEST_CHANNEL, 'column with spaces');

      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toContain('`column with spaces`');
    });
  });
});
