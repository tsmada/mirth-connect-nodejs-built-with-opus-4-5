/**
 * Polling Lease Manager
 *
 * Database-backed exclusive lease using D_POLLING_LEASES table.
 * Ensures only one cluster instance polls a given File/JDBC/JMS source
 * connector at a time, preventing duplicate message ingestion.
 *
 * Uses SELECT ... FOR UPDATE for atomic lease acquisition within a
 * serializable transaction boundary.
 */

import { RowDataPacket } from 'mysql2/promise';
import { getPool, withRetry } from '../db/pool.js';
import { getLogger } from '../logging/index.js';

const logger = getLogger('cluster');

// ── Types ──────────────────────────────────────────────────────────

export interface LeaseInfo {
  channelId: string;
  serverId: string;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
}

interface LeaseRow extends RowDataPacket {
  CHANNEL_ID: string;
  SERVER_ID: string;
  ACQUIRED_AT: Date;
  RENEWED_AT: Date;
  EXPIRES_AT: Date;
}

// ── Module state ───────────────────────────────────────────────────

/** Active renewal timers keyed by channelId */
const renewalTimers = new Map<string, NodeJS.Timeout>();

// ── Core lease operations ──────────────────────────────────────────

/**
 * Attempt to acquire an exclusive polling lease for a channel.
 *
 * Algorithm (inside a single transaction):
 * 1. SELECT ... FOR UPDATE on the channel row
 * 2. No row → INSERT with our SERVER_ID → acquired
 * 3. Row expired → UPDATE with our SERVER_ID (takeover) → acquired
 * 4. Row owned by us → UPDATE (renew) → acquired
 * 5. Row owned by another live server → not acquired
 */
