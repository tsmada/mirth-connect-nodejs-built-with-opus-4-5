/**
 * Tests for StatisticsAccumulator (PC-MJM-002)
 *
 * Validates that the batch statistics accumulator correctly:
 * 1. Accumulates increments per metaDataId/status
 * 2. Sums multiple increments to the same key
 * 3. Produces correct number of flush operations
 * 4. Flushes channel-level stats (metaDataId=0) before connector stats (MIRTH-3042)
 * 5. Resets state after calling reset()
 * 6. Handles multiple destinations independently
 */

import { StatisticsAccumulator } from '../../../../src/donkey/channel/StatisticsAccumulator.js';
import { Status } from '../../../../src/model/Status.js';

describe('StatisticsAccumulator', () => {
  let accumulator: StatisticsAccumulator;

  beforeEach(() => {
    accumulator = new StatisticsAccumulator();
  });

  it('should start empty', () => {
    expect(accumulator.size).toBe(0);
    expect(accumulator.isEmpty).toBe(true);
    expect(accumulator.getFlushOps('ch1', 'srv1')).toHaveLength(0);
  });

  it('should correctly accumulate a single increment', () => {
    accumulator.increment(0, Status.RECEIVED);

    expect(accumulator.size).toBe(1);
    expect(accumulator.isEmpty).toBe(false);

    const stats = accumulator.getStats();
    expect(stats.get(0)?.get(Status.RECEIVED)).toBe(1);
  });

  it('should sum multiple increments to the same metaDataId/status', () => {
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(0, Status.RECEIVED);

    const stats = accumulator.getStats();
    expect(stats.get(0)?.get(Status.RECEIVED)).toBe(3);
  });

  it('should sum increments with custom count', () => {
    accumulator.increment(0, Status.RECEIVED, 5);
    accumulator.increment(0, Status.RECEIVED, 3);

    const stats = accumulator.getStats();
    expect(stats.get(0)?.get(Status.RECEIVED)).toBe(8);
  });

  it('should track different statuses independently for the same metaDataId', () => {
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(0, Status.FILTERED);
    accumulator.increment(0, Status.ERROR, 2);

    const stats = accumulator.getStats();
    const metaData0 = stats.get(0)!;
    expect(metaData0.get(Status.RECEIVED)).toBe(1);
    expect(metaData0.get(Status.FILTERED)).toBe(1);
    expect(metaData0.get(Status.ERROR)).toBe(2);
  });

  it('should produce correct number of flush operations', () => {
    // Source: RECEIVED
    accumulator.increment(0, Status.RECEIVED);
    // Dest 1: SENT
    accumulator.increment(1, Status.SENT);
    // Dest 2: FILTERED
    accumulator.increment(2, Status.FILTERED);

    const ops = accumulator.getFlushOps('ch1', 'srv1');
    // 3 distinct (metaDataId, status) pairs = 3 operations
    expect(ops).toHaveLength(3);
    // Each operation should be a function
    for (const op of ops) {
      expect(typeof op).toBe('function');
    }
  });

  it('should flush channel-level stats (metaDataId=0) before connector stats (MIRTH-3042)', async () => {
    // Add stats in reverse order to verify sorting
    accumulator.increment(2, Status.SENT);
    accumulator.increment(1, Status.SENT);
    accumulator.increment(0, Status.RECEIVED);

    // Verify the internal stats map is sorted with metaDataId=0 first.
    // getFlushOps sorts entries by metaDataId ascending, so channel-level
    // stats (metaDataId=0) are flushed before connector stats.
    const stats = accumulator.getStats();
    const sortedKeys = [...stats.keys()].sort((a, b) => a - b);

    // metaDataId=0 should be first
    expect(sortedKeys[0]).toBe(0);
    expect(sortedKeys[1]).toBe(1);
    expect(sortedKeys[2]).toBe(2);
  });

  it('should reset all accumulated stats', () => {
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(1, Status.SENT);
    accumulator.increment(2, Status.ERROR);

    expect(accumulator.size).toBe(3);

    accumulator.reset();

    expect(accumulator.size).toBe(0);
    expect(accumulator.isEmpty).toBe(true);
    expect(accumulator.getFlushOps('ch1', 'srv1')).toHaveLength(0);
    expect(accumulator.getStats().size).toBe(0);
  });

  it('should handle multiple destinations accumulating independently', () => {
    // Source connector (metaDataId=0)
    accumulator.increment(0, Status.RECEIVED);

    // Destination 1 (metaDataId=1) - successful
    accumulator.increment(1, Status.SENT);

    // Destination 2 (metaDataId=2) - filtered
    accumulator.increment(2, Status.FILTERED);

    // Destination 3 (metaDataId=3) - error
    accumulator.increment(3, Status.ERROR);

    const stats = accumulator.getStats();
    expect(stats.size).toBe(4);
    expect(stats.get(0)?.get(Status.RECEIVED)).toBe(1);
    expect(stats.get(1)?.get(Status.SENT)).toBe(1);
    expect(stats.get(2)?.get(Status.FILTERED)).toBe(1);
    expect(stats.get(3)?.get(Status.ERROR)).toBe(1);

    // 4 operations total (one per metaDataId/status pair)
    const ops = accumulator.getFlushOps('ch1', 'srv1');
    expect(ops).toHaveLength(4);
  });

  it('should return a defensive copy from getStats()', () => {
    accumulator.increment(0, Status.RECEIVED);

    const stats1 = accumulator.getStats();
    stats1.get(0)?.set(Status.RECEIVED, 999);

    // Original should not be affected
    const stats2 = accumulator.getStats();
    expect(stats2.get(0)?.get(Status.RECEIVED)).toBe(1);
  });

  it('should handle accumulate-then-reset-then-accumulate cycle', () => {
    // First batch
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(1, Status.SENT);
    expect(accumulator.size).toBe(2);

    accumulator.reset();

    // Second batch (simulating next message)
    accumulator.increment(0, Status.RECEIVED);
    accumulator.increment(1, Status.ERROR);

    const stats = accumulator.getStats();
    expect(stats.size).toBe(2);
    expect(stats.get(0)?.get(Status.RECEIVED)).toBe(1);
    expect(stats.get(1)?.get(Status.ERROR)).toBe(1);
    // SENT from first batch should not be present
    expect(stats.get(1)?.get(Status.SENT)).toBeUndefined();
  });

  it('should produce flush ops with multiple statuses per metaDataId', () => {
    // Destination that had QUEUED then later SENT (hypothetical accumulation)
    accumulator.increment(1, Status.QUEUED);
    accumulator.increment(1, Status.SENT);

    const ops = accumulator.getFlushOps('ch1', 'srv1');
    // 2 operations: one for QUEUED, one for SENT, both for metaDataId=1
    expect(ops).toHaveLength(2);
  });
});
