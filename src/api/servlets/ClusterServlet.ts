/**
 * Cluster Servlet
 *
 * REST API for cluster status and node management.
 * Provides visibility into which Mirth instances are running,
 * their health, and which channels each has deployed.
 */

import { Router, Request, Response } from 'express';
import { getClusterConfig } from '../../cluster/ClusterConfig.js';
import { getClusterNodes } from '../../cluster/ServerRegistry.js';
import { getDeployedChannels } from '../../cluster/ChannelRegistry.js';

export const clusterRouter = Router();

/**
 * GET /api/system/cluster/status
 *
 * Returns overall cluster status including all nodes and their deployed channels.
 */
clusterRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const config = getClusterConfig();
    const nodes = await getClusterNodes();

    // Fetch deployed channels for each node in parallel
    const nodesWithChannels = await Promise.all(
      nodes.map(async (n) => {
        let deployedChannels: string[] = [];
        try {
          deployedChannels = await getDeployedChannels(n.serverId);
        } catch {
          // Channel registry may not be populated yet
        }

        return {
          serverId: n.serverId,
          hostname: n.hostname,
          port: n.port,
          apiUrl: n.apiUrl,
          status: n.status,
          lastHeartbeat: n.lastHeartbeat,
          startedAt: n.startedAt,
          deployedChannels,
        };
      })
    );

    res.json({
      enabled: config.clusterEnabled,
      thisNode: config.serverId,
      nodes: nodesWithChannels,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/system/cluster/nodes
 *
 * Returns the list of registered cluster nodes (without channel details).
 */
clusterRouter.get('/nodes', async (_req: Request, res: Response) => {
  try {
    const nodes = await getClusterNodes();

    res.json(
      nodes.map((n) => ({
        serverId: n.serverId,
        hostname: n.hostname,
        port: n.port,
        apiUrl: n.apiUrl,
        status: n.status,
        lastHeartbeat: n.lastHeartbeat,
        startedAt: n.startedAt,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
