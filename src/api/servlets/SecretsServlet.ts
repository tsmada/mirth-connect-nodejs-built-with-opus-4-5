/**
 * SecretsServlet — REST API for secrets management.
 *
 * Read operations available in all modes.
 * Write operations blocked in takeover/shadow modes (returns 409).
 *
 * Endpoints:
 * - GET  /api/secrets/status     — Provider status and cache stats
 * - GET  /api/secrets/keys       — List available secret providers
 * - POST /api/secrets/preload    — Pre-load keys into sync cache
 * - GET  /api/secrets/:key       — Get a secret value (redacted by default)
 * - POST /api/secrets/:key       — Set a secret value (mode-guarded)
 * - DELETE /api/secrets/:key     — Delete a secret (mode-guarded)
 */

import { Router, Request, Response } from 'express';
import { SecretsManager } from '../../secrets/SecretsManager.js';
import { isShadowMode } from '../../cluster/ShadowMode.js';

export const secretsRouter = Router();

/**
 * Check if write operations are allowed in the current mode.
 */
function isWriteAllowed(): { allowed: boolean; reason?: string } {
  if (isShadowMode()) {
    return { allowed: false, reason: 'Write operations blocked in shadow mode' };
  }
  const mode = process.env['MIRTH_MODE'];
  if (mode === 'takeover') {
    return {
      allowed: false,
      reason: 'Write operations blocked in takeover mode (shared database)',
    };
  }
  return { allowed: true };
}

/**
 * Check if SecretsManager is initialized; send 503 if not.
 */
function getManager(res: Response): SecretsManager | null {
  const mgr = SecretsManager.getInstance();
  if (!mgr) {
    res.status(503).json({
      error: 'Secrets Manager Not Initialized',
      message: 'Set MIRTH_SECRETS_PROVIDERS environment variable to enable secrets management',
    });
    return null;
  }
  return mgr;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /status — Provider status and cache stats
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.get('/status', (_req: Request, res: Response) => {
  const mgr = getManager(res);
  if (!mgr) return;

  res.json({
    providers: mgr.getProviderStatus(),
    cache: mgr.getCacheStats(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /keys — List available secret providers
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.get('/keys', (_req: Request, res: Response) => {
  const mgr = getManager(res);
  if (!mgr) return;

  const status = mgr.getProviderStatus();
  res.json({
    providers: status.map((p) => p.name),
    note: 'Key listing requires provider-specific list() support. Use GET /api/secrets/:key to check individual keys.',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /preload — Pre-load keys into sync cache
// IMPORTANT: Must be registered BEFORE /:key to avoid "preload" matching as a key
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.post('/preload', async (req: Request, res: Response) => {
  const mgr = getManager(res);
  if (!mgr) return;

  const keys = req.body?.keys;
  if (!Array.isArray(keys)) {
    res
      .status(400)
      .json({ error: 'Bad Request', message: 'Body must contain { keys: ["key1", ...] }' });
    return;
  }

  try {
    await mgr.preload(keys);
    res.json({ preloaded: keys.length, keys });
  } catch (err) {
    res.status(500).json({ error: 'Preload failed', message: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:key — Get a secret value
// Query: ?showValue=true to show actual value (default: redacted)
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.get('/:key', async (req: Request, res: Response) => {
  const mgr = getManager(res);
  if (!mgr) return;

  const key = req.params['key']!;
  const showValue = req.query['showValue'] === 'true';

  try {
    const secret = await mgr.resolve(key);
    if (!secret) {
      res.status(404).json({ error: 'Not Found', key });
      return;
    }

    res.json({
      key,
      value: showValue ? secret.value : '********',
      source: secret.source,
      fetchedAt: secret.fetchedAt.toISOString(),
      version: secret.version,
      expiresAt: secret.expiresAt?.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve secret', message: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:key — Set a secret value (mode-guarded)
// Body: { value: "secret-value" }
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.post('/:key', async (req: Request, res: Response) => {
  const writeCheck = isWriteAllowed();
  if (!writeCheck.allowed) {
    res.status(409).json({
      error: 'Write Blocked',
      message: writeCheck.reason,
    });
    return;
  }

  const mgr = getManager(res);
  if (!mgr) return;

  const value = req.body?.value;
  if (typeof value !== 'string') {
    res
      .status(400)
      .json({ error: 'Bad Request', message: 'Body must contain { value: "string" }' });
    return;
  }

  res.status(501).json({
    error: 'Not Implemented',
    message: 'Secret writes are provider-specific. Use the vault/cloud console directly.',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:key — Delete a secret (mode-guarded)
// ─────────────────────────────────────────────────────────────────────────────

secretsRouter.delete('/:key', async (_req: Request, res: Response) => {
  const writeCheck = isWriteAllowed();
  if (!writeCheck.allowed) {
    res.status(409).json({
      error: 'Write Blocked',
      message: writeCheck.reason,
    });
    return;
  }

  const mgr = getManager(res);
  if (!mgr) return;

  res.status(501).json({
    error: 'Not Implemented',
    message: 'Secret deletes are provider-specific. Use the vault/cloud console directly.',
  });
});
