/**
 * Server Log Servlet
 *
 * REST API for server log operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/serverlog/ServerLogServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../api/middleware/auth.js';
import { serverLogController } from './ServerLogController.js';
import { parseLogLevel } from './ServerLogItem.js';

export const serverLogRouter = Router();

// All routes require authentication
serverLogRouter.use(authMiddleware({ required: true }));

/**
 * GET /extensions/serverlog
 * Get server log entries
 *
 * Query parameters:
 * - fetchSize: Maximum number of entries to return (default: 100)
 * - lastLogId: Only return entries with ID greater than this
 * - level: Filter by minimum log level (DEBUG, INFO, WARN, ERROR)
 * - category: Filter by category substring
 */
serverLogRouter.get('/', async (req: Request, res: Response) => {
  try {
    const fetchSize = parseInt(req.query.fetchSize as string) || 100;
    const lastLogId = req.query.lastLogId
      ? parseInt(req.query.lastLogId as string)
      : undefined;
    const levelStr = req.query.level as string | undefined;
    const category = req.query.category as string | undefined;

    let logs;

    if (levelStr || category) {
      // Use filtered query
      logs = serverLogController.getFilteredLogs(fetchSize, {
        level: levelStr ? parseLogLevel(levelStr) : undefined,
        category,
        afterId: lastLogId,
      });
    } else {
      // Simple query
      logs = serverLogController.getServerLogs(fetchSize, lastLogId);
    }

    // Serialize for response
    const serialized = logs.map((item) => ({
      id: item.id,
      serverId: item.serverId,
      level: item.level,
      date: item.date.toISOString(),
      threadName: item.threadName,
      category: item.category,
      lineNumber: item.lineNumber,
      message: item.message,
      throwableInformation: item.throwableInformation,
    }));

    res.json(serialized);
  } catch (error) {
    console.error('Get server logs error:', error);
    res.status(500).json({ error: 'Failed to get server logs' });
  }
});

/**
 * GET /extensions/serverlog/status
 * Get server log status (count, latest ID, etc.)
 */
serverLogRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    res.json({
      count: serverLogController.getLogCount(),
      maxSize: serverLogController.getMaxLogSize(),
      latestLogId: serverLogController.getLatestLogId(),
      serverId: serverLogController.getServerId(),
    });
  } catch (error) {
    console.error('Get server log status error:', error);
    res.status(500).json({ error: 'Failed to get server log status' });
  }
});

/**
 * DELETE /extensions/serverlog
 * Clear all server logs
 */
serverLogRouter.delete('/', async (_req: Request, res: Response) => {
  try {
    serverLogController.clearLogs();
    res.json({ success: true, message: 'Server logs cleared' });
  } catch (error) {
    console.error('Clear server logs error:', error);
    res.status(500).json({ error: 'Failed to clear server logs' });
  }
});

/**
 * PUT /extensions/serverlog/config
 * Update server log configuration
 *
 * Body:
 * - maxSize: Maximum number of log entries to keep
 */
serverLogRouter.put('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const { maxSize } = req.body;

    if (maxSize !== undefined) {
      if (typeof maxSize !== 'number' || maxSize < 1) {
        res.status(400).json({ error: 'maxSize must be a positive number' });
        return;
      }
      serverLogController.setMaxLogSize(maxSize);
    }

    res.json({
      success: true,
      maxSize: serverLogController.getMaxLogSize(),
    });
  } catch (error) {
    console.error('Update server log config error:', error);
    res.status(500).json({ error: 'Failed to update server log configuration' });
  }
});
