/**
 * LoggingServlet tests
 *
 * Tests REST API endpoints for runtime log level management.
 * Uses the stub logging module and a lightweight HTTP helper.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import { Server } from 'http';
import { loggingRouter } from '../../../../src/api/servlets/LoggingServlet.js';
import { resetLogging, resetDebugRegistry, registerComponent, setComponentLevel } from '../../../../src/logging/index.js';
import { LogLevel } from '../../../../src/plugins/serverlog/ServerLogItem.js';

// Lightweight HTTP helper (same pattern as SecretsServlet tests)
async function request(
  app: express.Express,
  method: 'GET' | 'PUT' | 'DELETE',
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

function createTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/system/logging', loggingRouter);
  return app;
}

describe('LoggingServlet', () => {
  let app: express.Express;

  beforeEach(() => {
    resetLogging();
    resetDebugRegistry();
    app = createTestApp();
  });

  describe('GET /', () => {
    it('returns globalLevel and empty components by default', async () => {
      const res = await request(app, 'GET', '/api/system/logging');

      expect(res.status).toBe(200);
      expect(res.body.globalLevel).toBe('INFO');
      expect(res.body.components).toEqual([]);
    });

    it('returns registered components with effective levels', async () => {
      registerComponent('engine', 'Donkey message processing engine');
      registerComponent('api', 'REST API layer');

      const res = await request(app, 'GET', '/api/system/logging');

      expect(res.status).toBe(200);
      expect(res.body.globalLevel).toBe('INFO');
      expect(res.body.components).toHaveLength(2);

      const engine = res.body.components.find((c: any) => c.name === 'engine');
      expect(engine).toBeDefined();
      expect(engine.description).toBe('Donkey message processing engine');
      expect(engine.effectiveLevel).toBe('INFO');
      expect(engine.hasOverride).toBe(false);
    });
  });

  describe('PUT /level', () => {
    it('sets global log level', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/level', { level: 'DEBUG' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.level).toBe('DEBUG');

      // Verify via GET
      const getRes = await request(app, 'GET', '/api/system/logging');
      expect(getRes.body.globalLevel).toBe('DEBUG');
    });

    it('rejects missing level field', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/level', {});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing or invalid');
    });

    it('rejects invalid level string', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/level', { level: 'VERBOSE' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid log level');
      expect(res.body.error).toContain('VERBOSE');
    });

    it('accepts case-insensitive level', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/level', { level: 'warn' });

      expect(res.status).toBe(200);
      expect(res.body.level).toBe('WARN');
    });
  });

  describe('PUT /components/:name', () => {
    it('sets component-specific override', async () => {
      registerComponent('engine', 'Donkey engine');

      const res = await request(app, 'PUT', '/api/system/logging/components/engine', { level: 'DEBUG' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.component).toBe('engine');
      expect(res.body.level).toBe('DEBUG');
    });

    it('creates component entry if not previously registered', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/components/new-component', { level: 'ERROR' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it appears in GET
      const getRes = await request(app, 'GET', '/api/system/logging');
      const comp = getRes.body.components.find((c: any) => c.name === 'new-component');
      expect(comp).toBeDefined();
      expect(comp.effectiveLevel).toBe('ERROR');
      expect(comp.hasOverride).toBe(true);
    });

    it('rejects missing level field', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/components/engine', {});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing or invalid');
    });

    it('rejects invalid level string', async () => {
      const res = await request(app, 'PUT', '/api/system/logging/components/engine', { level: 'FATAL' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid log level');
    });
  });

  describe('DELETE /components/:name', () => {
    it('clears component override', async () => {
      registerComponent('engine', 'Donkey engine');
      setComponentLevel('engine', LogLevel.DEBUG);

      const res = await request(app, 'DELETE', '/api/system/logging/components/engine');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Override cleared');

      // Verify override is cleared
      const getRes = await request(app, 'GET', '/api/system/logging');
      const comp = getRes.body.components.find((c: any) => c.name === 'engine');
      expect(comp.hasOverride).toBe(false);
      expect(comp.effectiveLevel).toBe('INFO');
    });

    it('succeeds even if no override exists', async () => {
      const res = await request(app, 'DELETE', '/api/system/logging/components/nonexistent');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('full workflow', () => {
    it('register, override, verify, clear, verify', async () => {
      // Step 1: Register components
      registerComponent('engine', 'Message processing engine');
      registerComponent('api', 'REST API server');

      // Step 2: Verify initial state
      let res = await request(app, 'GET', '/api/system/logging');
      expect(res.body.globalLevel).toBe('INFO');
      expect(res.body.components).toHaveLength(2);
      expect(res.body.components.every((c: any) => c.effectiveLevel === 'INFO')).toBe(true);
      expect(res.body.components.every((c: any) => c.hasOverride === false)).toBe(true);

      // Step 3: Set global level to WARN
      res = await request(app, 'PUT', '/api/system/logging/level', { level: 'WARN' });
      expect(res.status).toBe(200);

      // Step 4: Verify components inherit new global level
      res = await request(app, 'GET', '/api/system/logging');
      expect(res.body.globalLevel).toBe('WARN');
      expect(res.body.components.every((c: any) => c.effectiveLevel === 'WARN')).toBe(true);

      // Step 5: Override engine to DEBUG
      res = await request(app, 'PUT', '/api/system/logging/components/engine', { level: 'DEBUG' });
      expect(res.status).toBe(200);

      // Step 6: Verify engine has override, api inherits global
      res = await request(app, 'GET', '/api/system/logging');
      const engine = res.body.components.find((c: any) => c.name === 'engine');
      const api = res.body.components.find((c: any) => c.name === 'api');
      expect(engine.effectiveLevel).toBe('DEBUG');
      expect(engine.hasOverride).toBe(true);
      expect(api.effectiveLevel).toBe('WARN');
      expect(api.hasOverride).toBe(false);

      // Step 7: Clear engine override
      res = await request(app, 'DELETE', '/api/system/logging/components/engine');
      expect(res.status).toBe(200);

      // Step 8: Verify engine reverted to global
      res = await request(app, 'GET', '/api/system/logging');
      const engineAfter = res.body.components.find((c: any) => c.name === 'engine');
      expect(engineAfter.effectiveLevel).toBe('WARN');
      expect(engineAfter.hasOverride).toBe(false);
    });
  });
});
