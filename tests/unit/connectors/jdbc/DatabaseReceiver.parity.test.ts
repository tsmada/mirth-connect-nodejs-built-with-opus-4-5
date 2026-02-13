/**
 * DatabaseReceiver Event Dispatch Parity Tests (Wave 17)
 *
 * Verifies that DatabaseReceiver dispatches connection status events
 * matching Java DatabaseReceiver.java lifecycle:
 *   - start(): IDLE
 *   - poll(): POLLING -> READING -> IDLE (in finally)
 */

import { DatabaseReceiver } from '../../../../src/connectors/jdbc/DatabaseReceiver';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Mock the DashboardStatusController to capture events
const mockProcessEvent = jest.fn();
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
  },
}));

// Mock mysql2/promise to avoid real DB connections
const mockQuery = jest.fn().mockResolvedValue([[], []]);
const mockRelease = jest.fn();
const mockGetConnection = jest.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});
jest.mock('mysql2/promise', () => ({
  createPool: jest.fn().mockReturnValue({
    getConnection: () => mockGetConnection(),
    end: jest.fn().mockResolvedValue(undefined),
  }),
}));

describe('DatabaseReceiver Event Dispatch Parity', () => {
  let receiver: DatabaseReceiver;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    mockProcessEvent.mockClear();
    mockQuery.mockClear();
    mockRelease.mockClear();
    mockGetConnection.mockClear();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  afterEach(async () => {
    if (receiver?.isRunning()) {
      await receiver.stop();
    }
  });

  it('should dispatch IDLE on start (matching Java onDeploy)', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();

    // First event should be IDLE (from start/deploy)
    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.IDLE,
        channelId: 'test-channel-id',
      })
    );
  });

  it('should dispatch POLLING at start of poll cycle', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    // Directly invoke the private poll() method to test event dispatch
    // (The immediate poll from start() races with this.running = true)
    await (receiver as any).poll();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.POLLING);
  });

  it('should dispatch READING after query in poll cycle', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    await (receiver as any).poll();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.READING);
  });

  it('should dispatch IDLE in finally after poll completes', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    await (receiver as any).poll();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    // Last event from poll should be IDLE (from finally block)
    expect(events[events.length - 1]).toBe(ConnectionStatusEventType.IDLE);
  });

  it('should follow POLLING -> READING -> IDLE lifecycle order', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    await (receiver as any).poll();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toEqual([
      ConnectionStatusEventType.POLLING,
      ConnectionStatusEventType.READING,
      ConnectionStatusEventType.IDLE,
    ]);
  });

  it('should dispatch IDLE even when poll encounters an error', async () => {
    receiver = new DatabaseReceiver({
      name: 'Test DB Receiver',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
        retryCount: 0,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    // Make getConnection fail
    mockGetConnection.mockRejectedValueOnce(new Error('Connection refused'));

    await (receiver as any).poll();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    // Even on error, IDLE should be dispatched in finally
    expect(events[events.length - 1]).toBe(ConnectionStatusEventType.IDLE);
  });
});

/**
 * Wave 20: CPC-W20-005 — JDBC Receiver lifecycle separation
 * onDeploy/onUndeploy should be separate from start/stop
 */
describe('DatabaseReceiver Lifecycle Parity (Wave 20)', () => {
  let receiver: DatabaseReceiver;
  const { createPool } = jest.requireMock('mysql2/promise');

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    mockProcessEvent.mockClear();
    mockQuery.mockClear();
    mockRelease.mockClear();
    mockGetConnection.mockClear();
    createPool.mockClear();
    mockGetConnection.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  afterEach(async () => {
    if (receiver?.isRunning()) {
      await receiver.stop();
    }
    // Also clean up the pool if created by onDeploy
    if ((receiver as any)?.pool) {
      try { await (receiver as any).onUndeploy(); } catch { /* ignore */ }
    }
  });

  it('CPC-W20-005: onDeploy creates connection pool and dispatches IDLE', async () => {
    receiver = new DatabaseReceiver({
      name: 'Deploy Test',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    expect(receiver.getPool()).toBeNull();

    await receiver.onDeploy();

    // Pool should be created
    expect(receiver.getPool()).not.toBeNull();
    expect(createPool).toHaveBeenCalledTimes(1);

    // IDLE event dispatched
    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.IDLE,
        channelId: 'test-channel-id',
      })
    );
  });

  it('CPC-W20-005: start reuses pool from onDeploy', async () => {
    receiver = new DatabaseReceiver({
      name: 'Reuse Pool Test',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.onDeploy();
    createPool.mockClear();
    mockProcessEvent.mockClear();

    await receiver.start();

    // Should NOT create a new pool (reuses from onDeploy)
    expect(createPool).not.toHaveBeenCalled();
    expect(receiver.isRunning()).toBe(true);
  });

  it('CPC-W20-005: start falls back to creating pool if onDeploy not called', async () => {
    receiver = new DatabaseReceiver({
      name: 'Fallback Test',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    // Skip onDeploy — start should still work
    await receiver.start();

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(receiver.isRunning()).toBe(true);
  });

  it('CPC-W20-005: onUndeploy closes connection pool', async () => {
    receiver = new DatabaseReceiver({
      name: 'Undeploy Test',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.onDeploy();
    expect(receiver.getPool()).not.toBeNull();

    await receiver.onUndeploy();
    expect(receiver.getPool()).toBeNull();
  });

  it('CPC-W20-005: stop does not close pool (pool lifecycle tied to deploy/undeploy)', async () => {
    receiver = new DatabaseReceiver({
      name: 'Stop Pool Test',
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        pollInterval: 999999,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.onDeploy();
    await receiver.start();

    // Stop should not close the pool
    await receiver.stop();
    expect(receiver.getPool()).not.toBeNull();
    expect(receiver.isRunning()).toBe(false);

    // Pool cleaned up in onUndeploy
    await receiver.onUndeploy();
    expect(receiver.getPool()).toBeNull();
  });
});
