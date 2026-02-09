/**
 * SecretsServlet tests
 *
 * Tests REST API endpoints for secrets management.
 * Uses mock SecretsManager and a lightweight HTTP helper (no supertest).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock SecretsManager before import
jest.mock('../../../../src/secrets/SecretsManager', () => ({
  SecretsManager: {
    getInstance: jest.fn(),
  },
}));

// Mock ShadowMode before import
jest.mock('../../../../src/cluster/ShadowMode', () => ({
  isShadowMode: jest.fn(() => false),
}));

import { SecretsManager } from '../../../../src/secrets/SecretsManager.js';
import { isShadowMode } from '../../../../src/cluster/ShadowMode.js';
import { secretsRouter } from '../../../../src/api/servlets/SecretsServlet.js';
import express from 'express';
import { Server } from 'http';

// Lightweight HTTP helper (avoids supertest dependency)
async function request(
  app: express.Express,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const server: Server = app.listen(0, async () => {
      const addr = server.address()!;
      const port = typeof addr === 'string' ? 0 : (addr as { port: number }).port;

      try {
        const fetchUrl = `http://localhost:${port}${url}`;
        const options: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (body !== undefined) {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(fetchUrl, options);
        const responseBody = await response.json().catch(() => null);

        resolve({ status: response.status, body: responseBody });
      } finally {
        server.close();
      }
    });
  });
}

// Build a minimal Express app wrapping the secrets router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/secrets', secretsRouter);
  return app;
}

/**
 * Create a mock SecretsManager with sensible defaults.
 */
function createMockManager(overrides: Record<string, unknown> = {}): any {
  return {
    getProviderStatus: jest.fn(() => [
      { name: 'env', initialized: true },
      { name: 'vault', initialized: true },
    ]),
    getCacheStats: jest.fn(() => ({
      size: 5,
      hits: 42,
      misses: 3,
      evictions: 1,
    })),
    resolve: jest.fn(async (key: string) => {
      if (key === 'DB_PASSWORD') {
        return {
          value: 's3cret',
          source: 'env',
          fetchedAt: new Date('2026-01-15T10:00:00Z'),
          version: undefined,
          expiresAt: undefined,
        };
      }
      return undefined;
    }),
    preload: jest.fn(async () => {}),
    ...overrides,
  };
}

describe('SecretsServlet', () => {
  let app: express.Express;
  const savedEnv = process.env['MIRTH_MODE'];

  beforeEach(() => {
    app = createTestApp();
    (isShadowMode as jest.Mock).mockReturnValue(false);
    (SecretsManager.getInstance as jest.Mock).mockReturnValue(null);
    delete process.env['MIRTH_MODE'];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env['MIRTH_MODE'] = savedEnv;
    } else {
      delete process.env['MIRTH_MODE'];
    }
  });

  // ─── GET /api/secrets/status ────────────────────────────────────────────

  describe('GET /api/secrets/status', () => {
    it('returns 503 when SecretsManager is not initialized', async () => {
      const { status, body } = await request(app, 'GET', '/api/secrets/status');
      expect(status).toBe(503);
      expect(body.error).toBe('Secrets Manager Not Initialized');
    });

    it('returns provider status and cache stats when initialized', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/status');
      expect(status).toBe(200);
      expect(body.providers).toHaveLength(2);
      expect(body.providers[0].name).toBe('env');
      expect(body.cache.size).toBe(5);
      expect(body.cache.hits).toBe(42);
    });
  });

  // ─── GET /api/secrets/keys ──────────────────────────────────────────────

  describe('GET /api/secrets/keys', () => {
    it('returns provider names', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/keys');
      expect(status).toBe(200);
      expect(body.providers).toEqual(['env', 'vault']);
    });
  });

  // ─── GET /api/secrets/:key ──────────────────────────────────────────────

  describe('GET /api/secrets/:key', () => {
    it('returns redacted value by default', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/DB_PASSWORD');
      expect(status).toBe(200);
      expect(body.key).toBe('DB_PASSWORD');
      expect(body.value).toBe('********');
      expect(body.source).toBe('env');
    });

    it('returns actual value with ?showValue=true', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/DB_PASSWORD?showValue=true');
      expect(status).toBe(200);
      expect(body.value).toBe('s3cret');
    });

    it('returns 404 for missing key', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/NONEXISTENT');
      expect(status).toBe(404);
      expect(body.error).toBe('Not Found');
    });

    it('returns 500 when resolve throws', async () => {
      const mgr = createMockManager({
        resolve: jest.fn(async () => { throw new Error('Provider unavailable'); }),
      });
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'GET', '/api/secrets/DB_PASSWORD');
      expect(status).toBe(500);
      expect(body.message).toBe('Provider unavailable');
    });
  });

  // ─── POST /api/secrets/:key — mode guards ──────────────────────────────

  describe('POST /api/secrets/:key', () => {
    it('returns 409 in shadow mode', async () => {
      (isShadowMode as jest.Mock).mockReturnValue(true);
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/MY_KEY', { value: 'test' });
      expect(status).toBe(409);
      expect(body.error).toBe('Write Blocked');
    });

    it('returns 409 in takeover mode', async () => {
      process.env['MIRTH_MODE'] = 'takeover';
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/MY_KEY', { value: 'test' });
      expect(status).toBe(409);
      expect(body.error).toBe('Write Blocked');
    });

    it('returns 400 for missing value in body', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/MY_KEY', {});
      expect(status).toBe(400);
      expect(body.error).toBe('Bad Request');
    });

    it('returns 501 for valid write request (not yet implemented)', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/MY_KEY', { value: 'new-secret' });
      expect(status).toBe(501);
      expect(body.error).toBe('Not Implemented');
    });
  });

  // ─── DELETE /api/secrets/:key ───────────────────────────────────────────

  describe('DELETE /api/secrets/:key', () => {
    it('returns 409 in shadow mode', async () => {
      (isShadowMode as jest.Mock).mockReturnValue(true);
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status } = await request(app, 'DELETE', '/api/secrets/MY_KEY');
      expect(status).toBe(409);
    });

    it('returns 501 in standalone mode', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'DELETE', '/api/secrets/MY_KEY');
      expect(status).toBe(501);
      expect(body.error).toBe('Not Implemented');
    });
  });

  // ─── POST /api/secrets/preload ──────────────────────────────────────────

  describe('POST /api/secrets/preload', () => {
    it('preloads keys successfully', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/preload', {
        keys: ['DB_PASSWORD', 'API_TOKEN'],
      });
      expect(status).toBe(200);
      expect(body.preloaded).toBe(2);
      expect(body.keys).toEqual(['DB_PASSWORD', 'API_TOKEN']);
      expect(mgr.preload).toHaveBeenCalledWith(['DB_PASSWORD', 'API_TOKEN']);
    });

    it('returns 400 for invalid body', async () => {
      const mgr = createMockManager();
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status } = await request(app, 'POST', '/api/secrets/preload', { keys: 'not-an-array' });
      expect(status).toBe(400);
    });

    it('returns 500 when preload throws', async () => {
      const mgr = createMockManager({
        preload: jest.fn(async () => { throw new Error('Cache error'); }),
      });
      (SecretsManager.getInstance as jest.Mock).mockReturnValue(mgr);

      const { status, body } = await request(app, 'POST', '/api/secrets/preload', { keys: ['key1'] });
      expect(status).toBe(500);
      expect(body.message).toBe('Cache error');
    });
  });
});
