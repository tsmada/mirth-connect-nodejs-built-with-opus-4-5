/**
 * Shadow Mode Servlet
 *
 * REST API for managing shadow mode during takeover operations.
 * Allows progressive promotion of channels from shadow (read-only)
 * to active (processing) state.
 *
 * Endpoints:
 * - GET  /api/system/shadow          — Shadow status + promoted channels list
 * - POST /api/system/shadow/promote  — Promote channel or full cutover
 * - POST /api/system/shadow/demote   — Stop + demote a promoted channel
 */

import { Router, Request, Response } from 'express';
import {
  isShadowMode,
  promoteChannel,
  demoteChannel,
  promoteAllChannels,
  getPromotedChannels,
  isChannelPromoted,
} from '../../cluster/ShadowMode.js';
import { EngineController } from '../../controllers/EngineController.js';
import { execute } from '../../db/pool.js';
import { getServerId } from '../../cluster/ClusterIdentity.js';
import { getMirthInstance } from '../../server/Mirth.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const shadowRouter = Router();

/**
 * GET /api/system/shadow — Shadow mode status
 */
shadowRouter.get('/', (_req: Request, res: Response) => {
  const promoted = Array.from(getPromotedChannels());
  const deployedCount = EngineController.getDeployedCount();

  res.json({
    shadowMode: isShadowMode(),
    promotedChannels: promoted,
    promotedCount: promoted.length,
    deployedCount,
    serverId: getServerId(),
  });
});

/**
 * POST /api/system/shadow/promote — Promote channel(s) or full cutover
 *
 * Body: { channelId: string } — promote single channel
 * Body: { all: true }         — full cutover (promote all, disable shadow mode)
 */
shadowRouter.post('/promote', async (req: Request, res: Response) => {
  try {
    if (!isShadowMode()) {
      res.status(400).json({
        error: 'Not in Shadow Mode',
        message: 'Shadow mode is not active. No promotion needed.',
      });
      return;
    }

    const { channelId, all } = req.body || {};

    // Full cutover
    if (all === true) {
      promoteAllChannels();

      // Start all deployed-but-stopped channels
      const startErrors: Array<{ channelId: string; error: string }> = [];

      // Get all channel statuses to find stopped channels
      const statuses = await EngineController.getChannelStatuses();
      for (const status of statuses) {
        if (status.state === 'STOPPED') {
          try {
            await EngineController.startChannel(status.channelId);
          } catch (err) {
            startErrors.push({
              channelId: status.channelId,
              error: String(err),
            });
          }
        }
      }

      // Complete shadow cutover: initialize VMRouter + DataPruner
      const mirth = getMirthInstance();
      if (mirth) {
        await mirth.completeShadowCutover();
      }

      const deployedCount = EngineController.getDeployedCount();

      // Update D_SERVERS status from SHADOW to ONLINE
      try {
        const serverId = getServerId();
        await execute(
          `UPDATE D_SERVERS SET STATUS = 'ONLINE' WHERE SERVER_ID = :serverId`,
          { serverId }
        );
      } catch (err) {
        logger.error('[Shadow] Failed to update D_SERVERS status', err as Error);
      }

      res.json({
        success: true,
        message: 'Full cutover complete. Shadow mode disabled.',
        deployedCount,
        startErrors: startErrors.length > 0 ? startErrors : undefined,
      });
      return;
    }

    // Single channel promote
    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({
        error: 'Missing channelId',
        message: 'Provide { channelId: "..." } or { all: true }',
      });
      return;
    }

    if (isChannelPromoted(channelId)) {
      res.status(400).json({
        error: 'Already Promoted',
        message: `Channel ${channelId} is already promoted.`,
      });
      return;
    }

    // Promote and start
    promoteChannel(channelId);

    try {
      await EngineController.startChannel(channelId);
    } catch (startError) {
      // If start fails (e.g., port conflict), demote back
      demoteChannel(channelId);
      res.status(500).json({
        error: 'Start Failed',
        message: `Channel ${channelId} promoted but failed to start: ${startError}. Channel demoted back to shadow.`,
        hint: 'Ensure the channel is stopped on Java Mirth before promoting.',
      });
      return;
    }

    res.json({
      success: true,
      message: `Channel ${channelId} promoted and started.`,
      warning: 'Ensure this channel is stopped on Java Mirth to avoid conflicts.',
      promotedChannels: Array.from(getPromotedChannels()),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Promotion Failed',
      message: String(error),
    });
  }
});

/**
 * POST /api/system/shadow/demote — Stop and demote a promoted channel
 *
 * Body: { channelId: string }
 */
shadowRouter.post('/demote', async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body || {};

    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({
        error: 'Missing channelId',
        message: 'Provide { channelId: "..." }',
      });
      return;
    }

    if (!isChannelPromoted(channelId)) {
      res.status(400).json({
        error: 'Not Promoted',
        message: `Channel ${channelId} is not currently promoted.`,
      });
      return;
    }

    // Stop the channel first
    try {
      await EngineController.stopChannel(channelId);
    } catch (stopError) {
      logger.error(`Error stopping channel ${channelId} during demotion`, stopError as Error);
      // Continue with demotion even if stop fails
    }

    demoteChannel(channelId);

    res.json({
      success: true,
      message: `Channel ${channelId} stopped and demoted to shadow mode.`,
      promotedChannels: Array.from(getPromotedChannels()),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Demotion Failed',
      message: String(error),
    });
  }
});
