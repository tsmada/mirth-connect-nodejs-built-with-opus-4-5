/**
 * Channel Registry
 *
 * Cluster-wide channel deployment registry.
 * Tracks which instances have which channels deployed via the D_CHANNEL_DEPLOYMENTS table.
 * In default "all instances deploy all channels" mode, this is informational.
 * Enables routing decisions when instances deploy different channel subsets.
 */

import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../db/pool.js';

interface DeploymentRow extends RowDataPacket {
  SERVER_ID: string;
  CHANNEL_ID: string;
  DEPLOYED_AT: Date;
}

/**
 * Register a channel deployment for a server instance.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotent upsert.
 */
export async function registerDeployment(serverId: string, channelId: string): Promise<void> {
  await execute(
    `INSERT INTO D_CHANNEL_DEPLOYMENTS (SERVER_ID, CHANNEL_ID, DEPLOYED_AT)
     VALUES (:serverId, :channelId, NOW())
     ON DUPLICATE KEY UPDATE DEPLOYED_AT = NOW()`,
    { serverId, channelId }
  );
}

/**
 * Remove a channel deployment record for a server instance.
 */
export async function unregisterDeployment(serverId: string, channelId: string): Promise<void> {
  await execute(
    `DELETE FROM D_CHANNEL_DEPLOYMENTS WHERE SERVER_ID = :serverId AND CHANNEL_ID = :channelId`,
    { serverId, channelId }
  );
}

/**
 * Remove all deployment records for a server (used during shutdown/deregistration).
 */
export async function unregisterAllDeployments(serverId: string): Promise<void> {
  await execute(
    `DELETE FROM D_CHANNEL_DEPLOYMENTS WHERE SERVER_ID = :serverId`,
    { serverId }
  );
}

/**
 * Get all server IDs that have a specific channel deployed.
 * Used for routing decisions — which instances can handle messages for a channel.
 */
export async function getChannelInstances(channelId: string): Promise<string[]> {
  const rows = await query<DeploymentRow>(
    `SELECT SERVER_ID, CHANNEL_ID, DEPLOYED_AT FROM D_CHANNEL_DEPLOYMENTS WHERE CHANNEL_ID = :channelId`,
    { channelId }
  );
  return rows.map((r) => r.SERVER_ID);
}

/**
 * Get all channel IDs deployed on a specific server instance.
 */
export async function getDeployedChannels(serverId: string): Promise<string[]> {
  const rows = await query<DeploymentRow>(
    `SELECT SERVER_ID, CHANNEL_ID, DEPLOYED_AT FROM D_CHANNEL_DEPLOYMENTS WHERE SERVER_ID = :serverId`,
    { serverId }
  );
  return rows.map((r) => r.CHANNEL_ID);
}
