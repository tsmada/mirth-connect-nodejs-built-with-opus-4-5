/**
 * Engine Servlet
 *
 * Handles channel deployment operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/EngineServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { EngineController } from '../../controllers/EngineController.js';

export const engineRouter = Router();

/**
 * Extract channel IDs from various request body formats.
 *
 * Mirth sends channel IDs in XML format: <set><string>id</string></set>
 * After XML parsing, this becomes: { set: { string: 'id' } } or { set: { string: ['id1', 'id2'] } }
 *
 * This helper normalizes all formats to a string array.
 */
function extractChannelIds(body: unknown): string[] {
  if (!body) {
    return [];
  }

  // Already an array (e.g., from JSON body)
  if (Array.isArray(body)) {
    return body.filter((id) => typeof id === 'string');
  }

  // Handle parsed XML format: { set: { string: 'id' } } or { set: { string: ['id1', 'id2'] } }
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;

    // Check for <set><string>...</string></set> format
    if (obj.set && typeof obj.set === 'object') {
      const setObj = obj.set as Record<string, unknown>;
      if (setObj.string) {
        if (Array.isArray(setObj.string)) {
          return setObj.string.filter((id) => typeof id === 'string');
        }
        if (typeof setObj.string === 'string') {
          return [setObj.string];
        }
      }
    }

    // Check for <list><string>...</string></list> format (alternative XML format)
    if (obj.list && typeof obj.list === 'object') {
      const listObj = obj.list as Record<string, unknown>;
      if (listObj.string) {
        if (Array.isArray(listObj.string)) {
          return listObj.string.filter((id) => typeof id === 'string');
        }
        if (typeof listObj.string === 'string') {
          return [listObj.string];
        }
      }
    }
  }

  return [];
}

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
    const channelIds = extractChannelIds(req.body);

    if (channelIds.length > 0) {
      console.log(`[EngineServlet] Deploying channels: ${channelIds.join(', ')}`);
      for (const id of channelIds) {
        await EngineController.deployChannel(id);
      }
    } else {
      console.log('[EngineServlet] No specific channels requested, deploying all');
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
    const channelIds = extractChannelIds(req.body);

    if (channelIds.length > 0) {
      console.log(`[EngineServlet] Undeploying channels: ${channelIds.join(', ')}`);
      for (const id of channelIds) {
        await EngineController.undeployChannel(id);
      }
    } else {
      console.log('[EngineServlet] No specific channels requested, undeploying all');
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
