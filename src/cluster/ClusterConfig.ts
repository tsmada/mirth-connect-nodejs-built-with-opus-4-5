/**
 * Cluster Configuration
 *
 * Central configuration derived from environment variables for cluster operation.
 * All cluster-related settings are consolidated here to provide a single source
 * of truth for multi-instance deployment parameters.
 */

export interface ClusterConfiguration {
  /** Stable server identity (MIRTH_SERVER_ID or auto UUID) */
  serverId: string;
  /** Whether clustering is enabled (MIRTH_CLUSTER_ENABLED, default false) */
  clusterEnabled: boolean;
  /** Redis URL for shared state (MIRTH_CLUSTER_REDIS_URL) */
  redisUrl?: string;
  /** Shared secret for inter-node auth (MIRTH_CLUSTER_SECRET) */
  clusterSecret?: string;
  /** Heartbeat interval in ms (MIRTH_CLUSTER_HEARTBEAT_INTERVAL, default 10000) */
  heartbeatInterval: number;
  /** Heartbeat timeout in ms (MIRTH_CLUSTER_HEARTBEAT_TIMEOUT, default 30000) */
  heartbeatTimeout: number;
  /** Message ID block allocation size (MIRTH_CLUSTER_SEQUENCE_BLOCK, default 100) */
  sequenceBlockSize: number;
  /** Polling coordination mode: 'exclusive' (one instance) or 'all' (every instance) */
  pollingMode: 'exclusive' | 'all';
  /** Polling lease TTL in ms (MIRTH_CLUSTER_LEASE_TTL, default 30000) */
  leaseTtl: number;
}

import { getServerId } from './ClusterIdentity.js';

let cachedConfig: ClusterConfiguration | null = null;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get the current cluster configuration.
 * Values are parsed from environment variables with sensible defaults.
 * The configuration is cached after first call; use resetClusterConfig() in tests.
 */
export function getClusterConfig(): ClusterConfiguration {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    serverId: getServerId(),
    clusterEnabled: parseBoolean(process.env['MIRTH_CLUSTER_ENABLED'], false),
    redisUrl: process.env['MIRTH_CLUSTER_REDIS_URL'] || undefined,
    clusterSecret: process.env['MIRTH_CLUSTER_SECRET'] || undefined,
    heartbeatInterval: parseNumber(process.env['MIRTH_CLUSTER_HEARTBEAT_INTERVAL'], 10000),
    heartbeatTimeout: parseNumber(process.env['MIRTH_CLUSTER_HEARTBEAT_TIMEOUT'], 30000),
    sequenceBlockSize: parseNumber(process.env['MIRTH_CLUSTER_SEQUENCE_BLOCK'], 100),
    pollingMode:
      (process.env['MIRTH_CLUSTER_POLLING_MODE'] as 'exclusive' | 'all') ||
      (parseBoolean(process.env['MIRTH_CLUSTER_ENABLED'], false) ? 'exclusive' : 'all'),
    leaseTtl: parseNumber(process.env['MIRTH_CLUSTER_LEASE_TTL'], 30000),
  };

  return cachedConfig;
}

/**
 * Reset cached configuration (for testing)
 */
export function resetClusterConfig(): void {
  cachedConfig = null;
}
