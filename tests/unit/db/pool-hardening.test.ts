import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the logging module before importing withRetry
jest.mock('../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
  })),
}));

import { withRetry } from '../../../src/db/pool.js';

describe('withRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should succeed on first try without retrying', async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue('success');

    const result = await withRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on deadlock (errno 1213) and succeed', async () => {
    const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });
    const fn = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlockError)
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, 3);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on lock wait timeout (errno 1205) and succeed', async () => {
    const timeoutError = Object.assign(new Error('Lock wait timeout'), { errno: 1205 });
    const fn = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, 3);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on non-deadlock errors (e.g. errno 1062 duplicate key)', async () => {
    const dupKeyError = Object.assign(new Error('Duplicate entry'), { errno: 1062 });
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(dupKeyError);

    await expect(withRetry(fn, 3)).rejects.toThrow('Duplicate entry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after exhausting all retries', async () => {
    const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(deadlockError);

    await expect(withRetry(fn, 3)).rejects.toThrow('Deadlock found');
    // 3 attempts total: attempts 1 and 2 retry, attempt 3 throws
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
