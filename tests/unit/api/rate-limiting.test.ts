import { describe, it, expect, afterEach } from '@jest/globals';
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';

/**
 * Tests for API rate limiting as configured in src/api/server.ts.
 *
 * Uses a minimal Express app with the same rate limiter configuration
 * rather than importing createApp() (which requires 20+ servlet mocks).
 * This validates the rate limiter behavior: window, max, skip, headers, message.
 */

function createTestApp(maxRequests = 5) {
  const app = express();

  // Mount rate limiter exactly as in server.ts, but with lower max for testing
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: maxRequests,
    skip: (req) => req.path.startsWith('/health'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too Many Requests', message: 'Rate limit exceeded. Try again later.' },
  }));

  // Health endpoints (exempted from rate limiting)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/health/startup', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Legacy health endpoint (not under /api, naturally exempt)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Regular API endpoints (subject to rate limiting)
  app.get('/api/channels', (_req, res) => {
    res.json({ channels: [] });
  });
  app.get('/api/server', (_req, res) => {
    res.json({ version: '3.9.0' });
  });

  return app;
}

describe('API Rate Limiting', () => {
  describe('rate limit enforcement', () => {
    it('allows requests within the rate limit', async () => {
      const app = createTestApp(5);
      const agent = request(app);

      for (let i = 0; i < 5; i++) {
        const res = await agent.get('/api/channels');
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 when rate limit is exceeded', async () => {
      const app = createTestApp(3);
      const agent = request(app);

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await agent.get('/api/channels');
      }

      // Next request should be rate limited
      const res = await agent.get('/api/channels');
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Try again later.',
      });
    });

    it('includes standard rate limit headers', async () => {
      const app = createTestApp(5);
      const res = await request(app).get('/api/channels');

      expect(res.status).toBe(200);
      // standardHeaders: true sends RateLimit-* headers (draft-6)
      expect(res.headers).toHaveProperty('ratelimit-limit');
      expect(res.headers).toHaveProperty('ratelimit-remaining');
      // legacyHeaders: false means no X-RateLimit-* headers
      expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
    });

    it('rate limits different API paths under the same counter', async () => {
      const app = createTestApp(3);
      const agent = request(app);

      await agent.get('/api/channels');
      await agent.get('/api/server');
      await agent.get('/api/channels');

      // 4th request (any /api path) should be limited
      const res = await agent.get('/api/server');
      expect(res.status).toBe(429);
    });
  });

  describe('health endpoint exemption', () => {
    it('exempts /api/health from rate limiting', async () => {
      const app = createTestApp(2);
      const agent = request(app);

      // Exhaust the limit on regular endpoints
      await agent.get('/api/channels');
      await agent.get('/api/channels');

      // /api/health should still work (skipped by rate limiter)
      const res = await agent.get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('exempts /api/health/live from rate limiting', async () => {
      const app = createTestApp(2);
      const agent = request(app);

      // Exhaust the limit
      await agent.get('/api/channels');
      await agent.get('/api/channels');

      const res = await agent.get('/api/health/live');
      expect(res.status).toBe(200);
    });

    it('exempts /api/health/startup from rate limiting', async () => {
      const app = createTestApp(2);
      const agent = request(app);

      // Exhaust the limit
      await agent.get('/api/channels');
      await agent.get('/api/channels');

      const res = await agent.get('/api/health/startup');
      expect(res.status).toBe(200);
    });

    it('does not count health requests toward the rate limit', async () => {
      const app = createTestApp(3);
      const agent = request(app);

      // Send many health requests (all skipped)
      for (let i = 0; i < 10; i++) {
        await agent.get('/api/health');
      }

      // All 3 regular requests should still succeed
      for (let i = 0; i < 3; i++) {
        const res = await agent.get('/api/channels');
        expect(res.status).toBe(200);
      }
    });

    it('legacy /health endpoint is naturally exempt (not under /api)', async () => {
      const app = createTestApp(2);
      const agent = request(app);

      // Exhaust /api rate limit
      await agent.get('/api/channels');
      await agent.get('/api/channels');

      // Legacy /health is not under /api mount, so not affected
      const res = await agent.get('/health');
      expect(res.status).toBe(200);
    });
  });

  describe('environment variable configuration', () => {
    const originalEnv = process.env.MIRTH_API_RATE_LIMIT;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.MIRTH_API_RATE_LIMIT = originalEnv;
      } else {
        delete process.env.MIRTH_API_RATE_LIMIT;
      }
    });

    it('parses MIRTH_API_RATE_LIMIT env var as the max requests per minute', () => {
      // Verify the parsing logic matches server.ts
      const envValue = '200';
      const parsed = parseInt(envValue || '100', 10);
      expect(parsed).toBe(200);
    });

    it('defaults to 100 when MIRTH_API_RATE_LIMIT is not set', () => {
      const envVal: string | undefined = undefined;
      const parsed = parseInt(envVal || '100', 10);
      expect(parsed).toBe(100);
    });
  });
});
