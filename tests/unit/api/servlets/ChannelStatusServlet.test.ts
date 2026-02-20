/**
 * ChannelStatusServlet Unit Tests
 *
 * Tests for channel status operations including:
 * - GET /:channelId/status - Get single channel status
 * - GET /statuses - Get all channel statuses (with query filters)
 * - POST /statuses/_getChannelStatusList - POST alternative for status list
 * - GET /statuses/initial - Get dashboard initial channel info
 * - POST /:channelId/_start - Start a single channel
 * - POST /_start - Start multiple channels
 * - POST /:channelId/_stop - Stop a single channel
 * - POST /_stop - Stop multiple channels
 * - POST /:channelId/_halt - Halt a single channel
 * - POST /_halt - Halt multiple channels
 * - POST /:channelId/_pause - Pause a single channel
 * - POST /_pause - Pause multiple channels
 * - POST /:channelId/_resume - Resume a single channel
 * - POST /_resume - Resume multiple channels
 * - POST /_startConnectors - Start connectors across channels
 * - POST /_stopConnectors - Stop connectors across channels
 * - POST /:channelId/connector/:metaDataId/_start - Start a single connector
 * - POST /:channelId/connector/:metaDataId/_stop - Stop a single connector
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock EngineController BEFORE importing the servlet
const mockEngineController = {
  getChannelStatus: jest.fn(),
  getChannelStatuses: jest.fn(),
  getDashboardChannelInfo: jest.fn(),
  startChannel: jest.fn(),
  stopChannel: jest.fn(),
  haltChannel: jest.fn(),
  pauseChannel: jest.fn(),
  resumeChannel: jest.fn(),
  startConnector: jest.fn(),
  stopConnector: jest.fn(),
};

jest.mock('../../../../src/controllers/EngineController.js', () => ({
  EngineController: mockEngineController,
}));

// Mock authorization
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CHANNEL_STATUS_GET: { name: 'getChannelStatus' },
  CHANNEL_STATUS_GET_ALL: { name: 'getAllChannelStatuses' },
  CHANNEL_STATUS_GET_INITIAL: { name: 'getDashboardChannelInfo' },
  CHANNEL_START: { name: 'startChannel' },
  CHANNEL_STOP: { name: 'stopChannel' },
  CHANNEL_PAUSE: { name: 'pauseChannel' },
  CHANNEL_RESUME: { name: 'resumeChannel' },
  CHANNEL_HALT: { name: 'haltChannel' },
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
import { channelStatusRouter } from '../../../../src/api/servlets/ChannelStatusServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

const TEST_CHANNEL_ID = 'ch-1111-2222-3333-444444444444';
const TEST_CHANNEL_ID_2 = 'ch-5555-6666-7777-888888888888';

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    channelId: TEST_CHANNEL_ID,
    name: 'Test Channel',
    state: 'STARTED',
    deployedDate: '2026-02-19T00:00:00.000Z',
    statistics: {
      RECEIVED: 100,
      FILTERED: 5,
      SENT: 90,
      ERROR: 5,
      QUEUED: 0,
    },
    childStatuses: [],
    ...overrides,
  };
}

function makeDashboardInfo(overrides: Record<string, unknown> = {}) {
  return {
    dashboardStatuses: [makeStatus()],
    remainingChannelIds: [],
    ...overrides,
  };
}

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Polyfill sendData like the real server provides
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, status?: number) {
      if (status) this.status(status);
      this.json(data);
    };
    next();
  });

  app.use('/channels', channelStatusRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('ChannelStatusServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /channels/:channelId/status - Get single channel status
  // ==========================================================================

  describe('GET /channels/:channelId/status', () => {
    it('should return status for a deployed channel', async () => {
      const status = makeStatus();
      mockEngineController.getChannelStatus.mockResolvedValueOnce(status);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/status`);

      expect(response.status).toBe(200);
      expect(response.body.channelId).toBe(TEST_CHANNEL_ID);
      expect(response.body.state).toBe('STARTED');
      expect(mockEngineController.getChannelStatus).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 404 when channel is not found', async () => {
      mockEngineController.getChannelStatus.mockResolvedValueOnce(null);

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/status`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Channel not found');
    });

    it('should return 500 on controller error', async () => {
      mockEngineController.getChannelStatus.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get(`/channels/${TEST_CHANNEL_ID}/status`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get channel status');
    });
  });

  // ==========================================================================
  // GET /channels/statuses - Get all channel statuses
  // ==========================================================================

  describe('GET /channels/statuses', () => {
    it('should return all channel statuses', async () => {
      const statuses = [makeStatus(), makeStatus({ channelId: TEST_CHANNEL_ID_2, name: 'Second' })];
      mockEngineController.getChannelStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app).get('/channels/statuses');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        undefined,
        undefined,
        false
      );
    });

    it('should filter by a single channelId query parameter', async () => {
      const statuses = [makeStatus()];
      mockEngineController.getChannelStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app).get(
        `/channels/statuses?channelId=${TEST_CHANNEL_ID}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        [TEST_CHANNEL_ID],
        undefined,
        false
      );
    });

    it('should filter by multiple channelId query parameters', async () => {
      const statuses = [makeStatus(), makeStatus({ channelId: TEST_CHANNEL_ID_2 })];
      mockEngineController.getChannelStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app).get(
        `/channels/statuses?channelId=${TEST_CHANNEL_ID}&channelId=${TEST_CHANNEL_ID_2}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2],
        undefined,
        false
      );
    });

    it('should pass filter query parameter', async () => {
      mockEngineController.getChannelStatuses.mockResolvedValueOnce([]);

      const response = await request(app).get('/channels/statuses?filter=ADT');

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        undefined,
        'ADT',
        false
      );
    });

    it('should pass includeUndeployed=true query parameter', async () => {
      mockEngineController.getChannelStatuses.mockResolvedValueOnce([]);

      const response = await request(app).get(
        '/channels/statuses?includeUndeployed=true'
      );

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        undefined,
        undefined,
        true
      );
    });

    it('should treat includeUndeployed=false as false', async () => {
      mockEngineController.getChannelStatuses.mockResolvedValueOnce([]);

      const response = await request(app).get(
        '/channels/statuses?includeUndeployed=false'
      );

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        undefined,
        undefined,
        false
      );
    });

    it('should combine filter, channelId, and includeUndeployed', async () => {
      mockEngineController.getChannelStatuses.mockResolvedValueOnce([]);

      const response = await request(app).get(
        `/channels/statuses?channelId=${TEST_CHANNEL_ID}&filter=ADT&includeUndeployed=true`
      );

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        [TEST_CHANNEL_ID],
        'ADT',
        true
      );
    });

    it('should return 500 on controller error', async () => {
      mockEngineController.getChannelStatuses.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/channels/statuses');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get channel statuses');
    });
  });

  // ==========================================================================
  // POST /channels/statuses/_getChannelStatusList - POST alternative
  // ==========================================================================

  describe('POST /channels/statuses/_getChannelStatusList', () => {
    it('should return statuses for channel IDs in POST body', async () => {
      const statuses = [makeStatus()];
      mockEngineController.getChannelStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app)
        .post('/channels/statuses/_getChannelStatusList')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2],
        undefined,
        false
      );
    });

    it('should get all statuses when body is not an array', async () => {
      const statuses = [makeStatus()];
      mockEngineController.getChannelStatuses.mockResolvedValueOnce(statuses);

      const response = await request(app)
        .post('/channels/statuses/_getChannelStatusList')
        .send({ notAnArray: true });

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        undefined,
        undefined,
        false
      );
    });

    it('should pass filter and includeUndeployed from query params', async () => {
      mockEngineController.getChannelStatuses.mockResolvedValueOnce([]);

      const response = await request(app)
        .post('/channels/statuses/_getChannelStatusList?filter=HL7&includeUndeployed=true')
        .send([TEST_CHANNEL_ID]);

      expect(response.status).toBe(200);
      expect(mockEngineController.getChannelStatuses).toHaveBeenCalledWith(
        [TEST_CHANNEL_ID],
        'HL7',
        true
      );
    });

    it('should return 500 on controller error', async () => {
      mockEngineController.getChannelStatuses.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/channels/statuses/_getChannelStatusList')
        .send([]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get channel statuses');
    });
  });

  // ==========================================================================
  // GET /channels/statuses/initial - Dashboard initial info
  // ==========================================================================

  describe('GET /channels/statuses/initial', () => {
    it('should return dashboard channel info with default fetchSize', async () => {
      const info = makeDashboardInfo();
      mockEngineController.getDashboardChannelInfo.mockResolvedValueOnce(info);

      const response = await request(app).get('/channels/statuses/initial');

      expect(response.status).toBe(200);
      expect(response.body.dashboardStatuses).toHaveLength(1);
      expect(response.body.remainingChannelIds).toEqual([]);
      expect(mockEngineController.getDashboardChannelInfo).toHaveBeenCalledWith(100, undefined);
    });

    it('should pass custom fetchSize', async () => {
      const info = makeDashboardInfo();
      mockEngineController.getDashboardChannelInfo.mockResolvedValueOnce(info);

      const response = await request(app).get('/channels/statuses/initial?fetchSize=50');

      expect(response.status).toBe(200);
      expect(mockEngineController.getDashboardChannelInfo).toHaveBeenCalledWith(50, undefined);
    });

    it('should pass filter query parameter', async () => {
      const info = makeDashboardInfo();
      mockEngineController.getDashboardChannelInfo.mockResolvedValueOnce(info);

      const response = await request(app).get(
        '/channels/statuses/initial?fetchSize=25&filter=ADT'
      );

      expect(response.status).toBe(200);
      expect(mockEngineController.getDashboardChannelInfo).toHaveBeenCalledWith(25, 'ADT');
    });

    it('should default fetchSize to 100 when not a number', async () => {
      const info = makeDashboardInfo();
      mockEngineController.getDashboardChannelInfo.mockResolvedValueOnce(info);

      const response = await request(app).get(
        '/channels/statuses/initial?fetchSize=notANumber'
      );

      expect(response.status).toBe(200);
      expect(mockEngineController.getDashboardChannelInfo).toHaveBeenCalledWith(100, undefined);
    });

    it('should return 500 on controller error', async () => {
      mockEngineController.getDashboardChannelInfo.mockRejectedValueOnce(
        new Error('DB error')
      );

      const response = await request(app).get('/channels/statuses/initial');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get dashboard channel info');
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/_start - Start single channel
  // ==========================================================================

  describe('POST /channels/:channelId/_start', () => {
    it('should start a channel and return 204', async () => {
      mockEngineController.startChannel.mockResolvedValueOnce(undefined);

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_start`);

      expect(response.status).toBe(204);
      expect(mockEngineController.startChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.startChannel.mockRejectedValueOnce(
        new Error('Channel not deployed')
      );

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_start`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.startChannel.mockRejectedValueOnce(
        new Error('Channel not deployed')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_start?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Channel not deployed');
    });

    it('should return 204 on error when returnErrors=false', async () => {
      mockEngineController.startChannel.mockRejectedValueOnce(
        new Error('Channel not deployed')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_start?returnErrors=false`
      );

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // POST /channels/_start - Start multiple channels
  // ==========================================================================

  describe('POST /channels/_start', () => {
    it('should start multiple channels and return 204', async () => {
      mockEngineController.startChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_start')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] });

      expect(response.status).toBe(204);
      expect(mockEngineController.startChannel).toHaveBeenCalledTimes(2);
      expect(mockEngineController.startChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockEngineController.startChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should handle a single channelId (non-array) in body', async () => {
      mockEngineController.startChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_start')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(204);
      expect(mockEngineController.startChannel).toHaveBeenCalledTimes(1);
      expect(mockEngineController.startChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should handle empty channelId gracefully', async () => {
      const response = await request(app)
        .post('/channels/_start')
        .send({});

      expect(response.status).toBe(204);
      expect(mockEngineController.startChannel).not.toHaveBeenCalled();
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.startChannel.mockRejectedValueOnce(new Error('Start failed'));

      const response = await request(app)
        .post('/channels/_start')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.startChannel.mockRejectedValueOnce(new Error('Start failed'));

      const response = await request(app)
        .post('/channels/_start?returnErrors=true')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Start failed');
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/_stop - Stop single channel
  // ==========================================================================

  describe('POST /channels/:channelId/_stop', () => {
    it('should stop a channel and return 204', async () => {
      mockEngineController.stopChannel.mockResolvedValueOnce(undefined);

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_stop`);

      expect(response.status).toBe(204);
      expect(mockEngineController.stopChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.stopChannel.mockRejectedValueOnce(new Error('Stop failed'));

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_stop`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.stopChannel.mockRejectedValueOnce(new Error('Stop failed'));

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_stop?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Stop failed');
    });
  });

  // ==========================================================================
  // POST /channels/_stop - Stop multiple channels
  // ==========================================================================

  describe('POST /channels/_stop', () => {
    it('should stop multiple channels and return 204', async () => {
      mockEngineController.stopChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_stop')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] });

      expect(response.status).toBe(204);
      expect(mockEngineController.stopChannel).toHaveBeenCalledTimes(2);
      expect(mockEngineController.stopChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockEngineController.stopChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should handle a single channelId (non-array) in body', async () => {
      mockEngineController.stopChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_stop')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(204);
      expect(mockEngineController.stopChannel).toHaveBeenCalledTimes(1);
    });

    it('should handle empty body gracefully', async () => {
      const response = await request(app)
        .post('/channels/_stop')
        .send({});

      expect(response.status).toBe(204);
      expect(mockEngineController.stopChannel).not.toHaveBeenCalled();
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.stopChannel.mockRejectedValueOnce(new Error('Stop all failed'));

      const response = await request(app)
        .post('/channels/_stop?returnErrors=true')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Stop all failed');
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.stopChannel.mockRejectedValueOnce(new Error('Stop all failed'));

      const response = await request(app)
        .post('/channels/_stop')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/_halt - Halt single channel
  // ==========================================================================

  describe('POST /channels/:channelId/_halt', () => {
    it('should halt a channel and return 204', async () => {
      mockEngineController.haltChannel.mockResolvedValueOnce(undefined);

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_halt`);

      expect(response.status).toBe(204);
      expect(mockEngineController.haltChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.haltChannel.mockRejectedValueOnce(new Error('Halt failed'));

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_halt`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.haltChannel.mockRejectedValueOnce(new Error('Halt failed'));

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_halt?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Halt failed');
    });
  });

  // ==========================================================================
  // POST /channels/_halt - Halt multiple channels
  // ==========================================================================

  describe('POST /channels/_halt', () => {
    it('should halt multiple channels and return 204', async () => {
      mockEngineController.haltChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_halt')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] });

      expect(response.status).toBe(204);
      expect(mockEngineController.haltChannel).toHaveBeenCalledTimes(2);
      expect(mockEngineController.haltChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockEngineController.haltChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should handle a single channelId (non-array) in body', async () => {
      mockEngineController.haltChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_halt')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(204);
      expect(mockEngineController.haltChannel).toHaveBeenCalledTimes(1);
    });

    it('should handle empty body gracefully', async () => {
      const response = await request(app)
        .post('/channels/_halt')
        .send({});

      expect(response.status).toBe(204);
      expect(mockEngineController.haltChannel).not.toHaveBeenCalled();
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.haltChannel.mockRejectedValueOnce(new Error('Halt all failed'));

      const response = await request(app)
        .post('/channels/_halt?returnErrors=true')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Halt all failed');
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.haltChannel.mockRejectedValueOnce(new Error('Halt all failed'));

      const response = await request(app)
        .post('/channels/_halt')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/_pause - Pause single channel
  // ==========================================================================

  describe('POST /channels/:channelId/_pause', () => {
    it('should pause a channel and return 204', async () => {
      mockEngineController.pauseChannel.mockResolvedValueOnce(undefined);

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_pause`);

      expect(response.status).toBe(204);
      expect(mockEngineController.pauseChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.pauseChannel.mockRejectedValueOnce(new Error('Pause failed'));

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_pause`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.pauseChannel.mockRejectedValueOnce(new Error('Pause failed'));

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_pause?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Pause failed');
    });
  });

  // ==========================================================================
  // POST /channels/_pause - Pause multiple channels
  // ==========================================================================

  describe('POST /channels/_pause', () => {
    it('should pause multiple channels and return 204', async () => {
      mockEngineController.pauseChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_pause')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] });

      expect(response.status).toBe(204);
      expect(mockEngineController.pauseChannel).toHaveBeenCalledTimes(2);
      expect(mockEngineController.pauseChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockEngineController.pauseChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should handle a single channelId (non-array) in body', async () => {
      mockEngineController.pauseChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_pause')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(204);
      expect(mockEngineController.pauseChannel).toHaveBeenCalledTimes(1);
    });

    it('should handle empty body gracefully', async () => {
      const response = await request(app)
        .post('/channels/_pause')
        .send({});

      expect(response.status).toBe(204);
      expect(mockEngineController.pauseChannel).not.toHaveBeenCalled();
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.pauseChannel.mockRejectedValueOnce(new Error('Pause all failed'));

      const response = await request(app)
        .post('/channels/_pause?returnErrors=true')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Pause all failed');
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.pauseChannel.mockRejectedValueOnce(new Error('Pause all failed'));

      const response = await request(app)
        .post('/channels/_pause')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/_resume - Resume single channel
  // ==========================================================================

  describe('POST /channels/:channelId/_resume', () => {
    it('should resume a channel and return 204', async () => {
      mockEngineController.resumeChannel.mockResolvedValueOnce(undefined);

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_resume`);

      expect(response.status).toBe(204);
      expect(mockEngineController.resumeChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.resumeChannel.mockRejectedValueOnce(new Error('Resume failed'));

      const response = await request(app).post(`/channels/${TEST_CHANNEL_ID}/_resume`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error message when returnErrors=true', async () => {
      mockEngineController.resumeChannel.mockRejectedValueOnce(new Error('Resume failed'));

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/_resume?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Resume failed');
    });
  });

  // ==========================================================================
  // POST /channels/_resume - Resume multiple channels
  // ==========================================================================

  describe('POST /channels/_resume', () => {
    it('should resume multiple channels and return 204', async () => {
      mockEngineController.resumeChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_resume')
        .send({ channelId: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] });

      expect(response.status).toBe(204);
      expect(mockEngineController.resumeChannel).toHaveBeenCalledTimes(2);
      expect(mockEngineController.resumeChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockEngineController.resumeChannel).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should handle a single channelId (non-array) in body', async () => {
      mockEngineController.resumeChannel.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_resume')
        .send({ channelId: TEST_CHANNEL_ID });

      expect(response.status).toBe(204);
      expect(mockEngineController.resumeChannel).toHaveBeenCalledTimes(1);
    });

    it('should handle empty body gracefully', async () => {
      const response = await request(app)
        .post('/channels/_resume')
        .send({});

      expect(response.status).toBe(204);
      expect(mockEngineController.resumeChannel).not.toHaveBeenCalled();
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.resumeChannel.mockRejectedValueOnce(
        new Error('Resume all failed')
      );

      const response = await request(app)
        .post('/channels/_resume?returnErrors=true')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Resume all failed');
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.resumeChannel.mockRejectedValueOnce(
        new Error('Resume all failed')
      );

      const response = await request(app)
        .post('/channels/_resume')
        .send({ channelId: [TEST_CHANNEL_ID] });

      expect(response.status).toBe(204);
    });
  });

  // ==========================================================================
  // POST /channels/_startConnectors - Start connectors across channels
  // ==========================================================================

  describe('POST /channels/_startConnectors', () => {
    it('should start connectors and return 204', async () => {
      mockEngineController.startConnector.mockResolvedValue(undefined);

      const entries = [
        { channelId: TEST_CHANNEL_ID, metaDataId: 0 },
        { channelId: TEST_CHANNEL_ID, metaDataId: 1 },
        { channelId: TEST_CHANNEL_ID_2, metaDataId: 0 },
      ];

      const response = await request(app)
        .post('/channels/_startConnectors')
        .send(entries);

      expect(response.status).toBe(204);
      expect(mockEngineController.startConnector).toHaveBeenCalledTimes(3);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 0);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 1);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID_2, 0);
    });

    it('should return 400 when body is not an array', async () => {
      const response = await request(app)
        .post('/channels/_startConnectors')
        .send({ channelId: TEST_CHANNEL_ID, metaDataId: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Array of {channelId, metaDataId} required');
      expect(mockEngineController.startConnector).not.toHaveBeenCalled();
    });

    it('should handle an empty array and return 204', async () => {
      const response = await request(app)
        .post('/channels/_startConnectors')
        .send([]);

      expect(response.status).toBe(204);
      expect(mockEngineController.startConnector).not.toHaveBeenCalled();
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.startConnector.mockRejectedValueOnce(
        new Error('Connector not found')
      );

      const response = await request(app)
        .post('/channels/_startConnectors')
        .send([{ channelId: TEST_CHANNEL_ID, metaDataId: 0 }]);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.startConnector.mockRejectedValueOnce(
        new Error('Connector not found')
      );

      const response = await request(app)
        .post('/channels/_startConnectors?returnErrors=true')
        .send([{ channelId: TEST_CHANNEL_ID, metaDataId: 0 }]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Connector not found');
    });
  });

  // ==========================================================================
  // POST /channels/_stopConnectors - Stop connectors across channels
  // ==========================================================================

  describe('POST /channels/_stopConnectors', () => {
    it('should stop connectors and return 204', async () => {
      mockEngineController.stopConnector.mockResolvedValue(undefined);

      const entries = [
        { channelId: TEST_CHANNEL_ID, metaDataId: 1 },
        { channelId: TEST_CHANNEL_ID_2, metaDataId: 2 },
      ];

      const response = await request(app)
        .post('/channels/_stopConnectors')
        .send(entries);

      expect(response.status).toBe(204);
      expect(mockEngineController.stopConnector).toHaveBeenCalledTimes(2);
      expect(mockEngineController.stopConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 1);
      expect(mockEngineController.stopConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID_2, 2);
    });

    it('should return 400 when body is not an array', async () => {
      const response = await request(app)
        .post('/channels/_stopConnectors')
        .send({ channelId: TEST_CHANNEL_ID, metaDataId: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Array of {channelId, metaDataId} required');
      expect(mockEngineController.stopConnector).not.toHaveBeenCalled();
    });

    it('should handle an empty array and return 204', async () => {
      const response = await request(app)
        .post('/channels/_stopConnectors')
        .send([]);

      expect(response.status).toBe(204);
      expect(mockEngineController.stopConnector).not.toHaveBeenCalled();
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.stopConnector.mockRejectedValueOnce(
        new Error('Connector stop failed')
      );

      const response = await request(app)
        .post('/channels/_stopConnectors')
        .send([{ channelId: TEST_CHANNEL_ID, metaDataId: 0 }]);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.stopConnector.mockRejectedValueOnce(
        new Error('Connector stop failed')
      );

      const response = await request(app)
        .post('/channels/_stopConnectors?returnErrors=true')
        .send([{ channelId: TEST_CHANNEL_ID, metaDataId: 0 }]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Connector stop failed');
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/connector/:metaDataId/_start - Start connector
  // ==========================================================================

  describe('POST /channels/:channelId/connector/:metaDataId/_start', () => {
    it('should start a connector and return 204', async () => {
      mockEngineController.startConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_start`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 1);
    });

    it('should parse metaDataId as integer', async () => {
      mockEngineController.startConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/3/_start`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 3);
    });

    it('should start source connector with metaDataId 0', async () => {
      mockEngineController.startConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/0/_start`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.startConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 0);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.startConnector.mockRejectedValueOnce(
        new Error('Connector not found')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_start`
      );

      expect(response.status).toBe(204);
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.startConnector.mockRejectedValueOnce(
        new Error('Connector not found')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_start?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Connector not found');
    });
  });

  // ==========================================================================
  // POST /channels/:channelId/connector/:metaDataId/_stop - Stop connector
  // ==========================================================================

  describe('POST /channels/:channelId/connector/:metaDataId/_stop', () => {
    it('should stop a connector and return 204', async () => {
      mockEngineController.stopConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_stop`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.stopConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 1);
    });

    it('should parse metaDataId as integer', async () => {
      mockEngineController.stopConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/5/_stop`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.stopConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 5);
    });

    it('should stop source connector with metaDataId 0', async () => {
      mockEngineController.stopConnector.mockResolvedValueOnce(undefined);

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/0/_stop`
      );

      expect(response.status).toBe(204);
      expect(mockEngineController.stopConnector).toHaveBeenCalledWith(TEST_CHANNEL_ID, 0);
    });

    it('should return 204 on error when returnErrors is not set', async () => {
      mockEngineController.stopConnector.mockRejectedValueOnce(
        new Error('Connector stop failed')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_stop`
      );

      expect(response.status).toBe(204);
    });

    it('should return 500 with error when returnErrors=true', async () => {
      mockEngineController.stopConnector.mockRejectedValueOnce(
        new Error('Connector stop failed')
      );

      const response = await request(app).post(
        `/channels/${TEST_CHANNEL_ID}/connector/1/_stop?returnErrors=true`
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Connector stop failed');
    });
  });
});
