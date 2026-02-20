/**
 * ClusterServlet Unit Tests
 *
 * Tests for cluster management endpoints including:
 * - GET /status - Cluster status with deployed channels
 * - GET /nodes - Node list without channel details
 */

import request from 'supertest';

// Mock ClusterConfig
const mockGetClusterConfig = jest.fn();

jest.mock('../../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: (...args: unknown[]) => mockGetClusterConfig(...args),
}));

// Mock ServerRegistry
const mockGetClusterNodes = jest.fn();

jest.mock('../../../../src/cluster/ServerRegistry.js', () => ({
  getClusterNodes: (...args: unknown[]) => mockGetClusterNodes(...args),
}));

// Mock ChannelRegistry
const mockGetDeployedChannels = jest.fn();

jest.mock('../../../../src/cluster/ChannelRegistry.js', () => ({
  getDeployedChannels: (...args: unknown[]) => mockGetDeployedChannels(...args),
}));

import express, { Express } from 'express';
import { clusterRouter } from '../../../../src/api/servlets/ClusterServlet.js';

// ============================================================================
// Test fixtures
// ============================================================================

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    serverId: 'node-1',
    hostname: 'mirth-pod-0',
    port: 8080,
    apiUrl: 'http://mirth-pod-0:8080',
    status: 'ONLINE',
    lastHeartbeat: new Date('2026-02-10T12:00:00Z'),
    startedAt: new Date('2026-02-10T11:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/cluster', clusterRouter);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe('ClusterServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /cluster/status
  // ==========================================================================

  describe('GET /cluster/status', () => {
    it('should return cluster status with nodes and deployed channels', async () => {
      mockGetClusterConfig.mockReturnValueOnce({
        clusterEnabled: true,
        serverId: 'node-1',
      });

      const nodes = [
        makeNode(),
        makeNode({ serverId: 'node-2', hostname: 'mirth-pod-1' }),
      ];
      mockGetClusterNodes.mockResolvedValueOnce(nodes);

      mockGetDeployedChannels
        .mockResolvedValueOnce(['ch-a', 'ch-b'])
        .mockResolvedValueOnce(['ch-a']);

      const response = await request(app).get('/cluster/status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.thisNode).toBe('node-1');
      expect(response.body.nodes).toHaveLength(2);

      expect(response.body.nodes[0].serverId).toBe('node-1');
      expect(response.body.nodes[0].deployedChannels).toEqual(['ch-a', 'ch-b']);
      expect(response.body.nodes[1].serverId).toBe('node-2');
      expect(response.body.nodes[1].deployedChannels).toEqual(['ch-a']);
    });

    it('should return empty deployed channels when registry lookup fails', async () => {
      mockGetClusterConfig.mockReturnValueOnce({
        clusterEnabled: true,
        serverId: 'node-1',
      });

      mockGetClusterNodes.mockResolvedValueOnce([makeNode()]);
      mockGetDeployedChannels.mockRejectedValueOnce(new Error('Table not found'));

      const response = await request(app).get('/cluster/status');

      expect(response.status).toBe(200);
      expect(response.body.nodes[0].deployedChannels).toEqual([]);
    });

    it('should return disabled cluster when not enabled', async () => {
      mockGetClusterConfig.mockReturnValueOnce({
        clusterEnabled: false,
        serverId: 'standalone-1',
      });

      mockGetClusterNodes.mockResolvedValueOnce([makeNode({ serverId: 'standalone-1' })]);
      mockGetDeployedChannels.mockResolvedValueOnce([]);

      const response = await request(app).get('/cluster/status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
      expect(response.body.thisNode).toBe('standalone-1');
    });

    it('should return 500 on error', async () => {
      mockGetClusterConfig.mockImplementationOnce(() => {
        throw new Error('Config error');
      });

      const response = await request(app).get('/cluster/status');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Config error');
    });

    it('should include all node fields in response', async () => {
      mockGetClusterConfig.mockReturnValueOnce({
        clusterEnabled: true,
        serverId: 'node-1',
      });

      mockGetClusterNodes.mockResolvedValueOnce([makeNode()]);
      mockGetDeployedChannels.mockResolvedValueOnce(['ch-1']);

      const response = await request(app).get('/cluster/status');

      expect(response.status).toBe(200);
      const node = response.body.nodes[0];
      expect(node).toHaveProperty('serverId');
      expect(node).toHaveProperty('hostname');
      expect(node).toHaveProperty('port');
      expect(node).toHaveProperty('apiUrl');
      expect(node).toHaveProperty('status');
      expect(node).toHaveProperty('lastHeartbeat');
      expect(node).toHaveProperty('startedAt');
      expect(node).toHaveProperty('deployedChannels');
    });
  });

  // ==========================================================================
  // GET /cluster/nodes
  // ==========================================================================

  describe('GET /cluster/nodes', () => {
    it('should return node list without deployed channels', async () => {
      const nodes = [
        makeNode(),
        makeNode({ serverId: 'node-2', hostname: 'mirth-pod-1', status: 'OFFLINE' }),
      ];
      mockGetClusterNodes.mockResolvedValueOnce(nodes);

      const response = await request(app).get('/cluster/nodes');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);

      expect(response.body[0].serverId).toBe('node-1');
      expect(response.body[0].status).toBe('ONLINE');
      expect(response.body[0]).not.toHaveProperty('deployedChannels');

      expect(response.body[1].serverId).toBe('node-2');
      expect(response.body[1].status).toBe('OFFLINE');
    });

    it('should return empty array when no nodes registered', async () => {
      mockGetClusterNodes.mockResolvedValueOnce([]);

      const response = await request(app).get('/cluster/nodes');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 on error', async () => {
      mockGetClusterNodes.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/cluster/nodes');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });

    it('should include all node fields except deployedChannels', async () => {
      mockGetClusterNodes.mockResolvedValueOnce([makeNode()]);

      const response = await request(app).get('/cluster/nodes');

      expect(response.status).toBe(200);
      const node = response.body[0];
      expect(node).toHaveProperty('serverId');
      expect(node).toHaveProperty('hostname');
      expect(node).toHaveProperty('port');
      expect(node).toHaveProperty('apiUrl');
      expect(node).toHaveProperty('status');
      expect(node).toHaveProperty('lastHeartbeat');
      expect(node).toHaveProperty('startedAt');
      expect(node).not.toHaveProperty('deployedChannels');
    });
  });
});
