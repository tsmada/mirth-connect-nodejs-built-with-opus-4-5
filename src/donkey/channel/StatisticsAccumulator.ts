/**
 * Batch statistics accumulator for the Donkey message pipeline.
 *
 * Java Mirth accumulates statistics in a Statistics object and writes them
 * once at the end of each transaction. This avoids the overhead of individual
 * updateStatistics() calls per status change per destination (~8-12 DB calls
 * per message reduced to 1-3 batched writes).
 *
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/Statistics.java
 */

import { PoolConnection } from 'mysql2/promise';
import { Status } from '../../model/Status.js';
import { updateStatistics } from '../../db/DonkeyDao.js';

export class StatisticsAccumulator {
  // Map<metaDataId, Map<Status, count>>
  private stats = new Map<number, Map<Status, number>>();

  /**
   * Record a status increment for a connector.
   */
  increment(metaDataId: number, status: Status, count = 1): void {
    if (!this.stats.has(metaDataId)) {
      this.stats.set(metaDataId, new Map());
    }
    const statusMap = this.stats.get(metaDataId)!;
    statusMap.set(status, (statusMap.get(status) || 0) + count);
  }

  /**
   * Returns transaction operations to persist all accumulated stats.
   * Channel-level stats (metaDataId=0) are flushed first per MIRTH-3042
   * (prevents deadlocks when channel and connector stats rows are locked
   * in consistent order).
   */
  getFlushOps(channelId: string, serverId: string): Array<(conn: PoolConnection) => Promise<void>> {
    const ops: Array<(conn: PoolConnection) => Promise<void>> = [];

    // Sort: metaDataId 0 first (channel-level), then ascending
    const sortedEntries = [...this.stats.entries()].sort(([a], [b]) => a - b);

    for (const [metaDataId, statusMap] of sortedEntries) {
      for (const [status, count] of statusMap) {
        ops.push(async (conn) => {
          await updateStatistics(channelId, metaDataId, serverId, status, count, conn);
        });
      }
    }

    return ops;
  }

  /**
   * Clear all accumulated stats. Call after a successful transaction commit.
   */
  reset(): void {
    this.stats.clear();
  }

  /**
   * Number of distinct metaDataIds with accumulated stats.
   */
  get size(): number {
    return this.stats.size;
  }

  /**
   * Check if any stats have been accumulated.
   */
  get isEmpty(): boolean {
    return this.stats.size === 0;
  }

  /**
   * Get the raw stats map (for testing/inspection).
   */
  getStats(): Map<number, Map<Status, number>> {
    return new Map(
      [...this.stats.entries()].map(([id, statusMap]) => [id, new Map(statusMap)])
    );
  }
}
