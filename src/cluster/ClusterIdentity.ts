/**
 * Cluster Identity
 *
 * Provides a stable server identity for this Mirth Connect instance.
 * In Kubernetes StatefulSets, MIRTH_SERVER_ID can be set to the pod name
 * for stable identity across restarts. For ephemeral containers, a random
 * UUID is generated on startup.
 */

import { randomUUID } from 'crypto';

let serverId: string | null = null;

/**
 * Get the server identity for this instance.
 *
 * Priority:
 * 1. MIRTH_SERVER_ID environment variable (stable identity for StatefulSets)
 * 2. crypto.randomUUID() generated at first call (ephemeral containers)
 *
 * The value is cached after first call for consistency within a process lifetime.
 */
export function getServerId(): string {
  if (serverId !== null) return serverId;

  serverId = process.env['MIRTH_SERVER_ID'] || randomUUID();
  return serverId;
}

/**
 * Reset the cached server ID (for testing only)
 */
export function resetServerId(): void {
  serverId = null;
}
