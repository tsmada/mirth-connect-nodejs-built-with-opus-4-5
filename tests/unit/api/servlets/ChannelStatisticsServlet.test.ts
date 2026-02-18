/**
 * ChannelStatisticsServlet Unit Tests
 *
 * Tests for channel statistics endpoints:
 * - GET /channels/statistics - Get all channel statistics
 * - POST /channels/statistics/_getStatistics - POST alternative
 * - GET /channels/:channelId/statistics - Get single channel stats
 * - POST /channels/_clearStatistics - Clear specific stats
 * - POST /channels/_clearAllStatistics - Clear all stats
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the database pool BEFORE importing the servlet
const mockPool = {
  query: jest.fn(),
  execute: jest.fn(),
};

jest.mock('../../../../src/db/pool.js', () => ({
  getPool: jest.fn(() => mockPool),
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock authorization - must passthrough to actual route handlers
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CHANNEL_STATS_GET: { name: 'getChannelStatistics' },
  CHANNEL_STATS_GET_ALL: { name: 'getAllChannelStatistics' },
  CHANNEL_STATS_CLEAR: { name: 'clearChannelStatistics' },
  CHANNEL_STATS_CLEAR_ALL: { name: 'clearAllChannelStatistics' },
}));

// Now import Express and create app
import express, { Express } from 'express';
import { channelStatisticsRouter } from '../../../../src/api/servlets/ChannelStatisticsServlet.js';

// Create a test app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Add sendData helper like in real app
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown) {
      this.json(data);
    };
    next();
  });

  app.use('/channels', channelStatisticsRouter);
  return app;
}

describe('ChannelStatisticsServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /channels/statistics', () => {
    it('should return statistics for all channels', async () => {
      // Mock table lookup - return one channel table
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []])
        // Mock statistics table exists check
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []])
        // Mock statistics query
        .mockResolvedValueOnce([[
          { METADATA_ID: 0, SERVER_ID: 'server1', RECEIVED: 100, FILTERED: 5, TRANSFORMED: 0, PENDING: 10, SENT: 80, ERROR: 5 },
        ], []]);

      const response = await request(app).get('/channels/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          channelId: '12345678-1234-1234-1234-123456789abc',
          received: 100,
          filtered: 5,
          sent: 80,
          error: 5,
          queued: 10,
        }),
      ]);
    });

    it('should return statistics for specific channels when channelId query provided', async () => {
      const channelId = '12345678-1234-1234-1234-123456789abc';

      // Mock table exists check
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []])
        // Mock statistics query
        .mockResolvedValueOnce([[
          { METADATA_ID: 0, SERVER_ID: 'server1', RECEIVED: 50, FILTERED: 2, TRANSFORMED: 0, PENDING: 5, SENT: 40, ERROR: 3 },
        ], []]);

      const response = await request(app)
        .get('/channels/statistics')
        .query({ channelId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          channelId,
          received: 50,
          sent: 40,
        }),
      ]);
    });

    it('should return empty array when no statistics tables exist', async () => {
      // Mock empty table lookup
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app).get('/channels/statistics');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app).get('/channels/statistics');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to get channel statistics',
      });
    });
  });

  describe('GET /channels/:channelId/statistics', () => {
    it('should return statistics for a specific channel', async () => {
      const channelId = '12345678-1234-1234-1234-123456789abc';

      // Mock table exists
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []])
        // Mock statistics
        .mockResolvedValueOnce([[
          { METADATA_ID: 0, SERVER_ID: 'server1', RECEIVED: 200, FILTERED: 10, TRANSFORMED: 0, PENDING: 20, SENT: 160, ERROR: 10 },
          { METADATA_ID: 1, SERVER_ID: 'server1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 5, SENT: 155, ERROR: 0 },
        ], []]);

      const response = await request(app).get(`/channels/${channelId}/statistics`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          channelId,
          received: 200, // Sum of all connectors
          sent: 315, // 160 + 155
          error: 10,
          filtered: 10,
          queued: 25, // 20 + 5
        }),
      );
    });

    it('should return 404 for non-existent channel', async () => {
      const channelId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

      // Mock table doesn't exist
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app).get(`/channels/${channelId}/statistics`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'Channel not found or has no statistics',
      });
    });

    it('should return zeros when statistics table exists but is empty', async () => {
      const channelId = '12345678-1234-1234-1234-123456789abc';

      // Mock table exists but empty
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []])
        .mockResolvedValueOnce([[], []]);

      const response = await request(app).get(`/channels/${channelId}/statistics`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          channelId,
          received: 0,
          sent: 0,
          error: 0,
          filtered: 0,
          queued: 0,
        }),
      );
    });
  });

  describe('POST /channels/statistics/_getStatistics', () => {
    it('should handle channel IDs in array body format', async () => {
      const channelIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];

      // Mock table checks and queries for both channels
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS11111111_1111_1111_1111_111111111111' }], []])
        .mockResolvedValueOnce([[{ METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 10, FILTERED: 1, TRANSFORMED: 0, PENDING: 1, SENT: 8, ERROR: 0 }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS22222222_2222_2222_2222_222222222222' }], []])
        .mockResolvedValueOnce([[{ METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 20, FILTERED: 2, TRANSFORMED: 0, PENDING: 2, SENT: 16, ERROR: 0 }], []]);

      const response = await request(app)
        .post('/channels/statistics/_getStatistics')
        .send(channelIds);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channelId: '11111111-1111-1111-1111-111111111111', received: 10 }),
          expect.objectContaining({ channelId: '22222222-2222-2222-2222-222222222222', received: 20 }),
        ]),
      );
    });

    it('should handle XML set format from Java client', async () => {
      const body = {
        set: {
          string: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
        },
      };

      // Mock queries
      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS11111111_1111_1111_1111_111111111111' }], []])
        .mockResolvedValueOnce([[{ METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 5, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 5, ERROR: 0 }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS22222222_2222_2222_2222_222222222222' }], []])
        .mockResolvedValueOnce([[{ METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 15, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 15, ERROR: 0 }], []]);

      const response = await request(app)
        .post('/channels/statistics/_getStatistics')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
    });

    it('should handle single string in XML format', async () => {
      const body = {
        set: {
          string: '33333333-3333-3333-3333-333333333333',
        },
      };

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS33333333_3333_3333_3333_333333333333' }], []])
        .mockResolvedValueOnce([[{ METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 100, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 100, ERROR: 0 }], []]);

      const response = await request(app)
        .post('/channels/statistics/_getStatistics')
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({ channelId: '33333333-3333-3333-3333-333333333333', received: 100 }),
      ]);
    });
  });

  describe('POST /channels/_clearStatistics', () => {
    it('should clear all statistics for a channel', async () => {
      const channelId = '12345678-1234-1234-1234-123456789abc';
      const body = {
        [channelId]: null,
      };

      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS12345678_1234_1234_1234_123456789abc' }], []]);
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post('/channels/_clearStatistics')
        .send(body);

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE D_MS12345678_1234_1234_1234_123456789abc SET'),
      );
    });

    it('should only clear specified statistic types based on query params', async () => {
      const channelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const body = {
        [channelId]: null,
      };

      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME: 'D_MSaaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee' }], []]);
      mockPool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post('/channels/_clearStatistics')
        .query({ received: 'true', filtered: 'false', sent: 'true', error: 'false' })
        .send(body);

      expect(response.status).toBe(204);
      const updateCall = mockPool.execute.mock.calls[0][0] as string;
      expect(updateCall).toContain('RECEIVED = 0');
      expect(updateCall).toContain('SENT = 0');
      expect(updateCall).not.toContain('FILTERED = 0');
      expect(updateCall).not.toContain('ERROR = 0');
    });

    it('should handle empty body gracefully (no-op)', async () => {
      // Empty body {} is valid - it just clears nothing
      const response = await request(app)
        .post('/channels/_clearStatistics')
        .send({});

      expect(response.status).toBe(204);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  describe('POST /channels/_clearAllStatistics', () => {
    it('should clear statistics for all channels', async () => {
      // Mock finding all statistics tables
      mockPool.query
        .mockResolvedValueOnce([[
          { TABLE_NAME: 'D_MS11111111_1111_1111_1111_111111111111' },
          { TABLE_NAME: 'D_MS22222222_2222_2222_2222_222222222222' },
        ], []])
        // Table exists checks
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS11111111_1111_1111_1111_111111111111' }], []])
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MS22222222_2222_2222_2222_222222222222' }], []]);

      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app).post('/channels/_clearAllStatistics');

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledTimes(2);
    });

    it('should handle empty statistics gracefully', async () => {
      // No statistics tables
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app).post('/channels/_clearAllStatistics');

      expect(response.status).toBe(204);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  describe('Statistics aggregation', () => {
    it('should aggregate statistics across multiple connectors', async () => {
      const channelId = 'aabbccdd-eeff-0011-2233-445566778899';

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MSaabbccdd_eeff_0011_2233_445566778899' }], []])
        .mockResolvedValueOnce([[
          { METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: 100, FILTERED: 10, TRANSFORMED: 0, PENDING: 5, SENT: 0, ERROR: 5 },
          { METADATA_ID: 1, SERVER_ID: 's1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 10, SENT: 70, ERROR: 5 },
          { METADATA_ID: 2, SERVER_ID: 's1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 20, ERROR: 0 },
        ], []]);

      const response = await request(app).get(`/channels/${channelId}/statistics`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          received: 100, // Only source connector receives
          sent: 90, // 70 + 20 from destinations
          error: 10, // 5 + 5
          filtered: 10,
          queued: 15, // 5 + 10
        }),
      );
    });

    it('should handle null values in statistics rows', async () => {
      const channelId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      mockPool.query
        .mockResolvedValueOnce([[{ TABLE_NAME: 'D_MSdddddddd_dddd_dddd_dddd_dddddddddddd' }], []])
        .mockResolvedValueOnce([[
          { METADATA_ID: 0, SERVER_ID: 's1', RECEIVED: null, FILTERED: null, TRANSFORMED: null, PENDING: null, SENT: null, ERROR: null },
        ], []]);

      const response = await request(app).get(`/channels/${channelId}/statistics`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          received: 0,
          sent: 0,
          error: 0,
          filtered: 0,
          queued: 0,
        }),
      );
    });
  });
});
