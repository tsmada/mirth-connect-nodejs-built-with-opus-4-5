import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'quorum-test-server'),
  resetServerId: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'quorum-test-server',
    clusterEnabled: true,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
  resetClusterConfig: jest.fn(),
}));

import {
  isQuorumEnabled,
  hasQuorum,
  getQuorumStatus,
} from '../../../src/cluster/QuorumCheck.js';
import { query } from '../../../src/db/pool.js';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('QuorumCheck', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isQuorumEnabled', () => {
    it('should return false by default', () => {
      delete process.env['MIRTH_CLUSTER_QUORUM_ENABLED'];
      expect(isQuorumEnabled()).toBe(false);
    });

    it('should return true when env var is set to true', () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';
      expect(isQuorumEnabled()).toBe(true);
    });

    it('should return false when env var is set to false', () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'false';
      expect(isQuorumEnabled()).toBe(false);
    });
  });

  describe('hasQuorum', () => {
    it('should always return true when quorum is disabled', async () => {
      delete process.env['MIRTH_CLUSTER_QUORUM_ENABLED'];

      const result = await hasQuorum();

      expect(result).toBe(true);
      // Should not query the database at all
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return true when quorum is met', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      // total = 3 (ONLINE + SHADOW), alive = 2
      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }] as any)  // total query
        .mockResolvedValueOnce([{ cnt: 2 }] as any);  // alive query

      const result = await hasQuorum();

      expect(result).toBe(true);
    });

    it('should return false when quorum is lost', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      // total = 3, alive = 1 (1 < ceil(3/2) = 2)
      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }] as any)
        .mockResolvedValueOnce([{ cnt: 1 }] as any);

      const result = await hasQuorum();

      expect(result).toBe(false);
    });
  });

  describe('getQuorumStatus', () => {
    it('should report quorum with 2 alive out of 3 total', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }] as any)
        .mockResolvedValueOnce([{ cnt: 2 }] as any);

      const status = await getQuorumStatus();

      expect(status).toEqual({
        alive: 2,
        total: 3,
        hasQuorum: true,
        minRequired: 2,     // ceil(3/2) = 2
        enabled: true,
      });
    });

    it('should report no quorum with 1 alive out of 3 total', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }] as any)
        .mockResolvedValueOnce([{ cnt: 1 }] as any);

      const status = await getQuorumStatus();

      expect(status).toEqual({
        alive: 1,
        total: 3,
        hasQuorum: false,
        minRequired: 2,     // ceil(3/2) = 2, 1 < 2
        enabled: true,
      });
    });

    it('should always have quorum with 1 alive out of 1 total', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }] as any)
        .mockResolvedValueOnce([{ cnt: 1 }] as any);

      const status = await getQuorumStatus();

      expect(status).toEqual({
        alive: 1,
        total: 1,
        hasQuorum: true,
        minRequired: 1,     // ceil(1/2) = 1
        enabled: true,
      });
    });

    it('should handle 0 total nodes gracefully', async () => {
      process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] = 'true';

      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }] as any)
        .mockResolvedValueOnce([{ cnt: 0 }] as any);

      const status = await getQuorumStatus();

      expect(status).toEqual({
        alive: 0,
        total: 0,
        hasQuorum: true,    // 0 >= ceil(0/2) = 0
        minRequired: 0,
        enabled: true,
      });
    });

    it('should report enabled: false when quorum is disabled', async () => {
      delete process.env['MIRTH_CLUSTER_QUORUM_ENABLED'];

      mockQuery
        .mockResolvedValueOnce([{ cnt: 3 }] as any)
        .mockResolvedValueOnce([{ cnt: 1 }] as any);

      const status = await getQuorumStatus();

      expect(status.enabled).toBe(false);
      // hasQuorum still computed correctly even when disabled
      expect(status.hasQuorum).toBe(false);
    });
  });
});
