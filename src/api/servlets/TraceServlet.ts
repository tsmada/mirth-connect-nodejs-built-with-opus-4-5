/**
 * Trace Servlet
 *
 * REST API endpoint for cross-channel message tracing.
 *
 * GET /api/messages/trace/:channelId/:messageId
 *   - Traces a message across all VM-connected channels
 *   - Returns full tree structure with optional content snapshots
 */

import { Router, Request, Response } from 'express';
import { authorize } from '../middleware/authorization.js';
import { MESSAGE_TRACE } from '../middleware/operations.js';
import { traceMessage, TraceOptions } from '../services/TraceService.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const traceRouter = Router();

/**
 * GET /:channelId/:messageId
 * Trace a message across channels
 */
traceRouter.get(
  '/:channelId/:messageId',
  authorize({ operation: MESSAGE_TRACE }),
  async (req: Request, res: Response) => {
    try {
      const channelId = req.params.channelId as string;
      const messageIdStr = req.params.messageId as string;

      const messageId = parseInt(messageIdStr, 10);
      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      // Parse query options
      const options: Partial<TraceOptions> = {};

      if (req.query.includeContent !== undefined) {
        options.includeContent = req.query.includeContent !== 'false';
      }

      if (req.query.contentTypes !== undefined) {
        options.contentTypes = (req.query.contentTypes as string).split(',').map(s => s.trim());
      }

      if (req.query.maxContentLength !== undefined) {
        const len = parseInt(req.query.maxContentLength as string, 10);
        if (!isNaN(len) && len > 0) {
          options.maxContentLength = len;
        }
      }

      if (req.query.maxDepth !== undefined) {
        const depth = parseInt(req.query.maxDepth as string, 10);
        if (!isNaN(depth) && depth > 0 && depth <= 50) {
          options.maxDepth = depth;
        }
      }

      if (req.query.maxChildren !== undefined) {
        const children = parseInt(req.query.maxChildren as string, 10);
        if (!isNaN(children) && children > 0 && children <= 200) {
          options.maxChildren = children;
        }
      }

      if (req.query.direction !== undefined) {
        const dir = req.query.direction as string;
        if (['both', 'backward', 'forward'].includes(dir)) {
          options.direction = dir as 'both' | 'backward' | 'forward';
        }
      }

      const result = await traceMessage(channelId, messageId, options);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('not found') || message.includes('not deployed')) {
        res.status(404).json({ error: message });
        return;
      }

      logger.error('Trace error', error as Error);
      res.status(500).json({ error: 'Failed to trace message' });
    }
  }
);
