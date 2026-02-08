import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock ClusterIdentity so getServerId() returns a predictable value
jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'test-server-id'),
  resetServerId: jest.fn(),
}));

import { getClusterConfig, resetClusterConfig } from '../../../src/cluster/ClusterConfig.js';

describe('ClusterConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetClusterConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetClusterConfig();
  });

  describe('getClusterConfig', () => {
    it('should return defaults when no env vars set', () => {
      delete process.env['MIRTH_CLUSTER_ENABLED'];
      delete process.env['MIRTH_CLUSTER_REDIS_URL'];
      delete process.env['MIRTH_CLUSTER_SECRET'];
      delete process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'];
      delete process.env['MIRTH_CLUSTER_HEARTBEAT_TIMEOUT'];
      delete process.env['MIRTH_CLUSTER_SEQUENCE_BLOCK'];

      const config = getClusterConfig();

      expect(config.serverId).toBe('test-server-id');
      expect(config.clusterEnabled).toBe(false);
      expect(config.redisUrl).toBeUndefined();
      expect(config.clusterSecret).toBeUndefined();
      expect(config.heartbeatInterval).toBe(10000);
      expect(config.heartbeatTimeout).toBe(30000);
      expect(config.sequenceBlockSize).toBe(100);
    });

    it('should parse MIRTH_CLUSTER_ENABLED=true', () => {
      process.env['MIRTH_CLUSTER_ENABLED'] = 'true';

      const config = getClusterConfig();

      expect(config.clusterEnabled).toBe(true);
    });

    it('should parse MIRTH_CLUSTER_ENABLED=1', () => {
      process.env['MIRTH_CLUSTER_ENABLED'] = '1';
      resetClusterConfig();

      const config = getClusterConfig();

      expect(config.clusterEnabled).toBe(true);
    });

    it('should parse MIRTH_CLUSTER_ENABLED=yes', () => {
      process.env['MIRTH_CLUSTER_ENABLED'] = 'yes';
      resetClusterConfig();

      const config = getClusterConfig();

      expect(config.clusterEnabled).toBe(true);
    });

    it('should parse MIRTH_CLUSTER_ENABLED=false', () => {
      process.env['MIRTH_CLUSTER_ENABLED'] = 'false';

      const config = getClusterConfig();

      expect(config.clusterEnabled).toBe(false);
    });

    it('should read Redis URL from env', () => {
      process.env['MIRTH_CLUSTER_REDIS_URL'] = 'redis://redis:6379';

      const config = getClusterConfig();

      expect(config.redisUrl).toBe('redis://redis:6379');
    });

    it('should read cluster secret from env', () => {
      process.env['MIRTH_CLUSTER_SECRET'] = 'super-secret-key';

      const config = getClusterConfig();

      expect(config.clusterSecret).toBe('super-secret-key');
    });

    it('should parse custom heartbeat interval', () => {
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = '5000';

      const config = getClusterConfig();

      expect(config.heartbeatInterval).toBe(5000);
    });

    it('should parse custom heartbeat timeout', () => {
      process.env['MIRTH_CLUSTER_HEARTBEAT_TIMEOUT'] = '60000';

      const config = getClusterConfig();

      expect(config.heartbeatTimeout).toBe(60000);
    });

    it('should parse custom sequence block size', () => {
      process.env['MIRTH_CLUSTER_SEQUENCE_BLOCK'] = '500';

      const config = getClusterConfig();

      expect(config.sequenceBlockSize).toBe(500);
    });

    it('should fallback to defaults for invalid numbers', () => {
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = 'not-a-number';
      process.env['MIRTH_CLUSTER_HEARTBEAT_TIMEOUT'] = '';
      process.env['MIRTH_CLUSTER_SEQUENCE_BLOCK'] = 'abc';

      const config = getClusterConfig();

      expect(config.heartbeatInterval).toBe(10000);
      expect(config.heartbeatTimeout).toBe(30000);
      expect(config.sequenceBlockSize).toBe(100);
    });

    it('should cache the configuration on subsequent calls', () => {
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = '5000';

      const config1 = getClusterConfig();
      // Change env var after first call
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = '9999';
      const config2 = getClusterConfig();

      // Should still return cached value
      expect(config2.heartbeatInterval).toBe(5000);
      expect(config1).toBe(config2); // Same object reference
    });

    it('should re-read config after resetClusterConfig', () => {
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = '5000';
      const config1 = getClusterConfig();
      expect(config1.heartbeatInterval).toBe(5000);

      resetClusterConfig();
      process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'] = '9999';
      const config2 = getClusterConfig();

      expect(config2.heartbeatInterval).toBe(9999);
    });
  });
});
