import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
}));

import { SequenceAllocator } from '../../../src/cluster/SequenceAllocator.js';
import { getPool } from '../../../src/db/pool.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('SequenceAllocator', () => {
  const channelId = 'abcdef12-3456-7890-abcd-ef1234567890';
  let allocator: SequenceAllocator;

  // Helpers for building mock connections
  function createMockConnection(queryFn: (...args: any[]) => any) {
    return {
      query: jest.fn(queryFn as any),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
  }

  function setupMockPool(currentId: number = 1) {
    const conn = createMockConnection((sql: string) => {
      if (sql.includes('SELECT')) {
        return [[{ LOCAL_CHANNEL_ID: currentId }]];
      }
      return [{ affectedRows: 1 }];
    });
    const mockPool = { getConnection: () => Promise.resolve(conn) };
    mockGetPool.mockReturnValue(mockPool as any);
    return conn;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    allocator = new SequenceAllocator(10);
  });

  describe('allocateId', () => {
    it('should allocate a block and return sequential IDs', async () => {
      const conn = setupMockPool(1);

      const id1 = await allocator.allocateId(channelId);
      const id2 = await allocator.allocateId(channelId);
      const id3 = await allocator.allocateId(channelId);

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);

      // Only one DB round-trip for the whole block
      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    });

    it('should allocate a new block when current is exhausted', async () => {
      let callCount = 0;
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('SELECT')) {
          callCount++;
          return [[{ LOCAL_CHANNEL_ID: callCount === 1 ? 1 : 11 }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

      // Exhaust the first block (IDs 1-10)
      for (let i = 0; i < 10; i++) {
        await allocator.allocateId(channelId);
      }
      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);

      // This should trigger a new block allocation
      const id11 = await allocator.allocateId(channelId);
      expect(id11).toBe(11);
      expect(conn.beginTransaction).toHaveBeenCalledTimes(2);
    });

    it('should use the correct D_MSQ table name', async () => {
      const conn = setupMockPool(1);
      await allocator.allocateId(channelId);

      // Channel ID dashes are replaced with underscores
      const expectedTable = 'D_MSQabcdef12_3456_7890_abcd_ef1234567890';
      const selectCall = (conn.query.mock.calls as any[][]).find(
        (call) => typeof call[0] === 'string' && call[0].includes('SELECT')
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![0]).toContain(expectedTable);
    });

    it('should increment the DB sequence by blockSize', async () => {
      const conn = setupMockPool(50);
      await allocator.allocateId(channelId);

      // connection.query calls: [0]=SELECT, [1]=UPDATE
      // UPDATE is called with (sql, [newMaxId])
      const allCalls = conn.query.mock.calls;
      expect(allCalls).toHaveLength(2);
      const updateArgs = allCalls[1] as unknown[];
      expect((updateArgs[0] as string)).toContain('UPDATE');
      // blockSize=10, so current 50 should be updated to 60
      expect(updateArgs[1]).toEqual([60]);
    });

    it('should handle multiple channels independently', async () => {
      const channel1 = '11111111-1111-1111-1111-111111111111';
      const channel2 = '22222222-2222-2222-2222-222222222222';
      let queryCount = 0;

      const conn = createMockConnection((sql: string) => {
        if (sql.includes('SELECT')) {
          queryCount++;
          // First channel starts at 1, second at 100
          return [[{ LOCAL_CHANNEL_ID: queryCount === 1 ? 1 : 100 }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

      const id1 = await allocator.allocateId(channel1);
      const id2 = await allocator.allocateId(channel2);

      expect(id1).toBe(1);
      expect(id2).toBe(100);
      expect(conn.beginTransaction).toHaveBeenCalledTimes(2);
    });

    it('should use a transaction with FOR UPDATE lock', async () => {
      const conn = setupMockPool(1);
      await allocator.allocateId(channelId);

      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);

      const selectCall = (conn.query.mock.calls as any[][]).find(
        (call) => typeof call[0] === 'string' && call[0].includes('FOR UPDATE')
      );
      expect(selectCall).toBeDefined();
    });

    it('should rollback and rethrow on DB error', async () => {
      const conn = createMockConnection(() => {
        throw new Error('DB connection lost');
      });
      mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

      await expect(allocator.allocateId(channelId)).rejects.toThrow('DB connection lost');
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('blockSize configuration', () => {
    it('should default to blockSize of 100', async () => {
      const defaultAllocator = new SequenceAllocator();
      const conn = setupMockPool(1);

      await defaultAllocator.allocateId(channelId);

      const allCalls = conn.query.mock.calls;
      const updateArgs = allCalls[1] as unknown[];
      expect(updateArgs[1]).toEqual([101]); // 1 + 100
    });

    it('should respect custom blockSize', async () => {
      const smallAllocator = new SequenceAllocator(5);
      const conn = setupMockPool(1);

      await smallAllocator.allocateId(channelId);

      const allCalls = conn.query.mock.calls;
      const updateArgs = allCalls[1] as unknown[];
      expect(updateArgs[1]).toEqual([6]); // 1 + 5
    });
  });

  describe('getRemaining', () => {
    it('should return 0 for unknown channel', () => {
      expect(allocator.getRemaining('unknown-channel')).toBe(0);
    });

    it('should return remaining IDs in current block', async () => {
      setupMockPool(1);

      // Allocate 3 IDs from a block of 10
      await allocator.allocateId(channelId);
      await allocator.allocateId(channelId);
      await allocator.allocateId(channelId);

      expect(allocator.getRemaining(channelId)).toBe(7); // 10 - 3 = 7
    });

    it('should return 0 when block is exhausted', async () => {
      setupMockPool(1);

      // Exhaust all 10 IDs
      for (let i = 0; i < 10; i++) {
        await allocator.allocateId(channelId);
      }

      expect(allocator.getRemaining(channelId)).toBe(0);
    });
  });

  describe('clear', () => {
    it('should reset all cached blocks', async () => {
      setupMockPool(1);

      await allocator.allocateId(channelId);
      expect(allocator.getRemaining(channelId)).toBe(9);

      allocator.clear();

      expect(allocator.getRemaining(channelId)).toBe(0);
    });

    it('should force new block allocation after clear', async () => {
      let queryCount = 0;
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('SELECT')) {
          queryCount++;
          return [[{ LOCAL_CHANNEL_ID: queryCount === 1 ? 1 : 11 }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

      await allocator.allocateId(channelId);
      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);

      allocator.clear();

      // Next allocateId should hit the DB again
      const nextId = await allocator.allocateId(channelId);
      expect(nextId).toBe(11);
      expect(conn.beginTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
