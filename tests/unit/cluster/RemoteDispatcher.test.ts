import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock cluster config
jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'test-server',
    clusterEnabled: true,
    clusterSecret: 'test-secret',
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
  resetClusterConfig: jest.fn(),
}));

// Mock EngineController
const mockDispatchRawMessage = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('../../../src/controllers/EngineController.js', () => ({
  EngineController: {
    dispatchRawMessage: (...args: unknown[]) => mockDispatchRawMessage(...args),
  },
}));

// Mock RawMessage
jest.mock('../../../src/model/RawMessage.js', () => {
  class MockRawMessage {
    private data: string;
    private sourceMap: Map<string, unknown>;
    constructor() {
      this.data = '';
      this.sourceMap = new Map();
    }
    static fromString(data: string) {
      const msg = new MockRawMessage();
      msg.data = data;
      return msg;
    }
    getRawData() { return this.data; }
    getSourceMap() { return this.sourceMap; }
  }
  return { RawMessage: MockRawMessage };
});

import { internalRouter } from '../../../src/cluster/RemoteDispatcher.js';
import { getClusterConfig } from '../../../src/cluster/ClusterConfig.js';

describe('RemoteDispatcher', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/internal', internalRouter);
  });

  describe('POST /api/internal/dispatch', () => {
    it('should reject requests without cluster secret', async () => {
      const res = await request(app)
        .post('/api/internal/dispatch')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Invalid cluster secret');
    });

    it('should reject requests with wrong cluster secret', async () => {
      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'wrong-secret')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(403);
    });

    it('should accept requests with correct cluster secret', async () => {
      mockDispatchRawMessage.mockResolvedValueOnce({
        messageId: 42,
        selectedResponse: { message: 'ACK', status: { toString: () => 'SENT' } },
      });

      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ messageId: 42, status: 'SENT' });
    });

    it('should return 400 when channelId is missing', async () => {
      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({ rawData: 'MSH|...' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('should return 400 when rawData is missing', async () => {
      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({ channelId: 'ch-1' });

      expect(res.status).toBe(400);
    });

    it('should handle filtered messages (null result)', async () => {
      mockDispatchRawMessage.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ messageId: -1, status: 'FILTERED' });
    });

    it('should handle dispatch errors', async () => {
      mockDispatchRawMessage.mockRejectedValueOnce(new Error('Channel not deployed: ch-1'));

      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Channel not deployed');
    });

    it('should forward sourceMap data', async () => {
      mockDispatchRawMessage.mockResolvedValueOnce({
        messageId: 99,
        selectedResponse: null,
      });

      const res = await request(app)
        .post('/api/internal/dispatch')
        .set('X-Cluster-Secret', 'test-secret')
        .send({
          channelId: 'ch-1',
          rawData: 'MSH|...',
          sourceMap: { sourceChannelId: 'upstream-ch' },
        });

      expect(res.status).toBe(200);
      // Verify the mock was called with the rawMessage containing sourceMap
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);
    });

    it('should allow requests when no cluster secret is configured', async () => {
      (getClusterConfig as jest.Mock).mockReturnValue({
        serverId: 'test-server',
        clusterEnabled: true,
        clusterSecret: undefined, // No secret configured
      });

      mockDispatchRawMessage.mockResolvedValueOnce({
        messageId: 1,
        selectedResponse: null,
      });

      const res = await request(app)
        .post('/api/internal/dispatch')
        .send({ channelId: 'ch-1', rawData: 'MSH|...' });

      expect(res.status).toBe(200);
    });
  });
});
