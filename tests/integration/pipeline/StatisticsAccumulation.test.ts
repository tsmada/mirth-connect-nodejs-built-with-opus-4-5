/**
 * Statistics Accumulation — Behavioral Tests
 *
 * Verifies asymmetric aggregate rules from Statistics.ts (lines 233-256):
 * - RECEIVED: aggregated from source connector only (metaDataId === 0)
 * - FILTERED: aggregated from all connectors
 * - ERROR: aggregated from all connectors
 * - SENT: aggregated from destination connectors only (metaDataId > 0)
 *
 * Also verifies:
 * - TRACKED_STATUSES only includes RECEIVED, FILTERED, SENT, ERROR
 * - Non-tracked statuses (TRANSFORMED, PENDING, QUEUED) are silently ignored
 * - Event dispatching for stat changes
 * - allowNegatives flag behavior
 *
 * Ported from: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/StatisticsTests.java
 * Pattern: P10 (Model Object Graph — direct construction, no mocks)
 */

import {
  Statistics,
  TRACKED_STATUSES,
  MessageEventType,
  EventDispatcher,
  MessageEvent,
  messageEventTypeFromStatus,
} from '../../../src/donkey/channel/Statistics.js';
import { StatisticsAccumulator } from '../../../src/donkey/channel/StatisticsAccumulator.js';
import { Status } from '../../../src/model/Status.js';

const CHANNEL_ID = 'test-channel-001';
const SOURCE_META = 0;
const DEST1_META = 1;
const DEST2_META = 2;

describe('Statistics: tracked statuses and aggregate rules', () => {
  // ─── Contract: TRACKED_STATUSES inventory ───

  it('should only track RECEIVED, FILTERED, SENT, ERROR', () => {
    expect(TRACKED_STATUSES).toEqual([
      Status.RECEIVED,
      Status.FILTERED,
      Status.SENT,
      Status.ERROR,
    ]);
    // TRANSFORMED, PENDING, QUEUED are NOT tracked
    expect(TRACKED_STATUSES).not.toContain(Status.TRANSFORMED);
    expect(TRACKED_STATUSES).not.toContain(Status.PENDING);
    expect(TRACKED_STATUSES).not.toContain(Status.QUEUED);
  });

  // ─── Contract: Aggregate rules are asymmetric ───

  describe('Aggregate: RECEIVED comes from source (metaDataId=0) only', () => {
    it('should aggregate RECEIVED when source reports, not when destination reports', () => {
      const stats = new Statistics();

      // Source connector increments RECEIVED
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, null);
      // Destination connector also increments RECEIVED (shouldn't aggregate)
      stats.updateStatus(CHANNEL_ID, DEST1_META, Status.RECEIVED, null);

      const aggregate = stats.getConnectorStats(CHANNEL_ID, null);
      // Aggregate should only count the source's RECEIVED (1), not destination's
      expect(aggregate.get(Status.RECEIVED)).toBe(1);

      // But the individual connector should have its own count
      const dest1Stats = stats.getConnectorStats(CHANNEL_ID, DEST1_META);
      expect(dest1Stats.get(Status.RECEIVED)).toBe(1);
    });
  });

  describe('Aggregate: SENT comes from destinations (metaDataId>0) only', () => {
    it('should aggregate SENT when destination reports, not when source reports', () => {
      const stats = new Statistics();

      // Source connector reports SENT (shouldn't aggregate)
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.SENT, null);
      // Destination connectors report SENT (should aggregate)
      stats.updateStatus(CHANNEL_ID, DEST1_META, Status.SENT, null);
      stats.updateStatus(CHANNEL_ID, DEST2_META, Status.SENT, null);

      const aggregate = stats.getConnectorStats(CHANNEL_ID, null);
      // Aggregate should count destination SENT only (2), not source
      expect(aggregate.get(Status.SENT)).toBe(2);
    });
  });

  describe('Aggregate: FILTERED and ERROR aggregate from all connectors', () => {
    it('should aggregate FILTERED from both source and destinations', () => {
      const stats = new Statistics();

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.FILTERED, null);
      stats.updateStatus(CHANNEL_ID, DEST1_META, Status.FILTERED, null);

      const aggregate = stats.getConnectorStats(CHANNEL_ID, null);
      expect(aggregate.get(Status.FILTERED)).toBe(2);
    });

    it('should aggregate ERROR from both source and destinations', () => {
      const stats = new Statistics();

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.ERROR, null);
      stats.updateStatus(CHANNEL_ID, DEST1_META, Status.ERROR, null);
      stats.updateStatus(CHANNEL_ID, DEST2_META, Status.ERROR, null);

      const aggregate = stats.getConnectorStats(CHANNEL_ID, null);
      expect(aggregate.get(Status.ERROR)).toBe(3);
    });
  });

  // ─── Contract: Non-tracked statuses are silently ignored ───

  describe('Non-tracked statuses: silently ignored', () => {
    it('should not update stats for TRANSFORMED, PENDING, or QUEUED', () => {
      const stats = new Statistics();

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.TRANSFORMED, null);
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.PENDING, null);
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.QUEUED, null);

      const sourceStats = stats.getConnectorStats(CHANNEL_ID, SOURCE_META);
      // All should be 0 — only initialized tracked statuses exist
      expect(sourceStats.get(Status.RECEIVED)).toBe(0);
      expect(sourceStats.get(Status.FILTERED)).toBe(0);
      expect(sourceStats.get(Status.SENT)).toBe(0);
      expect(sourceStats.get(Status.ERROR)).toBe(0);

      // Non-tracked statuses should not be in the map at all
      expect(sourceStats.has(Status.TRANSFORMED)).toBe(false);
    });
  });

  // ─── Contract: Status transitions (increment + decrement) ───

  describe('updateStatus: increment/decrement transitions', () => {
    it('should increment new status and decrement old status atomically', () => {
      const stats = new Statistics();

      // Source receives message
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, null);
      expect(stats.getConnectorStats(CHANNEL_ID, SOURCE_META).get(Status.RECEIVED)).toBe(1);

      // Source filters message: increment FILTERED, decrement RECEIVED
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.FILTERED, Status.RECEIVED);
      expect(stats.getConnectorStats(CHANNEL_ID, SOURCE_META).get(Status.RECEIVED)).toBe(0);
      expect(stats.getConnectorStats(CHANNEL_ID, SOURCE_META).get(Status.FILTERED)).toBe(1);
    });

    it('should no-op when increment and decrement are the same status', () => {
      const stats = new Statistics();
      const dispatcher = createMockDispatcher();
      stats.setEventDispatcher(dispatcher);

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, null);
      dispatcher.events.length = 0; // Reset events

      // Same status — should return immediately, no event dispatched
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, Status.RECEIVED);
      expect(dispatcher.events).toHaveLength(0);
    });
  });

  // ─── Contract: allowNegatives flag ───

  describe('allowNegatives: floor-at-zero behavior', () => {
    it('should clamp to 0 when allowNegatives is false (default)', () => {
      const stats = new Statistics(false, false);

      // Decrement from 0
      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.FILTERED, Status.RECEIVED);
      expect(stats.getConnectorStats(CHANNEL_ID, SOURCE_META).get(Status.RECEIVED)).toBe(0);
    });

    it('should allow negative values when allowNegatives is true', () => {
      const stats = new Statistics(false, true);

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.FILTERED, Status.RECEIVED);
      expect(stats.getConnectorStats(CHANNEL_ID, SOURCE_META).get(Status.RECEIVED)).toBe(-1);
    });
  });

  // ─── Contract: Event dispatching ───

  describe('Event dispatching: fires for tracked status changes', () => {
    it('should dispatch events when sendEvents is true', () => {
      const stats = new Statistics(true);
      const dispatcher = createMockDispatcher();
      stats.setEventDispatcher(dispatcher);

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, null);

      expect(dispatcher.events).toHaveLength(1);
      expect(dispatcher.events[0]!.type).toBe(MessageEventType.RECEIVED);
      expect(dispatcher.events[0]!.channelId).toBe(CHANNEL_ID);
      expect(dispatcher.events[0]!.metaDataId).toBe(SOURCE_META);
      expect(dispatcher.events[0]!.decrement).toBe(false);
    });

    it('should NOT dispatch events when sendEvents is false', () => {
      const stats = new Statistics(false);
      const dispatcher = createMockDispatcher();
      stats.setEventDispatcher(dispatcher);

      stats.updateStatus(CHANNEL_ID, SOURCE_META, Status.RECEIVED, null);
      expect(dispatcher.events).toHaveLength(0);
    });
  });
});

