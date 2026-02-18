/**
 * Tests for deadlock retry wiring in SequenceAllocator.
 *
 * Verifies that allocateBlock (via allocateId) retries on MySQL
 * deadlock errors before propagating.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Provide a working withRetry (without delays for fast tests)
jest.mock('../../../src/db/pool.js', () => {
  const withRetry = async (fn: () => Promise<any>, maxRetries = 3) => {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const errno = error?.errno ?? error?.code;
        if ((errno === 1213 || errno === 1205) && attempt < maxRetries) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError!;
  };
  return {
    getPool: jest.fn(),
    withRetry,
  };
});

import { SequenceAllocator } from '../../../src/cluster/SequenceAllocator.js';
import { getPool } from '../../../src/db/pool.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

const channelId = 'abcdef12-3456-7890-abcd-ef1234567890';

function createMockConnection(queryFn: (...args: any[]) => any) {
  return {
    query: jest.fn(queryFn as any),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

describe('SequenceAllocator deadlock retry', () => {
  let allocator: SequenceAllocator;

  beforeEach(() => {
    jest.clearAllMocks();
    allocator = new SequenceAllocator(10);
  });

  it('should retry on deadlock and return valid block', async () => {
    // First connection: deadlock
    const deadlockConn = createMockConnection(() => {
      throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
    });

    // Second connection: succeeds
    const successConn = createMockConnection((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return [[{ LOCAL_CHANNEL_ID: 100 }]];
      }
      return [{ affectedRows: 1 }];
    });

    mockGetPool.mockReturnValue({
      getConnection: jest.fn<any>()
        .mockResolvedValueOnce(deadlockConn)
        .mockResolvedValueOnce(successConn),
    } as any);

    const id = await allocator.allocateId(channelId);

    expect(id).toBe(100);
    expect(deadlockConn.rollback).toHaveBeenCalledTimes(1);
    expect(deadlockConn.release).toHaveBeenCalledTimes(1);
    expect(successConn.commit).toHaveBeenCalledTimes(1);
  });

  it('should propagate after exhausting all retries', async () => {
    const deadlockConn = createMockConnection(() => {
      throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
    });

    mockGetPool.mockReturnValue({
      getConnection: jest.fn<any>().mockResolvedValue(deadlockConn),
    } as any);

    await expect(allocator.allocateId(channelId)).rejects.toThrow('Deadlock found');
  });
});
