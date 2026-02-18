import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies
const mockExecute = jest.fn<(sql: string, params?: unknown) => Promise<{ affectedRows: number }>>()
  .mockResolvedValue({ affectedRows: 1 } as never);
const mockQuery = jest.fn<(sql: string, params?: unknown) => Promise<unknown[]>>()
  .mockResolvedValue([]);

jest.mock('../../../src/db/pool.js', () => ({
  query: (sql: string, params?: unknown) => mockQuery(sql, params),
  execute: (sql: string, params?: unknown) => mockExecute(sql, params),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'test-server',
    clusterEnabled: false,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
}));

jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'test-server'),
}));

import {
  LocalEventBus,
  DatabasePollingEventBus,
  createEventBus,
} from '../../../src/cluster/EventBus.js';
import { getClusterConfig } from '../../../src/cluster/ClusterConfig.js';

describe('EventBus', () => {
  describe('LocalEventBus', () => {
    let bus: LocalEventBus;

    beforeEach(() => {
      bus = new LocalEventBus();
    });

    afterEach(async () => {
      await bus.close();
    });

    it('should deliver published events to subscribers', async () => {
      const handler = jest.fn();
      bus.subscribe('test-channel', handler);

      await bus.publish('test-channel', { key: 'value' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should deliver to multiple subscribers on the same channel', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      bus.subscribe('test-channel', handler1);
      bus.subscribe('test-channel', handler2);

      await bus.publish('test-channel', 'hello');

      expect(handler1).toHaveBeenCalledWith('hello');
      expect(handler2).toHaveBeenCalledWith('hello');
    });

    it('should not deliver events to unsubscribed handlers', async () => {
      const handler = jest.fn();
      bus.subscribe('test-channel', handler);
      bus.unsubscribe('test-channel', handler);

      await bus.publish('test-channel', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not deliver events to subscribers on different channels', async () => {
      const handler = jest.fn();
      bus.subscribe('channel-a', handler);

      await bus.publish('channel-b', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle publishing to channel with no subscribers', async () => {
      // Should not throw
      await bus.publish('no-subscribers', 'data');
    });

    it('should handle handler errors without affecting other handlers', async () => {
      const errorHandler = jest.fn(() => { throw new Error('boom'); });
      const goodHandler = jest.fn();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      bus.subscribe('test', errorHandler);
      bus.subscribe('test', goodHandler);

      await bus.publish('test', 'data');

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should clean up all handlers on close', async () => {
      const handler = jest.fn();
      bus.subscribe('test', handler);

      await bus.close();
      await bus.publish('test', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle unsubscribe from non-existent channel', () => {
      const handler = jest.fn();
      // Should not throw
      bus.unsubscribe('non-existent', handler);
    });
  });

  describe('DatabasePollingEventBus', () => {
    let bus: DatabasePollingEventBus;

    beforeEach(() => {
      jest.clearAllMocks();
      // Use a long poll interval so it doesn't auto-poll during tests
      bus = new DatabasePollingEventBus(60000);
    });

    afterEach(async () => {
      await bus.close();
    });

    it('should write events to D_CLUSTER_EVENTS on publish', async () => {
      await bus.publish('dashboard', { type: 'stateChange' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const sql = mockExecute.mock.calls[0]![0] as string;
      expect(sql).toContain('INSERT INTO D_CLUSTER_EVENTS');
      expect(mockExecute.mock.calls[0]![1]).toEqual({
        channel: 'dashboard',
        data: JSON.stringify({ type: 'stateChange' }),
        serverId: 'test-server',
      });
    });

    it('should also dispatch locally on publish', async () => {
      const handler = jest.fn();
      bus.subscribe('dashboard', handler);

      await bus.publish('dashboard', { type: 'stateChange' });

      expect(handler).toHaveBeenCalledWith({ type: 'stateChange' });
    });

    it('should subscribe and unsubscribe handlers', async () => {
      const handler = jest.fn();
      bus.subscribe('test', handler);

      await bus.publish('test', 'data');
      expect(handler).toHaveBeenCalledTimes(1);

      bus.unsubscribe('test', handler);
      await bus.publish('test', 'data2');
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should clean up timer on close', async () => {
      bus.start();
      await bus.close();
      // No assertion needed — just verifying it doesn't throw or leak
    });
  });

  describe('createEventBus', () => {
    it('should return LocalEventBus when cluster is disabled', () => {
      (getClusterConfig as jest.Mock).mockReturnValue({
        serverId: 'test-server',
        clusterEnabled: false,
      });

      const bus = createEventBus();

      expect(bus).toBeInstanceOf(LocalEventBus);
    });

    it('should return DatabasePollingEventBus when cluster is enabled without Redis', () => {
      (getClusterConfig as jest.Mock).mockReturnValue({
        serverId: 'test-server',
        clusterEnabled: true,
        // No redisUrl
      });

      const bus = createEventBus();

      expect(bus).toBeInstanceOf(DatabasePollingEventBus);
      bus.close();
    });
  });
});
