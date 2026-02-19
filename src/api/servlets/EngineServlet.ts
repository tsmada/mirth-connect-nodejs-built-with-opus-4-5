/**
 * Engine Servlet
 *
 * Handles channel deployment operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/EngineServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { EngineController } from '../../controllers/EngineController.js';
import { authorize } from '../middleware/authorization.js';
import { ENGINE_DEPLOY, ENGINE_UNDEPLOY, ENGINE_REDEPLOY_ALL } from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

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

/**
 * POST /channels/_redeployAll
 * Redeploy all channels
 */
engineRouter.post(
  '/_redeployAll',
  authorize({ operation: ENGINE_REDEPLOY_ALL }),
  async (req: Request, res: Response) => {
    try {
      await EngineController.redeployAllChannels();
      res.status(204).end();
    } catch (error) {
      logger.error('Redeploy all channels error', error as Error);
      const returnErrors = req.query.returnErrors === 'true';
      if (returnErrors) {
        res.status(500).json({ error: (error as Error).message });
      } else {
        res.status(204).end();
      }
    }
  }
);

/**
 * POST /channels/:channelId/_deploy
 * Deploy a single channel
 */
engineRouter.post(
  '/:channelId/_deploy',
  authorize({ operation: ENGINE_DEPLOY, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = req.params.channelId as string;
      await EngineController.deployChannel(channelId);
      res.status(204).end();
    } catch (error) {
      logger.error('Deploy channel error', error as Error);
      const returnErrors = req.query.returnErrors === 'true';
      if (returnErrors) {
        res.status(500).json({ error: (error as Error).message });
      } else {
        res.status(204).end();
      }
    }
  }
);

/**
 * POST /channels/_deploy
 * Deploy multiple channels
 */
engineRouter.post(
  '/_deploy',
  authorize({ operation: ENGINE_DEPLOY }),
  async (req: Request, res: Response) => {
    try {
      const channelIds = extractChannelIds(req.body);

      const errors: Array<{ channelId: string; error: string }> = [];

      if (channelIds.length > 0) {
        logger.info(`[EngineServlet] Deploying channels: ${channelIds.join(', ')}`);
        for (const id of channelIds) {
          try {
            await EngineController.deployChannel(id);
          } catch (err) {
            const msg = (err as Error).message;
            logger.error(`[EngineServlet] Failed to deploy channel ${id}: ${msg}`);
            errors.push({ channelId: id, error: msg });
          }
        }
      } else {
        logger.info('[EngineServlet] No specific channels requested, deploying all');
        await EngineController.deployAllChannels();
      }

      const returnErrors = req.query.returnErrors === 'true';
      if (errors.length > 0 && returnErrors) {
        res.status(500).json({ errors });
      } else {
        res.status(204).end();
      }
    } catch (error) {
      logger.error('Deploy channels error', error as Error);
      const returnErrors = req.query.returnErrors === 'true';
      if (returnErrors) {
        res.status(500).json({ error: (error as Error).message });
      } else {
        res.status(204).end();
      }
    }
  }
);

/**
 * POST /channels/:channelId/_undeploy
 * Undeploy a single channel
 */
engineRouter.post(
  '/:channelId/_undeploy',
  authorize({ operation: ENGINE_UNDEPLOY, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = req.params.channelId as string;
      await EngineController.undeployChannel(channelId);
      res.status(204).end();
    } catch (error) {
      logger.error('Undeploy channel error', error as Error);
      const returnErrors = req.query.returnErrors === 'true';
      if (returnErrors) {
        res.status(500).json({ error: (error as Error).message });
      } else {
        res.status(204).end();
      }
    }
  }
);

/**
 * POST /channels/_undeploy
 * Undeploy multiple channels
 */
engineRouter.post(
  '/_undeploy',
  authorize({ operation: ENGINE_UNDEPLOY }),
  async (req: Request, res: Response) => {
    try {
      const channelIds = extractChannelIds(req.body);

      if (channelIds.length > 0) {
        logger.info(`[EngineServlet] Undeploying channels: ${channelIds.join(', ')}`);
        for (const id of channelIds) {
          await EngineController.undeployChannel(id);
        }
      } else {
        logger.info('[EngineServlet] No specific channels requested, undeploying all');
        await EngineController.undeployAllChannels();
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Undeploy channels error', error as Error);
      const returnErrors = req.query.returnErrors === 'true';
      if (returnErrors) {
        res.status(500).json({ error: (error as Error).message });
      } else {
        res.status(204).end();
      }
    }
  }
);
