/**
 * Data Pruner Servlet
 *
 * REST API for data pruner operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datapruner/DataPrunerServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../api/middleware/auth.js';
import { dataPrunerController, DataPrunerConfig } from './DataPrunerController.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('data-pruner', 'Pruning engine');
const logger = getLogger('data-pruner');

export const dataPrunerRouter = Router();

// All routes require authentication
dataPrunerRouter.use(authMiddleware({ required: true }));

/**
 * GET /extensions/datapruner/status
 * Get current pruner status
 */
dataPrunerRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = dataPrunerController.getStatusForApi();
    res.sendData(status);
  } catch (error) {
    logger.error('Get data pruner status error', error as Error);
    res.status(500).json({ error: 'Failed to get data pruner status' });
  }
});

/**
 * GET /extensions/datapruner/lastStatus
 * Get the status from the last completed prune operation
 */
dataPrunerRouter.get('/lastStatus', async (_req: Request, res: Response) => {
  try {
    const status = dataPrunerController.getLastStatusForApi();
    res.sendData(status);
  } catch (error) {
    logger.error('Get last data pruner status error', error as Error);
    res.status(500).json({ error: 'Failed to get last data pruner status' });
  }
});

/**
 * GET /extensions/datapruner/config
 * Get current configuration
 */
dataPrunerRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = dataPrunerController.getConfiguration();
    res.sendData(config);
  } catch (error) {
    logger.error('Get data pruner config error', error as Error);
    res.status(500).json({ error: 'Failed to get data pruner configuration' });
  }
});

/**
 * PUT /extensions/datapruner/config
 * Update configuration
 */
dataPrunerRouter.put('/config', async (req: Request, res: Response) => {
  try {
    const config: Partial<DataPrunerConfig> = req.body;
    await dataPrunerController.updateConfiguration(config);
    res.sendData({ success: true });
  } catch (error) {
    logger.error('Update data pruner config error', error as Error);
    res.status(500).json({ error: 'Failed to update data pruner configuration' });
  }
});

/**
 * GET /extensions/datapruner/running
 * Check if pruner is running
 */
dataPrunerRouter.get('/running', async (_req: Request, res: Response) => {
  try {
    const running = dataPrunerController.isRunning();
    res.sendData(running);
  } catch (error) {
    logger.error('Get data pruner running status error', error as Error);
    res.status(500).json({ error: 'Failed to get running status' });
  }
});

/**
 * POST /extensions/datapruner/_start
 * Start the data pruner
 */
dataPrunerRouter.post('/_start', async (_req: Request, res: Response) => {
  try {
    const started = await dataPrunerController.startPruner();

    if (started) {
      res.sendData({ success: true, message: 'Data pruner started' });
    } else {
      res.status(409).json({ error: 'Data pruner is already running' });
    }
  } catch (error) {
    logger.error('Start data pruner error', error as Error);
    res.status(500).json({ error: 'Failed to start data pruner' });
  }
});

/**
 * POST /extensions/datapruner/_stop
 * Stop the data pruner
 */
dataPrunerRouter.post('/_stop', async (_req: Request, res: Response) => {
  try {
    await dataPrunerController.stopPruner();
    res.sendData({ success: true, message: 'Data pruner stopped' });
  } catch (error) {
    logger.error('Stop data pruner error', error as Error);
    res.status(500).json({ error: 'Failed to stop data pruner' });
  }
});

/**
 * GET /extensions/datapruner/timeElapsed
 * Get the elapsed time for the current task
 */
dataPrunerRouter.get('/timeElapsed', async (_req: Request, res: Response) => {
  try {
    const pruner = dataPrunerController.getPruner();
    const elapsed = pruner.getTimeElapsed();
    res.sendData(elapsed);
  } catch (error) {
    logger.error('Get time elapsed error', error as Error);
    res.status(500).json({ error: 'Failed to get time elapsed' });
  }
});