export async function acquireLease(
  channelId: string,
  serverId: string,
  ttlMs: number
): Promise<boolean> {
  return withRetry(async () => {
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Lock the row (or gap-lock if missing)
      const [rows] = await connection.query<LeaseRow[]>(
        `SELECT CHANNEL_ID, SERVER_ID, ACQUIRED_AT, RENEWED_AT, EXPIRES_AT
         FROM D_POLLING_LEASES
         WHERE CHANNEL_ID = ?
         FOR UPDATE`,
        [channelId]
      );

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      if (rows.length === 0) {
        // Case 1: No existing lease — insert new
        await connection.query(
          `INSERT INTO D_POLLING_LEASES (CHANNEL_ID, SERVER_ID, ACQUIRED_AT, RENEWED_AT, EXPIRES_AT)
           VALUES (?, ?, ?, ?, ?)`,
          [channelId, serverId, now, now, expiresAt]
        );
        await connection.commit();
        logger.info(`Lease acquired for channel ${channelId} by ${serverId}`);
        return true;
      }

      const existing = rows[0]!;

      if (existing.EXPIRES_AT < now) {
        // Case 2: Expired lease — takeover
        await connection.query(
          `UPDATE D_POLLING_LEASES
           SET SERVER_ID = ?, ACQUIRED_AT = ?, RENEWED_AT = ?, EXPIRES_AT = ?
           WHERE CHANNEL_ID = ?`,
          [serverId, now, now, expiresAt, channelId]
        );
        await connection.commit();
        logger.info(
          `Lease takeover for channel ${channelId}: ${existing.SERVER_ID} → ${serverId} (expired)`
        );
        return true;
      }

      if (existing.SERVER_ID === serverId) {
        // Case 3: We already hold the lease — renew
        await connection.query(
          `UPDATE D_POLLING_LEASES
           SET RENEWED_AT = ?, EXPIRES_AT = ?
           WHERE CHANNEL_ID = ?`,
          [now, expiresAt, channelId]
        );
        await connection.commit();
        logger.debug(`Lease renewed for channel ${channelId} by ${serverId}`);
        return true;
      }

      // Case 4: Another live server holds the lease
      await connection.commit();
      logger.debug(
        `Lease not acquired for channel ${channelId}: held by ${existing.SERVER_ID} until ${existing.EXPIRES_AT.toISOString()}`
      );
      return false;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}

/**
 * Renew an existing lease.
 *
 * Only succeeds if the calling server currently holds the lease.
 * Returns false if the lease is held by another server or does not exist.
 */
export async function renewLease(
  channelId: string,
  serverId: string,
  ttlMs: number
): Promise<boolean> {
  return withRetry(async () => {
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<LeaseRow[]>(
        `SELECT SERVER_ID FROM D_POLLING_LEASES
         WHERE CHANNEL_ID = ?
         FOR UPDATE`,
        [channelId]
      );

      if (rows.length === 0) {
        await connection.commit();
        logger.warn(`Lease renewal failed for channel ${channelId}: no lease exists`);
        return false;
      }

      const existing = rows[0]!;
      if (existing.SERVER_ID !== serverId) {
        await connection.commit();
        logger.warn(
          `Lease renewal failed for channel ${channelId}: held by ${existing.SERVER_ID}, not ${serverId}`
        );
        return false;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      await connection.query(
        `UPDATE D_POLLING_LEASES
         SET RENEWED_AT = ?, EXPIRES_AT = ?
         WHERE CHANNEL_ID = ? AND SERVER_ID = ?`,
        [now, expiresAt, channelId, serverId]
      );

      await connection.commit();
      logger.debug(`Lease renewed for channel ${channelId} by ${serverId}`);
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}

/**
 * Release a lease for a specific channel.
 * Only the current holder can release.
 */
export async function releaseLease(channelId: string, serverId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM D_POLLING_LEASES WHERE CHANNEL_ID = ? AND SERVER_ID = ?`, [
    channelId,
    serverId,
  ]);
  logger.info(`Lease released for channel ${channelId} by ${serverId}`);
}

/**
 * Release all leases held by a specific server.
 * Called during graceful shutdown.
 */
export async function releaseAllLeases(serverId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM D_POLLING_LEASES WHERE SERVER_ID = ?`, [serverId]);
  logger.info(`All leases released for server ${serverId}`);
}

// ── Renewal timers ─────────────────────────────────────────────────

/**
 * Start a periodic lease renewal timer for a channel.
 * Renews at TTL / 2 interval to prevent expiry during normal operation.
 */
export function startLeaseRenewal(channelId: string, serverId: string, ttlMs: number): void {
  // Clear any existing timer for this channel
  stopLeaseRenewal(channelId);

  const interval = Math.max(ttlMs / 2, 1000); // At least 1s

  const timer = setInterval(async () => {
    try {
      const renewed = await renewLease(channelId, serverId, ttlMs);
      if (!renewed) {
        logger.warn(
          `Lease renewal failed for channel ${channelId} — lease may have been taken over`
        );
        stopLeaseRenewal(channelId);
      }
    } catch (error) {
      logger.error(
        `Error renewing lease for channel ${channelId}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }, interval);

  // Unref the timer so it doesn't prevent process shutdown
  if (timer.unref) {
    timer.unref();
  }

  renewalTimers.set(channelId, timer);
  logger.debug(`Lease renewal timer started for channel ${channelId} (interval: ${interval}ms)`);
}

/**
 * Stop the lease renewal timer for a specific channel.
 */
export function stopLeaseRenewal(channelId: string): void {
  const timer = renewalTimers.get(channelId);
  if (timer) {
    clearInterval(timer);
    renewalTimers.delete(channelId);
    logger.debug(`Lease renewal timer stopped for channel ${channelId}`);
  }
}

/**
 * Stop all active lease renewal timers.
 * Called during graceful shutdown.
 */
export function stopAllLeaseRenewals(): void {
  renewalTimers.forEach((timer, channelId) => {
    clearInterval(timer);
    logger.debug(`Lease renewal timer stopped for channel ${channelId}`);
  });
  renewalTimers.clear();
}

// ── Query helpers ──────────────────────────────────────────────────

/**
 * Get all current leases across all channels.
 */
export async function getAllLeases(): Promise<LeaseInfo[]> {
  const pool = getPool();
  const [rows] = await pool.query<LeaseRow[]>(
    `SELECT CHANNEL_ID, SERVER_ID, ACQUIRED_AT, RENEWED_AT, EXPIRES_AT
     FROM D_POLLING_LEASES
     ORDER BY CHANNEL_ID`
  );

  return rows.map((row) => ({
    channelId: row.CHANNEL_ID,
    serverId: row.SERVER_ID,
    acquiredAt: row.ACQUIRED_AT,
    renewedAt: row.RENEWED_AT,
    expiresAt: row.EXPIRES_AT,
  }));
}