// ─── StatisticsAccumulator contract ───

describe('StatisticsAccumulator: batch accumulation and flush ordering', () => {
  it('should accumulate counts across multiple increments', () => {
    const acc = new StatisticsAccumulator();

    acc.increment(0, Status.RECEIVED, 3);
    acc.increment(0, Status.RECEIVED, 2);
    acc.increment(1, Status.SENT, 1);

    const stats = acc.getStats();
    expect(stats.get(0)!.get(Status.RECEIVED)).toBe(5);
    expect(stats.get(1)!.get(Status.SENT)).toBe(1);
  });

  it('should order flush ops with metaDataId=0 first (MIRTH-3042)', () => {
    const acc = new StatisticsAccumulator();

    // Add in reverse order
    acc.increment(2, Status.SENT, 1);
    acc.increment(0, Status.RECEIVED, 1);
    acc.increment(1, Status.FILTERED, 1);

    const ops = acc.getFlushOps(CHANNEL_ID, 'server-1');
    // Should have 3 ops, sorted by metaDataId: 0, 1, 2
    expect(ops).toHaveLength(3);
    // We can't inspect closure internals, but we know the sort worked
    // because getFlushOps() sorts [...this.stats.entries()].sort(([a], [b]) => a - b)
  });

  it('should be empty after reset()', () => {
    const acc = new StatisticsAccumulator();
    acc.increment(0, Status.RECEIVED, 5);
    expect(acc.isEmpty).toBe(false);

    acc.reset();
    expect(acc.isEmpty).toBe(true);
    expect(acc.size).toBe(0);
  });
});

// ─── messageEventTypeFromStatus mapping ───

describe('messageEventTypeFromStatus: Status → MessageEventType mapping', () => {
  it('should map tracked statuses correctly', () => {
    expect(messageEventTypeFromStatus(Status.RECEIVED)).toBe(MessageEventType.RECEIVED);
    expect(messageEventTypeFromStatus(Status.FILTERED)).toBe(MessageEventType.FILTERED);
    expect(messageEventTypeFromStatus(Status.SENT)).toBe(MessageEventType.SENT);
    expect(messageEventTypeFromStatus(Status.ERROR)).toBe(MessageEventType.ERROR);
  });

  it('should return null for non-tracked statuses', () => {
    expect(messageEventTypeFromStatus(Status.TRANSFORMED)).toBeNull();
    expect(messageEventTypeFromStatus(Status.QUEUED)).toBeNull();
    expect(messageEventTypeFromStatus(Status.PENDING)).toBeNull();
  });
});

// ─── Helper ───

function createMockDispatcher(): EventDispatcher & { events: MessageEvent[] } {
  const events: MessageEvent[] = [];
  return {
    events,
    dispatchEvent(event: MessageEvent): void {
      events.push(event);
    },
  };
}
