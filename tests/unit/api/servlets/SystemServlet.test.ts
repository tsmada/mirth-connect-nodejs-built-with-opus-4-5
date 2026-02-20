/**
 * SystemServlet Unit Tests
 *
 * Tests for system information endpoints including:
 * - GET /system/info - System information (OS, Node version, DB)
 * - GET /system/stats - System statistics (CPU, memory)
 * - GET /system/cluster/statistics - Cluster-wide channel statistics
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  SYSTEM_GET_INFO: { name: 'getSystemInfo' },
  SYSTEM_GET_STATS: { name: 'getSystemStats' },
}));

// Mock DonkeyDao
const mockGetLocalChannelIds = jest.fn();
const mockGetStatistics = jest.fn();

jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  getLocalChannelIds: (...args: unknown[]) => mockGetLocalChannelIds(...args),
  getStatistics: (...args: unknown[]) => mockGetStatistics(...args),
}));

// Mock logging
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  registerComponent: jest.fn(),
}));

import express, { Express } from 'express';
import { systemRouter } from '../../../../src/api/servlets/SystemServlet.js';

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, status?: number) {
      if (status) this.status(status);
      this.json(data);
    };
    next();
  });

  app.use('/system', systemRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('SystemServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /system/info
  // ==========================================================================

  describe('GET /system/info', () => {
    it('should return system information', async () => {
      const response = await request(app).get('/system/info');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('jvmVersion');
      expect(response.body.jvmVersion).toMatch(/^Node\.js v/);
      expect(response.body).toHaveProperty('osName');
      expect(response.body).toHaveProperty('osVersion');
      expect(response.body).toHaveProperty('osArchitecture');
      expect(response.body).toHaveProperty('dbName', 'MySQL');
      expect(response.body).toHaveProperty('dbVersion', '8.0');
    });

    it('should return well-formed JSON with all required fields', async () => {
      const response = await request(app).get('/system/info');

      expect(response.status).toBe(200);
      const requiredFields = ['jvmVersion', 'osName', 'osVersion', 'osArchitecture', 'dbName', 'dbVersion'];
      for (const field of requiredFields) {
        expect(response.body).toHaveProperty(field);
        expect(typeof response.body[field]).toBe('string');
      }
    });
  });

  // ==========================================================================
  // GET /system/stats
  // ==========================================================================

  describe('GET /system/stats', () => {
    it('should return system statistics', async () => {
      const response = await request(app).get('/system/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('cpuUsagePercent');
      expect(response.body).toHaveProperty('allocatedMemoryBytes');
      expect(response.body).toHaveProperty('freeMemoryBytes');
      expect(response.body).toHaveProperty('maxMemoryBytes');
      expect(response.body).toHaveProperty('diskFreeBytes');
      expect(response.body).toHaveProperty('diskTotalBytes');
    });

    it('should return valid ISO timestamp', async () => {
      const response = await request(app).get('/system/stats');

      expect(response.status).toBe(200);
      const parsed = new Date(response.body.timestamp);
      expect(parsed.toISOString()).toBe(response.body.timestamp);
    });

    it('should return numeric values for memory fields', async () => {
      const response = await request(app).get('/system/stats');

      expect(response.status).toBe(200);
      expect(typeof response.body.cpuUsagePercent).toBe('number');
      expect(typeof response.body.allocatedMemoryBytes).toBe('number');
      expect(typeof response.body.freeMemoryBytes).toBe('number');
      expect(typeof response.body.maxMemoryBytes).toBe('number');
      expect(response.body.allocatedMemoryBytes).toBeGreaterThan(0);
      expect(response.body.maxMemoryBytes).toBeGreaterThan(0);
    });

    it('should return CPU usage between 0 and 100', async () => {
      const response = await request(app).get('/system/stats');

      expect(response.status).toBe(200);
      expect(response.body.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(response.body.cpuUsagePercent).toBeLessThanOrEqual(100);
    });
  });

  // ==========================================================================
  // GET /system/cluster/statistics
  // ==========================================================================

  describe('GET /system/cluster/statistics', () => {
    it('should return cluster statistics for all channels', async () => {
      const channelMap = new Map([
        ['ch-1', 1],
        ['ch-2', 2],
      ]);
      mockGetLocalChannelIds.mockResolvedValueOnce(channelMap);

      // Stats for ch-1
      mockGetStatistics.mockResolvedValueOnce([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 10, FILTERED: 1, TRANSFORMED: 9, PENDING: 0, SENT: 8, ERROR: 1 },
        { METADATA_ID: 0, SERVER_ID: 'node-2', RECEIVED: 5, FILTERED: 0, TRANSFORMED: 5, PENDING: 1, SENT: 4, ERROR: 0 },
      ]);
      // Stats for ch-2
      mockGetStatistics.mockResolvedValueOnce([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 20, FILTERED: 2, TRANSFORMED: 18, PENDING: 0, SENT: 18, ERROR: 0 },
      ]);

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);

      // First channel: aggregated across 2 servers
      const ch1 = response.body[0];
      expect(ch1.channelId).toBe('ch-1');
      expect(ch1.aggregate.received).toBe(15);
      expect(ch1.aggregate.sent).toBe(12);
      expect(ch1.aggregate.error).toBe(1);
      expect(ch1.perServer).toHaveLength(2);

      // Second channel: single server
      const ch2 = response.body[1];
      expect(ch2.channelId).toBe('ch-2');
      expect(ch2.aggregate.received).toBe(20);
      expect(ch2.perServer).toHaveLength(1);
    });

    it('should return empty array when no channels exist', async () => {
      mockGetLocalChannelIds.mockResolvedValueOnce(new Map());

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should skip channels whose stats tables are missing', async () => {
      const channelMap = new Map([
        ['ch-1', 1],
        ['ch-missing', 2],
      ]);
      mockGetLocalChannelIds.mockResolvedValueOnce(channelMap);

      // ch-1 returns stats
      mockGetStatistics.mockResolvedValueOnce([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 10, FILTERED: 0, TRANSFORMED: 10, PENDING: 0, SENT: 10, ERROR: 0 },
      ]);
      // ch-missing throws (table dropped)
      mockGetStatistics.mockRejectedValueOnce(new Error('Table not found'));

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].channelId).toBe('ch-1');
    });

    it('should aggregate across multiple METADATA_IDs for same server', async () => {
      const channelMap = new Map([['ch-1', 1]]);
      mockGetLocalChannelIds.mockResolvedValueOnce(channelMap);

      mockGetStatistics.mockResolvedValueOnce([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 10, FILTERED: 0, TRANSFORMED: 10, PENDING: 0, SENT: 10, ERROR: 0 },
        { METADATA_ID: 1, SERVER_ID: 'node-1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 8, ERROR: 2 },
      ]);

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(200);
      const ch = response.body[0];
      // Same server, different METADATA_IDs should be summed
      expect(ch.perServer).toHaveLength(1);
      expect(ch.perServer[0].received).toBe(10);
      expect(ch.perServer[0].sent).toBe(18);
      expect(ch.perServer[0].error).toBe(2);
      // Aggregate should also be the sum
      expect(ch.aggregate.received).toBe(10);
      expect(ch.aggregate.sent).toBe(18);
    });

    it('should return 500 on error', async () => {
      mockGetLocalChannelIds.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get cluster statistics');
    });

    it('should include per-server breakdown with correct server IDs', async () => {
      const channelMap = new Map([['ch-1', 1]]);
      mockGetLocalChannelIds.mockResolvedValueOnce(channelMap);

      mockGetStatistics.mockResolvedValueOnce([
        { METADATA_ID: 0, SERVER_ID: 'alpha', RECEIVED: 3, FILTERED: 1, TRANSFORMED: 2, PENDING: 0, SENT: 2, ERROR: 0 },
        { METADATA_ID: 0, SERVER_ID: 'beta', RECEIVED: 7, FILTERED: 0, TRANSFORMED: 7, PENDING: 2, SENT: 5, ERROR: 0 },
      ]);

      const response = await request(app).get('/system/cluster/statistics');

      expect(response.status).toBe(200);
      const perServer = response.body[0].perServer;
      const alpha = perServer.find((s: { serverId: string }) => s.serverId === 'alpha');
      const beta = perServer.find((s: { serverId: string }) => s.serverId === 'beta');
      expect(alpha.received).toBe(3);
      expect(beta.received).toBe(7);
    });
  });
});
