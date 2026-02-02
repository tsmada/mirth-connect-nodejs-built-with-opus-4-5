/**
 * Channel Group Servlet
 *
 * Handles channel group operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelGroupServletInterface.java
 *
 * Endpoints:
 * - GET /channelgroups - Get all channel groups
 * - POST /channelgroups/_getChannelGroups - POST alternative
 * - POST /channelgroups/_bulkUpdate - Bulk update groups
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, execute } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { authorize } from '../middleware/authorization.js';
import { CHANNEL_GROUP_GET, CHANNEL_GROUP_UPDATE } from '../middleware/operations.js';

export const channelGroupRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface ChannelGroup {
  id: string;
  name: string;
  description?: string;
  revision: number;
  channels: ChannelGroupChannel[];
}

interface ChannelGroupChannel {
  id: string;
  revision: number;
}

interface ChannelGroupRow extends RowDataPacket {
  ID: string;
  NAME: string;
  DESCRIPTION: string | null;
  REVISION: number;
  GROUP_DATA: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create channel group table if not exists
 */
async function ensureChannelGroupTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS CHANNEL_GROUP (
      ID VARCHAR(36) NOT NULL PRIMARY KEY,
      NAME VARCHAR(255) NOT NULL,
      DESCRIPTION TEXT,
      REVISION INT NOT NULL DEFAULT 1,
      GROUP_DATA LONGTEXT NOT NULL
    ) ENGINE=InnoDB
  `);
}

/**
 * Serialize channel group for storage
 */
function serializeGroup(group: ChannelGroup): string {
  return JSON.stringify({
    channels: group.channels,
  });
}

/**
 * Deserialize channel group from storage
 */
function deserializeGroup(row: ChannelGroupRow): ChannelGroup {
  const data = JSON.parse(row.GROUP_DATA || '{}');
  return {
    id: row.ID,
    name: row.NAME,
    description: row.DESCRIPTION || undefined,
    revision: row.REVISION,
    channels: data.channels || [],
  };
}

/**
 * Get all channel groups
 */
async function getChannelGroups(ids?: string[]): Promise<ChannelGroup[]> {
  await ensureChannelGroupTable();

  let rows: ChannelGroupRow[];

  if (ids && ids.length > 0) {
    const placeholders = ids.map((_, i) => `:id${i}`);
    const params: Record<string, string> = {};
    ids.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    rows = await query<ChannelGroupRow>(
      `SELECT * FROM CHANNEL_GROUP WHERE ID IN (${placeholders.join(', ')}) ORDER BY NAME`,
      params
    );
  } else {
    rows = await query<ChannelGroupRow>('SELECT * FROM CHANNEL_GROUP ORDER BY NAME');
  }

  return rows.map(deserializeGroup);
}

/**
 * Get channel group by ID
 * Exported for potential use by other servlets
 */
export async function getChannelGroupById(id: string): Promise<ChannelGroup | null> {
  await ensureChannelGroupTable();

  const rows = await query<ChannelGroupRow>(
    'SELECT * FROM CHANNEL_GROUP WHERE ID = :id',
    { id }
  );

  if (rows.length === 0) {
    return null;
  }

  return deserializeGroup(rows[0]!);
}

/**
 * Create or update a channel group
 */
async function upsertChannelGroup(group: ChannelGroup): Promise<void> {
  await ensureChannelGroupTable();

  const serialized = serializeGroup(group);

  await execute(
    `INSERT INTO CHANNEL_GROUP (ID, NAME, DESCRIPTION, REVISION, GROUP_DATA)
     VALUES (:id, :name, :description, :revision, :groupData)
     ON DUPLICATE KEY UPDATE
       NAME = :name,
       DESCRIPTION = :description,
       REVISION = :revision,
       GROUP_DATA = :groupData`,
    {
      id: group.id,
      name: group.name,
      description: group.description ?? null,
      revision: group.revision,
      groupData: serialized,
    }
  );
}

/**
 * Delete a channel group
 */
async function deleteChannelGroup(id: string): Promise<boolean> {
  await ensureChannelGroupTable();

  const result = await execute(
    'DELETE FROM CHANNEL_GROUP WHERE ID = :id',
    { id }
  );

  return (result as { affectedRows: number }).affectedRows > 0;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /channelgroups
 * Get all channel groups or specific groups by ID
 */
channelGroupRouter.get(
  '/',
  authorize({ operation: CHANNEL_GROUP_GET }),
  async (req: Request, res: Response) => {
    try {
      const groupIds = req.query.channelGroupId;

      let ids: string[] | undefined;
      if (groupIds) {
        ids = Array.isArray(groupIds) ? (groupIds as string[]) : [groupIds as string];
      }

      const groups = await getChannelGroups(ids);
      res.sendData(groups);
    } catch (error) {
      console.error('Get channel groups error:', error);
      res.status(500).json({ error: 'Failed to get channel groups' });
    }
  }
);

/**
 * POST /channelgroups/_getChannelGroups
 * Get channel groups (POST alternative with IDs in body)
 */
channelGroupRouter.post(
  '/_getChannelGroups',
  authorize({ operation: CHANNEL_GROUP_GET }),
  async (req: Request, res: Response) => {
    try {
      let ids: string[] | undefined;

      // Handle various body formats
      if (Array.isArray(req.body)) {
        ids = req.body;
      } else if (req.body && req.body.set && req.body.set.string) {
        // XML format: <set><string>id1</string></set>
        const idList = req.body.set.string;
        ids = Array.isArray(idList) ? idList : [idList];
      }

      const groups = await getChannelGroups(ids);
      res.sendData(groups);
    } catch (error) {
      console.error('Get channel groups POST error:', error);
      res.status(500).json({ error: 'Failed to get channel groups' });
    }
  }
);

/**
 * POST /channelgroups/_bulkUpdate
 * Bulk update channel groups
 *
 * Body format:
 * {
 *   channelGroups: ChannelGroup[],        // Groups to create/update
 *   removedChannelGroupIds: string[]      // Group IDs to delete
 * }
 */
channelGroupRouter.post(
  '/_bulkUpdate',
  authorize({ operation: CHANNEL_GROUP_UPDATE }),
  async (req: Request, res: Response) => {
    try {
      const { channelGroups, removedChannelGroupIds } = req.body as {
        channelGroups?: ChannelGroup[];
        removedChannelGroupIds?: string[];
      };

      // Delete removed groups
      if (removedChannelGroupIds && removedChannelGroupIds.length > 0) {
        for (const id of removedChannelGroupIds) {
          await deleteChannelGroup(id);
        }
      }

      // Create/update groups
      if (channelGroups && channelGroups.length > 0) {
        for (const group of channelGroups) {
          // Generate ID if not provided
          if (!group.id) {
            group.id = uuidv4();
          }
          // Initialize revision if not set
          if (!group.revision) {
            group.revision = 1;
          }
          // Ensure channels array exists
          if (!group.channels) {
            group.channels = [];
          }

          await upsertChannelGroup(group);
        }
      }

      // Return true on success (matches Java API)
      res.sendData(true);
    } catch (error) {
      console.error('Bulk update channel groups error:', error);
      res.status(500).json({ error: 'Failed to update channel groups' });
    }
  }
);
