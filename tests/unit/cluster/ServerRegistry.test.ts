import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'test-server-001'),
  resetServerId: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'test-server-001',
    clusterEnabled: true,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
  resetClusterConfig: jest.fn(),
}));

import {
  registerServer,
  startHeartbeat,
  stopHeartbeat,
  deregisterServer,
  getClusterNodes,
  isNodeAlive,
  getOfflineNodeIds,
} from '../../../src/cluster/ServerRegistry.js';
import { query, execute } from '../../../src/db/pool.js';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;

describe('ServerRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopHeartbeat(); // Clean up any running heartbeat
  });

  afterEach(() => {
    stopHeartbeat();
  });

  describe('registerServer', () => {
    it('should INSERT/UPDATE D_SERVERS with server info', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

      await registerServer(8081);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0]!;
      expect(sql).toContain('INSERT INTO D_SERVERS');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(params).toEqual(expect.objectContaining({
        serverId: 'test-server-001',
        port: 8081,
      }));
    });

    it('should handle no port argument', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

      await registerServer();

      const [_sql, params] = mockExecute.mock.calls[0]!;
      expect(params).toEqual(expect.objectContaining({
        port: null,
        apiUrl: null,
      }));
    });
  });

  describe('deregisterServer', () => {
    it('should UPDATE D_SERVERS status to OFFLINE', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

      await deregisterServer();

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0]!;
      expect(sql).toContain("STATUS = 'OFFLINE'");
      expect(params).toEqual(expect.objectContaining({
        serverId: 'test-server-001',
      }));
    });

    it('should not throw on DB error', async () => {
      mockExecute.mockRejectedValue(new Error('Connection lost'));

      await expect(deregisterServer()).resolves.toBeUndefined();
    });
  });

  describe('startHeartbeat / stopHeartbeat', () => {
    it('should start and stop without error', () => {
      jest.useFakeTimers();

      startHeartbeat();
      // Calling again should be a no-op
      startHeartbeat();

      stopHeartbeat();
      // Calling again should be a no-op
      stopHeartbeat();

      jest.useRealTimers();
    });

    it('should execute heartbeat UPDATE on interval', () => {
      jest.useFakeTimers();
      mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

      startHeartbeat();

      // Advance past one heartbeat interval (10000ms)
      jest.advanceTimersByTime(10000);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE D_SERVERS SET LAST_HEARTBEAT'),
        expect.objectContaining({ serverId: 'test-server-001' })
      );

      stopHeartbeat();
      jest.useRealTimers();
    });
  });

  describe('getClusterNodes', () => {
    it('should return all nodes from D_SERVERS', async () => {
      mockQuery.mockResolvedValue([
        {
          SERVER_ID: 'node-1',
          HOSTNAME: 'host-1',
          PORT: 8081,
          API_URL: 'http://host-1:8081',
          STARTED_AT: new Date('2026-01-01'),
          LAST_HEARTBEAT: new Date('2026-01-01'),
          STATUS: 'ONLINE',
        },
        {
          SERVER_ID: 'node-2',
          HOSTNAME: 'host-2',
          PORT: 8082,
          API_URL: 'http://host-2:8082',
          STARTED_AT: new Date('2026-01-01'),
          LAST_HEARTBEAT: new Date('2025-12-31'),
          STATUS: 'OFFLINE',
        },
      ] as any);

      const nodes = await getClusterNodes();

      expect(nodes).toHaveLength(2);
      expect(nodes[0]).toEqual({
        serverId: 'node-1',
        hostname: 'host-1',
        port: 8081,
        apiUrl: 'http://host-1:8081',
        startedAt: new Date('2026-01-01'),
        lastHeartbeat: new Date('2026-01-01'),
        status: 'ONLINE',
      });
      expect(nodes[1]!.status).toBe('OFFLINE');
    });

    it('should return empty array when no nodes exist', async () => {
      mockQuery.mockResolvedValue([] as any);

      const nodes = await getClusterNodes();

      expect(nodes).toHaveLength(0);
    });
  });

  describe('isNodeAlive', () => {
    it('should return true when node heartbeat is within timeout', async () => {
      mockQuery.mockResolvedValue([
        { SERVER_ID: 'node-1', STATUS: 'ONLINE', LAST_HEARTBEAT: new Date() },
      ] as any);

      const alive = await isNodeAlive('node-1');

      expect(alive).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE SERVER_ID = :serverId'),
        expect.objectContaining({ serverId: 'node-1', timeoutSeconds: 30 })
      );
    });

    it('should return false when node heartbeat has expired', async () => {
      mockQuery.mockResolvedValue([] as any);

      const alive = await isNodeAlive('node-expired');

      expect(alive).toBe(false);
    });
  });

  describe('getOfflineNodeIds', () => {
    it('should return IDs of nodes with expired heartbeat', async () => {
      mockQuery.mockResolvedValue([
        { SERVER_ID: 'stale-1' },
        { SERVER_ID: 'stale-2' },
      ] as any);

      const ids = await getOfflineNodeIds();

      expect(ids).toEqual(['stale-1', 'stale-2']);
    });

    it('should return empty array when all nodes are healthy', async () => {
      mockQuery.mockResolvedValue([] as any);

      const ids = await getOfflineNodeIds();

      expect(ids).toHaveLength(0);
    });
  });
});
