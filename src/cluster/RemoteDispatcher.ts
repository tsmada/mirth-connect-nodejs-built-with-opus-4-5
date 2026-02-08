/**
 * Remote Dispatcher
 *
 * Dispatches messages to remote Mirth instances in a clustered deployment.
 * Used when a Channel Writer destination targets a channel deployed on a different instance.
 * Secured with MIRTH_CLUSTER_SECRET for inter-node authentication.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getClusterConfig } from './ClusterConfig.js';
import { EngineController } from '../controllers/EngineController.js';
import { RawMessage } from '../model/RawMessage.js';

export interface RemoteDispatchResult {
  messageId: number;
  status: string;
}

/**
 * Dispatch a message to a remote Mirth instance via HTTP.
 *
 * @param targetApiUrl - Base API URL of the remote instance (e.g. http://mirth-2:8081)
 * @param channelId - Target channel ID
 * @param rawData - Raw message content
 * @param sourceMap - Optional source map data for tracing
 */
export async function dispatchToRemote(
  targetApiUrl: string,
  channelId: string,
  rawData: string,
  sourceMap?: Record<string, unknown>
): Promise<RemoteDispatchResult> {
  const config = getClusterConfig();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.clusterSecret) {
    headers['X-Cluster-Secret'] = config.clusterSecret;
  }

  const url = `${targetApiUrl.replace(/\/$/, '')}/api/internal/dispatch`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channelId, rawData, sourceMap }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote dispatch to ${targetApiUrl} failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as RemoteDispatchResult;
}

/**
 * Internal dispatch router.
 * Receives messages from other cluster instances and dispatches them locally.
 * Mount at /api/internal.
 */
export const internalRouter = Router();

// Verify cluster secret on all internal routes
internalRouter.use((req: Request, res: Response, next: NextFunction) => {
  const config = getClusterConfig();
  if (config.clusterSecret && req.headers['x-cluster-secret'] !== config.clusterSecret) {
    res.status(403).json({ error: 'Invalid cluster secret' });
    return;
  }
  next();
});

/**
 * POST /api/internal/dispatch
 *
 * Body: { channelId: string, rawData: string, sourceMap?: Record<string, unknown> }
 * Returns: { messageId: number, status: string }
 */
internalRouter.post('/dispatch', async (req: Request, res: Response) => {
  try {
    const { channelId, rawData, sourceMap } = req.body as {
      channelId?: string;
      rawData?: string;
      sourceMap?: Record<string, unknown>;
    };

    if (!channelId || !rawData) {
      res.status(400).json({ error: 'Missing channelId or rawData' });
      return;
    }

    const rawMessage = RawMessage.fromString(rawData);
    if (sourceMap) {
      const map = rawMessage.getSourceMap();
      for (const [key, value] of Object.entries(sourceMap)) {
        map.set(key, value);
      }
    }

    const result = await EngineController.dispatchRawMessage(channelId, rawMessage);

    if (!result) {
      res.status(200).json({ messageId: -1, status: 'FILTERED' });
      return;
    }

    res.status(200).json({
      messageId: result.messageId ?? -1,
      status: result.selectedResponse?.status?.toString() ?? 'SENT',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
