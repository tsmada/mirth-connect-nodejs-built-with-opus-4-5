/**
 * EngineServlet Unit Tests
 *
 * Tests for channel deployment endpoints including:
 * - Single channel deploy/undeploy
 * - Batch channel deploy/undeploy (JSON array and XML formats)
 * - Redeploy all channels
 * - extractChannelIds() XML body parsing
 * - returnErrors query parameter behavior
 * - Error handling (success-silent vs. error-surface)
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock authorization — must passthrough to actual route handlers
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name })),
}));

// Mock operations used by EngineServlet
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  ENGINE_DEPLOY: { name: 'deployChannels' },
  ENGINE_UNDEPLOY: { name: 'undeployChannels' },
  ENGINE_REDEPLOY_ALL: { name: 'redeployAllChannels' },
}));

// Mock EngineController — all methods are async and return void on success
jest.mock('../../../../src/controllers/EngineController.js', () => ({
  EngineController: {
    deployChannel: jest.fn(),
    undeployChannel: jest.fn(),
    deployAllChannels: jest.fn(),
    undeployAllChannels: jest.fn(),
    redeployAllChannels: jest.fn(),
  },
}));

// Mock logging — prevent Winston setup / file I/O in test environment
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  registerComponent: jest.fn(),
}));

// Import Express and servlet AFTER mocks are registered
import express, { Express } from 'express';
import { engineRouter } from '../../../../src/api/servlets/EngineServlet.js';
import { EngineController } from '../../../../src/controllers/EngineController.js';

// Typed access to jest mock functions for EngineController
const mockDeploy = EngineController.deployChannel as jest.Mock;
const mockUndeploy = EngineController.undeployChannel as jest.Mock;
const mockDeployAll = EngineController.deployAllChannels as jest.Mock;
const mockUndeployAll = EngineController.undeployAllChannels as jest.Mock;
const mockRedeployAll = EngineController.redeployAllChannels as jest.Mock;

const TEST_CHANNEL_ID = '12345678-1234-1234-1234-123456789abc';
const TEST_CHANNEL_ID_2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * Create a minimal Express app that mirrors the real server setup:
 * - JSON body parser
 * - XML body parser (application/xml → parsed object via express-xml-bodyparser or similar)
 * - res.sendData() helper
 * - engineRouter mounted at /channels
 */
function createTestApp(): Express {
  const app = express();

  // Standard body parsers that the real app uses
  app.use(express.json());
  app.use(express.text({ type: 'application/xml' }));

  // Add res.sendData helper matching the real server
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown) {
      this.json(data);
    };
    next();
  });

  // Mount the engine router — same path as the real server
  app.use('/channels', engineRouter);

  return app;
}

