/**
 * UsageServlet Unit Tests
 *
 * Tests for usage data reporting endpoints including:
 * - GET /usageData - Get usage data
 * - POST /usageData/_generate - Generate fresh usage data
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
  USAGE_GET_DATA: { name: 'getUsageData' },
}));

// Mock database pool
const mockQuery = jest.fn();

jest.mock('../../../../src/db/pool.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Mock auth (getActiveSessionCount)
const mockGetActiveSessionCount = jest.fn();

jest.mock('../../../../src/api/middleware/auth.js', () => ({
  getActiveSessionCount: () => mockGetActiveSessionCount(),
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
import { usageRouter } from '../../../../src/api/servlets/UsageServlet.js';

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

  app.use('/usageData', usageRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('UsageServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock behavior: all queries succeed with minimal data
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)') && sql.includes('CHANNEL')) {
        return [{ total: 3 }];
      }
      if (sql.includes('COUNT(*)') && sql.includes('PERSON')) {
        return [{ total: 2 }];
      }
      if (sql.includes('information_schema')) {
        return []; // No statistics tables
      }
      if (sql.includes('CONFIGURATION') && sql.includes('server.id')) {
        return [{ VALUE: 'test-server-id' }];
      }
      return [];
    });

    mockGetActiveSessionCount.mockResolvedValue(1);
  });

  // ==========================================================================
  // GET /usageData
  // ==========================================================================

  describe('GET /usageData', () => {
    it('should return usage data with all required fields', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('serverId');
      expect(response.body).toHaveProperty('serverVersion');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('channelCount');
      expect(response.body).toHaveProperty('enabledChannelCount');
      expect(response.body).toHaveProperty('deployedChannelCount');
      expect(response.body).toHaveProperty('userCount');
      expect(response.body).toHaveProperty('activeSessionCount');
      expect(response.body).toHaveProperty('connectorCounts');
      expect(response.body).toHaveProperty('messageStatistics');
    });

    it('should return correct channel and user counts from database', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.channelCount).toBe(3);
      expect(response.body.userCount).toBe(2);
    });

    it('should return server ID from configuration table', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.serverId).toBe('test-server-id');
    });

    it('should return active session count', async () => {
      mockGetActiveSessionCount.mockResolvedValueOnce(5);

      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.activeSessionCount).toBe(5);
    });

    it('should return valid ISO timestamp', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      const parsed = new Date(response.body.timestamp);
      expect(parsed.toISOString()).toBe(response.body.timestamp);
    });

    it('should return connector counts object', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(typeof response.body.connectorCounts).toBe('object');
      expect(response.body.connectorCounts).toHaveProperty('HTTP Listener');
      expect(response.body.connectorCounts).toHaveProperty('TCP Listener');
    });

    it('should return message statistics', async () => {
      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      const stats = response.body.messageStatistics;
      expect(stats).toHaveProperty('totalReceived');
      expect(stats).toHaveProperty('totalSent');
      expect(stats).toHaveProperty('totalFiltered');
      expect(stats).toHaveProperty('totalError');
    });

    it('should handle missing CHANNEL table gracefully', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('CHANNEL')) throw new Error('Table not found');
        if (sql.includes('PERSON')) return [{ total: 1 }];
        if (sql.includes('CONFIGURATION')) return [{ VALUE: 'srv' }];
        return [];
      });

      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.channelCount).toBe(0);
    });

    it('should handle missing PERSON table gracefully', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('PERSON')) throw new Error('Table not found');
        if (sql.includes('CHANNEL')) return [{ total: 5 }];
        if (sql.includes('CONFIGURATION')) return [{ VALUE: 'srv' }];
        return [];
      });

      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.userCount).toBe(0);
    });

    it('should aggregate statistics from D_MS tables', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*)') && sql.includes('CHANNEL')) return [{ total: 1 }];
        if (sql.includes('COUNT(*)') && sql.includes('PERSON')) return [{ total: 1 }];
        if (sql.includes('information_schema')) {
          return [{ TABLE_NAME: 'D_MS1' }];
        }
        if (sql.includes('SUM(RECEIVED)')) {
          return [{ received: 100, sent: 90, filtered: 5, error: 5 }];
        }
        if (sql.includes('CONFIGURATION')) return [{ VALUE: 'srv' }];
        return [];
      });

      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.messageStatistics.totalReceived).toBe(100);
      expect(response.body.messageStatistics.totalSent).toBe(90);
      expect(response.body.messageStatistics.totalFiltered).toBe(5);
      expect(response.body.messageStatistics.totalError).toBe(5);
    });

    it('should return unknown serverId when CONFIGURATION table is missing', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('CONFIGURATION')) throw new Error('Table not found');
        if (sql.includes('CHANNEL')) return [{ total: 0 }];
        if (sql.includes('PERSON')) return [{ total: 0 }];
        return [];
      });

      const response = await request(app).get('/usageData');

      expect(response.status).toBe(200);
      expect(response.body.serverId).toBe('unknown');
    });
  });

  // ==========================================================================
  // POST /usageData/_generate
  // ==========================================================================

  describe('POST /usageData/_generate', () => {
    it('should generate fresh usage data', async () => {
      const response = await request(app).post('/usageData/_generate');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('serverId');
      expect(response.body).toHaveProperty('channelCount');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return same structure as GET endpoint', async () => {
      const getResponse = await request(app).get('/usageData');
      const postResponse = await request(app).post('/usageData/_generate');

      const getKeys = Object.keys(getResponse.body).sort();
      const postKeys = Object.keys(postResponse.body).sort();
      expect(postKeys).toEqual(getKeys);
    });
  });
});
