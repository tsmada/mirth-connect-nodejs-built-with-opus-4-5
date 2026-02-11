/**
 * Logging Servlet
 *
 * REST API for runtime log level management.
 * Allows viewing and modifying the global log level and per-component overrides.
 *
 * Endpoints:
 *   GET  /                  - Current global level + all component overrides
 *   PUT  /level             - Set global log level
 *   PUT  /components/:name  - Set component-specific log level override
 *   DELETE /components/:name - Clear component override (revert to global)
 */

import { Router, Request, Response } from 'express';
import { parseLogLevel } from '../../plugins/serverlog/ServerLogItem.js';
import {
  getGlobalLevel,
  setGlobalLevel,
  setComponentLevel,
  clearComponentLevel,
  getRegisteredComponents,
} from '../../logging/index.js';

export const loggingRouter = Router();

const VALID_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

/**
 * GET / - Current global level + all component overrides
 */
loggingRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const globalLevel = getGlobalLevel();
    const components = getRegisteredComponents(globalLevel);
    res.json({ globalLevel, components });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get logging configuration' });
  }
});

/**
 * PUT /level - Set global log level
 * Body: { level: "DEBUG" }
 */
loggingRouter.put('/level', async (req: Request, res: Response) => {
  try {
    const { level } = req.body;
    if (!level || typeof level !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "level" field' });
      return;
    }
    if (!VALID_LEVELS.includes(level.toUpperCase())) {
      res.status(400).json({ error: `Invalid log level: ${level}. Valid: ${VALID_LEVELS.join(', ')}` });
      return;
    }
    const parsed = parseLogLevel(level);
    setGlobalLevel(parsed);
    res.json({ success: true, level: parsed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set global log level' });
  }
});

/**
 * PUT /components/:name - Set component-specific log level override
 * Body: { level: "DEBUG" }
 */
loggingRouter.put('/components/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params.name as string;
    const { level } = req.body;
    if (!level || typeof level !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "level" field' });
      return;
    }
    if (!VALID_LEVELS.includes(level.toUpperCase())) {
      res.status(400).json({ error: `Invalid log level: ${level}. Valid: ${VALID_LEVELS.join(', ')}` });
      return;
    }
    const parsed = parseLogLevel(level);
    setComponentLevel(name, parsed);
    res.json({ success: true, component: name, level: parsed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set component log level' });
  }
});

/**
 * DELETE /components/:name - Clear component override (revert to global)
 */
loggingRouter.delete('/components/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params.name as string;
    clearComponentLevel(name);
    res.json({ success: true, component: name, message: 'Override cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear component override' });
  }
});
