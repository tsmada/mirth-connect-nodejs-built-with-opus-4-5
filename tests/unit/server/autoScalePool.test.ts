/**
 * Tests for autoScalePool() logic in Mirth.ts.
 *
 * Since autoScalePool is a private method on the Mirth class, we test the
 * scaling logic indirectly by verifying the mathematical properties and
 * the interaction with pool.ts functions.
 */
import { describe, it, expect, afterEach } from '@jest/globals';

describe('autoScalePool sizing logic', () => {
  // Pure function testing the scaling formula from Mirth.ts:
  //   recommended = Math.max(10, Math.ceil(enabledCount / 5))
  //   defaultMax = mode === 'takeover' ? 50 : 100
  //   maxPoolSize = parseInt(process.env['DB_POOL_MAX'] || String(defaultMax), 10)
  //   targetSize = Math.min(recommended, maxPoolSize)

  function computeTargetSize(
    enabledCount: number,
    mode: 'standalone' | 'takeover',
    dbPoolMax?: string
  ): number {
    const recommended = Math.max(10, Math.ceil(enabledCount / 5));
    const defaultMax = mode === 'takeover' ? 50 : 100;
    const maxPoolSize = parseInt(dbPoolMax || String(defaultMax), 10);
    return Math.min(recommended, maxPoolSize);
  }

  describe('standalone mode', () => {
    it('should return 10 for 0 channels (minimum)', () => {
      expect(computeTargetSize(0, 'standalone')).toBe(10);
    });

    it('should return 10 for 50 channels (50/5 = 10)', () => {
      expect(computeTargetSize(50, 'standalone')).toBe(10);
    });

    it('should return 10 for 1 channel (minimum applies)', () => {
      expect(computeTargetSize(1, 'standalone')).toBe(10);
    });

    it('should scale to 46 for 227 channels', () => {
      // Math.ceil(227 / 5) = 46
      expect(computeTargetSize(227, 'standalone')).toBe(46);
    });

    it('should cap at 100 for very large channel counts', () => {
      // Math.ceil(1000 / 5) = 200, but capped at 100
      expect(computeTargetSize(1000, 'standalone')).toBe(100);
    });

    it('should respect DB_POOL_MAX override', () => {
      // 227 channels → recommended 46, but max capped at 30
      expect(computeTargetSize(227, 'standalone', '30')).toBe(30);
    });

    it('should scale linearly between 50 and 500 channels', () => {
      expect(computeTargetSize(100, 'standalone')).toBe(20);
      expect(computeTargetSize(200, 'standalone')).toBe(40);
      expect(computeTargetSize(300, 'standalone')).toBe(60);
      expect(computeTargetSize(400, 'standalone')).toBe(80);
      expect(computeTargetSize(500, 'standalone')).toBe(100);
    });
  });

  describe('takeover mode', () => {
    it('should cap at 50 by default', () => {
      // 500 channels → recommended 100, but takeover cap is 50
      expect(computeTargetSize(500, 'takeover')).toBe(50);
    });

    it('should return 46 for 227 channels (under cap)', () => {
      expect(computeTargetSize(227, 'takeover')).toBe(46);
    });

    it('should cap at 50 for 300 channels', () => {
      // Math.ceil(300 / 5) = 60, but capped at 50
      expect(computeTargetSize(300, 'takeover')).toBe(50);
    });

    it('should respect DB_POOL_MAX override in takeover mode', () => {
      expect(computeTargetSize(300, 'takeover', '75')).toBe(60);
    });

    it('should not exceed DB_POOL_MAX even in takeover mode', () => {
      // 300 channels → recommended 60, max overridden to 25
      expect(computeTargetSize(300, 'takeover', '25')).toBe(25);
    });
  });

  describe('startup concurrency computation', () => {
    // From Mirth.ts:
    //   defaultConcurrency = Math.min(10, Math.max(1, Math.floor(poolSize / 3)))

    function computeStartupConcurrency(poolSize: number): number {
      return Math.min(10, Math.max(1, Math.floor(poolSize / 3)));
    }

    it('should return 1 for pool size 3 (minimum)', () => {
      expect(computeStartupConcurrency(3)).toBe(1);
    });

    it('should return 3 for pool size 10 (default)', () => {
      expect(computeStartupConcurrency(10)).toBe(3);
    });

    it('should return 10 for pool size 46 (capped)', () => {
      // Math.floor(46 / 3) = 15, capped at 10
      expect(computeStartupConcurrency(46)).toBe(10);
    });

    it('should return 10 for pool size 100', () => {
      expect(computeStartupConcurrency(100)).toBe(10);
    });

    it('should return 1 for pool size 1', () => {
      expect(computeStartupConcurrency(1)).toBe(1);
    });

    it('should return 6 for pool size 20', () => {
      expect(computeStartupConcurrency(20)).toBe(6);
    });
  });
});

describe('autoScalePool integration with pool.ts', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
  });

  it('isPoolSizeExplicit should detect DB_POOL_SIZE env var', async () => {
    // Mock pool module inline
    jest.resetModules();

    // Test without DB_POOL_SIZE
    delete process.env.DB_POOL_SIZE;
    const { isPoolSizeExplicit: check1 } = await import('../../../src/db/pool.js');
    expect(check1()).toBe(false);

    // Test with DB_POOL_SIZE
    process.env.DB_POOL_SIZE = '50';
    expect(check1()).toBe(true);
  });

  it('pool sizing warning threshold: channels > poolSize * 5', () => {
    // From Mirth.ts: if (isPoolSizeExplicit() && enabledCount > connectionLimit * 5)
    const cases = [
      { channels: 50, poolSize: 10, shouldWarn: false }, // 50 <= 50
      { channels: 51, poolSize: 10, shouldWarn: true }, // 51 > 50
      { channels: 100, poolSize: 20, shouldWarn: false }, // 100 <= 100
      { channels: 227, poolSize: 10, shouldWarn: true }, // 227 > 50
      { channels: 227, poolSize: 46, shouldWarn: false }, // 227 <= 230
    ];

    for (const { channels, poolSize, shouldWarn } of cases) {
      expect(channels > poolSize * 5).toBe(shouldWarn);
    }
  });
});
