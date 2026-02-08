import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock EngineController before importing
jest.mock('../../../src/controllers/EngineController.js', () => ({
  EngineController: {
    getDeployedChannel: jest.fn(),
  },
}));

// Mock ClusterIdentity
jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'health-test-server'),
  resetServerId: jest.fn(),
}));

import express from 'express';
import {
  healthRouter,
  setShuttingDown,
  setStartupComplete,
  isShuttingDown,
  isStartupComplete,
} from '../../../src/cluster/HealthCheck.js';
import { EngineController } from '../../../src/controllers/EngineController.js';
import { DeployedState } from '../../../src/api/models/DashboardStatus.js';

// We'll use a lightweight approach: create an express app and test with supertest-like logic
// But since supertest is available, let's use it
import request from 'supertest';

const app = express();
app.use('/api/health', healthRouter);

describe('HealthCheck', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    setShuttingDown(false);
    setStartupComplete(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('GET /api/health', () => {
    it('should return 200 with status ok when running', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.serverId).toBe('health-test-server');
      expect(typeof res.body.uptime).toBe('number');
    });

    it('should return 503 when shutting down', async () => {
      setShuttingDown(true);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('shutting_down');
    });
  });

  describe('GET /api/health/live', () => {
    it('should always return 200', async () => {
      const res = await request(app).get('/api/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });

    it('should return 200 even when shutting down', async () => {
      setShuttingDown(true);

      const res = await request(app).get('/api/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });
  });

  describe('GET /api/health/startup', () => {
    it('should return 503 before startup complete', async () => {
      setStartupComplete(false);

      const res = await request(app).get('/api/health/startup');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('starting');
    });

    it('should return 200 after startup complete', async () => {
      setStartupComplete(true);

      const res = await request(app).get('/api/health/startup');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('GET /api/health/channels/:channelId', () => {
    it('should return 503 when channel is not deployed', async () => {
      (EngineController.getDeployedChannel as jest.Mock).mockReturnValue(null);

      const res = await request(app).get('/api/health/channels/chan-123');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_deployed');
      expect(res.body.channelId).toBe('chan-123');
    });

    it('should return 200 when channel is STARTED', async () => {
      (EngineController.getDeployedChannel as jest.Mock).mockReturnValue({
        getState: () => DeployedState.STARTED,
      });

      const res = await request(app).get('/api/health/channels/chan-123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('started');
    });

    it('should return 503 when channel is STOPPED', async () => {
      (EngineController.getDeployedChannel as jest.Mock).mockReturnValue({
        getState: () => DeployedState.STOPPED,
      });

      const res = await request(app).get('/api/health/channels/chan-123');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('stopped');
    });

    it('should return 503 when channel is PAUSED', async () => {
      (EngineController.getDeployedChannel as jest.Mock).mockReturnValue({
        getState: () => DeployedState.PAUSED,
      });

      const res = await request(app).get('/api/health/channels/chan-123');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('paused');
    });
  });

  describe('state flag functions', () => {
    it('isShuttingDown should reflect setShuttingDown', () => {
      expect(isShuttingDown()).toBe(false);
      setShuttingDown(true);
      expect(isShuttingDown()).toBe(true);
      setShuttingDown(false);
      expect(isShuttingDown()).toBe(false);
    });

    it('isStartupComplete should reflect setStartupComplete', () => {
      expect(isStartupComplete()).toBe(false);
      setStartupComplete(true);
      expect(isStartupComplete()).toBe(true);
      setStartupComplete(false);
      expect(isStartupComplete()).toBe(false);
    });
  });
});
