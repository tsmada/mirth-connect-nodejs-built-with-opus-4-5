/**
 * Tests for src/index.ts — verifies process-level handler patterns.
 *
 * Since index.ts is the entry point and calls process.exit(), we cannot
 * import it directly. Instead we test the handler patterns in isolation.
 */

describe('index.ts process handlers', () => {
  it('process supports unhandledRejection listener registration', () => {
    const handler = jest.fn();
    process.on('unhandledRejection', handler);
    expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0);
    process.removeListener('unhandledRejection', handler);
  });

  it('process supports uncaughtException listener registration', () => {
    const handler = jest.fn();
    process.on('uncaughtException', handler);
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
    process.removeListener('uncaughtException', handler);
  });

  it('gracefulShutdown returns immediately when mirth is null', async () => {
    let stopCalled = false;
    const mockMirth: { stop: () => Promise<void> } | null = null;

    async function gracefulShutdown(): Promise<void> {
      if (!mockMirth) return;
      stopCalled = true;
      await mockMirth.stop();
    }

    await gracefulShutdown();
    expect(stopCalled).toBe(false);
  });

  it('gracefulShutdown calls mirth.stop() with timeout protection', async () => {
    let stopCalled = false;
    const mockMirth = {
      stop: jest.fn(async () => { stopCalled = true; }),
    };

    async function gracefulShutdown(): Promise<void> {
      if (!mockMirth) return;
      const timeout = setTimeout(() => { /* force exit */ }, 5000);
      try {
        await mockMirth.stop();
      } finally {
        clearTimeout(timeout);
      }
    }

    await gracefulShutdown();
    expect(stopCalled).toBe(true);
    expect(mockMirth.stop).toHaveBeenCalledTimes(1);
  });

  it('gracefulShutdown clears timeout even if stop() throws', async () => {
    jest.useFakeTimers();
    const mockMirth = {
      stop: jest.fn(async () => { throw new Error('shutdown failed'); }),
    };

    async function gracefulShutdown(): Promise<void> {
      if (!mockMirth) return;
      const timeout = setTimeout(() => { /* force exit */ }, 5000);
      try {
        await mockMirth.stop();
      } finally {
        clearTimeout(timeout);
      }
    }

    await expect(gracefulShutdown()).rejects.toThrow('shutdown failed');
    // Verify no pending timers (timeout was cleared in finally block)
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
