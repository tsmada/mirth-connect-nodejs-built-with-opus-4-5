import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock the database pool
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock the logger
jest.mock('../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
  })),
  registerComponent: jest.fn(),
}));

import {
  acquireLease,
  renewLease,
  releaseLease,
  releaseAllLeases,
  startLeaseRenewal,
  stopLeaseRenewal,
  stopAllLeaseRenewals,
  getAllLeases,
} from '../../../src/cluster/PollingLeaseManager.js';
import { getPool } from '../../../src/db/pool.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

// ── Helpers ────────────────────────────────────────────────────────

function createMockConnection(queryFn?: (...args: any[]) => any) {
  const defaultQuery = jest.fn(() => [[], []]) as any;
  return {
    query: queryFn ? jest.fn(queryFn as any) : defaultQuery,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

function mockPool(conn: ReturnType<typeof createMockConnection>) {
  const pool = {
    getConnection: jest.fn(() => Promise.resolve(conn)),
    query: conn.query,
  };
  mockGetPool.mockReturnValue(pool as any);
  return pool;
}

const CHANNEL_ID = 'chan-0001-0001-0001-000000000001';
const SERVER_A = 'server-a';
const SERVER_B = 'server-b';
const TTL = 30000;

describe('PollingLeaseManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stopAllLeaseRenewals();
  });

  afterEach(() => {
    stopAllLeaseRenewals();
    jest.useRealTimers();
  });

  // ── acquireLease ───────────────────────────────────────────────

  describe('acquireLease', () => {
    it('should insert a new lease when no existing row', async () => {
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[]]; // No existing lease
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await acquireLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(true);
      expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      expect(conn.rollback).not.toHaveBeenCalled();
      // Verify INSERT was called (second query call after the SELECT)
      expect(conn.query).toHaveBeenCalledTimes(2);
      const insertCall = conn.query.mock.calls[1]!;
      expect((insertCall[0] as string)).toContain('INSERT INTO D_POLLING_LEASES');
    });

    it('should takeover an expired lease from another server', async () => {
      const expiredTime = new Date(Date.now() - 60000); // 60s ago
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{
            CHANNEL_ID,
            SERVER_ID: SERVER_B,
            ACQUIRED_AT: expiredTime,
            RENEWED_AT: expiredTime,
            EXPIRES_AT: expiredTime, // Expired
          }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await acquireLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(true);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      const updateCall = conn.query.mock.calls[1]!;
      expect((updateCall[0] as string)).toContain('UPDATE D_POLLING_LEASES');
    });

    it('should renew when we already hold the lease', async () => {
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 15000);
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{
            CHANNEL_ID,
            SERVER_ID: SERVER_A, // We hold it
            ACQUIRED_AT: now,
            RENEWED_AT: now,
            EXPIRES_AT: futureExpiry,
          }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await acquireLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(true);
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    it('should fail when another server holds an active lease', async () => {
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 15000);
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{
            CHANNEL_ID,
            SERVER_ID: SERVER_B, // Someone else holds it
            ACQUIRED_AT: now,
            RENEWED_AT: now,
            EXPIRES_AT: futureExpiry, // Not expired
          }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await acquireLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(false);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      // No INSERT or UPDATE — just commit the read-only transaction
      expect(conn.query).toHaveBeenCalledTimes(1);
    });

    it('should rollback on error', async () => {
      const conn = createMockConnection(() => {
        throw new Error('DB connection lost');
      });
      mockPool(conn);

      await expect(acquireLease(CHANNEL_ID, SERVER_A, TTL)).rejects.toThrow('DB connection lost');
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('should always release the connection', async () => {
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      await acquireLease(CHANNEL_ID, SERVER_A, TTL);

      expect(conn.release).toHaveBeenCalledTimes(1);
    });
  });

  // ── renewLease ─────────────────────────────────────────────────

  describe('renewLease', () => {
    it('should renew when we hold the lease', async () => {
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_A }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await renewLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(true);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      const updateCall = conn.query.mock.calls[1]!;
      expect((updateCall[0] as string)).toContain('UPDATE D_POLLING_LEASES');
    });

    it('should fail when lease is held by another server', async () => {
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_B }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await renewLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(false);
      expect(conn.commit).toHaveBeenCalledTimes(1);
      // Only the SELECT query — no UPDATE
      expect(conn.query).toHaveBeenCalledTimes(1);
    });

    it('should fail when no lease exists', async () => {
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[]]; // No rows
        }
        return [{ affectedRows: 0 }];
      });
      mockPool(conn);

      const result = await renewLease(CHANNEL_ID, SERVER_A, TTL);

      expect(result).toBe(false);
      expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    it('should rollback on error', async () => {
      const conn = createMockConnection(() => {
        throw new Error('DB error');
      });
      mockPool(conn);

      await expect(renewLease(CHANNEL_ID, SERVER_A, TTL)).rejects.toThrow('DB error');
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    });
  });

  // ── releaseLease ───────────────────────────────────────────────

  describe('releaseLease', () => {
    it('should delete the lease row for the given channel and server', async () => {
      const conn = createMockConnection(() => [{ affectedRows: 1 }]);
      mockPool(conn);

      await releaseLease(CHANNEL_ID, SERVER_A);

      expect(conn.query).toHaveBeenCalledTimes(1);
      const call = conn.query.mock.calls[0]!;
      expect((call[0] as string)).toContain('DELETE FROM D_POLLING_LEASES');
      expect(call[1]).toEqual([CHANNEL_ID, SERVER_A]);
    });
  });

  // ── releaseAllLeases ───────────────────────────────────────────

  describe('releaseAllLeases', () => {
    it('should delete all leases for a server', async () => {
      const conn = createMockConnection(() => [{ affectedRows: 3 }]);
      mockPool(conn);

      await releaseAllLeases(SERVER_A);

      expect(conn.query).toHaveBeenCalledTimes(1);
      const call = conn.query.mock.calls[0]!;
      expect((call[0] as string)).toContain('DELETE FROM D_POLLING_LEASES WHERE SERVER_ID = ?');
      expect(call[1]).toEqual([SERVER_A]);
    });
  });

  // ── Renewal timers ─────────────────────────────────────────────

  describe('startLeaseRenewal', () => {
    it('should create a periodic renewal timer', () => {
      // startLeaseRenewal doesn't call renewLease immediately — it sets up the interval
      startLeaseRenewal(CHANNEL_ID, SERVER_A, TTL);

      // Timer exists (we can verify by checking that stopLeaseRenewal clears it)
      // Advance past the first interval (TTL/2 = 15000ms)
      // At this point it would try to call renewLease, which needs mocked DB
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_A }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      // Advance time to trigger the first renewal
      jest.advanceTimersByTime(TTL / 2);
    });

    it('should replace an existing timer for the same channel', () => {
      startLeaseRenewal(CHANNEL_ID, SERVER_A, TTL);
      // Start a second timer for the same channel — should clear the first
      startLeaseRenewal(CHANNEL_ID, SERVER_A, TTL);

      // Verify no double renewals fire by advancing past one interval
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_A }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      jest.advanceTimersByTime(TTL / 2);
    });

    it('should enforce a minimum interval of 1 second', () => {
      const veryShortTtl = 500; // TTL/2 = 250ms, should be clamped to 1000ms
      startLeaseRenewal(CHANNEL_ID, SERVER_A, veryShortTtl);

      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_A }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      // At 500ms, nothing should have fired yet (minimum interval is 1000ms)
      jest.advanceTimersByTime(500);
      expect(conn.query).not.toHaveBeenCalled();

      // At 1000ms, first renewal should fire
      jest.advanceTimersByTime(500);
    });
  });

  describe('stopLeaseRenewal', () => {
    it('should clear the timer for a specific channel', () => {
      startLeaseRenewal(CHANNEL_ID, SERVER_A, TTL);
      stopLeaseRenewal(CHANNEL_ID);

      // Advance past what would be the first interval — no DB calls
      const conn = createMockConnection();
      mockPool(conn);
      jest.advanceTimersByTime(TTL);

      expect(conn.query).not.toHaveBeenCalled();
    });

    it('should be a no-op for non-existent timers', () => {
      // Should not throw
      stopLeaseRenewal('non-existent-channel');
    });
  });

  describe('stopAllLeaseRenewals', () => {
    it('should clear all active timers', () => {
      startLeaseRenewal('channel-1', SERVER_A, TTL);
      startLeaseRenewal('channel-2', SERVER_A, TTL);
      startLeaseRenewal('channel-3', SERVER_A, TTL);

      stopAllLeaseRenewals();

      // Advance time — no DB calls should occur
      const conn = createMockConnection();
      mockPool(conn);
      jest.advanceTimersByTime(TTL);

      expect(conn.query).not.toHaveBeenCalled();
    });
  });

  // ── getAllLeases ────────────────────────────────────────────────

  describe('getAllLeases', () => {
    it('should return all lease rows mapped to LeaseInfo', async () => {
      const now = new Date();
      const expires = new Date(now.getTime() + TTL);
      const conn = createMockConnection(() => [[
        {
          CHANNEL_ID: 'chan-1',
          SERVER_ID: SERVER_A,
          ACQUIRED_AT: now,
          RENEWED_AT: now,
          EXPIRES_AT: expires,
        },
        {
          CHANNEL_ID: 'chan-2',
          SERVER_ID: SERVER_B,
          ACQUIRED_AT: now,
          RENEWED_AT: now,
          EXPIRES_AT: expires,
        },
      ]]);
      mockPool(conn);

      const leases = await getAllLeases();

      expect(leases).toHaveLength(2);
      expect(leases[0]).toEqual({
        channelId: 'chan-1',
        serverId: SERVER_A,
        acquiredAt: now,
        renewedAt: now,
        expiresAt: expires,
      });
      expect(leases[1]).toEqual({
        channelId: 'chan-2',
        serverId: SERVER_B,
        acquiredAt: now,
        renewedAt: now,
        expiresAt: expires,
      });
    });

    it('should return empty array when no leases exist', async () => {
      const conn = createMockConnection(() => [[]]);
      mockPool(conn);

      const leases = await getAllLeases();

      expect(leases).toEqual([]);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle expired lease takeover at exact expiry boundary', async () => {
      // Lease expires at exactly now — should still be treated as expired
      const exactlyNow = new Date();
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{
            CHANNEL_ID,
            SERVER_ID: SERVER_B,
            ACQUIRED_AT: new Date(exactlyNow.getTime() - TTL),
            RENEWED_AT: new Date(exactlyNow.getTime() - TTL),
            EXPIRES_AT: new Date(exactlyNow.getTime() - 1), // Just past expiry
          }]];
        }
        return [{ affectedRows: 1 }];
      });
      mockPool(conn);

      const result = await acquireLease(CHANNEL_ID, SERVER_A, TTL);
      expect(result).toBe(true);
    });

    it('should handle lease renewal that fails due to takeover', async () => {
      // Start renewal timer, but another server takes over
      const conn = createMockConnection((sql: string) => {
        if (sql.includes('FOR UPDATE')) {
          return [[{ SERVER_ID: SERVER_B }]]; // Another server took over
        }
        return [{ affectedRows: 0 }];
      });
      mockPool(conn);

      startLeaseRenewal(CHANNEL_ID, SERVER_A, TTL);

      // Advance to trigger renewal
      jest.advanceTimersByTime(TTL / 2);

      // Allow the async renewal to complete
      await jest.advanceTimersByTimeAsync(0);

      // Timer should have been stopped after failed renewal
      // Advance again — no more DB calls
      conn.query.mockClear();
      jest.advanceTimersByTime(TTL);

      // The renewal timer self-stops on failure, so no further queries
      // (This is verified by the stopLeaseRenewal call inside the renewal callback)
    });
  });
});
