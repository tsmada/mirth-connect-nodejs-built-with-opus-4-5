/**
 * Server Registry
 *
 * Manages the D_SERVERS table for cluster node tracking.
 * Each Mirth instance registers itself on startup, sends periodic heartbeats,
 * and marks itself offline on shutdown. Other nodes query this table to
 * discover cluster members and detect failures.
 */

import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../db/pool.js';
import { getServerId } from './ClusterIdentity.js';
import { getClusterConfig } from './ClusterConfig.js';
import { getLogger, registerComponent } from '../logging/index.js';
import os from 'os';

registerComponent('cluster', 'Cluster operations');
const logger = getLogger('cluster');

export interface ClusterNode {
  serverId: string;
  hostname: string | null;
  port: number | null;
  apiUrl: string | null;
  startedAt: Date | null;
  lastHeartbeat: Date | null;
  status: 'ONLINE' | 'OFFLINE' | 'SHADOW';
}

interface ClusterNodeRow extends RowDataPacket {
  SERVER_ID: string;
  HOSTNAME: string | null;
  PORT: number | null;
  API_URL: string | null;
  STARTED_AT: Date | null;
  LAST_HEARTBEAT: Date | null;
  STATUS: string;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function rowToNode(row: ClusterNodeRow): ClusterNode {
  return {
    serverId: row.SERVER_ID,
    hostname: row.HOSTNAME,
    port: row.PORT,
    apiUrl: row.API_URL,
    startedAt: row.STARTED_AT,
    lastHeartbeat: row.LAST_HEARTBEAT,
    status: row.STATUS === 'SHADOW' ? 'SHADOW' : row.STATUS === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
  };
}

/**
 * Register this server in D_SERVERS.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotent upsert.
 */
export async function registerServer(port?: number, status?: string): Promise<void> {
  const serverId = getServerId();
  const hostname = os.hostname();
  const apiUrl = port ? `http://${hostname}:${port}` : null;
  const serverStatus = status || 'ONLINE';

  await execute(
    `INSERT INTO D_SERVERS (SERVER_ID, HOSTNAME, PORT, API_URL, STARTED_AT, LAST_HEARTBEAT, STATUS)
     VALUES (:serverId, :hostname, :port, :apiUrl, NOW(), NOW(), :serverStatus)
     ON DUPLICATE KEY UPDATE
       HOSTNAME = :hostname,
       PORT = :port,
       API_URL = :apiUrl,
       STARTED_AT = NOW(),
       LAST_HEARTBEAT = NOW(),
       STATUS = :serverStatus`,
    { serverId, hostname, port: port ?? null, apiUrl, serverStatus }
  );

  logger.info(`Registered server ${serverId} (${hostname}:${port ?? 'N/A'})`);
}

/**
 * Start periodic heartbeat updates.
 * Updates LAST_HEARTBEAT in D_SERVERS at the configured interval.
 */
export function startHeartbeat(): void {
  if (heartbeatTimer) return;

  const config = getClusterConfig();
  const serverId = getServerId();

  heartbeatTimer = setInterval(async () => {
    try {
      await execute(
        `UPDATE D_SERVERS SET LAST_HEARTBEAT = NOW() WHERE SERVER_ID = :serverId`,
        { serverId }
      );
    } catch (err) {
      logger.error('Heartbeat update failed', err as Error);
    }
  }, config.heartbeatInterval);

  // Don't prevent process exit
  heartbeatTimer.unref();

  logger.info(`Heartbeat started (interval: ${config.heartbeatInterval}ms)`);
}

/**
 * Stop the heartbeat interval.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('Heartbeat stopped');
  }
}

/**
 * Mark this server as OFFLINE in D_SERVERS.
 */
export async function deregisterServer(): Promise<void> {
  const serverId = getServerId();

  try {
    await execute(
      `UPDATE D_SERVERS SET STATUS = 'OFFLINE', LAST_HEARTBEAT = NOW() WHERE SERVER_ID = :serverId`,
      { serverId }
    );
    logger.info(`Deregistered server ${serverId}`);
  } catch (err) {
    logger.error('Failed to deregister', err as Error);
  }
}

/**
 * Get all registered cluster nodes.
 */
export async function getClusterNodes(): Promise<ClusterNode[]> {
  const rows = await query<ClusterNodeRow>(
    `SELECT SERVER_ID, HOSTNAME, PORT, API_URL, STARTED_AT, LAST_HEARTBEAT, STATUS FROM D_SERVERS`
  );
  return rows.map(rowToNode);
}

/**
 * Check whether a specific node's heartbeat is within the timeout window.
 */
export async function isNodeAlive(serverId: string): Promise<boolean> {
  const config = getClusterConfig();
  const timeoutSeconds = Math.floor(config.heartbeatTimeout / 1000);

  const rows = await query<ClusterNodeRow>(
    `SELECT SERVER_ID, HOSTNAME, PORT, API_URL, STARTED_AT, LAST_HEARTBEAT, STATUS
     FROM D_SERVERS
     WHERE SERVER_ID = :serverId
       AND STATUS = 'ONLINE'
       AND LAST_HEARTBEAT >= NOW() - INTERVAL :timeoutSeconds SECOND`,
    { serverId, timeoutSeconds }
  );

  return rows.length > 0;
}

/**
 * Get server IDs of nodes whose heartbeat has expired.
 */
export async function getOfflineNodeIds(): Promise<string[]> {
  const config = getClusterConfig();
  const timeoutSeconds = Math.floor(config.heartbeatTimeout / 1000);

  const rows = await query<ClusterNodeRow>(
    `SELECT SERVER_ID, HOSTNAME, PORT, API_URL, STARTED_AT, LAST_HEARTBEAT, STATUS
     FROM D_SERVERS
     WHERE STATUS = 'ONLINE'
       AND LAST_HEARTBEAT < NOW() - INTERVAL :timeoutSeconds SECOND`,
    { timeoutSeconds }
  );

  return rows.map((r) => r.SERVER_ID);
}
