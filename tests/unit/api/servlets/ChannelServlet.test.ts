/**
 * ChannelServlet Unit Tests
 *
 * Tests for channel CRUD endpoints including:
 * - Get all channels (with query filters)
 * - Get channel by ID (JSON and XML)
 * - Get channel IDs and names
 * - Get channel summaries
 * - Create channel (with conflict/override)
 * - Update channel (with revision check)
 * - Delete single and multiple channels
 * - Remove all messages (DELETE and POST variants)
 * - Set initial state (bulk and single)
 * - Enable/disable channels (bulk and single)
 * - Get connector names
 * - Get metadata columns
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

// Mock operations used by ChannelServlet
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CHANNEL_GET_CHANNELS: { name: 'getChannels' },
  CHANNEL_GET_CHANNEL: { name: 'getChannel' },
  CHANNEL_GET_CHANNEL_SUMMARY: { name: 'getChannelSummary' },
  CHANNEL_CREATE: { name: 'createChannel' },
  CHANNEL_UPDATE: { name: 'updateChannel' },
  CHANNEL_REMOVE: { name: 'removeChannel' },
  CHANNEL_GET_IDS_AND_NAMES: { name: 'getChannelIdsAndNames' },
  MESSAGE_REMOVE_ALL: { name: 'removeAllMessages' },
}));

// Mock ChannelController
jest.mock('../../../../src/controllers/ChannelController.js', () => ({
  ChannelController: {
    getChannel: jest.fn(),
    getAllChannels: jest.fn(),
    getChannelXml: jest.fn(),
    getCodeTemplateLibraries: jest.fn(),
    getChannelSummaries: jest.fn(),
    getChannelIdsAndNames: jest.fn(),
    createChannel: jest.fn(),
    createChannelWithXml: jest.fn(),
    updateChannel: jest.fn(),
    updateChannelWithXml: jest.fn(),
    deleteChannel: jest.fn(),
    setChannelEnabled: jest.fn(),
  },
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
import { channelRouter } from '../../../../src/api/servlets/ChannelServlet.js';
import { ChannelController } from '../../../../src/controllers/ChannelController.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TEST_CHANNEL_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
const TEST_CHANNEL_ID_2 = '11112222-3333-4444-5555-666677778888';

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_CHANNEL_ID,
    name: 'Test Channel',
    description: 'A test channel',
    revision: 1,
    enabled: true,
    sourceConnector: {
      metaDataId: 0,
      name: 'Source',
      enabled: true,
      transportName: 'TCP Listener',
      properties: {},
    },
    destinationConnectors: [
      {
        metaDataId: 1,
        name: 'HTTP Sender',
        enabled: true,
        transportName: 'HTTP Sender',
        properties: {},
      },
    ],
    properties: {
      initialState: 'STARTED',
      metaDataColumns: [],
    },
    ...overrides,
  };
}

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: ['application/xml', 'text/xml'] }));

  // Add sendData helper matching the real app
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, status?: number) {
      if (status) this.status(status);
      this.json(data);
    };
    next();
  });

  app.use('/channels', channelRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('ChannelServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /channels — get all channels
  // ==========================================================================

  describe('GET /channels', () => {
    it('should return all channels', async () => {
      const channels = [makeChannel(), makeChannel({ id: TEST_CHANNEL_ID_2, name: 'Second Channel' })];
      (ChannelController.getAllChannels as jest.Mock).mockResolvedValueOnce(channels);

      const response = await request(app).get('/channels');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(TEST_CHANNEL_ID);
      expect(response.body[1].id).toBe(TEST_CHANNEL_ID_2);
    });

    it('should filter by channelId query parameter', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app).get(`/channels?channelId=${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(TEST_CHANNEL_ID);
      expect(ChannelController.getChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should filter by multiple channelId query parameters', async () => {
      const ch1 = makeChannel();
      const ch2 = makeChannel({ id: TEST_CHANNEL_ID_2, name: 'Second' });
      (ChannelController.getChannel as jest.Mock)
        .mockResolvedValueOnce(ch1)
        .mockResolvedValueOnce(ch2);

      const response = await request(app)
        .get(`/channels?channelId=${TEST_CHANNEL_ID}&channelId=${TEST_CHANNEL_ID_2}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should filter pollingOnly channels', async () => {
      const pollingChannel = makeChannel({
        sourceConnector: { metaDataId: 0, name: 'Source', enabled: true, transportName: 'File Reader', properties: {} },
      });
      const nonPollingChannel = makeChannel({ id: TEST_CHANNEL_ID_2, name: 'TCP Channel' });
      (ChannelController.getAllChannels as jest.Mock).mockResolvedValueOnce([pollingChannel, nonPollingChannel]);

      const response = await request(app).get('/channels?pollingOnly=true');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].sourceConnector.transportName).toBe('File Reader');
    });

    it('should include code template libraries when requested', async () => {
      const channel = makeChannel();
      (ChannelController.getAllChannels as jest.Mock).mockResolvedValueOnce([channel]);
      (ChannelController.getCodeTemplateLibraries as jest.Mock).mockResolvedValueOnce(['lib1']);

      const response = await request(app).get('/channels?includeCodeTemplateLibraries=true');

      expect(response.status).toBe(200);
      expect(response.body[0].codeTemplateLibraries).toEqual(['lib1']);
      expect(ChannelController.getCodeTemplateLibraries).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });
  });

  // ==========================================================================
  // POST /channels/_getChannels — POST alternative for bulk channel fetch
  // ==========================================================================

  describe('POST /channels/_getChannels', () => {
    it('should return channels by IDs in POST body', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app)
        .post('/channels/_getChannels')
        .send([TEST_CHANNEL_ID]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(TEST_CHANNEL_ID);
    });

    it('should return all channels when body is empty array', async () => {
      const channels = [makeChannel()];
      (ChannelController.getAllChannels as jest.Mock).mockResolvedValueOnce(channels);

      const response = await request(app)
        .post('/channels/_getChannels')
        .send([]);

      expect(response.status).toBe(200);
      expect(ChannelController.getAllChannels).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // GET /channels/idsAndNames — channel ID/name map
  // ==========================================================================

  describe('GET /channels/idsAndNames', () => {
    it('should return a map of channel IDs to names', async () => {
      const idsAndNames = {
        [TEST_CHANNEL_ID]: 'Test Channel',
        [TEST_CHANNEL_ID_2]: 'Second Channel',
      };
      (ChannelController.getChannelIdsAndNames as jest.Mock).mockResolvedValueOnce(idsAndNames);

      const response = await request(app).get('/channels/idsAndNames');

      expect(response.status).toBe(200);
      expect(response.body[TEST_CHANNEL_ID]).toBe('Test Channel');
      expect(response.body[TEST_CHANNEL_ID_2]).toBe('Second Channel');
    });
  });

  // ==========================================================================
  // GET /channels/:channelId — get single channel
  // ==========================================================================

  describe('GET /channels/:channelId', () => {
    it('should return a channel as JSON', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(TEST_CHANNEL_ID);
      expect(response.body.name).toBe('Test Channel');
      expect(response.body.revision).toBe(1);
    });

    it('should return 404 when channel not found', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });

    it('should return channel XML when Accept header is application/xml', async () => {
      const xml = '<channel><id>test</id></channel>';
      (ChannelController.getChannelXml as jest.Mock).mockResolvedValueOnce(xml);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}`)
        .set('Accept', 'application/xml');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/xml');
      expect(response.text).toBe(xml);
    });

    it('should return 404 for XML request when channel not found', async () => {
      (ChannelController.getChannelXml as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}`)
        .set('Accept', 'application/xml');

      expect(response.status).toBe(404);
    });

    it('should include code template libraries when requested', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);
      (ChannelController.getCodeTemplateLibraries as jest.Mock).mockResolvedValueOnce(['lib-a']);

      const response = await request(app)
        .get(`/channels/${TEST_CHANNEL_ID}?includeCodeTemplateLibraries=true`);

      expect(response.status).toBe(200);
      expect(response.body.codeTemplateLibraries).toEqual(['lib-a']);
    });
  });

  // ==========================================================================
  // POST /channels/_getSummary — channel summaries
  // ==========================================================================

  describe('POST /channels/_getSummary', () => {
    it('should return channel summaries', async () => {
      const summaries = [{ channelId: TEST_CHANNEL_ID, added: true, removed: false }];
      (ChannelController.getChannelSummaries as jest.Mock).mockResolvedValueOnce(summaries);

      const response = await request(app)
        .post('/channels/_getSummary')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].channelId).toBe(TEST_CHANNEL_ID);
    });

    it('should pass ignoreNewChannels flag to controller', async () => {
      (ChannelController.getChannelSummaries as jest.Mock).mockResolvedValueOnce([]);

      await request(app)
        .post('/channels/_getSummary?ignoreNewChannels=true')
        .send({ [TEST_CHANNEL_ID]: { revision: 1 } });

      expect(ChannelController.getChannelSummaries).toHaveBeenCalledWith(
        { [TEST_CHANNEL_ID]: { revision: 1 } },
        true
      );
    });
  });

  // ==========================================================================
  // POST /channels — create channel
  // ==========================================================================

  describe('POST /channels', () => {
    it('should create a new channel and return 201', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null); // no existing
      (ChannelController.createChannelWithXml as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/channels')
        .send({ id: TEST_CHANNEL_ID, name: 'New Channel' });

      expect(response.status).toBe(201);
      expect(response.body).toBe(true);
      expect(ChannelController.createChannelWithXml).toHaveBeenCalledWith(
        expect.objectContaining({ id: TEST_CHANNEL_ID, name: 'New Channel' }),
        undefined
      );
    });

    it('should generate an ID when none is provided', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);
      (ChannelController.createChannelWithXml as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/channels')
        .send({ name: 'Auto-ID Channel' });

      expect(response.status).toBe(201);
      expect(ChannelController.createChannelWithXml).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Auto-ID Channel', id: expect.any(String) }),
        undefined
      );
    });

    it('should return 400 when channel name is missing', async () => {
      const response = await request(app)
        .post('/channels')
        .send({ id: TEST_CHANNEL_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel name is required');
    });

    it('should return 409 when channel already exists without override', async () => {
      const existing = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);

      const response = await request(app)
        .post('/channels')
        .send({ id: TEST_CHANNEL_ID, name: 'Test Channel' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Channel already exists');
    });

    it('should update existing channel when override=true', async () => {
      const existing = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);
      (ChannelController.updateChannelWithXml as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/channels?override=true')
        .send({ id: TEST_CHANNEL_ID, name: 'Updated Channel' });

      expect(response.status).toBe(200);
      expect(ChannelController.updateChannelWithXml).toHaveBeenCalledWith(
        TEST_CHANNEL_ID,
        expect.objectContaining({ name: 'Updated Channel' }),
        undefined
      );
    });
  });

  // ==========================================================================
  // PUT /channels/:channelId — update channel
  // ==========================================================================

  describe('PUT /channels/:channelId', () => {
    it('should update a channel successfully', async () => {
      const existing = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);
      (ChannelController.updateChannel as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}`)
        .send({ id: TEST_CHANNEL_ID, name: 'Updated Name', revision: 1 });

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
      expect(ChannelController.updateChannel).toHaveBeenCalledWith(
        TEST_CHANNEL_ID,
        expect.objectContaining({ name: 'Updated Name' })
      );
    });

    it('should return 404 when channel does not exist', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}`)
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });

    it('should return 409 when revision is stale', async () => {
      const existing = makeChannel({ revision: 5 });
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}`)
        .send({ name: 'Updated', revision: 3 }); // stale revision

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Channel has been modified');
    });

    it('should skip revision check when override=true', async () => {
      const existing = makeChannel({ revision: 5 });
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);
      (ChannelController.updateChannel as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .put(`/channels/${TEST_CHANNEL_ID}?override=true`)
        .send({ name: 'Force Update', revision: 1 }); // wrong revision but override=true

      expect(response.status).toBe(200);
      expect(ChannelController.updateChannel).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // DELETE /channels/:channelId — delete single channel
  // ==========================================================================

  describe('DELETE /channels/:channelId', () => {
    it('should delete a channel and return 204', async () => {
      const existing = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(existing);
      (ChannelController.deleteChannel as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await request(app).delete(`/channels/${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(204);
      expect(ChannelController.deleteChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 404 when channel does not exist', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).delete(`/channels/${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });
  });

  // ==========================================================================
  // DELETE /channels — delete multiple channels via query param
  // ==========================================================================

  describe('DELETE /channels (bulk via query param)', () => {
    it('should delete multiple channels by channelId query params', async () => {
      (ChannelController.deleteChannel as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .delete(`/channels?channelId=${TEST_CHANNEL_ID}&channelId=${TEST_CHANNEL_ID_2}`);

      expect(response.status).toBe(204);
      expect(ChannelController.deleteChannel).toHaveBeenCalledTimes(2);
      expect(ChannelController.deleteChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(ChannelController.deleteChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should return 400 when no channelId query params provided', async () => {
      const response = await request(app).delete('/channels');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel IDs required');
    });
  });

  // ==========================================================================
  // POST /channels/_removeChannels — delete multiple via POST body
  // ==========================================================================

  describe('POST /channels/_removeChannels', () => {
    it('should delete channels from POST body array', async () => {
      (ChannelController.deleteChannel as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_removeChannels')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(204);
      expect(ChannelController.deleteChannel).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when body is not an array', async () => {
      const response = await request(app)
        .post('/channels/_removeChannels')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel IDs required');
    });
  });

  // ==========================================================================
  // DELETE /channels/_removeAllMessages — truncate message tables
  // ==========================================================================

  describe('DELETE /channels/_removeAllMessages', () => {
    const TABLE_ID = TEST_CHANNEL_ID.replace(/-/g, '_');

    it('should truncate message tables for the specified channel', async () => {
      // Mock the table exists check
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME: `D_M${TABLE_ID}` }], []]);
      // Mock TRUNCATE executes (D_MC, D_MA, D_MM, D_M)
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        // Stats UPDATE
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .delete(`/channels/_removeAllMessages?channelId=${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledWith(`TRUNCATE TABLE D_MC${TABLE_ID}`);
      expect(mockPool.execute).toHaveBeenCalledWith(`TRUNCATE TABLE D_MA${TABLE_ID}`);
      expect(mockPool.execute).toHaveBeenCalledWith(`TRUNCATE TABLE D_MM${TABLE_ID}`);
      expect(mockPool.execute).toHaveBeenCalledWith(`TRUNCATE TABLE D_M${TABLE_ID}`);
    });

    it('should skip truncate when message tables do not exist', async () => {
      // No rows returned — table does not exist
      mockPool.query.mockResolvedValueOnce([[], []]);

      const response = await request(app)
        .delete(`/channels/_removeAllMessages?channelId=${TEST_CHANNEL_ID}`);

      expect(response.status).toBe(204);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should return 400 when channelId query param is missing', async () => {
      const response = await request(app).delete('/channels/_removeAllMessages');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel IDs required');
    });

    it('should skip statistics clear when clearStatistics=false', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME: `D_M${TABLE_ID}` }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

      const response = await request(app)
        .delete(`/channels/_removeAllMessages?channelId=${TEST_CHANNEL_ID}&clearStatistics=false`);

      expect(response.status).toBe(204);
      // Stats UPDATE should NOT be called (only 4 TRUNCATE calls)
      const updateCalls = (mockPool.execute as jest.Mock).mock.calls.filter(
        (call) => (call[0] as string).startsWith('UPDATE')
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ==========================================================================
  // POST /channels/_removeAllMessagesPost — POST body variant
  // ==========================================================================

  describe('POST /channels/_removeAllMessagesPost', () => {
    const TABLE_ID = TEST_CHANNEL_ID.replace(/-/g, '_');

    it('should truncate tables using channel IDs from POST body', async () => {
      mockPool.query.mockResolvedValueOnce([[{ TABLE_NAME: `D_M${TABLE_ID}` }], []]);
      mockPool.execute
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const response = await request(app)
        .post('/channels/_removeAllMessagesPost')
        .send([TEST_CHANNEL_ID]);

      expect(response.status).toBe(204);
      expect(mockPool.execute).toHaveBeenCalledWith(`TRUNCATE TABLE D_M${TABLE_ID}`);
    });

    it('should return 400 when body is empty or not an array', async () => {
      const response = await request(app)
        .post('/channels/_removeAllMessagesPost')
        .send([]);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Channel IDs required in body');
    });
  });

  // ==========================================================================
  // POST /channels/_setInitialState — set initial state for multiple channels
  // ==========================================================================

  describe('POST /channels/_setInitialState', () => {
    it('should set initial state for specified channels', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);
      (ChannelController.updateChannel as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/channels/_setInitialState')
        .send({ channelIds: [TEST_CHANNEL_ID], initialState: 'PAUSED' });

      expect(response.status).toBe(204);
      expect(ChannelController.updateChannel).toHaveBeenCalledWith(
        TEST_CHANNEL_ID,
        expect.objectContaining({
          properties: expect.objectContaining({ initialState: 'PAUSED' }),
        })
      );
    });

    it('should return 400 when initialState is missing', async () => {
      const response = await request(app)
        .post('/channels/_setInitialState')
        .send({ channelIds: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('initialState is required');
    });

    it('should handle empty channelIds array (no-op)', async () => {
      const response = await request(app)
        .post('/channels/_setInitialState')
        .send({ channelIds: [], initialState: 'STARTED' });

      expect(response.status).toBe(204);
      expect(ChannelController.updateChannel).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/initialState/:initialState — single channel
  // ==========================================================================

  describe('POST /channels/:channelId/initialState/:initialState', () => {
    it('should set initial state for a single channel', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);
      (ChannelController.updateChannel as jest.Mock).mockResolvedValueOnce(true);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/initialState/STOPPED`);

      expect(response.status).toBe(204);
      expect(ChannelController.updateChannel).toHaveBeenCalledWith(
        TEST_CHANNEL_ID,
        expect.objectContaining({
          properties: expect.objectContaining({ initialState: 'STOPPED' }),
        })
      );
    });

    it('should return 404 when channel does not exist', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/initialState/STARTED`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });
  });

  // ==========================================================================
  // POST /channels/_setEnabled — bulk enable/disable
  // ==========================================================================

  describe('POST /channels/_setEnabled', () => {
    it('should enable specific channels by ID', async () => {
      (ChannelController.setChannelEnabled as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_setEnabled')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2], enabled: true });

      expect(response.status).toBe(204);
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledWith(TEST_CHANNEL_ID, true);
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledWith(TEST_CHANNEL_ID_2, true);
    });

    it('should disable a single channel by ID string', async () => {
      (ChannelController.setChannelEnabled as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_setEnabled')
        .send({ channelId: TEST_CHANNEL_ID, enabled: 'false' });

      expect(response.status).toBe(204);
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledWith(TEST_CHANNEL_ID, false);
    });

    it('should enable/disable all channels when no channelId given', async () => {
      const allChannels = [makeChannel(), makeChannel({ id: TEST_CHANNEL_ID_2, name: 'Ch 2' })];
      (ChannelController.getAllChannels as jest.Mock).mockResolvedValueOnce(allChannels);
      (ChannelController.setChannelEnabled as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_setEnabled')
        .send({ enabled: false });

      expect(response.status).toBe(204);
      expect(ChannelController.getAllChannels).toHaveBeenCalled();
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/enabled/:enabled — single channel enable/disable
  // ==========================================================================

  describe('POST /channels/:channelId/enabled/:enabled', () => {
    it('should enable a single channel', async () => {
      (ChannelController.setChannelEnabled as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/enabled/true`);

      expect(response.status).toBe(204);
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledWith(TEST_CHANNEL_ID, true);
    });

    it('should disable a single channel', async () => {
      (ChannelController.setChannelEnabled as jest.Mock).mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/enabled/false`);

      expect(response.status).toBe(204);
      expect(ChannelController.setChannelEnabled).toHaveBeenCalledWith(TEST_CHANNEL_ID, false);
    });
  });

  // ==========================================================================
  // GET /channels/:channelId/connectorNames — connector names map
  // ==========================================================================

  describe('GET /channels/:channelId/connectorNames', () => {
    it('should return a map of metaDataId to connector name', async () => {
      const channel = makeChannel();
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/connectorNames`);

      expect(response.status).toBe(200);
      expect(response.body[0]).toBe('Source');
      expect(response.body[1]).toBe('HTTP Sender');
    });

    it('should return 404 when channel does not exist', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/connectorNames`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });
  });

  // ==========================================================================
  // GET /channels/:channelId/metaDataColumns — metadata columns
  // ==========================================================================

  describe('GET /channels/:channelId/metaDataColumns', () => {
    it('should return metadata columns for the channel', async () => {
      const columns = [
        { name: 'PATIENT_ID', type: 'STRING' },
        { name: 'VISIT_ID', type: 'NUMBER' },
      ];
      const channel = makeChannel({ properties: { metaDataColumns: columns } });
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/metaDataColumns`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('PATIENT_ID');
    });

    it('should return empty array when no metadata columns configured', async () => {
      const channel = makeChannel({ properties: { initialState: 'STARTED' } }); // no metaDataColumns key
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(channel);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/metaDataColumns`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 404 when channel does not exist', async () => {
      (ChannelController.getChannel as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/metaDataColumns`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });
  });
});
