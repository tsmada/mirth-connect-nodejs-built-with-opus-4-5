/**
 * Channel Servlet
 *
 * Handles channel CRUD operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Channel, ChannelHeader } from '../models/Channel.js';
import { ChannelController } from '../../controllers/ChannelController.js';

export const channelRouter = Router();

// Route param types
interface ChannelParams {
  channelId: string;
}

interface EnabledParams {
  channelId: string;
  enabled: string;
}

/**
 * GET /channels
 * Get all channels or channels by IDs
 */
channelRouter.get('/', async (req: Request, res: Response) => {
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
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

/**
 * POST /channels/_getChannels
 * Get channels by IDs (POST alternative for large ID sets)
 */
channelRouter.post('/_getChannels', async (req: Request, res: Response) => {
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
    console.error('Get channels POST error:', error);
    res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

/**
 * GET /channels/:channelId
 * Get a single channel by ID
 */
channelRouter.get('/:channelId', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    const includeCodeTemplateLibraries = req.query.includeCodeTemplateLibraries === 'true';
    const accept = req.get('Accept') || '';
    const wantsXml = accept.includes('application/xml') || accept.includes('text/xml');

    // Skip status and statuses routes
    if (channelId === 'statuses' || channelId === 'idsAndNames') {
      return;
    }

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
    console.error('Get channel error:', error);
    res.status(500).json({ error: 'Failed to retrieve channel' });
  }
});

/**
 * GET /channels/idsAndNames
 * Get map of channel IDs to names
 */
channelRouter.get('/idsAndNames', async (_req: Request, res: Response) => {
  try {
    const idsAndNames = await ChannelController.getChannelIdsAndNames();
    res.sendData(idsAndNames);
  } catch (error) {
    console.error('Get channel IDs and names error:', error);
    res.status(500).json({ error: 'Failed to retrieve channel IDs and names' });
  }
});

/**
 * POST /channels/_getSummary
 * Get channel summaries
 */
channelRouter.post('/_getSummary', async (req: Request, res: Response) => {
  try {
    const cachedChannels: Record<string, ChannelHeader> = req.body || {};
    const ignoreNewChannels = req.query.ignoreNewChannels === 'true';

    const summaries = await ChannelController.getChannelSummaries(cachedChannels, ignoreNewChannels);
    res.sendData(summaries);
  } catch (error) {
    console.error('Get channel summary error:', error);
    res.status(500).json({ error: 'Failed to retrieve channel summary' });
  }
});

/**
 * POST /channels
 * Create a new channel or update existing if override=true
 */
channelRouter.post('/', async (req: Request, res: Response) => {
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
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

/**
 * PUT /channels/:channelId
 * Update a channel
 */
channelRouter.put('/:channelId', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
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
    console.error('Update channel error:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

/**
 * DELETE /channels/:channelId
 * Delete a channel
 */
channelRouter.delete('/:channelId', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;

    const existing = await ChannelController.getChannel(channelId);
    if (!existing) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    await ChannelController.deleteChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Delete channel error:', error);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

/**
 * DELETE /channels
 * Delete multiple channels
 */
channelRouter.delete('/', async (req: Request, res: Response) => {
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
    console.error('Delete channels error:', error);
    res.status(500).json({ error: 'Failed to delete channels' });
  }
});

/**
 * POST /channels/_removeChannels
 * Delete multiple channels (POST alternative)
 */
channelRouter.post('/_removeChannels', async (req: Request, res: Response) => {
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
    console.error('Remove channels error:', error);
    res.status(500).json({ error: 'Failed to remove channels' });
  }
});

/**
 * POST /channels/_setEnabled
 * Enable/disable channels
 */
channelRouter.post('/_setEnabled', async (req: Request, res: Response) => {
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
    console.error('Set enabled error:', error);
    res.status(500).json({ error: 'Failed to set enabled' });
  }
});

/**
 * POST /channels/:channelId/enabled/:enabled
 * Enable/disable a single channel
 */
channelRouter.post('/:channelId/enabled/:enabled', async (req: Request<EnabledParams>, res: Response) => {
  try {
    const { channelId, enabled } = req.params;
    await ChannelController.setChannelEnabled(channelId, enabled === 'true');
    res.status(204).end();
  } catch (error) {
    console.error('Set channel enabled error:', error);
    res.status(500).json({ error: 'Failed to set channel enabled' });
  }
});

/**
 * GET /channels/:channelId/connectorNames
 * Get connector names for a channel
 */
channelRouter.get('/:channelId/connectorNames', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
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
    console.error('Get connector names error:', error);
    res.status(500).json({ error: 'Failed to get connector names' });
  }
});

/**
 * GET /channels/:channelId/metaDataColumns
 * Get metadata columns for a channel
 */
channelRouter.get('/:channelId/metaDataColumns', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    const channel = await ChannelController.getChannel(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const columns = channel.properties.metaDataColumns || [];
    res.sendData(columns);
  } catch (error) {
    console.error('Get metadata columns error:', error);
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
