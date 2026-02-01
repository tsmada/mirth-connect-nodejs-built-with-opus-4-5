/**
 * Engine Servlet
 *
 * Handles channel deployment operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/EngineServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { EngineController } from '../../controllers/EngineController.js';

export const engineRouter = Router();

// Route param types
interface ChannelParams {
  channelId: string;
}

/**
 * POST /channels/_redeployAll
 * Redeploy all channels
 */
engineRouter.post('/_redeployAll', async (req: Request, res: Response) => {
  try {
    await EngineController.redeployAllChannels();
    res.status(204).end();
  } catch (error) {
    console.error('Redeploy all channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_deploy
 * Deploy a single channel
 */
engineRouter.post('/:channelId/_deploy', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.deployChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Deploy channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_deploy
 * Deploy multiple channels
 */
engineRouter.post('/_deploy', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      for (const id of channelIds) {
        await EngineController.deployChannel(id);
      }
    } else {
      await EngineController.deployAllChannels();
    }

    res.status(204).end();
  } catch (error) {
    console.error('Deploy channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/:channelId/_undeploy
 * Undeploy a single channel
 */
engineRouter.post('/:channelId/_undeploy', async (req: Request<ChannelParams>, res: Response) => {
  try {
    const { channelId } = req.params;
    await EngineController.undeployChannel(channelId);
    res.status(204).end();
  } catch (error) {
    console.error('Undeploy channel error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});

/**
 * POST /channels/_undeploy
 * Undeploy multiple channels
 */
engineRouter.post('/_undeploy', async (req: Request, res: Response) => {
  try {
    const channelIds = req.body;
    if (channelIds && Array.isArray(channelIds) && channelIds.length > 0) {
      for (const id of channelIds) {
        await EngineController.undeployChannel(id);
      }
    } else {
      await EngineController.undeployAllChannels();
    }

    res.status(204).end();
  } catch (error) {
    console.error('Undeploy channels error:', error);
    const returnErrors = req.query.returnErrors === 'true';
    if (returnErrors) {
      res.status(500).json({ error: (error as Error).message });
    } else {
      res.status(204).end();
    }
  }
});
