/**
 * Tests for ClusterServlet polling control endpoints.
 *
 * Covers: GET /leases, GET /polling, POST /polling/enable, POST /polling/disable
 */

import express from 'express';
import request from 'supertest';
import { clusterRouter } from '../../../src/api/servlets/ClusterServlet.js';

// ── Mocks ────────────────────────────────────────────────────

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    clusterEnabled: true,
    serverId: 'test-node-1',
    pollingMode: 'exclusive',
    leaseTtl: 15000,
  })),
}));

jest.mock('../../../src/cluster/ServerRegistry.js', () => ({
  getClusterNodes: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../../src/cluster/ChannelRegistry.js', () => ({
  getDeployedChannels: jest.fn(() => Promise.resolve([])),
}));

const mockGetAllLeases = jest.fn();
jest.mock('../../../src/cluster/PollingLeaseManager.js', () => ({
  getAllLeases: (...args: unknown[]) => mockGetAllLeases(...args),
}));

const mockEnableTakeoverPolling = jest.fn();
const mockDisableTakeoverPolling = jest.fn();
const mockGetTakeoverPollingEnabled = jest.fn();
const mockIsPollingAllowedInTakeover = jest.fn();
jest.mock('../../../src/cluster/TakeoverPollingGuard.js', () => ({
  enableTakeoverPolling: (...args: unknown[]) => mockEnableTakeoverPolling(...args),
  disableTakeoverPolling: (...args: unknown[]) => mockDisableTakeoverPolling(...args),
  getTakeoverPollingEnabled: (...args: unknown[]) => mockGetTakeoverPollingEnabled(...args),
  isPollingAllowedInTakeover: (...args: unknown[]) => mockIsPollingAllowedInTakeover(...args),
}));

// ── Test App ─────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/system/cluster', clusterRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────

describe('ClusterServlet — Polling Endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    mockGetTakeoverPollingEnabled.mockReturnValue(new Set());
    mockIsPollingAllowedInTakeover.mockReturnValue(true);
  });

  // ── GET /leases ──────────────────────────────────────────

  describe('GET /api/system/cluster/leases', () => {
    it('returns empty leases when none exist', async () => {
      mockGetAllLeases.mockResolvedValue([]);

      const res = await request(app).get('/api/system/cluster/leases');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ leases: [] });
    });

    it('returns active leases', async () => {
      const now = new Date();
      const leases = [
        {
          channelId: 'ch-001',
          serverId: 'node-1',
          acquiredAt: now.toISOString(),
          renewedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15000).toISOString(),
        },
      ];
      mockGetAllLeases.mockResolvedValue(leases);

      const res = await request(app).get('/api/system/cluster/leases');

      expect(res.status).toBe(200);
      expect(res.body.leases).toHaveLength(1);
      expect(res.body.leases[0].channelId).toBe('ch-001');
      expect(res.body.leases[0].serverId).toBe('node-1');
    });

    it('returns 500 on database error', async () => {
      mockGetAllLeases.mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app).get('/api/system/cluster/leases');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DB connection lost');
    });
  });

  // ── GET /polling ─────────────────────────────────────────

  describe('GET /api/system/cluster/polling', () => {
    it('returns polling status with no enabled channels', async () => {
      mockGetAllLeases.mockResolvedValue([]);
      mockGetTakeoverPollingEnabled.mockReturnValue(new Set());

      const res = await request(app).get('/api/system/cluster/polling');

      expect(res.status).toBe(200);
      expect(res.body.clusterEnabled).toBe(true);
      expect(res.body.pollingMode).toBe('exclusive');
      expect(res.body.leaseTtl).toBe(15000);
      expect(res.body.enabledChannels).toEqual([]);
      expect(res.body.leases).toEqual([]);
    });

    it('returns enabled channels and leases', async () => {
      mockGetTakeoverPollingEnabled.mockReturnValue(new Set(['ch-001', 'ch-002']));
      mockGetAllLeases.mockResolvedValue([
        { channelId: 'ch-001', serverId: 'node-1' },
      ]);

      const res = await request(app).get('/api/system/cluster/polling');

      expect(res.status).toBe(200);
      expect(res.body.enabledChannels).toEqual(expect.arrayContaining(['ch-001', 'ch-002']));
      expect(res.body.leases).toHaveLength(1);
    });
  });

  // ── POST /polling/enable ─────────────────────────────────

  describe('POST /api/system/cluster/polling/enable', () => {
    it('enables polling for a channel', async () => {
      mockIsPollingAllowedInTakeover.mockReturnValue(true);

      const res = await request(app)
        .post('/api/system/cluster/polling/enable')
        .send({ channelId: 'ch-001' });

      expect(res.status).toBe(200);
      expect(res.body.channelId).toBe('ch-001');
      expect(res.body.pollingEnabled).toBe(true);
      expect(res.body.allowed).toBe(true);
      expect(mockEnableTakeoverPolling).toHaveBeenCalledWith('ch-001');
    });

    it('returns 400 when channelId is missing', async () => {
      const res = await request(app)
        .post('/api/system/cluster/polling/enable')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('channelId is required');
      expect(mockEnableTakeoverPolling).not.toHaveBeenCalled();
    });
  });

  // ── POST /polling/disable ────────────────────────────────

  describe('POST /api/system/cluster/polling/disable', () => {
    it('disables polling for a channel', async () => {
      mockIsPollingAllowedInTakeover.mockReturnValue(false);

      const res = await request(app)
        .post('/api/system/cluster/polling/disable')
        .send({ channelId: 'ch-001' });

      expect(res.status).toBe(200);
      expect(res.body.channelId).toBe('ch-001');
      expect(res.body.pollingEnabled).toBe(false);
      expect(res.body.allowed).toBe(false);
      expect(mockDisableTakeoverPolling).toHaveBeenCalledWith('ch-001');
    });

    it('returns 400 when channelId is missing', async () => {
      const res = await request(app)
        .post('/api/system/cluster/polling/disable')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('channelId is required');
      expect(mockDisableTakeoverPolling).not.toHaveBeenCalled();
    });
  });
});
