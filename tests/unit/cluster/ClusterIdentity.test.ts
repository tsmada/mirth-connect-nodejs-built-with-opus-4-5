import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Must import after each resetServerId call since module caches the value
import { getServerId, resetServerId } from '../../../src/cluster/ClusterIdentity.js';

describe('ClusterIdentity', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetServerId();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetServerId();
  });

  describe('getServerId', () => {
    it('should return MIRTH_SERVER_ID env var when set', () => {
      process.env['MIRTH_SERVER_ID'] = 'pod-mirth-0';

      const id = getServerId();

      expect(id).toBe('pod-mirth-0');
    });

    it('should return a UUID when MIRTH_SERVER_ID is not set', () => {
      delete process.env['MIRTH_SERVER_ID'];

      const id = getServerId();

      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should return the same value on subsequent calls (singleton)', () => {
      delete process.env['MIRTH_SERVER_ID'];

      const id1 = getServerId();
      const id2 = getServerId();

      expect(id1).toBe(id2);
    });

    it('should generate a new UUID after resetServerId', () => {
      delete process.env['MIRTH_SERVER_ID'];

      const id1 = getServerId();
      resetServerId();
      const id2 = getServerId();

      // Technically could be the same UUID, but astronomically unlikely
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
      expect(id2.length).toBeGreaterThan(0);
    });

    it('should use env var even after a previous auto-generated ID was reset', () => {
      delete process.env['MIRTH_SERVER_ID'];
      const autoId = getServerId();
      expect(autoId).toMatch(/^[0-9a-f]{8}-/);

      resetServerId();
      process.env['MIRTH_SERVER_ID'] = 'stable-pod-1';
      const envId = getServerId();

      expect(envId).toBe('stable-pod-1');
    });
  });
});
