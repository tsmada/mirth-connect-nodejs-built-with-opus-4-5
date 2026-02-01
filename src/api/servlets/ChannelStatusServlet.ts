/**
 * Channel Status Servlet
 *
 * Handles channel status operations (start, stop, pause, resume, halt).
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelStatusServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { EngineController } from '../../controllers/EngineController.js';

export const channelStatusRouter = Router();

// Route param types
interface ChannelParams {
  channelId: string;
}

interface ConnectorParams {
  channelId: string;
  metaDataId: string;
}

/**
 * GET /channels/:channelId/status
 * Get status for a single channel
 */
channelStatusRouter.get('/:channelId/status', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    const status = await EngineController.getChannelStatus(channelId);

    if (!status) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.sendData(status);
  } catch (error) {
    console.error('Get channel status error:', error);
    res.status(500).json({ error: 'Failed to get channel status' });
  }
});

/**
 * GET /channels/statuses
 * Get statuses for all channels or specific channels
 */
channelStatusRouter.get('/statuses', async (req: Request, res: Response) => {
  try {
    const channelIds = req.query.channelId;
    const filter = req.query.filter as string | undefined;
    const includeUndeployed = req.query.includeUndeployed === 'true';

    let ids: string[] | undefined;
    if (channelIds) {
      ids = Array.isArray(channelIds) ? channelIds as string[] : [channelIds as string];
    }

    const statuses = await EngineController.getChannelStatuses(ids, filter, includeUndeployed);
    res.sendData(statuses);
  } catch (error) {
    console.error('Get channel statuses error:', error);
    res.status(500).json({ error: 'Failed to get channel statuses' });
  }
});

/**
 * POST /channels/statuses/_getChannelStatusList
 * Get channel statuses (POST alternative)
 */
channelStatusRouter.post('/statuses/_getChannelStatusList', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    const filter = req.query.filter as string | undefined;
    const includeUndeployed = req.query.includeUndeployed === 'true';

    const ids = channelIds && Array.isArray(channelIds) ? channelIds : undefined;
    const statuses = await EngineController.getChannelStatuses(ids, filter, includeUndeployed);
    res.sendData(statuses);
  } catch (error) {
    console.error('Get channel statuses POST error:', error);
    res.status(500).json({ error: 'Failed to get channel statuses' });
  }
});

/**
 * GET /channels/statuses/initial
 * Get initial dashboard channel info
 */
channelStatusRouter.get('/statuses/initial', async (req: Request, res: Response) => {
  try {
    const fetchSize = parseInt(req.query.fetchSize as string, 10) || 100;
    const filter = req.query.filter as string | undefined;

    const info = await EngineController.getDashboardChannelInfo(fetchSize, filter);
    res.sendData(info);
  } catch (error) {
    console.error('Get dashboard channel info error:', error);
    res.status(500).json({ error: 'Failed to get dashboard channel info' });
  }
});

/**
 * POST /channels/:channelId/_start
 * Start a channel
 */
channelStatusRouter.post('/:channelId/_start', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.startChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Start channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_start
 * Start multiple channels
 */
channelStatusRouter.post('/_start', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.startChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Start channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_stop
 * Stop a channel
 */
channelStatusRouter.post('/:channelId/_stop', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.stopChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Stop channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_stop
 * Stop multiple channels
 */
channelStatusRouter.post('/_stop', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.stopChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Stop channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_halt
 * Halt a channel (force stop)
 */
channelStatusRouter.post('/:channelId/_halt', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.haltChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Halt channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_halt
 * Halt multiple channels
 */
channelStatusRouter.post('/_halt', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.haltChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Halt channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_pause
 * Pause a channel
 */
channelStatusRouter.post('/:channelId/_pause', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.pauseChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Pause channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_pause
 * Pause multiple channels
 */
channelStatusRouter.post('/_pause', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.pauseChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Pause channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_resume
 * Resume a channel
 */
channelStatusRouter.post('/:channelId/_resume', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.resumeChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Resume channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_resume
 * Resume multiple channels
 */
channelStatusRouter.post('/_resume', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.resumeChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Resume channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/connector/:metaDataId/_start
 * Start a connector
 */
channelStatusRouter.post('/:channelId/connector/:metaDataId/_start', async (req: Request<ConnectorParams>, res: Response) => {
  try {
    const { channelId, metaDataId } = req.params;
    await EngineController.startConnector(channelId, parseInt(metaDataId, 10));
    res.status(204).end();
  } catch (error) {
    console.error('Start connector error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/connector/:metaDataId/_stop
 * Stop a connector
 */
channelStatusRouter.post('/:channelId/connector/:metaDataId/_stop', async (req: Request<ConnectorParams>, res: Response) => {
  try {
    const { channelId, metaDataId } = req.params;
    await EngineController.stopConnector(channelId, parseInt(metaDataId, 10));
    res.status(204).end();
  } catch (error) {
    console.error('Stop connector error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});
