/**
 * System Servlet
 *
 * Handles system information endpoints.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/SystemServletInterface.java
 *
 * Endpoints:
 * - GET /system/info - Get system information
 * - GET /system/stats - Get system statistics
 * - GET /system/cluster/statistics - Get cluster-wide channel statistics
 */

import { Router, Request, Response } from 'express';
import * as os from 'os';
import { authorize } from '../middleware/authorization.js';
import { SYSTEM_GET_INFO, SYSTEM_GET_STATS } from '../middleware/operations.js';
import { getLocalChannelIds, getStatistics, StatisticsRow } from '../../db/DonkeyDao.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const systemRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface SystemInfo {
  jvmVersion: string;
  osName: string;
  osVersion: string;
  osArchitecture: string;
  dbName: string;
  dbVersion: string;
}

interface SystemStats {
  timestamp: string;
  cpuUsagePercent: number;
  allocatedMemoryBytes: number;
  freeMemoryBytes: number;
  maxMemoryBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get CPU usage percentage
 */
function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - (idle / total) * 100;

  return Math.round(usage * 100) / 100;
}

/**
 * Get system information
 */
function getSystemInfo(): SystemInfo {
  return {
    jvmVersion: `Node.js ${process.version}`,
    osName: os.type(),
    osVersion: os.release(),
    osArchitecture: os.arch(),
    dbName: 'MySQL',
    dbVersion: '8.0', // Would be queried from database in production
  };
}

/**
 * Get system statistics
 */
function getSystemStats(): SystemStats {
  const memUsage = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    cpuUsagePercent: getCpuUsage(),
    allocatedMemoryBytes: memUsage.heapTotal,
    freeMemoryBytes: memUsage.heapTotal - memUsage.heapUsed,
    maxMemoryBytes: os.totalmem(),
    diskFreeBytes: 0, // Would need fs.statfs in production
    diskTotalBytes: 0, // Would need fs.statfs in production
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /system/info
 * Get system information
 */
systemRouter.get(
  '/info',
  authorize({ operation: SYSTEM_GET_INFO }),
  async (_req: Request, res: Response) => {
    try {
      const info = getSystemInfo();
      res.sendData(info);
    } catch (error) {
      logger.error('Get system info error', error as Error);
      res.status(500).json({ error: 'Failed to get system info' });
    }
  }
);

/**
 * GET /system/stats
 * Get system statistics
 */
systemRouter.get(
  '/stats',
  authorize({ operation: SYSTEM_GET_STATS }),
  async (_req: Request, res: Response) => {
    try {
      const stats = getSystemStats();
      res.sendData(stats);
    } catch (error) {
      logger.error('Get system stats error', error as Error);
      res.status(500).json({ error: 'Failed to get system stats' });
    }
  }
);

// ============================================================================
// Cluster Statistics
// ============================================================================

interface PerServerStats {
  serverId: string;
  received: number;
  filtered: number;
  transformed: number;
  pending: number;
  sent: number;
  error: number;
}

interface ChannelClusterStats {
  channelId: string;
  aggregate: Omit<PerServerStats, 'serverId'>;
  perServer: PerServerStats[];
}

/**
 * GET /system/cluster/statistics
 * Get channel statistics aggregated across all cluster instances.
 *
 * Queries each channel's D_MS table (which is already partitioned by SERVER_ID)
 * and returns both per-server breakdowns and aggregated totals.
 */
systemRouter.get(
  '/cluster/statistics',
  authorize({ operation: SYSTEM_GET_STATS }),
  async (_req: Request, res: Response) => {
    try {
      const channelMap = await getLocalChannelIds();
      const channelIds = Array.from(channelMap.keys());

      const results: ChannelClusterStats[] = [];

      for (const channelId of channelIds) {
        let rows: StatisticsRow[];
        try {
          rows = await getStatistics(channelId);
        } catch {
          // Channel tables may have been dropped; skip
          continue;
        }

        // Group by SERVER_ID
        const serverMap = new Map<string, PerServerStats>();
        const aggregate = {
          received: 0,
          filtered: 0,
          transformed: 0,
          pending: 0,
          sent: 0,
          error: 0,
        };

        for (const row of rows) {
          let entry = serverMap.get(row.SERVER_ID);
          if (!entry) {
            entry = {
              serverId: row.SERVER_ID,
              received: 0,
              filtered: 0,
              transformed: 0,
              pending: 0,
              sent: 0,
              error: 0,
            };
            serverMap.set(row.SERVER_ID, entry);
          }
          // Sum across all METADATA_IDs for this server
          entry.received += row.RECEIVED;
          entry.filtered += row.FILTERED;
          entry.transformed += row.TRANSFORMED;
          entry.pending += row.PENDING;
          entry.sent += row.SENT;
          entry.error += row.ERROR;

          // Aggregate across all servers
          aggregate.received += row.RECEIVED;
          aggregate.filtered += row.FILTERED;
          aggregate.transformed += row.TRANSFORMED;
          aggregate.pending += row.PENDING;
          aggregate.sent += row.SENT;
          aggregate.error += row.ERROR;
        }

        results.push({
          channelId,
          aggregate,
          perServer: Array.from(serverMap.values()),
        });
      }

      res.sendData(results);
    } catch (error) {
      logger.error('Get cluster statistics error', error as Error);
      res.status(500).json({ error: 'Failed to get cluster statistics' });
    }
  }
);
