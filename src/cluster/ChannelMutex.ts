/**
 * Per-key async mutex for serializing access to channel-specific resources.
 *
 * Uses Promise chains (not actual OS mutexes) to serialize async operations
 * on the same key while allowing different keys to proceed concurrently.
 *
 * Used by SequenceAllocator to prevent in-memory block overwrites at the
 * await allocateBlock() boundary.
 */
export class ChannelMutex {
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire exclusive access for the given key.
   * Returns a release function that MUST be called in a finally block.
   */
  async acquire(key: string): Promise<() => void> {
    // Wait for any existing lock on this key
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release!: () => void;
    const promise = new Promise<void>(r => { release = () => { this.locks.delete(key); r(); }; });
    this.locks.set(key, promise);
    return release;
  }

  /** Check if a key currently has an active lock (for diagnostics) */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /** Get count of active locks (for diagnostics) */
  get activeLockCount(): number {
    return this.locks.size;
  }
}
