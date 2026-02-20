/**
 * ChannelGroupServlet Unit Tests
 *
 * Tests for channel group management endpoints including:
 * - GET / - Get all channel groups
 * - POST /_getChannelGroups - POST alternative for bulk fetch
 * - POST /_bulkUpdate - Bulk update groups (create, update, delete)
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the database pool BEFORE importing the servlet
const mockQuery = jest.fn();
const mockExecute = jest.fn();

jest.mock('../../../../src/db/pool.js', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    execute: jest.fn(),
  })),
  query: mockQuery,
  execute: mockExecute,
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'generated-uuid-5678'),
}));

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock multipartForm middleware
jest.mock('../../../../src/api/middleware/multipartForm.js', () => ({
  multipartFormMiddleware: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CHANNEL_GROUP_GET: { name: 'getChannelGroups' },
  CHANNEL_GROUP_UPDATE: { name: 'updateChannelGroups' },
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

// Now import Express and the servlet AFTER all mocks are in place
import express, { Express } from 'express';
import { channelGroupRouter } from '../../../../src/api/servlets/ChannelGroupServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TEST_GROUP_ID = 'group-1111-2222-3333-444444444444';
const TEST_GROUP_ID_2 = 'group-5555-6666-7777-888888888888';
const TEST_CHANNEL_ID = 'chan-aaaa-bbbb-cccc-dddddddddddd';

function makeGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    ID: TEST_GROUP_ID,
    NAME: 'Test Group',
    DESCRIPTION: 'A test group',
    REVISION: 1,
    GROUP_DATA: JSON.stringify({
      channels: [{ id: TEST_CHANNEL_ID, revision: 1 }],
    }),
    ...overrides,
  };
}

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

  app.use('/channelgroups', channelGroupRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('ChannelGroupServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: ensureChannelGroupTable succeeds (CREATE TABLE IF NOT EXISTS)
    mockExecute.mockResolvedValue({ affectedRows: 0 });
  });

  // ==========================================================================
  // GET /channelgroups - Get all channel groups
  // ==========================================================================

  describe('GET /channelgroups', () => {
    it('should return all channel groups', async () => {
      mockQuery.mockResolvedValueOnce([
        makeGroupRow(),
        makeGroupRow({ ID: TEST_GROUP_ID_2, NAME: 'Second Group' }),
      ]);

      const response = await request(app).get('/channelgroups');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(TEST_GROUP_ID);
      expect(response.body[0].name).toBe('Test Group');
      expect(response.body[1].id).toBe(TEST_GROUP_ID_2);
    });

    it('should return empty array when no groups exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const response = await request(app).get('/channelgroups');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should filter by channelGroupId query parameter', async () => {
      mockQuery.mockResolvedValueOnce([makeGroupRow()]);

      const response = await request(app)
        .get(`/channelgroups?channelGroupId=${TEST_GROUP_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(TEST_GROUP_ID);
    });

    it('should filter by multiple channelGroupId query params', async () => {
      mockQuery.mockResolvedValueOnce([
        makeGroupRow(),
        makeGroupRow({ ID: TEST_GROUP_ID_2, NAME: 'Second' }),
      ]);

      const response = await request(app)
        .get(`/channelgroups?channelGroupId=${TEST_GROUP_ID}&channelGroupId=${TEST_GROUP_ID_2}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should deserialize channels from GROUP_DATA', async () => {
      mockQuery.mockResolvedValueOnce([makeGroupRow()]);

      const response = await request(app).get('/channelgroups');

      expect(response.status).toBe(200);
      expect(response.body[0].channels).toHaveLength(1);
      expect(response.body[0].channels[0].id).toBe(TEST_CHANNEL_ID);
    });

    it('should handle null DESCRIPTION gracefully', async () => {
      mockQuery.mockResolvedValueOnce([makeGroupRow({ DESCRIPTION: null })]);

      const response = await request(app).get('/channelgroups');

      expect(response.status).toBe(200);
      expect(response.body[0].description).toBeUndefined();
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/channelgroups');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get channel groups');
    });
  });

  // ==========================================================================
  // POST /channelgroups/_getChannelGroups - POST alternative
  // ==========================================================================

  describe('POST /channelgroups/_getChannelGroups', () => {
    it('should return groups by IDs in POST body array', async () => {
      mockQuery.mockResolvedValueOnce([makeGroupRow()]);

      const response = await request(app)
        .post('/channelgroups/_getChannelGroups')
        .send([TEST_GROUP_ID]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(TEST_GROUP_ID);
    });

    it('should return all groups when body is empty', async () => {
      mockQuery.mockResolvedValueOnce([
        makeGroupRow(),
        makeGroupRow({ ID: TEST_GROUP_ID_2, NAME: 'Second' }),
      ]);

      const response = await request(app)
        .post('/channelgroups/_getChannelGroups')
        .send([]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/channelgroups/_getChannelGroups')
        .send([]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get channel groups');
    });
  });

  // ==========================================================================
  // POST /channelgroups/_bulkUpdate - Bulk update
  // ==========================================================================

  describe('POST /channelgroups/_bulkUpdate', () => {
    it('should create new channel groups', async () => {
      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [
            {
              id: TEST_GROUP_ID,
              name: 'New Group',
              revision: 1,
              channels: [{ id: TEST_CHANNEL_ID, revision: 1 }],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
      // ensureTable + upsert
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should delete removed channel groups', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          removedChannelGroupIds: [TEST_GROUP_ID, TEST_GROUP_ID_2],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should handle both creates and deletes in one request', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [
            { id: TEST_GROUP_ID, name: 'Keep Group', revision: 1, channels: [] },
          ],
          removedChannelGroupIds: [TEST_GROUP_ID_2],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should generate ID when group has no ID', async () => {
      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [{ name: 'Auto-ID Group', channels: [] }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should initialize revision to 1 when not set', async () => {
      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [{ id: TEST_GROUP_ID, name: 'No Rev', channels: [] }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should initialize channels to empty array when not set', async () => {
      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [{ id: TEST_GROUP_ID, name: 'No Channels' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should succeed with empty body (no-op)', async () => {
      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB write failed'));

      const response = await request(app)
        .post('/channelgroups/_bulkUpdate')
        .send({
          channelGroups: [{ id: TEST_GROUP_ID, name: 'Fail Group', revision: 1, channels: [] }],
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update channel groups');
    });
  });
});
