/**
 * Channel Status Servlet
 *
 * Handles channel status operations (start, stop, pause, resume, halt).
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ChannelStatusServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { EngineController } from '../../controllers/EngineController.js';
import { authorize } from '../middleware/authorization.js';
import {
  CHANNEL_STATUS_GET,
  CHANNEL_STATUS_GET_ALL,
  CHANNEL_STATUS_GET_INITIAL,
  CHANNEL_START,
  CHANNEL_STOP,
  CHANNEL_PAUSE,
  CHANNEL_RESUME,
  CHANNEL_HALT,
} from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const channelStatusRouter = Router();

/**
 * GET /channels/:channelId/status
 * Get status for a single channel
 */
channelStatusRouter.get('/:channelId/status', authorize({ operation: CHANNEL_STATUS_GET, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const status = await EngineController.getChannelStatus(channelId);

    if (!status) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.sendData(status);
  } catch (error) {
    logger.error('Get channel status error', error as Error);
    res.status(500).json({ error: 'Failed to get channel status' });
  }
});

/**
 * GET /channels/statuses
 * Get statuses for all channels or specific channels
 */
channelStatusRouter.get('/statuses', authorize({ operation: CHANNEL_STATUS_GET_ALL }), async (req: Request, res: Response) => {
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
    logger.error('Get channel statuses error', error as Error);
    res.status(500).json({ error: 'Failed to get channel statuses' });
  }
});

/**
 * POST /channels/statuses/_getChannelStatusList
 * Get channel statuses (POST alternative)
 */
channelStatusRouter.post('/statuses/_getChannelStatusList', authorize({ operation: CHANNEL_STATUS_GET_ALL }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    const filter = req.query.filter as string | undefined;
    const includeUndeployed = req.query.includeUndeployed === 'true';

    const ids = channelIds && Array.isArray(channelIds) ? channelIds : undefined;
    const statuses = await EngineController.getChannelStatuses(ids, filter, includeUndeployed);
    res.sendData(statuses);
  } catch (error) {
    logger.error('Get channel statuses POST error', error as Error);
    res.status(500).json({ error: 'Failed to get channel statuses' });
  }
});

/**
 * GET /channels/statuses/initial
 * Get initial dashboard channel info
 */
channelStatusRouter.get('/statuses/initial', authorize({ operation: CHANNEL_STATUS_GET_INITIAL }), async (req: Request, res: Response) => {
  try {
    const fetchSize = parseInt(req.query.fetchSize as string, 10) || 100;
    const filter = req.query.filter as string | undefined;

    const info = await EngineController.getDashboardChannelInfo(fetchSize, filter);
    res.sendData(info);
  } catch (error) {
    logger.error('Get dashboard channel info error', error as Error);
    res.status(500).json({ error: 'Failed to get dashboard channel info' });
  }
});

/**
 * POST /channels/:channelId/_start
 * Start a channel
 */
channelStatusRouter.post('/:channelId/_start', authorize({ operation: CHANNEL_START, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    await EngineController.startChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Start channel error', error as Error);
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
channelStatusRouter.post('/_start', authorize({ operation: CHANNEL_START }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.startChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Start channels error', error as Error);
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
channelStatusRouter.post('/:channelId/_stop', authorize({ operation: CHANNEL_STOP, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    await EngineController.stopChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Stop channel error', error as Error);
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
channelStatusRouter.post('/_stop', authorize({ operation: CHANNEL_STOP }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.stopChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Stop channels error', error as Error);
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
channelStatusRouter.post('/:channelId/_halt', authorize({ operation: CHANNEL_HALT, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    await EngineController.haltChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Halt channel error', error as Error);
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
channelStatusRouter.post('/_halt', authorize({ operation: CHANNEL_HALT }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.haltChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Halt channels error', error as Error);
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
channelStatusRouter.post('/:channelId/_pause', authorize({ operation: CHANNEL_PAUSE, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    await EngineController.pauseChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Pause channel error', error as Error);
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
channelStatusRouter.post('/_pause', authorize({ operation: CHANNEL_PAUSE }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.pauseChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Pause channels error', error as Error);
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
channelStatusRouter.post('/:channelId/_resume', authorize({ operation: CHANNEL_RESUME, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    await EngineController.resumeChannel(channelId);
    res.status(204).end();
  } catch (error) {
    logger.error('Resume channel error', error as Error);
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
channelStatusRouter.post('/_resume', authorize({ operation: CHANNEL_RESUME }), async (req: Request, res: Response) => {
  try {
    const channelIds = req.body.channelId;
    const ids = channelIds ? (Array.isArray(channelIds) ? channelIds : [channelIds]) : [];

    for (const id of ids) {
      await EngineController.resumeChannel(id);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Resume channels error', error as Error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_startConnectors
 * Start connectors across multiple channels
 */
channelStatusRouter.post('/_startConnectors', authorize({ operation: CHANNEL_START }), async (req: Request, res: Response) => {
  try {
    const connectorEntries = req.body as Array<{ channelId: string; metaDataId: number }>;

    if (!Array.isArray(connectorEntries)) {
      res.status(400).json({ error: 'Array of {channelId, metaDataId} required' });
      return;
    }

    for (const entry of connectorEntries) {
      await EngineController.startConnector(entry.channelId, entry.metaDataId);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Start connectors error', error as Error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_stopConnectors
 * Stop connectors across multiple channels
 */
channelStatusRouter.post('/_stopConnectors', authorize({ operation: CHANNEL_STOP }), async (req: Request, res: Response) => {
  try {
    const connectorEntries = req.body as Array<{ channelId: string; metaDataId: number }>;

    if (!Array.isArray(connectorEntries)) {
      res.status(400).json({ error: 'Array of {channelId, metaDataId} required' });
      return;
    }

    for (const entry of connectorEntries) {
      await EngineController.stopConnector(entry.channelId, entry.metaDataId);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Stop connectors error', error as Error);
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
channelStatusRouter.post('/:channelId/connector/:metaDataId/_start', authorize({ operation: CHANNEL_START, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const metaDataId = req.params.metaDataId as string;
    await EngineController.startConnector(channelId, parseInt(metaDataId, 10));
    res.status(204).end();
  } catch (error) {
    logger.error('Start connector error', error as Error);
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
channelStatusRouter.post('/:channelId/connector/:metaDataId/_stop', authorize({ operation: CHANNEL_STOP, checkAuthorizedChannelId: 'channelId' }), async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const metaDataId = req.params.metaDataId as string;
    await EngineController.stopConnector(channelId, parseInt(metaDataId, 10));
    res.status(204).end();
  } catch (error) {
    logger.error('Stop connector error', error as Error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});
