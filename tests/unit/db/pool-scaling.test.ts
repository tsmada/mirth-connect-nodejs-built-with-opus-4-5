import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock the logging module
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

// Mock mysql2/promise
const mockPool = {
  on: jest.fn(),
  end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  pool: {
    _allConnections: { length: 8 },
    _freeConnections: { length: 3 },
    _connectionQueue: { length: 2 },
    config: { connectionLimit: 20 },
    on: jest.fn(),
  },
};

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => mockPool),
}));

import {
  initPool,
  closePool,
  getPoolStats,
  getPoolConfig,
  recreatePool,
  isPoolSizeExplicit,
} from '../../../src/db/pool.js';

describe('Pool Scaling', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset pool state
    await closePool();
  });

  afterEach(async () => {
    await closePool();
  });

  describe('getPoolStats', () => {
    it('should return zeros when pool is not initialized', () => {
      const stats = getPoolStats();
      expect(stats).toEqual({
        active: 0,
        idle: 0,
        queued: 0,
        total: 0,
        limit: 0,
      });
    });

    it('should return correct stats from inner pool', () => {
      initPool({ host: 'localhost', port: 3306, database: 'test', user: 'test', password: 'test' });
      const stats = getPoolStats();
      expect(stats.total).toBe(8);
      expect(stats.idle).toBe(3);
      expect(stats.active).toBe(5); // 8 - 3
      expect(stats.queued).toBe(2);
      expect(stats.limit).toBe(20);
    });
  });

  describe('getPoolConfig', () => {
    it('should return defaults when pool is not initialized', () => {
      const config = getPoolConfig();
      expect(config.connectionLimit).toBe(10);
      expect(config.queueLimit).toBe(200);
    });

    it('should return configured values after init', () => {
      initPool({
        host: 'localhost',
        port: 3306,
        database: 'test',
        user: 'test',
        password: 'test',
        connectionLimit: 50,
        queueLimit: 500,
      });
      const config = getPoolConfig();
      expect(config.connectionLimit).toBe(50);
      expect(config.queueLimit).toBe(500);
    });
  });

  describe('recreatePool', () => {
    it('should close existing pool and create new one', async () => {
      initPool({ host: 'localhost', port: 3306, database: 'test', user: 'test', password: 'test' });
      expect(mockPool.end).not.toHaveBeenCalled();

      await recreatePool({
        host: 'localhost',
        port: 3306,
        database: 'test',
        user: 'test',
        password: 'test',
        connectionLimit: 50,
      });

      // Old pool was closed
      expect(mockPool.end).toHaveBeenCalledTimes(1);

      // New config stored
      const config = getPoolConfig();
      expect(config.connectionLimit).toBe(50);
    });

    it('should work when no prior pool exists', async () => {
      await recreatePool({
        host: 'localhost',
        port: 3306,
        database: 'test',
        user: 'test',
        password: 'test',
        connectionLimit: 30,
      });

      const config = getPoolConfig();
      expect(config.connectionLimit).toBe(30);
    });
  });

  describe('isPoolSizeExplicit', () => {
    const originalEnv = process.env.DB_POOL_SIZE;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.DB_POOL_SIZE = originalEnv;
      } else {
        delete process.env.DB_POOL_SIZE;
      }
    });

    it('should return false when DB_POOL_SIZE is not set', () => {
      delete process.env.DB_POOL_SIZE;
      expect(isPoolSizeExplicit()).toBe(false);
    });

    it('should return true when DB_POOL_SIZE is set', () => {
      process.env.DB_POOL_SIZE = '50';
      expect(isPoolSizeExplicit()).toBe(true);
    });
  });

  describe('initPool logging', () => {
    it('should register enqueue handler with stats', () => {
      initPool({ host: 'localhost', port: 3306, database: 'test', user: 'test', password: 'test' });
      // The inner pool 'enqueue' handler should be registered
      expect(mockPool.pool.on).toHaveBeenCalledWith('enqueue', expect.any(Function));
    });
  });
});
