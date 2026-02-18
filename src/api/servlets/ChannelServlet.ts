/**
 * Channel Servlet
 *
 * Handles channel CRUD operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RowDataPacket } from 'mysql2';
import { Channel, ChannelHeader } from '../models/Channel.js';
import { DeployedState } from '../models/DashboardStatus.js';
import { ChannelController } from '../../controllers/ChannelController.js';
import { getPool } from '../../db/pool.js';
import { authorize } from '../middleware/authorization.js';
import {
  CHANNEL_GET_CHANNELS,
  CHANNEL_GET_CHANNEL,
  CHANNEL_GET_CHANNEL_SUMMARY,
  CHANNEL_CREATE,
  CHANNEL_UPDATE,
  CHANNEL_REMOVE,
  CHANNEL_GET_IDS_AND_NAMES,
  MESSAGE_REMOVE_ALL,
} from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const channelRouter = Router();

/**
 * GET /channels
 * Get all channels or channels by IDs
 */
channelRouter.get('/', authorize({ operation: CHANNEL_GET_CHANNELS }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.query.channelId;
    const pollingOnly = req.query.pollingOnly === 'true';
    const includeCodeTemplateLibraries = req.query.includeCodeTemplateLibraries === 'true';

    let channels: Channel[];

    if (channelIds) {
      // Filter by specific channel IDs
      const ids = Array.isArray(channelIds) ? channelIds : [channelIds];
      channels = await Promise.all(
        ids.map((id) => ChannelController.getChannel(id as string))
      ).then((results) => results.filter((c): c is Channel => c !== null));
    } else {
      // Get all channels
      channels = await ChannelController.getAllChannels();
    }

    // Filter polling only if requested
    if (pollingOnly) {
      channels = channels.filter((c) => isPollingChannel(c));
    }

    // Include code template libraries if requested
    if (includeCodeTemplateLibraries) {
      for (const channel of channels) {
        channel.codeTemplateLibraries = await ChannelController.getCodeTemplateLibraries(channel.id);
      }
    }

    res.sendData(channels);
  } catch (error) {
    logger.error('Get channels error', error as Error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

/**
 * POST /channels/_getChannels
 * Get channels by IDs (POST alternative for large ID sets)
 */
channelRouter.post('/_getChannels', authorize({ operation: CHANNEL_GET_CHANNELS }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    const pollingOnly = req.query.pollingOnly === 'true';
    const includeCodeTemplateLibraries = req.query.includeCodeTemplateLibraries === 'true';

    let channels: Channel[];

    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      channels = await Promise.all(
        channelIds.map((id: string) => ChannelController.getChannel(id))
      ).then((results) => results.filter((c): c is Channel => c !== null));
    } else {
      channels = await ChannelController.getAllChannels();
    }

    if (pollingOnly) {
      channels = channels.filter((c) => isPollingChannel(c));
    }

    if (includeCodeTemplateLibraries) {
      for (const channel of channels) {
        channel.codeTemplateLibraries = await ChannelController.getCodeTemplateLibraries(channel.id);
      }
    }

    res.sendData(channels);
  } catch (error) {
    logger.error('Get channels POST error', error as Error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

/**
 * GET /channels/idsAndNames
 * Get map of channel IDs to names
 * NOTE: This MUST come before /:channelId to avoid being matched as a channelId
 */
channelRouter.get('/idsAndNames', authorize({ operation: CHANNEL_GET_IDS_AND_NAMES }), async (_req: Request, res: Response) => {
  try {
    const idsAndNames = await ChannelController.getChannelIdsAndNames();
    res.sendData(idsAndNames);
  } catch (error) {
    logger.error('Get channel IDs and names error', error as Error);
    res.status(500).json({ error: 'Failed to retrieve channel IDs and names' });
  }
});

/**
 * GET /channels/:channelId
 * Get a single channel by ID
 */
channelRouter.get('/:channelId', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const includeCodeTemplateLibraries = req.query.includeCodeTemplateLibraries === 'true';
    const accept = req.get('Accept') || '';
    const wantsXml = accept.includes('application/xml') || accept.includes('text/xml');

    // For XML requests, return raw XML from database to preserve original structure
    if (wantsXml) {
      const channelXml = await ChannelController.getChannelXml(channelId);
      if (!channelXml) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      res.type('application/xml').send(channelXml);
      return;
    }

    // For JSON requests, return parsed channel object
    const channel = await ChannelController.getChannel(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    if (includeCodeTemplateLibraries) {
      channel.codeTemplateLibraries = await ChannelController.getCodeTemplateLibraries(channel.id);
    }

    res.sendData(channel);
  } catch (error) {
    logger.error('Get channel error', error as Error);
    res.status(500).json({ error: 'Failed to retrieve channel' });
  }
});

/**
 * POST /channels/_getSummary
 * Get channel summaries
 */
channelRouter.post('/_getSummary', authorize({ operation: CHANNEL_GET_CHANNEL_SUMMARY }), async (req: Request, res: Response) => {
  try {
    const cachedChannels: Record<string, ChannelHeader> = req.body || {};
    const ignoreNewChannels = req.query.ignoreNewChannels === 'true';

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, ignoreNewChannels);
    res.sendData(summaries);
  } catch (error) {
    logger.error('Get channel summary error', error as Error);
    res.status(500).json({ error: 'Failed to retrieve channel summary' });
  }
});

/**
 * POST /channels
 * Create a new channel or update existing if override=true
 */
channelRouter.post('/', authorize({ operation: CHANNEL_CREATE }), async (req: Request, res: Response) => {
  try {
    const channelData = req.body;
    const override = req.query.override === 'true';
    // Get raw XML if available (stored by content negotiation middleware)
    const rawXml = (req as Request & { rawBody?: string }).rawBody;

    if (!channelData.name) {
      res.status(400).json({ error: 'Channel name is required' });
      return;
    }

    // Generate ID if not provided
    if (!channelData.id) {
      channelData.id = uuidv4();
    }

    // Check if channel already exists
    const existing = await ChannelController.getChannel(channelData.id);
    if (existing) {
      if (override) {
        // Update existing channel - preserve raw XML if available
        const success = await ChannelController.updateChannelWithXml(
          channelData.id,
          channelData,
          rawXml
        );
        res.sendData(success);
        return;
      }
      res.status(409).json({ error: 'Channel already exists' });
      return;
    }

    // Create channel - preserve raw XML if available
    const success = await ChannelController.createChannelWithXml(channelData, rawXml);
    res.sendData(success, success ? 201 : 500);
  } catch (error) {
    logger.error('Create channel error', error as Error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

/**
 * PUT /channels/:channelId
 * Update a channel
 */
channelRouter.put('/:channelId', authorize({ operation: CHANNEL_UPDATE, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const channelData = req.body;
    const override = req.query.override === 'true';

    const existing = await ChannelController.getChannel(channelId);
    if (!existing) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check revision unless override is true
    if (!override && channelData.revision && channelData.revision !== existing.revision) {
      res.status(409).json({ error: 'Channel has been modified' });
      return;
    }

    const success = await ChannelController.updateChannel(channelId, channelData);
    res.sendData(success);
  } catch (error) {
    logger.error('Update channel error', error as Error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

/**
 * DELETE /channels/_removeAllMessages
 * Remove all messages from specified channels
 * Called by GUI bulk "Remove All Messages" action
 * NOTE: Must be registered BEFORE DELETE /:channelId to avoid Express matching
 * "_removeAllMessages" as a channelId parameter.
 */
channelRouter.delete('/_removeAllMessages', authorize({ operation: MESSAGE_REMOVE_ALL }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.query.channelId;
    const clearStatistics = req.query.clearStatistics !== 'false';

    if (!channelIds) {
      res.status(400).json({ error: 'Channel IDs required' });
      return;
    }

    const ids = Array.isArray(channelIds) ? channelIds as string[] : [channelIds as string];
    const pool = getPool();

    for (const channelId of ids) {
      const tableId = channelId.replace(/-/g, '_');

      // Check if tables exist
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [`D_M${tableId}`]
      );

      if (rows.length === 0) continue;

      // Truncate all message-related tables
      await pool.execute(`TRUNCATE TABLE D_MC${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_MA${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_MM${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_M${tableId}`);

      if (clearStatistics) {
        try {
          await pool.execute(`UPDATE D_MS${tableId} SET RECEIVED = 0, FILTERED = 0, TRANSFORMED = 0, PENDING = 0, SENT = 0, ERROR = 0`);
        } catch {
          // Stats table might not exist
        }
      }
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Remove all messages error', error as Error);
    res.status(500).json({ error: 'Failed to remove all messages' });
  }
});

/**
 * DELETE /channels/:channelId
 * Delete a channel
 */
channelRouter.delete('/:channelId', authorize({ operation: CHANNEL_REMOVE, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;

    const existing = await ChannelController.getChannel(channelId);
    if (!existing) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    await ChannelController.deleteChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Delete channel error', error as Error);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

/**
 * DELETE /channels
 * Delete multiple channels
 */
channelRouter.delete('/', authorize({ operation: CHANNEL_REMOVE }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.query.channelId;
    if (!channelIds) {
      res.status(400).json({ error: 'Channel IDs required' });
      return;
    }

    const ids = Array.isArray(channelIds) ? channelIds : [channelIds];
    for (const id of ids) {
      await ChannelController.deleteChannel(id as string);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Delete channels error', error as Error);
    res.status(500).json({ error: 'Failed to delete channels' });
  }
});

/**
 * POST /channels/_removeChannels
 * Delete multiple channels (POST alternative)
 */
channelRouter.post('/_removeChannels', authorize({ operation: CHANNEL_REMOVE }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    if (!channelIds || !Array.isArray(channelIds)) {
      res.status(400).json({ error: 'Channel IDs required' });
      return;
    }

    for (const id of channelIds) {
      await ChannelController.deleteChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Remove channels error', error as Error);
    res.status(500).json({ error: 'Failed to remove channels' });
  }
});

/**
 * POST /channels/_removeAllMessagesPost
 * POST alternative for removing all messages from specified channels
 */
channelRouter.post('/_removeAllMessagesPost', authorize({ operation: MESSAGE_REMOVE_ALL }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    const clearStatistics = req.query.clearStatistics !== 'false';

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      res.status(400).json({ error: 'Channel IDs required in body' });
      return;
    }

    const pool = getPool();

    for (const channelId of channelIds) {
      const tableId = (channelId as string).replace(/-/g, '_');

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [`D_M${tableId}`]
      );

      if (rows.length === 0) continue;

      await pool.execute(`TRUNCATE TABLE D_MC${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_MA${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_MM${tableId}`);
      await pool.execute(`TRUNCATE TABLE D_M${tableId}`);

      if (clearStatistics) {
        try {
          await pool.execute(`UPDATE D_MS${tableId} SET RECEIVED = 0, FILTERED = 0, TRANSFORMED = 0, PENDING = 0, SENT = 0, ERROR = 0`);
        } catch {
          // Stats table might not exist
        }
      }
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Remove all messages POST error', error as Error);
    res.status(500).json({ error: 'Failed to remove all messages' });
  }
});

/**
 * POST /channels/_setInitialState
 * Set initial state for multiple channels
 */
channelRouter.post('/_setInitialState', authorize({ operation: CHANNEL_UPDATE }), async (req: Request, res: Response) => {
  try {
    const { channelIds, initialState } = req.body as { channelIds?: string[]; initialState?: string };

    if (!initialState) {
      res.status(400).json({ error: 'initialState is required' });
      return;
    }

    const ids = channelIds || [];
    for (const id of ids) {
      const channel = await ChannelController.getChannel(id);
      if (channel) {
        channel.properties = channel.properties || {};
        channel.properties.initialState = initialState as DeployedState;
        await ChannelController.updateChannel(id, channel);
      }
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Set initial state error', error as Error);
    res.status(500).json({ error: 'Failed to set initial state' });
  }
});

/**
 * POST /channels/:channelId/initialState/:initialState
 * Set initial state for a single channel
 */
channelRouter.post('/:channelId/initialState/:initialState', authorize({ operation: CHANNEL_UPDATE, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const initialState = req.params.initialState as string;

    const channel = await ChannelController.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    channel.properties = channel.properties || {};
    channel.properties.initialState = initialState as DeployedState;
    await ChannelController.updateChannel(channelId, channel);

    res.status(204).end();
  } catch (error) {
    logger.error('Set channel initial state error', error as Error);
    res.status(500).json({ error: 'Failed to set initial state' });
  }
});

/**
 * POST /channels/_setEnabled
 * Enable/disable channels
 */
channelRouter.post('/_setEnabled', authorize({ operation: CHANNEL_UPDATE }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const enabled = req.body.enabled === 'true' || req.body.enabled === true;

    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    if (ids.length === 0) {
      // Enable/disable all channels
      const allChannels = await ChannelController.getAllChannels();
      for (const channel of allChannels) {
        await ChannelController.setChannelEnabled(channel.id, enabled);
      }
    } else {
      for (const id of ids) {
        await ChannelController.setChannelEnabled(id, enabled);
      }
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Set enabled error', error as Error);
    res.status(500).json({ error: 'Failed to set enabled' });
  }
});

/**
 * POST /channels/:channelId/enabled/:enabled
 * Enable/disable a single channel
 */
channelRouter.post('/:channelId/enabled/:enabled', authorize({ operation: CHANNEL_UPDATE, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const enabled = req.params.enabled as string;
    await ChannelController.setChannelEnabled(channelId, enabled === 'true');
    res.status(204).end();
  } catch (error) {
    logger.error('Set channel enabled error', error as Error);
    res.status(500).json({ error: 'Failed to set channel enabled' });
  }
});

/**
 * GET /channels/:channelId/connectorNames
 * Get connector names for a channel
 */
channelRouter.get('/:channelId/connectorNames', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const channel = await ChannelController.getChannel(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const connectorNames: Record<number, string> = {};
    connectorNames[channel.sourceConnector.metaDataId] = channel.sourceConnector.name;
    for (const dest of channel.destinationConnectors) {
      connectorNames[dest.metaDataId] = dest.name;
    }

    res.sendData(connectorNames);
  } catch (error) {
    logger.error('Get connector names error', error as Error);
    res.status(500).json({ error: 'Failed to get connector names' });
  }
});

/**
 * GET /channels/:channelId/metaDataColumns
 * Get metadata columns for a channel
 */
channelRouter.get('/:channelId/metaDataColumns', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const channel = await ChannelController.getChannel(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const columns = channel.properties.metaDataColumns || [];
    res.sendData(columns);
  } catch (error) {
    logger.error('Get metadata columns error', error as Error);
    res.status(500).json({ error: 'Failed to get metadata columns' });
  }
});

/**
 * Helper to check if channel has polling source connector
 */
function isPollingChannel(channel: Channel): boolean {
  const pollingTransports = [
    'Database Reader',
    'File Reader',
    'DICOM Listener',
    'JavaScript Reader',
  ];
  return pollingTransports.includes(channel.sourceConnector.transportName);
}