describe('EngineServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // POST /channels/_redeployAll
  // ============================================================================

  describe('POST /channels/_redeployAll', () => {
    it('should redeploy all channels and return 204', async () => {
      mockRedeployAll.mockResolvedValueOnce(undefined);

      const response = await request(app).post('/channels/_redeployAll');

      expect(response.status).toBe(204);
      expect(mockRedeployAll).toHaveBeenCalledTimes(1);
    });

    it('should return 204 even on error when returnErrors is not set', async () => {
      mockRedeployAll.mockRejectedValueOnce(new Error('Redeploy failed'));

      const response = await request(app).post('/channels/_redeployAll');

      expect(response.status).toBe(204);
      expect(mockRedeployAll).toHaveBeenCalledTimes(1);
    });

    it('should return 500 with error detail when returnErrors=true and redeploy fails', async () => {
      mockRedeployAll.mockRejectedValueOnce(new Error('Engine not ready'));

      const response = await request(app)
        .post('/channels/_redeployAll?returnErrors=true');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Engine not ready');
    });
  });

  // ============================================================================
  // POST /channels/:channelId/_deploy  (single channel)
  // ============================================================================

  describe('POST /channels/:channelId/_deploy', () => {
    it('should deploy a single channel by ID and return 204', async () => {
      mockDeploy.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_deploy`);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(1);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 even on error when returnErrors is not set', async () => {
      mockDeploy.mockRejectedValueOnce(new Error('Channel not found'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_deploy`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error detail when returnErrors=true and deploy fails', async () => {
      mockDeploy.mockRejectedValueOnce(new Error('Port already in use'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_deploy?returnErrors=true`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Port already in use');
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });
  });

  // ============================================================================
  // POST /channels/:channelId/_undeploy  (single channel)
  // ============================================================================

  describe('POST /channels/:channelId/_undeploy', () => {
    it('should undeploy a single channel by ID and return 204', async () => {
      mockUndeploy.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_undeploy`);

      expect(response.status).toBe(204);
      expect(mockUndeploy).toHaveBeenCalledTimes(1);
      expect(mockUndeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should return 204 even on error when returnErrors is not set', async () => {
      mockUndeploy.mockRejectedValueOnce(new Error('Channel is locked'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_undeploy`);

      expect(response.status).toBe(204);
    });

    it('should return 500 with error detail when returnErrors=true and undeploy fails', async () => {
      mockUndeploy.mockRejectedValueOnce(new Error('Undeploy timed out'));

      const response = await request(app)
        .post(`/channels/${TEST_CHANNEL_ID}/_undeploy?returnErrors=true`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Undeploy timed out');
    });
  });

  // ============================================================================
  // POST /channels/_deploy  (batch — JSON array)
  // ============================================================================

  describe('POST /channels/_deploy (batch — JSON array)', () => {
    it('should deploy each channel in a JSON array and return 204', async () => {
      mockDeploy.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_deploy')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(2);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should call deployAllChannels when body is empty / no IDs provided', async () => {
      mockDeployAll.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/channels/_deploy')
        .send([]);

      expect(response.status).toBe(204);
      expect(mockDeployAll).toHaveBeenCalledTimes(1);
      expect(mockDeploy).not.toHaveBeenCalled();
    });

    it('should call deployAllChannels when body is absent', async () => {
      mockDeployAll.mockResolvedValueOnce(undefined);

      // Send request with no body
      const response = await request(app).post('/channels/_deploy');

      expect(response.status).toBe(204);
      expect(mockDeployAll).toHaveBeenCalledTimes(1);
    });

    it('should return 204 when some channels fail and returnErrors is not set', async () => {
      mockDeploy
        .mockResolvedValueOnce(undefined)                           // first channel succeeds
        .mockRejectedValueOnce(new Error('Connector failed'));      // second channel fails

      const response = await request(app)
        .post('/channels/_deploy')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(204);
    });

    it('should return 500 with errors array when returnErrors=true and any channel fails', async () => {
      mockDeploy
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('EADDRINUSE'));

      const response = await request(app)
        .post('/channels/_deploy?returnErrors=true')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(500);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].channelId).toBe(TEST_CHANNEL_ID_2);
      expect(response.body.errors[0].error).toBe('EADDRINUSE');
    });
  });

  // ============================================================================
  // POST /channels/_undeploy  (batch — JSON array)
  // ============================================================================

  describe('POST /channels/_undeploy (batch — JSON array)', () => {
    it('should undeploy each channel in a JSON array and return 204', async () => {
      mockUndeploy.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/channels/_undeploy')
        .send([TEST_CHANNEL_ID, TEST_CHANNEL_ID_2]);

      expect(response.status).toBe(204);
      expect(mockUndeploy).toHaveBeenCalledTimes(2);
      expect(mockUndeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockUndeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should call undeployAllChannels when body is empty', async () => {
      mockUndeployAll.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post('/channels/_undeploy')
        .send([]);

      expect(response.status).toBe(204);
      expect(mockUndeployAll).toHaveBeenCalledTimes(1);
      expect(mockUndeploy).not.toHaveBeenCalled();
    });

    it('should return 500 with error detail when returnErrors=true and undeploy fails', async () => {
      mockUndeploy.mockRejectedValueOnce(new Error('Undeploy failed'));

      const response = await request(app)
        .post('/channels/_undeploy?returnErrors=true')
        .send([TEST_CHANNEL_ID]);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Undeploy failed');
    });
  });

  // ============================================================================
  // extractChannelIds — XML parsed body formats
  //
  // The real Mirth Administrator sends XML: <set><string>id</string></set>
  // The express XML body parser converts this to a JS object before the handler
  // sees it. We verify all supported shapes here by posting pre-parsed objects
  // as JSON (the handler itself calls extractChannelIds(req.body) regardless of
  // original content-type, so the shape is what matters).
  // ============================================================================

  describe('extractChannelIds — XML body formats', () => {
    it('should extract a single ID from XML <set><string>id</string></set> shape', async () => {
      mockDeploy.mockResolvedValue(undefined);

      // Simulates what the XML body parser produces for:
      //   <set><string>12345678-...</string></set>
      const xmlParsedBody = { set: { string: TEST_CHANNEL_ID } };

      const response = await request(app)
        .post('/channels/_deploy')
        .send(xmlParsedBody);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(1);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should extract multiple IDs from XML <set><string>[…]</string></set> shape', async () => {
      mockDeploy.mockResolvedValue(undefined);

      // Simulates: <set><string>id1</string><string>id2</string></set>
      const xmlParsedBody = { set: { string: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] } };

      const response = await request(app)
        .post('/channels/_deploy')
        .send(xmlParsedBody);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(2);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID_2);
    });

    it('should extract a single ID from XML <list><string>id</string></list> shape', async () => {
      mockDeploy.mockResolvedValue(undefined);

      // Alternative Mirth format: <list><string>id</string></list>
      const xmlParsedBody = { list: { string: TEST_CHANNEL_ID } };

      const response = await request(app)
        .post('/channels/_deploy')
        .send(xmlParsedBody);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(1);
      expect(mockDeploy).toHaveBeenCalledWith(TEST_CHANNEL_ID);
    });

    it('should extract multiple IDs from XML <list><string>[…]</string></list> shape', async () => {
      mockDeploy.mockResolvedValue(undefined);

      const xmlParsedBody = { list: { string: [TEST_CHANNEL_ID, TEST_CHANNEL_ID_2] } };

      const response = await request(app)
        .post('/channels/_deploy')
        .send(xmlParsedBody);

      expect(response.status).toBe(204);
      expect(mockDeploy).toHaveBeenCalledTimes(2);
    });

    it('should fall back to deployAllChannels when body has unknown shape', async () => {
      mockDeployAll.mockResolvedValueOnce(undefined);

      // An object with no recognizable set/list key → empty extraction → deploy all
      const response = await request(app)
        .post('/channels/_deploy')
        .send({ unknown: { key: 'value' } });

      expect(response.status).toBe(204);
      expect(mockDeployAll).toHaveBeenCalledTimes(1);
      expect(mockDeploy).not.toHaveBeenCalled();
    });
  });
});
