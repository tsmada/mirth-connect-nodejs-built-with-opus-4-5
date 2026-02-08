/**
 * ArtifactServlet tests
 *
 * Tests REST API endpoints for the artifact management system.
 * Uses mock req/res objects to test route handlers in isolation.
 */

import express from 'express';
import { artifactRouter } from '../../../../src/api/servlets/ArtifactServlet.js';
import { ArtifactController } from '../../../../src/artifact/ArtifactController.js';

// Create a test app with the artifact router
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/artifacts', artifactRouter);
  return app;
}

// Lightweight HTTP helper (avoids supertest dependency)
async function request(
  app: express.Express,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address()!;
      const port = typeof addr === 'string' ? 0 : addr.port;

      try {
        const fetchUrl = `http://localhost:${port}${url}`;
        const options: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (body) {
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

describe('ArtifactServlet', () => {
  let app: express.Express;

  beforeEach(() => {
    ArtifactController._reset();
    app = createTestApp();
  });

  afterEach(() => {
    ArtifactController._reset();
  });

  // ─── 503 when not initialized ──────────────────────────────────────────

  describe('503 when not initialized', () => {
    it('POST /export returns 503', async () => {
      const { status, body } = await request(app, 'POST', '/api/artifacts/export', { channelXmls: {} });
      expect(status).toBe(503);
      expect((body as any).error).toMatch(/not initialized/i);
    });

    it('GET /git/status returns 503', async () => {
      const { status, body } = await request(app, 'GET', '/api/artifacts/git/status');
      expect(status).toBe(503);
      expect((body as any).error).toMatch(/not initialized/i);
    });

    it('POST /git/push returns 503', async () => {
      const { status } = await request(app, 'POST', '/api/artifacts/git/push');
      expect(status).toBe(503);
    });

    it('POST /git/pull returns 503', async () => {
      const { status } = await request(app, 'POST', '/api/artifacts/git/pull');
      expect(status).toBe(503);
    });

    it('POST /import returns 503', async () => {
      const { status } = await request(app, 'POST', '/api/artifacts/import', { all: true });
      expect(status).toBe(503);
    });

    it('GET /delta returns 503', async () => {
      const { status } = await request(app, 'GET', '/api/artifacts/delta');
      expect(status).toBe(503);
    });

    it('POST /deploy returns 503', async () => {
      const { status } = await request(app, 'POST', '/api/artifacts/deploy', {});
      expect(status).toBe(503);
    });

    it('POST /promote returns 503', async () => {
      const { status } = await request(app, 'POST', '/api/artifacts/promote', {
        sourceEnv: 'dev',
        targetEnv: 'staging',
      });
      expect(status).toBe(503);
    });
  });

  // ─── 400 validation errors ─────────────────────────────────────────────

  describe('400 validation errors', () => {
    it('POST /export with missing channelXmls returns 400', async () => {
      // Initialize so we get past 503
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-test-'));
      await ArtifactController.initialize(tempDir);

      const { status, body } = await request(app, 'POST', '/api/artifacts/export', {});
      expect(status).toBe(400);
      expect((body as any).error).toMatch(/invalid/i);

      ArtifactController._reset();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('POST /promote with missing params returns 400', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-test-'));
      await ArtifactController.initialize(tempDir);

      const { status, body } = await request(app, 'POST', '/api/artifacts/promote', {});
      expect(status).toBe(400);
      expect((body as any).error).toMatch(/missing/i);

      ArtifactController._reset();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // ─── Endpoints that don't require initialization ───────────────────────

  describe('endpoints without init requirement', () => {
    it('GET /deps returns dependency graph', async () => {
      const { status, body } = await request(app, 'GET', '/api/artifacts/deps');
      expect(status).toBe(200);
      expect((body as any).nodes).toBeDefined();
    });

    it('GET /promote/status returns approval records', async () => {
      const { status, body } = await request(app, 'GET', '/api/artifacts/promote/status');
      expect(status).toBe(200);
      expect((body as any).pending).toBeDefined();
      expect((body as any).history).toBeDefined();
    });
  });

  // ─── Router mounts all expected paths ──────────────────────────────────

  describe('route registration', () => {
    it('has export routes', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('POST /export');
      expect(routes).toContain('GET /export/:channelId');
    });

    it('has import route', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('POST /import');
    });

    it('has diff route', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('GET /diff/:channelId');
    });

    it('has sensitive route', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('GET /sensitive/:channelId');
    });

    it('has git routes', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('GET /git/status');
      expect(routes).toContain('POST /git/push');
      expect(routes).toContain('POST /git/pull');
      expect(routes).toContain('GET /git/log');
    });

    it('has promote routes', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('POST /promote');
      expect(routes).toContain('GET /promote/status');
    });

    it('has delta and deploy routes', () => {
      const routes = getRoutes(artifactRouter);
      expect(routes).toContain('GET /delta');
      expect(routes).toContain('POST /deploy');
    });
  });
});

/**
 * Extract route definitions from an Express router.
 */
function getRoutes(router: express.Router): string[] {
  const routes: string[] = [];

  if ((router as any).stack) {
    for (const layer of (router as any).stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter(m => layer.route.methods[m])
          .map(m => m.toUpperCase());
        for (const method of methods) {
          routes.push(`${method} ${layer.route.path}`);
        }
      }
    }
  }

  return routes;
}
