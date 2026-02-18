/**
 * Channel Statistics Servlet
 *
 * Handles channel statistics operations (get, clear).
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelStatisticsServletInterface.java
 *
 * Endpoints:
 * - GET /channels/statistics - Get all channel statistics
 * - POST /channels/statistics/_getStatistics - POST alternative
 * - GET /channels/:channelId/statistics - Get single channel stats
 * - POST /channels/_clearStatistics - Clear specific stats
 * - POST /channels/_clearAllStatistics - Clear all stats
 */

import { Router, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { getPool } from '../../db/pool.js';
import { statisticsTable } from '../../db/DonkeyDao.js';
import { authorize } from '../middleware/authorization.js';
import {
  CHANNEL_STATS_GET,
  CHANNEL_STATS_GET_ALL,
  CHANNEL_STATS_CLEAR,
  CHANNEL_STATS_CLEAR_ALL,
} from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const channelStatisticsRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface ChannelParams {
  channelId: string;
}

interface StatisticsRow extends RowDataPacket {
  METADATA_ID: number;
  SERVER_ID: string;
  RECEIVED: number;
  FILTERED: number;
  TRANSFORMED: number;
  PENDING: number;
  SENT: number;
  ERROR: number;
}

/**
 * Full channel statistics with connector-level breakdown
 */
interface ChannelStatisticsInternal {
  received: number;
  sent: number;
  error: number;
  filtered: number;
  queued: number;
}

export interface ChannelStatisticsMap {
  channelId: string;
  serverId: string;
  /** Aggregate statistics for all connectors */
  aggregate: ChannelStatisticsInternal;
  /** Per-connector statistics (keyed by metaDataId) */
  connectors: Map<number, ChannelStatisticsInternal>;
}

/**
 * Response format for statistics API
 */
interface ChannelStatisticsResponse {
  channelId: string;
  serverId: string;
  received: number;
  sent: number;
  error: number;
  filtered: number;
  queued: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if statistics table exists
 */
async function statisticsTableExists(channelId: string): Promise<boolean> {
  const pool = getPool();
  const tableName = statisticsTable(channelId);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return rows.length > 0;
}

/**
 * Get statistics for a single channel
 */
async function getChannelStatistics(channelId: string): Promise<ChannelStatisticsResponse | null> {
  // Check if table exists
  const exists = await statisticsTableExists(channelId);
  if (!exists) {
    return null;
  }

  const pool = getPool();
  const [rows] = await pool.query<StatisticsRow[]>(
    `SELECT * FROM ${statisticsTable(channelId)}`
  );

  if (rows.length === 0) {
    return {
      channelId,
      serverId: '',
      received: 0,
      sent: 0,
      error: 0,
      filtered: 0,
      queued: 0,
    };
  }

  // Aggregate statistics across all connectors and servers
  let totalReceived = 0;
  let totalSent = 0;
  let totalError = 0;
  let totalFiltered = 0;
  let totalPending = 0;
  let serverId = '';

  for (const row of rows) {
    totalReceived += row.RECEIVED || 0;
    totalSent += row.SENT || 0;
    totalError += row.ERROR || 0;
    totalFiltered += row.FILTERED || 0;
    totalPending += row.PENDING || 0;

    if (!serverId && row.SERVER_ID) {
      serverId = row.SERVER_ID;
    }
  }

  return {
    channelId,
    serverId,
    received: totalReceived,
    sent: totalSent,
    error: totalError,
    filtered: totalFiltered,
    queued: totalPending, // PENDING maps to queued in API
  };
}

/**
 * Get all channel IDs that have statistics tables
 */
async function getChannelsWithStatistics(): Promise<string[]> {
  const pool = getPool();

  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'D\\_MS%'
     AND TABLE_NAME NOT LIKE 'D\\_MSQ%'`
  );

  return tables.map((row) => {
    const tableName = row.TABLE_NAME as string;
    // Extract channel ID from table name (D_MS{uuid_with_underscores})
    return tableName.substring(4).replace(/_/g, '-');
  });
}

/**
 * Clear statistics for a channel
 */
async function clearChannelStatistics(
  channelId: string,
  connectorNames: Map<number, string> | null = null,
  deleteReceived: boolean = true,
  deleteFiltered: boolean = true,
  deleteSent: boolean = true,
  deleteError: boolean = true
): Promise<void> {
  const exists = await statisticsTableExists(channelId);
  if (!exists) {
    return;
  }

  const pool = getPool();

  // Build update statement for columns to clear
  const updates: string[] = [];
  if (deleteReceived) updates.push('RECEIVED = 0');
  if (deleteFiltered) updates.push('FILTERED = 0');
  if (deleteSent) updates.push('SENT = 0');
  if (deleteError) updates.push('ERROR = 0');

  if (updates.length === 0) {
    return;
  }

  let sql = `UPDATE ${statisticsTable(channelId)} SET ${updates.join(', ')}`;

  // If connector names specified, only clear those connectors
  if (connectorNames && connectorNames.size > 0) {
    const metaDataIds = Array.from(connectorNames.keys());
    const placeholders = metaDataIds.map(() => '?').join(', ');
    sql += ` WHERE METADATA_ID IN (${placeholders})`;
    await pool.execute(sql, metaDataIds);
  } else {
    await pool.execute(sql);
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /channels/statistics
 * Get statistics for all channels or specific channels
 */
channelStatisticsRouter.get(
  '/statistics',
  authorize({ operation: CHANNEL_STATS_GET_ALL }),
  async (req: Request, res: Response) => {
    try {
      const channelIds = req.query.channelId;
      const includeUndeployed = req.query.includeUndeployed === 'true';

      let targetChannelIds: string[];

      if (channelIds) {
        // Use specified channel IDs
        targetChannelIds = Array.isArray(channelIds)
          ? (channelIds as string[])
          : [channelIds as string];
      } else if (includeUndeployed) {
        // Get all channels with statistics tables
        targetChannelIds = await getChannelsWithStatistics();
      } else {
        // Get only deployed channels (channels with statistics)
        targetChannelIds = await getChannelsWithStatistics();
      }

      const statistics: ChannelStatisticsResponse[] = [];

      for (const channelId of targetChannelIds) {
        const stats = await getChannelStatistics(channelId);
        if (stats) {
          statistics.push(stats);
        }
      }

      res.sendData(statistics);
    } catch (error) {
      logger.error('Get channel statistics error', error as Error);
      res.status(500).json({ error: 'Failed to get channel statistics' });
    }
  }
);

/**
 * POST /channels/statistics/_getStatistics
 * Get statistics (POST alternative with channel IDs in body)
 */
channelStatisticsRouter.post(
  '/statistics/_getStatistics',
  authorize({ operation: CHANNEL_STATS_GET_ALL }),
  async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const includeUndeployed = req.query.includeUndeployed === 'true';

      let targetChannelIds: string[];

      if (body && Array.isArray(body) && body.length > 0) {
        targetChannelIds = body;
      } else if (body && body.set && body.set.string) {
        // Handle XML format: <set><string>id1</string><string>id2</string></set>
        const ids = body.set.string;
        targetChannelIds = Array.isArray(ids) ? ids : [ids];
      } else if (includeUndeployed) {
        targetChannelIds = await getChannelsWithStatistics();
      } else {
        targetChannelIds = await getChannelsWithStatistics();
      }

      const statistics: ChannelStatisticsResponse[] = [];

      for (const channelId of targetChannelIds) {
        const stats = await getChannelStatistics(channelId);
        if (stats) {
          statistics.push(stats);
        }
      }

      res.sendData(statistics);
    } catch (error) {
      logger.error('Get channel statistics POST error', error as Error);
      res.status(500).json({ error: 'Failed to get channel statistics' });
    }
  }
);

/**
 * GET /channels/:channelId/statistics
 * Get statistics for a single channel
 */
channelStatisticsRouter.get(
  '/:channelId/statistics',
  authorize({ operation: CHANNEL_STATS_GET, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params as unknown as ChannelParams;
      const stats = await getChannelStatistics(channelId);

      if (!stats) {
        res.status(404).json({ error: 'Channel not found or has no statistics' });
        return;
      }

      res.sendData(stats);
    } catch (error) {
      logger.error('Get channel statistics error', error as Error);
      res.status(500).json({ error: 'Failed to get channel statistics' });
    }
  }
);

/**
 * POST /channels/_clearStatistics
 * Clear statistics for specific channels/connectors
 *
 * Query params:
 * - received (boolean): Clear received count
 * - filtered (boolean): Clear filtered count
 * - sent (boolean): Clear sent count
 * - error (boolean): Clear error count
 *
 * Body: Map of channelId -> list of connector names (or null for all connectors)
 */
channelStatisticsRouter.post(
  '/_clearStatistics',
  authorize({ operation: CHANNEL_STATS_CLEAR }),
  async (req: Request, res: Response) => {
    try {
      // Parse query params for which stats to clear
      const deleteReceived = req.query.received !== 'false';
      const deleteFiltered = req.query.filtered !== 'false';
      const deleteSent = req.query.sent !== 'false';
      const deleteError = req.query.error !== 'false';

      // Body contains map of channelId -> connector info
      const body = req.body as Record<
        string,
        { entry: { string: string; list?: { integer: number | number[] } }[] } | null
      >;

      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }

      // Process each channel
      for (const [channelId, connectorData] of Object.entries(body)) {
        let connectorNames: Map<number, string> | null = null;

        if (connectorData && connectorData.entry) {
          // Parse connector names from entry format
          connectorNames = new Map();
          for (const entry of connectorData.entry) {
            const metaDataIds = entry.list?.integer;
            if (metaDataIds !== undefined) {
              const ids = Array.isArray(metaDataIds) ? metaDataIds : [metaDataIds];
              for (const id of ids) {
                connectorNames.set(id, entry.string);
              }
            }
          }
        }

        await clearChannelStatistics(
          channelId,
          connectorNames,
          deleteReceived,
          deleteFiltered,
          deleteSent,
          deleteError
        );
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Clear statistics error', error as Error);
      res.status(500).json({ error: 'Failed to clear statistics' });
    }
  }
);

/**
 * POST /channels/_clearAllStatistics
 * Clear all statistics for all channels
 */
channelStatisticsRouter.post(
  '/_clearAllStatistics',
  authorize({ operation: CHANNEL_STATS_CLEAR_ALL }),
  async (_req: Request, res: Response) => {
    try {
      // Get all channels with statistics
      const channelIds = await getChannelsWithStatistics();

      // Clear all statistics for each channel
      for (const channelId of channelIds) {
        await clearChannelStatistics(channelId);
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Clear all statistics error', error as Error);
      res.status(500).json({ error: 'Failed to clear all statistics' });
    }
  }
);
