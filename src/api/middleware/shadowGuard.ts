/**
 * Shadow Guard Middleware
 *
 * Blocks mutating HTTP requests (POST/PUT/DELETE/PATCH) when shadow mode is active.
 * Promoted channels are allowed through for channel-scoped operations.
 *
 * Returns 409 Conflict with JSON body when blocked.
 */

import { Request, Response, NextFunction } from 'express';
import { isShadowMode, isChannelPromoted } from '../../cluster/ShadowMode.js';

/**
 * Extract channel ID from request path or body.
 * Checks multiple locations since different routes pass the channel ID differently.
 */
function extractChannelId(req: Request): string | null {
  // From URL params (e.g., /api/channels/:channelId/...)
  if (req.params['channelId']) {
    return req.params['channelId'];
  }

  // From request body (e.g., POST /api/channels/_deploy with { channelIds: [...] })
  if (req.body && typeof req.body === 'object') {
    if (req.body.channelId) return req.body.channelId;
  }

  return null;
}

/**
 * Create shadow guard middleware.
 * When shadow mode is active, blocks POST/PUT/DELETE/PATCH requests
 * unless the operation targets a promoted channel.
 */
export function shadowGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Pass through if shadow mode is not active
    if (!isShadowMode()) {
      next();
      return;
    }

    // Allow GET/HEAD/OPTIONS requests (read-only)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    // Check if request targets a promoted channel
    const channelId = extractChannelId(req);
    if (channelId && isChannelPromoted(channelId)) {
      next();
      return;
    }

    // Block the request
    res.status(409).json({
      error: 'Shadow Mode Active',
      message: channelId
        ? `Channel ${channelId} is not promoted. Use POST /api/system/shadow/promote to activate it.`
        : 'Write operations are blocked in shadow mode. Promote channels individually or use full cutover.',
      shadowMode: true,
      promotePath: '/api/system/shadow/promote',
    });
  };
}
