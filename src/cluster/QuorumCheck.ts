/**
 * Quorum Check
 *
 * Determines if the cluster has enough alive nodes to be considered healthy.
 * Used by the readiness health check to return 503 when quorum is lost,
 * causing the load balancer to stop routing traffic to a minority partition.
 *
 * Quorum = alive nodes >= ceil(total registered nodes / 2)
 * Single instance: ceil(1/2) = 1, always satisfied.
 *
 * Opt-in via MIRTH_CLUSTER_QUORUM_ENABLED (default: false).
 */

import { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool.js';
import { getClusterConfig } from './ClusterConfig.js';

export interface QuorumStatus {
  alive: number;
  total: number;
  hasQuorum: boolean;
  minRequired: number;
  enabled: boolean;
}

interface CountRow extends RowDataPacket {
  cnt: number;
}

/**
 * Check if quorum enforcement is enabled via environment variable.
 */
export function isQuorumEnabled(): boolean {
  return process.env['MIRTH_CLUSTER_QUORUM_ENABLED'] === 'true';
}

/**
 * Get the current quorum status by querying D_SERVERS.
 *
 * - total = count of nodes with STATUS in ('ONLINE', 'SHADOW') — excludes OFFLINE
 * - alive = count of ONLINE nodes whose heartbeat is within the timeout window
 * - minRequired = ceil(total / 2)
 * - hasQuorum = alive >= minRequired
 */
export async function getQuorumStatus(): Promise<QuorumStatus> {
  const config = getClusterConfig();
  const timeoutSeconds = Math.floor(config.heartbeatTimeout / 1000);

  // Count total non-OFFLINE nodes (ONLINE + SHADOW)
  const totalRows = await query<CountRow>(
    `SELECT COUNT(*) AS cnt FROM D_SERVERS WHERE STATUS IN ('ONLINE', 'SHADOW')`
  );
  const total = totalRows[0]?.cnt ?? 0;

  // Count alive nodes: ONLINE with heartbeat within timeout
  const aliveRows = await query<CountRow>(
    `SELECT COUNT(*) AS cnt FROM D_SERVERS
     WHERE STATUS = 'ONLINE'
       AND LAST_HEARTBEAT >= NOW() - INTERVAL :timeoutSeconds SECOND`,
    { timeoutSeconds }
  );
  const alive = aliveRows[0]?.cnt ?? 0;

  const minRequired = Math.ceil(total / 2);

  return {
    alive,
    total,
    hasQuorum: alive >= minRequired,
    minRequired,
    enabled: isQuorumEnabled(),
  };
}

/**
 * Quick check: does the cluster currently have quorum?
 * Always returns true when quorum enforcement is disabled.
 */
export async function hasQuorum(): Promise<boolean> {
  if (!isQuorumEnabled()) return true;
  const status = await getQuorumStatus();
  return status.hasQuorum;
}
