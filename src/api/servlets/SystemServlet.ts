/**
 * System Servlet
 *
 * Handles system information endpoints.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/SystemServletInterface.java
 *
 * Endpoints:
 * - GET /system/info - Get system information
 * - GET /system/stats - Get system statistics
 */

import { Router, Request, Response } from 'express';
import * as os from 'os';
import { authorize } from '../middleware/authorization.js';
import { SYSTEM_GET_INFO, SYSTEM_GET_STATS } from '../middleware/operations.js';

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
      console.error('Get system info error:', error);
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
      console.error('Get system stats error:', error);
      res.status(500).json({ error: 'Failed to get system stats' });
    }
  }
);
