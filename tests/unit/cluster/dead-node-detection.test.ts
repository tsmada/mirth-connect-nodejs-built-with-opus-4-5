import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'test-server-001'),
  resetServerId: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'test-server-001',
    clusterEnabled: true,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
  resetClusterConfig: jest.fn(),
}));

import {
  startDeadNodeDetection,
  stopDeadNodeDetection,
  startHeartbeat,
  stopHeartbeat,
} from '../../../src/cluster/ServerRegistry.js';
import { query, execute } from '../../../src/db/pool.js';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;

/** Flush pending microtasks so async interval callbacks settle. */
async function flushMicrotasks(): Promise<void> {
  // Multiple rounds of microtask flushing to allow chained promises to resolve
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('Dead Node Detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env = { ...originalEnv };
    stopHeartbeat(); // Cleans up both heartbeat and dead node timers
  });

  afterEach(() => {
    stopHeartbeat();
    jest.useRealTimers();
    process.env = originalEnv;
  });

  it('should mark dead nodes as OFFLINE after timeout', async () => {
    // getOfflineNodeIds returns stale nodes
    mockQuery.mockResolvedValue([
      { SERVER_ID: 'dead-node-1' },
      { SERVER_ID: 'dead-node-2' },
    ] as any);
    mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

    startDeadNodeDetection();

    // Advance past one interval (10000ms)
    jest.advanceTimersByTime(10000);
    await flushMicrotasks();

    // Should have called execute for each dead node
    const updateCalls = mockExecute.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("STATUS = 'OFFLINE'") && sql.includes('D_SERVERS')
    );
    expect(updateCalls).toHaveLength(2);

    expect(updateCalls[0]![1]).toEqual(expect.objectContaining({ serverId: 'dead-node-1' }));
    expect(updateCalls[1]![1]).toEqual(expect.objectContaining({ serverId: 'dead-node-2' }));

    stopDeadNodeDetection();
  });

  it('should not mark any nodes offline when all are healthy', async () => {
    // getOfflineNodeIds returns empty array
    mockQuery.mockResolvedValue([] as any);
    mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

    startDeadNodeDetection();

    jest.advanceTimersByTime(10000);
    await flushMicrotasks();

    // No UPDATE calls for dead nodes
    const offlineCalls = mockExecute.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes("STATUS = 'OFFLINE'") && sql.includes('D_SERVERS')
    );
    expect(offlineCalls).toHaveLength(0);

    stopDeadNodeDetection();
  });

  it('should not start dead node cleanup when env var is false', () => {
    process.env['MIRTH_CLUSTER_DEAD_NODE_CLEANUP'] = 'false';
    mockExecute.mockResolvedValue({ affectedRows: 1 } as any);

    startHeartbeat();

    jest.advanceTimersByTime(10000);

    // Only heartbeat UPDATE should fire, no getOfflineNodeIds query
    expect(mockQuery).not.toHaveBeenCalled();

    stopHeartbeat();
  });

  it('should start dead node detection automatically with heartbeat by default', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 } as any);
    mockQuery.mockResolvedValue([] as any);

    startHeartbeat();

    jest.advanceTimersByTime(10000);
    await flushMicrotasks();

    // getOfflineNodeIds should have been called (dead node detection started)
    expect(mockQuery).toHaveBeenCalled();

    stopHeartbeat();
  });

  it('should be idempotent - calling startDeadNodeDetection twice is a no-op', async () => {
    mockQuery.mockResolvedValue([] as any);

    startDeadNodeDetection();
    startDeadNodeDetection(); // Second call should be no-op

    jest.advanceTimersByTime(10000);
    await flushMicrotasks();

    // Should only fire once per interval, not twice
    expect(mockQuery).toHaveBeenCalledTimes(1);

    stopDeadNodeDetection();
  });

  it('should handle database errors gracefully without crashing', async () => {
    mockQuery.mockRejectedValue(new Error('Connection lost'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    startDeadNodeDetection();

    jest.advanceTimersByTime(10000);
    await flushMicrotasks();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[ServerRegistry] Dead node detection failed:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
    stopDeadNodeDetection();
  });
});
