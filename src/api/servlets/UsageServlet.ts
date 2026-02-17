/**
 * Usage Servlet
 *
 * Handles usage data reporting.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/UsageServletInterface.java
 *
 * Usage data is aggregated statistics about the Mirth installation
 * (channel counts, message volumes, etc.) for analytics/support purposes.
 *
 * Endpoints:
 * - GET /usageData - Get usage data
 */

import { Router, Request, Response } from 'express';
import { query } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { authorize } from '../middleware/authorization.js';
import { USAGE_GET_DATA } from '../middleware/operations.js';
import { getActiveSessionCount } from '../middleware/auth.js';

export const usageRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface UsageData {
  serverId: string;
  serverVersion: string;
  timestamp: string;
  channelCount: number;
  enabledChannelCount: number;
  deployedChannelCount: number;
  userCount: number;
  activeSessionCount: number;
  connectorCounts: Record<string, number>;
  messageStatistics: {
    totalReceived: number;
    totalSent: number;
    totalFiltered: number;
    totalError: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get usage data
 */
async function getUsageData(): Promise<UsageData> {
  // Get channel count
  let channelCount = 0;
  let enabledChannelCount = 0;
  try {
    const channelRows = await query<RowDataPacket>(
      'SELECT COUNT(*) as total FROM CHANNEL'
    );
    channelCount = channelRows[0]?.total ?? 0;

    // Count enabled channels (would need to parse channel XML)
    enabledChannelCount = channelCount; // Simplified
  } catch {
    // Table might not exist
  }

  // Get user count
  let userCount = 0;
  try {
    const userRows = await query<RowDataPacket>(
      'SELECT COUNT(*) as total FROM PERSON'
    );
    userCount = userRows[0]?.total ?? 0;
  } catch {
    // Table might not exist
  }

  // Get connector usage (count of each connector type)
  const connectorCounts: Record<string, number> = {
    'HTTP Listener': 0,
    'HTTP Sender': 0,
    'TCP Listener': 0,
    'TCP Sender': 0,
    'File Reader': 0,
    'File Writer': 0,
    'Database Reader': 0,
    'Database Writer': 0,
    'JavaScript Writer': 0,
  };

  // In a real implementation, we would parse channel XML to count connectors
  // For now, we return placeholder counts

  // Get message statistics across all channels
  let totalReceived = 0;
  let totalSent = 0;
  let totalFiltered = 0;
  let totalError = 0;

  try {
    // Find all statistics tables
    const tables = await query<RowDataPacket>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'D\\_MS%'
       AND TABLE_NAME NOT LIKE 'D\\_MSQ%'`
    );

    for (const table of tables) {
      const tableName = table.TABLE_NAME as string;
      try {
        const stats = await query<RowDataPacket>(
          `SELECT SUM(RECEIVED) as received, SUM(SENT) as sent,
           SUM(FILTERED) as filtered, SUM(ERROR) as error
           FROM ${tableName}`
        );
        if (stats.length > 0 && stats[0]) {
          totalReceived += stats[0].received ?? 0;
          totalSent += stats[0].sent ?? 0;
          totalFiltered += stats[0].filtered ?? 0;
          totalError += stats[0].error ?? 0;
        }
      } catch {
        // Skip tables that fail to query
      }
    }
  } catch {
    // information_schema query failed
  }

  // Get server ID from configuration
  let serverId = 'unknown';
  try {
    const serverIdRows = await query<RowDataPacket>(
      `SELECT VALUE FROM CONFIGURATION WHERE CATEGORY = 'core' AND NAME = 'server.id'`
    );
    if (serverIdRows.length > 0 && serverIdRows[0]) {
      serverId = serverIdRows[0].VALUE;
    }
  } catch {
    // Configuration table might not exist
  }

  return {
    serverId,
    serverVersion: '3.9.0',
    timestamp: new Date().toISOString(),
    channelCount,
    enabledChannelCount,
    deployedChannelCount: 0, // Would need to check engine state
    userCount,
    activeSessionCount: await getActiveSessionCount(),
    connectorCounts,
    messageStatistics: {
      totalReceived,
      totalSent,
      totalFiltered,
      totalError,
    },
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /usageData
 * Get usage data
 */
usageRouter.get(
  '/',
  authorize({ operation: USAGE_GET_DATA }),
  async (_req: Request, res: Response) => {
    try {
      const usageData = await getUsageData();
      res.sendData(usageData);
    } catch (error) {
      console.error('Get usage data error:', error);
      res.status(500).json({ error: 'Failed to get usage data' });
    }
  }
);
