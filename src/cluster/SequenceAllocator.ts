/**
 * Block-allocated message ID generator for clustered deployments.
 *
 * Instead of acquiring a database row lock for every message, pre-allocates
 * blocks of N IDs. Reduces D_MSQ contention by ~99% in clustered mode.
 *
 * Trade-off: up to N-1 IDs may be wasted per container restart.
 * This is harmless — IDs need only be unique, not contiguous.
 */

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool.js';

interface SequenceBlock {
  nextId: number;   // Next ID to return
  maxId: number;    // Last ID in this block (exclusive)
}

function sequenceTable(channelId: string): string {
  return `D_MSQ${channelId.replace(/-/g, '_')}`;
}

export class SequenceAllocator {
  private blocks: Map<string, SequenceBlock> = new Map();
  private blockSize: number;

  constructor(blockSize: number = 100) {
    this.blockSize = blockSize;
  }

  /**
   * Get the next message ID for a channel.
   * Allocates a new block from the DB if the current block is exhausted.
   */
  async allocateId(channelId: string): Promise<number> {
    let block = this.blocks.get(channelId);
    if (!block || block.nextId >= block.maxId) {
      block = await this.allocateBlock(channelId);
      this.blocks.set(channelId, block);
    }
    return block.nextId++;
  }

  /**
   * Acquire a block of IDs from the D_MSQ table.
   * Uses FOR UPDATE lock on a single row, but increments by blockSize
   * instead of 1, amortizing the lock cost across many messages.
   */
  private async allocateBlock(channelId: string): Promise<SequenceBlock> {
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const table = sequenceTable(channelId);

      // Lock the sequence row and read current value
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT LOCAL_CHANNEL_ID FROM ${table} WHERE ID = 1 FOR UPDATE`
      );

      const currentId = (rows[0]?.LOCAL_CHANNEL_ID as number) ?? 1;
      const newMaxId = currentId + this.blockSize;

      // Advance the sequence by the full block size
      await connection.query(
        `UPDATE ${table} SET LOCAL_CHANNEL_ID = ? WHERE ID = 1`,
        [newMaxId]
      );

      await connection.commit();

      return { nextId: currentId, maxId: newMaxId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get remaining IDs in current block (for diagnostics).
   */
  getRemaining(channelId: string): number {
    const block = this.blocks.get(channelId);
    if (!block) return 0;
    return Math.max(0, block.maxId - block.nextId);
  }

  /**
   * Clear all cached blocks (for shutdown/testing).
   */
  clear(): void {
    this.blocks.clear();
  }
}
