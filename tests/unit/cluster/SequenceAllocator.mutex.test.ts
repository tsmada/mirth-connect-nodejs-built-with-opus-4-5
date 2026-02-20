import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the database pool
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

import { SequenceAllocator } from '../../../src/cluster/SequenceAllocator.js';
import { getPool } from '../../../src/db/pool.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('SequenceAllocator (mutex concurrency)', () => {
  const channelId = 'abcdef12-3456-7890-abcd-ef1234567890';
  let allocator: SequenceAllocator;

  function createMockConnection(queryFn: (...args: any[]) => any) {
    return {
      query: jest.fn(queryFn as any),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    allocator = new SequenceAllocator(10);
  });

  it('allocateId returns unique IDs under concurrent calls', async () => {
    let dbCounter = 0;
    const conn = createMockConnection((sql: string) => {
      if (sql.includes('SELECT')) {
        dbCounter++;
        return [[{ LOCAL_CHANNEL_ID: (dbCounter - 1) * 10 + 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // Fire 5 concurrent allocateId calls for the same channel
    const promises = Array.from({ length: 5 }, () => allocator.allocateId(channelId));
    const ids = await Promise.all(promises);

    // All IDs should be unique
    expect(new Set(ids).size).toBe(5);
    // Should be sequential within the block: 1, 2, 3, 4, 5
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('multiple channels can allocate concurrently without interference', async () => {
    const channel1 = '11111111-1111-1111-1111-111111111111';
    const channel2 = '22222222-2222-2222-2222-222222222222';

    const conn = createMockConnection((sql: string) => {
      if (sql.includes('SELECT')) {
        // Different starting IDs for different channels
        if (sql.includes('11111111')) return [[{ LOCAL_CHANNEL_ID: 1 }]];
        return [[{ LOCAL_CHANNEL_ID: 100 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // Fire concurrent calls for both channels simultaneously
    const promises = [
      allocator.allocateId(channel1),
      allocator.allocateId(channel2),
      allocator.allocateId(channel1),
      allocator.allocateId(channel2),
    ];
    const ids = await Promise.all(promises);

    // Channel 1 IDs should be 1, 2 and channel 2 IDs should be 100, 101
    const ch1Ids = [ids[0]!, ids[2]!].sort((a, b) => a - b);
    const ch2Ids = [ids[1]!, ids[3]!].sort((a, b) => a - b);

    expect(ch1Ids).toEqual([1, 2]);
    expect(ch2Ids).toEqual([100, 101]);
  });

  it('block exhaustion triggers reallocation correctly under concurrency', async () => {
    let dbCallCount = 0;
    const conn = createMockConnection(async (sql: string) => {
      if (sql.includes('SELECT')) {
        dbCallCount++;
        // Simulate async DB delay to increase interleave chance
        await new Promise(r => setTimeout(r, 5));
        // First block starts at 1 (max 11), second at 11 (max 21)
        return [[{ LOCAL_CHANNEL_ID: dbCallCount === 1 ? 1 : 11 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // Exhaust the first block (10 IDs)
    for (let i = 0; i < 10; i++) {
      await allocator.allocateId(channelId);
    }

    // Now fire concurrent calls that all need a new block
    const promises = Array.from({ length: 3 }, () => allocator.allocateId(channelId));
    const ids = await Promise.all(promises);

    // All should get unique IDs from the second block
    expect(new Set(ids).size).toBe(3);
    const sorted = ids.sort((a, b) => a - b);
    expect(sorted).toEqual([11, 12, 13]);

    // Only two DB round trips total (one for first block, one for second)
    expect(dbCallCount).toBe(2);
  });

  it('no ID duplicates with N concurrent calls to same channel', async () => {
    const N = 25; // More than one block size (10)
    let dbCallCount = 0;
    const conn = createMockConnection(async (sql: string) => {
      if (sql.includes('SELECT')) {
        dbCallCount++;
        await new Promise(r => setTimeout(r, 2));
        return [[{ LOCAL_CHANNEL_ID: (dbCallCount - 1) * 10 + 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    const promises = Array.from({ length: N }, () => allocator.allocateId(channelId));
    const ids = await Promise.all(promises);

    // No duplicates
    expect(new Set(ids).size).toBe(N);
    // Should be exactly 1..25
    expect(ids.sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1)
    );
  });

  it('mutex prevents block overwrite race condition', async () => {
    // This test specifically targets the race where two calls see an exhausted
    // block, both call allocateBlock(), and the second overwrites the first's block.
    let dbCallCount = 0;
    const conn = createMockConnection(async (sql: string) => {
      if (sql.includes('SELECT')) {
        dbCallCount++;
        // Add significant delay to amplify the race window
        await new Promise(r => setTimeout(r, 20));
        return [[{ LOCAL_CHANNEL_ID: (dbCallCount - 1) * 10 + 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // Exhaust the block
    for (let i = 0; i < 10; i++) {
      await allocator.allocateId(channelId);
    }

    // Fire 5 concurrent calls when the block is exhausted.
    // Without the mutex, multiple allocateBlock() calls would fire.
    const promises = Array.from({ length: 5 }, () => allocator.allocateId(channelId));
    const ids = await Promise.all(promises);

    // All unique
    expect(new Set(ids).size).toBe(5);
    // Only ONE additional DB block allocation should have occurred
    // (first block + one re-allocation, not 5 re-allocations)
    expect(dbCallCount).toBe(2);
  });

  it('allocateBlock error does not permanently lock the channel', async () => {
    let callCount = 0;
    const conn = createMockConnection(async (sql: string) => {
      if (sql.includes('SELECT')) {
        callCount++;
        if (callCount === 1) {
          throw new Error('transient DB error');
        }
        return [[{ LOCAL_CHANNEL_ID: 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // First call fails
    await expect(allocator.allocateId(channelId)).rejects.toThrow('transient DB error');

    // Second call should succeed — mutex should not be permanently held
    const id = await allocator.allocateId(channelId);
    expect(id).toBe(1);
  });

  it('getRemaining is accurate after concurrent allocations', async () => {
    const conn = createMockConnection((sql: string) => {
      if (sql.includes('SELECT')) return [[{ LOCAL_CHANNEL_ID: 1 }]];
      return [{ affectedRows: 1 }];
    });
    mockGetPool.mockReturnValue({ getConnection: () => Promise.resolve(conn) } as any);

    // Allocate 7 of 10 concurrently
    const promises = Array.from({ length: 7 }, () => allocator.allocateId(channelId));
    await Promise.all(promises);

    expect(allocator.getRemaining(channelId)).toBe(3);
  });
});
