/**
 * Tests for deadlock retry wiring in DonkeyDao.
 *
 * Verifies that getNextMessageId, pruneMessages, and deleteMessage
 * retry on MySQL deadlock errors (errno 1213, 1205) before propagating.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock logging before any module imports
jest.mock('../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
  })),
}));

jest.mock('../../../src/db/Encryptor.js', () => ({
  getEncryptor: jest.fn(),
  isEncryptionEnabled: jest.fn(() => false),
}));

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
    transaction: jest.fn(),
    withRetry,
  };
});

import { getNextMessageId, pruneMessages, deleteMessage } from '../../../src/db/DonkeyDao.js';
import { getPool, transaction } from '../../../src/db/pool.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

const channelId = 'abcdef12-3456-7890-abcd-ef1234567890';

function createMockConnection(queryFn: (...args: any[]) => any) {
  return {
    query: jest.fn(queryFn as any),
    execute: jest.fn(queryFn as any),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

describe('DonkeyDao deadlock retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNextMessageId', () => {
    it('should retry on errno 1213 (deadlock) and succeed', async () => {
      // First connection: deadlock on SELECT FOR UPDATE
      const deadlockConn = createMockConnection(() => {
        throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
      });

      // Second connection: succeeds
      const successConn = createMockConnection((sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT')) {
          return [[{ LOCAL_CHANNEL_ID: 42 }]];
        }
        return [{ affectedRows: 1 }];
      });

      mockGetPool.mockReturnValue({
        getConnection: jest.fn<any>()
          .mockResolvedValueOnce(deadlockConn)
          .mockResolvedValueOnce(successConn),
      } as any);

      const id = await getNextMessageId(channelId);

      expect(id).toBe(42);
      expect(deadlockConn.rollback).toHaveBeenCalledTimes(1);
      expect(deadlockConn.release).toHaveBeenCalledTimes(1);
      expect(successConn.commit).toHaveBeenCalledTimes(1);
      expect(successConn.release).toHaveBeenCalledTimes(1);
    });

    it('should retry on errno 1205 (lock wait timeout) and succeed', async () => {
      const timeoutConn = createMockConnection(() => {
        throw Object.assign(new Error('Lock wait timeout'), { errno: 1205 });
      });

      const successConn = createMockConnection((sql: string) => {
        if (typeof sql === 'string' && sql.includes('SELECT')) {
          return [[{ LOCAL_CHANNEL_ID: 7 }]];
        }
        return [{ affectedRows: 1 }];
      });

      mockGetPool.mockReturnValue({
        getConnection: jest.fn<any>()
          .mockResolvedValueOnce(timeoutConn)
          .mockResolvedValueOnce(successConn),
      } as any);

      const id = await getNextMessageId(channelId);

      expect(id).toBe(7);
      expect(timeoutConn.rollback).toHaveBeenCalledTimes(1);
      expect(successConn.commit).toHaveBeenCalledTimes(1);
    });

    it('should propagate after exhausting all retries', async () => {
      const deadlockConn = createMockConnection(() => {
        throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
      });

      mockGetPool.mockReturnValue({
        getConnection: jest.fn<any>().mockResolvedValue(deadlockConn),
      } as any);

      await expect(getNextMessageId(channelId)).rejects.toThrow('Deadlock found');

      // 3 attempts (default maxRetries) × getConnection
      expect(mockGetPool().getConnection).toHaveBeenCalledTimes(3);
    });
  });

  describe('pruneMessages', () => {
    it('should retry on deadlock and complete', async () => {
      const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });

      mockTransaction
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValueOnce(5 as never);

      const count = await pruneMessages(channelId, [1, 2, 3, 4, 5]);

      expect(count).toBe(5);
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it('should propagate non-deadlock errors immediately', async () => {
      const syntaxError = Object.assign(new Error('SQL syntax error'), { errno: 1064 });

      mockTransaction.mockRejectedValue(syntaxError);

      await expect(pruneMessages(channelId, [1])).rejects.toThrow('SQL syntax error');
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteMessage', () => {
    it('should retry on deadlock and complete', async () => {
      const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });

      mockTransaction
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValueOnce(undefined as never);

      await deleteMessage(channelId, 42);

      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
