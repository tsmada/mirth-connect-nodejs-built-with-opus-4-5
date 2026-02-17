/**
 * Tests for custom Mirth Connect OTEL metrics.
 *
 * These verify metric creation and recording work correctly,
 * even when no OTLP collector is configured (metrics are no-ops
 * when the SDK isn't initialized — they just don't export).
 */

import {
  messagesProcessed,
  messagesErrored,
  messagesPruned,
  messageDuration,
  queueDepth,
  wsConnections,
  registerObservableGauges,
} from '../../../src/telemetry/metrics.js';

describe('Mirth OTEL Metrics', () => {
  describe('Counter metrics', () => {
    it('should increment messagesProcessed without error', () => {
      expect(() => {
        messagesProcessed.add(1, { 'channel.name': 'test-channel', 'message.status': 'SENT' });
      }).not.toThrow();
    });

    it('should increment messagesErrored without error', () => {
      expect(() => {
        messagesErrored.add(1, { 'channel.name': 'test-channel' });
      }).not.toThrow();
    });

    it('should increment messagesPruned without error', () => {
      expect(() => {
        messagesPruned.add(50, { 'channel.name': 'test-channel' });
      }).not.toThrow();
    });

    it('should accept zero increment', () => {
      expect(() => {
        messagesProcessed.add(0, { 'channel.name': 'test-channel', 'message.status': 'FILTERED' });
      }).not.toThrow();
    });
  });

  describe('Histogram metrics', () => {
    it('should record messageDuration without error', () => {
      expect(() => {
        messageDuration.record(42.5, { 'channel.name': 'test-channel' });
      }).not.toThrow();
    });

    it('should record very small durations', () => {
      expect(() => {
        messageDuration.record(0.1, { 'channel.name': 'fast-channel' });
      }).not.toThrow();
    });

    it('should record very large durations', () => {
      expect(() => {
        messageDuration.record(30000, { 'channel.name': 'slow-channel' });
      }).not.toThrow();
    });
  });

  describe('UpDownCounter metrics', () => {
    it('should increment queueDepth', () => {
      expect(() => {
        queueDepth.add(1, { 'channel.id': 'abc-123', 'queue.type': 'source' });
      }).not.toThrow();
    });

    it('should decrement queueDepth', () => {
      expect(() => {
        queueDepth.add(-1, { 'channel.id': 'abc-123', 'queue.type': 'source' });
      }).not.toThrow();
    });

    it('should increment wsConnections', () => {
      expect(() => {
        wsConnections.add(1, { 'ws.path': '/ws/dashboardstatus' });
      }).not.toThrow();
    });

    it('should decrement wsConnections', () => {
      expect(() => {
        wsConnections.add(-1, { 'ws.path': '/ws/dashboardstatus' });
      }).not.toThrow();
    });
  });

  describe('Observable gauges', () => {
    it('should register observable gauges without error', () => {
      expect(() => {
        registerObservableGauges({
          getDeployedChannelCount: () => 5,
          getStartedChannelCount: () => 3,
          getDbPoolActive: () => 2,
          getDbPoolIdle: () => 8,
        });
      }).not.toThrow();
    });

    it('should handle accessor functions that return zero', () => {
      expect(() => {
        registerObservableGauges({
          getDeployedChannelCount: () => 0,
          getStartedChannelCount: () => 0,
          getDbPoolActive: () => 0,
          getDbPoolIdle: () => 0,
        });
      }).not.toThrow();
    });
  });

  describe('Metric attributes', () => {
    it('should accept empty attributes', () => {
      expect(() => {
        messagesProcessed.add(1, {});
      }).not.toThrow();
    });

    it('should accept multiple attributes', () => {
      expect(() => {
        messagesProcessed.add(1, {
          'channel.name': 'ADT Receiver',
          'message.status': 'ERROR',
          'error.type': 'TIMEOUT',
        });
      }).not.toThrow();
    });
  });
});
