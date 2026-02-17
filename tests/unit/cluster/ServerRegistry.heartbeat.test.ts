import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: jest.fn(() => 'test-server-hb'),
  resetServerId: jest.fn(),
}));

jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: jest.fn(() => ({
    serverId: 'test-server-hb',
    clusterEnabled: true,
    heartbeatInterval: 1000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  })),
  resetClusterConfig: jest.fn(),
}));

import {
  startHeartbeat,
  stopHeartbeat,
  getConsecutiveHeartbeatFailures,
} from '../../../src/cluster/ServerRegistry.js';
import { execute } from '../../../src/db/pool.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;

describe('ServerRegistry heartbeat self-fencing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopHeartbeat(); // Resets consecutiveHeartbeatFailures
    jest.useFakeTimers();
  });

  afterEach(() => {
    stopHeartbeat();
    jest.useRealTimers();
  });

  it('should reset failure counter on successful heartbeat', async () => {
    // First call fails, second succeeds
    mockExecute
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValue({ affectedRows: 1 } as any);

    startHeartbeat();

    // Trigger first heartbeat — fails
    jest.advanceTimersByTime(1000);
    // Let the async callbacks settle
    await jest.advanceTimersByTimeAsync(0);

    expect(getConsecutiveHeartbeatFailures()).toBe(1);

    // Trigger second heartbeat — succeeds
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);

    expect(getConsecutiveHeartbeatFailures()).toBe(0);
  });

  it('should increment failure counter on each failed heartbeat', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    mockExecute.mockRejectedValue(new Error('DB gone'));

    startHeartbeat();

    // 1st failure
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConsecutiveHeartbeatFailures()).toBe(1);

    // 2nd failure
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConsecutiveHeartbeatFailures()).toBe(2);

    exitSpy.mockRestore();
  });

  it('should call process.exit(1) after MAX_HEARTBEAT_FAILURES consecutive failures', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    mockExecute.mockRejectedValue(new Error('DB gone'));

    startHeartbeat();

    // Default MAX_HEARTBEAT_FAILURES is 3
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(1000);
      await jest.advanceTimersByTimeAsync(0);
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should not call process.exit if failures recover before threshold', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Fail twice, then succeed
    mockExecute
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ affectedRows: 1 } as any);

    startHeartbeat();

    // 2 failures
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConsecutiveHeartbeatFailures()).toBe(2);

    // Recovery
    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConsecutiveHeartbeatFailures()).toBe(0);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('should reset failure counter when stopHeartbeat is called', async () => {
    mockExecute.mockRejectedValue(new Error('DB gone'));

    startHeartbeat();

    jest.advanceTimersByTime(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(getConsecutiveHeartbeatFailures()).toBe(1);

    stopHeartbeat();
    expect(getConsecutiveHeartbeatFailures()).toBe(0);
  });
});
