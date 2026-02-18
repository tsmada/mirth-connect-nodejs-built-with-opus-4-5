/**
 * Dashboard Status Servlet
 *
 * REST API for dashboard connector status operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/dashboardstatus/DashboardConnectorStatusServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../api/middleware/auth.js';
import { dashboardStatusController } from './DashboardStatusController.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

export const dashboardStatusRouter = Router();

// All routes require authentication
dashboardStatusRouter.use(authMiddleware({ required: true }));

/**
 * GET /extensions/dashboardstatus/connectorstates
 * Get the current state of all connectors
 *
 * Response: { serverId: { channelId: [ ConnectionStateItem, ... ] } }
 */
dashboardStatusRouter.get('/connectorstates', async (_req: Request, res: Response) => {
  try {
    const serverId = dashboardStatusController.getServerId();
    const states = dashboardStatusController.getConnectionStatesForApi();

    // Wrap in server ID like Java implementation
    const result: Record<string, typeof states> = {
      [serverId]: states,
    };

    res.json(result);
  } catch (error) {
    logger.error('Get connector states error', error as Error);
    res.status(500).json({ error: 'Failed to get connector states' });
  }
});

/**
 * GET /extensions/dashboardstatus/channellog
 * Get connection log for a specific channel or all channels
 *
 * Query parameters:
 * - channelId: Channel ID to filter by (optional, null for all)
 * - fetchSize: Maximum number of entries to return (default: 100)
 * - lastLogId: Only return entries with ID greater than this
 */
dashboardStatusRouter.get('/channellog', async (req: Request, res: Response) => {
  try {
    const channelId = (req.query.channelId as string) || null;
    const fetchSize = parseInt(req.query.fetchSize as string) || 100;
    const lastLogId = req.query.lastLogId
      ? parseInt(req.query.lastLogId as string)
      : undefined;

    const logs = dashboardStatusController.getSerializableChannelLog(
      channelId,
      fetchSize,
      lastLogId
    );

    res.json(logs);
  } catch (error) {
    logger.error('Get channel log error', error as Error);
    res.status(500).json({ error: 'Failed to get channel log' });
  }
});

/**
 * GET /extensions/dashboardstatus/channellog/:channelId
 * Get connection log for a specific channel
 */
dashboardStatusRouter.get('/channellog/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const fetchSize = parseInt(req.query.fetchSize as string) || 100;
    const lastLogId = req.query.lastLogId
      ? parseInt(req.query.lastLogId as string)
      : undefined;

    const logs = dashboardStatusController.getSerializableChannelLog(
      channelId,
      fetchSize,
      lastLogId
    );

    res.json(logs);
  } catch (error) {
    logger.error('Get channel log error', error as Error);
    res.status(500).json({ error: 'Failed to get channel log' });
  }
});

/**
 * GET /extensions/dashboardstatus/statemap
 * Get the connector state map (raw format)
 *
 * Response: { connectorId: { color: string, state: string } }
 */
dashboardStatusRouter.get('/statemap', async (_req: Request, res: Response) => {
  try {
    const stateMap = dashboardStatusController.getConnectorStateMapForApi();
    res.json(stateMap);
  } catch (error) {
    logger.error('Get state map error', error as Error);
    res.status(500).json({ error: 'Failed to get state map' });
  }
});

/**
 * GET /extensions/dashboardstatus/stats
 * Get dashboard status statistics
 */
dashboardStatusRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = dashboardStatusController.getStats();
    res.json({
      ...stats,
      serverId: dashboardStatusController.getServerId(),
    });
  } catch (error) {
    logger.error('Get dashboard stats error', error as Error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

/**
 * DELETE /extensions/dashboardstatus/channellog
 * Clear all channel logs
 */
dashboardStatusRouter.delete('/channellog', async (_req: Request, res: Response) => {
  try {
    dashboardStatusController.clearAllLogs();
    res.json({ success: true, message: 'All channel logs cleared' });
  } catch (error) {
    logger.error('Clear channel logs error', error as Error);
    res.status(500).json({ error: 'Failed to clear channel logs' });
  }
});

/**
 * DELETE /extensions/dashboardstatus/channellog/:channelId
 * Clear logs for a specific channel
 */
dashboardStatusRouter.delete('/channellog/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    dashboardStatusController.clearChannelLog(channelId);
    res.json({ success: true, message: `Logs cleared for channel ${channelId}` });
  } catch (error) {
    logger.error('Clear channel log error', error as Error);
    res.status(500).json({ error: 'Failed to clear channel log' });
  }
});

/**
 * DELETE /extensions/dashboardstatus/state/:channelId
 * Reset state for a channel
 */
dashboardStatusRouter.delete('/state/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    dashboardStatusController.resetChannelState(channelId);
    res.json({ success: true, message: `State reset for channel ${channelId}` });
  } catch (error) {
    logger.error('Reset channel state error', error as Error);
    res.status(500).json({ error: 'Failed to reset channel state' });
  }
});
