import {
  Statistics,
  TRACKED_STATUSES,
  MessageEventType,
  messageEventTypeFromStatus,
  EventDispatcher,
  MessageEvent,
} from '../../../../src/donkey/channel/Statistics';
import { Status } from '../../../../src/model/Status';

// Mock event dispatcher for testing
class MockEventDispatcher implements EventDispatcher {
  public events: MessageEvent[] = [];

  dispatchEvent(event: MessageEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
  }
}

describe('Statistics', () => {
  let stats: Statistics;

  beforeEach(() => {
    stats = new Statistics(false);
  });

  describe('constructor', () => {
    it('should create empty statistics', () => {
      expect(stats.isEmpty()).toBe(true);
    });

    it('should support sendEvents option', () => {
      const statsWithEvents = new Statistics(true);
      expect(statsWithEvents).toBeDefined();
    });

    it('should support allowNegatives option', () => {
      const statsAllowNegative = new Statistics(false, true);
      expect(statsAllowNegative).toBeDefined();
    });
  });

  describe('TRACKED_STATUSES', () => {
    it('should include RECEIVED, FILTERED, SENT, ERROR', () => {
      expect(TRACKED_STATUSES).toContain(Status.RECEIVED);
      expect(TRACKED_STATUSES).toContain(Status.FILTERED);
      expect(TRACKED_STATUSES).toContain(Status.SENT);
      expect(TRACKED_STATUSES).toContain(Status.ERROR);
    });

    it('should not include TRANSFORMED or QUEUED', () => {
      expect(TRACKED_STATUSES).not.toContain(Status.TRANSFORMED);
      expect(TRACKED_STATUSES).not.toContain(Status.QUEUED);
    });
  });

  describe('messageEventTypeFromStatus', () => {
    it('should map tracked statuses to event types', () => {
      expect(messageEventTypeFromStatus(Status.RECEIVED)).toBe(MessageEventType.RECEIVED);
      expect(messageEventTypeFromStatus(Status.FILTERED)).toBe(MessageEventType.FILTERED);
      expect(messageEventTypeFromStatus(Status.SENT)).toBe(MessageEventType.SENT);
      expect(messageEventTypeFromStatus(Status.ERROR)).toBe(MessageEventType.ERROR);
    });

    it('should return null for untracked statuses', () => {
      expect(messageEventTypeFromStatus(Status.TRANSFORMED)).toBeNull();
      expect(messageEventTypeFromStatus(Status.QUEUED)).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should increment status count', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(1);
    });

    it('should decrement status count when provided', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 0, Status.SENT, Status.RECEIVED);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(0);
      expect(connectorStats.get(Status.SENT)).toBe(1);
    });

    it('should not update if increment equals decrement', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, Status.RECEIVED);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(0);
    });

    it('should update aggregate stats for RECEIVED on source connector', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);

      const aggregateStats = stats.getConnectorStats('channel-1', null);
      expect(aggregateStats.get(Status.RECEIVED)).toBe(1);
    });

    it('should not update aggregate stats for RECEIVED on destination connector', () => {
      stats.updateStatus('channel-1', 1, Status.RECEIVED, null);

      const aggregateStats = stats.getConnectorStats('channel-1', null);
      expect(aggregateStats.get(Status.RECEIVED)).toBe(0);
    });

    it('should update aggregate stats for SENT on destination connector', () => {
      stats.updateStatus('channel-1', 1, Status.SENT, null);

      const aggregateStats = stats.getConnectorStats('channel-1', null);
      expect(aggregateStats.get(Status.SENT)).toBe(1);
    });

    it('should not update aggregate stats for SENT on source connector', () => {
      stats.updateStatus('channel-1', 0, Status.SENT, null);

      const aggregateStats = stats.getConnectorStats('channel-1', null);
      expect(aggregateStats.get(Status.SENT)).toBe(0);
    });

    it('should update aggregate stats for FILTERED and ERROR from all connectors', () => {
      stats.updateStatus('channel-1', 0, Status.FILTERED, null);
      stats.updateStatus('channel-1', 1, Status.ERROR, null);

      const aggregateStats = stats.getConnectorStats('channel-1', null);
      expect(aggregateStats.get(Status.FILTERED)).toBe(1);
      expect(aggregateStats.get(Status.ERROR)).toBe(1);
    });
  });

  describe('updateConnector', () => {
    it('should update multiple statuses at once', () => {
      const diff = new Map<Status, number>();
      diff.set(Status.RECEIVED, 5);
      diff.set(Status.SENT, 3);

      stats.updateConnector('channel-1', 1, diff);

      const connectorStats = stats.getConnectorStats('channel-1', 1);
      expect(connectorStats.get(Status.RECEIVED)).toBe(5);
      expect(connectorStats.get(Status.SENT)).toBe(3);
    });
  });

  describe('overwrite', () => {
    it('should overwrite connector stats', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);

      const newStats = new Map<Status, number>();
      newStats.set(Status.RECEIVED, 100);
      newStats.set(Status.SENT, 50);

      stats.overwrite('channel-1', 0, newStats);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(100);
      expect(connectorStats.get(Status.SENT)).toBe(50);
    });
  });

  describe('resetStats', () => {
    it('should reset specified statuses to zero', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 0, Status.ERROR, null);

      stats.resetStats('channel-1', 0, new Set([Status.RECEIVED]));

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(0);
      expect(connectorStats.get(Status.ERROR)).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove all stats for a channel', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-2', 0, Status.RECEIVED, null);

      stats.remove('channel-1');

      const allStats = stats.getStats();
      expect(allStats.has('channel-1')).toBe(false);
      expect(allStats.has('channel-2')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all statistics', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-2', 0, Status.RECEIVED, null);

      stats.clear();

      expect(stats.isEmpty()).toBe(true);
    });
  });

  describe('isEmpty', () => {
    it('should return true when all stats are zero', () => {
      stats.getConnectorStats('channel-1', 0); // Creates entries with zero values
      expect(stats.isEmpty()).toBe(true);
    });

    it('should return false when any stat is non-zero', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      expect(stats.isEmpty()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return all statistics', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 1, Status.SENT, null);
      stats.updateStatus('channel-2', 0, Status.RECEIVED, null);

      const allStats = stats.getStats();

      expect(allStats.size).toBe(2);
      expect(allStats.has('channel-1')).toBe(true);
      expect(allStats.has('channel-2')).toBe(true);
    });
  });

  describe('getChannelStats', () => {
    it('should return stats for specific channel', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 1, Status.SENT, null);

      const channelStats = stats.getChannelStats('channel-1');

      // Should have aggregate (null), source (0), and destination (1)
      expect(channelStats.size).toBe(3);
    });
  });

  describe('event dispatching', () => {
    let statsWithEvents: Statistics;
    let mockDispatcher: MockEventDispatcher;

    beforeEach(() => {
      statsWithEvents = new Statistics(true);
      mockDispatcher = new MockEventDispatcher();
      statsWithEvents.setEventDispatcher(mockDispatcher);
    });

    it('should dispatch events when sendEvents is true', () => {
      statsWithEvents.updateStatus('channel-1', 0, Status.RECEIVED, null);

      expect(mockDispatcher.events.length).toBe(1);
      expect(mockDispatcher.events[0]?.channelId).toBe('channel-1');
      expect(mockDispatcher.events[0]?.metaDataId).toBe(0);
      expect(mockDispatcher.events[0]?.type).toBe(MessageEventType.RECEIVED);
      expect(mockDispatcher.events[0]?.count).toBe(1);
      expect(mockDispatcher.events[0]?.decrement).toBe(false);
    });

    it('should dispatch decrement event', () => {
      statsWithEvents.updateStatus('channel-1', 0, Status.RECEIVED, null);
      mockDispatcher.clear();

      statsWithEvents.updateStatus('channel-1', 0, Status.SENT, Status.RECEIVED);

      // Should have two events: decrement RECEIVED, increment SENT
      expect(mockDispatcher.events.length).toBe(2);
    });
  });

  describe('allowNegatives', () => {
    it('should not allow negative values by default', () => {
      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateStatus('channel-1', 0, Status.ERROR, Status.RECEIVED);
      stats.updateStatus('channel-1', 0, Status.ERROR, Status.RECEIVED);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(0);
    });

    it('should allow negative values when configured', () => {
      const statsAllowNegative = new Statistics(false, true);
      statsAllowNegative.updateStatus('channel-1', 0, Status.RECEIVED, null);
      statsAllowNegative.updateStatus('channel-1', 0, Status.ERROR, Status.RECEIVED);
      statsAllowNegative.updateStatus('channel-1', 0, Status.ERROR, Status.RECEIVED);

      const connectorStats = statsAllowNegative.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(-1);
    });
  });

  describe('updateFromStatistics', () => {
    it('should merge stats from another Statistics object', () => {
      const otherStats = new Statistics(false);
      otherStats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      otherStats.updateStatus('channel-1', 0, Status.RECEIVED, null);

      stats.updateStatus('channel-1', 0, Status.RECEIVED, null);
      stats.updateFromStatistics(otherStats);

      const connectorStats = stats.getConnectorStats('channel-1', 0);
      expect(connectorStats.get(Status.RECEIVED)).toBe(3);
    });
  });

  describe('getTrackedStatuses', () => {
    it('should return set of tracked statuses', () => {
      const trackedSet = Statistics.getTrackedStatuses();

      expect(trackedSet.has(Status.RECEIVED)).toBe(true);
      expect(trackedSet.has(Status.FILTERED)).toBe(true);
      expect(trackedSet.has(Status.SENT)).toBe(true);
      expect(trackedSet.has(Status.ERROR)).toBe(true);
      expect(trackedSet.has(Status.TRANSFORMED)).toBe(false);
    });
  });
});
