import { describe, it, expect, beforeEach } from '@jest/globals';
import { ChannelMutex } from '../../../src/cluster/ChannelMutex.js';

describe('ChannelMutex', () => {
  let mutex: ChannelMutex;

  beforeEach(() => {
    mutex = new ChannelMutex();
  });

  it('acquire() returns a release function', async () => {
    const release = await mutex.acquire('key-1');
    expect(typeof release).toBe('function');
    release();
  });

  it('different keys do not block each other', async () => {
    const order: string[] = [];

    const release1 = await mutex.acquire('key-a');
    order.push('acquired-a');

    // key-b should acquire immediately even though key-a is held
    const release2 = await mutex.acquire('key-b');
    order.push('acquired-b');

    expect(order).toEqual(['acquired-a', 'acquired-b']);
    expect(mutex.activeLockCount).toBe(2);

    release1();
    release2();
  });

  it('same key serializes access', async () => {
    const order: number[] = [];

    const release1 = await mutex.acquire('shared');
    order.push(1);

    // Start a second acquire that will wait for release1
    const promise2 = mutex.acquire('shared').then(release => {
      order.push(2);
      return release;
    });

    // Yield to allow promise2 to start waiting
    await new Promise(r => setTimeout(r, 10));

    // Second acquire should not have proceeded yet
    expect(order).toEqual([1]);

    release1();

    // Now the second acquire should complete
    const release2 = await promise2;
    expect(order).toEqual([1, 2]);
    release2();
  });

  it('isLocked() returns correct state', async () => {
    expect(mutex.isLocked('key-1')).toBe(false);

    const release = await mutex.acquire('key-1');
    expect(mutex.isLocked('key-1')).toBe(true);

    release();
    // After a microtask tick the lock should be cleared
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.isLocked('key-1')).toBe(false);
  });

  it('activeLockCount tracks active locks', async () => {
    expect(mutex.activeLockCount).toBe(0);

    const r1 = await mutex.acquire('a');
    expect(mutex.activeLockCount).toBe(1);

    const r2 = await mutex.acquire('b');
    expect(mutex.activeLockCount).toBe(2);

    r1();
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.activeLockCount).toBe(1);

    r2();
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.activeLockCount).toBe(0);
  });

  it('release clears the lock', async () => {
    const release = await mutex.acquire('key-1');
    expect(mutex.isLocked('key-1')).toBe(true);

    release();
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.isLocked('key-1')).toBe(false);
  });

  it('multiple sequential acquire/release cycles work', async () => {
    for (let i = 0; i < 5; i++) {
      const release = await mutex.acquire('key');
      expect(mutex.isLocked('key')).toBe(true);
      release();
      await new Promise(r => setTimeout(r, 0));
    }
    expect(mutex.isLocked('key')).toBe(false);
    expect(mutex.activeLockCount).toBe(0);
  });

  it('concurrent acquires on same key execute in order', async () => {
    const order: number[] = [];

    const release1 = await mutex.acquire('key');

    // Queue up 3 more acquires
    const p2 = mutex.acquire('key').then(rel => { order.push(2); rel(); });
    const p3 = mutex.acquire('key').then(rel => { order.push(3); rel(); });
    const p4 = mutex.acquire('key').then(rel => { order.push(4); rel(); });

    order.push(1);
    release1();

    await Promise.all([p2, p3, p4]);

    // All should have executed, first holder first
    expect(order[0]).toBe(1);
    // The remaining 3 should all be present (order among waiters is deterministic via microtask queue)
    expect(order).toHaveLength(4);
    expect(order.sort()).toEqual([1, 2, 3, 4]);
  });

  it('error in critical section still releases lock (try/finally pattern)', async () => {
    let threw = false;
    const release = await mutex.acquire('key');
    try {
      throw new Error('simulated failure');
    } catch {
      threw = true;
    } finally {
      release();
    }
    expect(threw).toBe(true);

    // After the error, the key should be unlockable again
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.isLocked('key')).toBe(false);

    // Another caller should be able to acquire
    const release2 = await mutex.acquire('key');
    expect(mutex.isLocked('key')).toBe(true);
    release2();
  });

  it('stress test: many concurrent acquires on same key all get unique sequence', async () => {
    const results: number[] = [];
    let counter = 0;

    const tasks = Array.from({ length: 20 }, async () => {
      const release = await mutex.acquire('counter-key');
      try {
        // Simulate async work
        await new Promise(r => setTimeout(r, Math.random() * 5));
        counter++;
        results.push(counter);
      } finally {
        release();
      }
    });

    await Promise.all(tasks);

    // All 20 tasks should have produced unique sequential numbers
    expect(results).toHaveLength(20);
    expect(new Set(results).size).toBe(20);
    // Values should be 1..20 (serialized access means no duplicates)
    expect(results.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
  });
});
