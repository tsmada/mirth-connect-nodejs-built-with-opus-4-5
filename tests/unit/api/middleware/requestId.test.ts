/**
 * Tests for request correlation ID middleware
 */

import { requestIdMiddleware } from '../../../../src/api/middleware/requestId.js';
import { Request, Response } from 'express';

function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return {
    get: ((name: string) => headers[name.toLowerCase()]) as any,
    headers: headers as any,
  };
}

function createMockRes(): Partial<Response> & { headers: Record<string, string> } {
  const res: any = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

describe('requestIdMiddleware', () => {
  const middleware = requestIdMiddleware();

  it('should generate a UUID when no X-Request-ID header is present', () => {
    const req = createMockReq() as Request;
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res as Response, next);

    expect(req.requestId).toBeDefined();
    // UUID v4 format: 8-4-4-4-12
    expect(req.requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
    expect(res.headers['X-Request-ID']).toBe(req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('should reuse a valid client-provided X-Request-ID', () => {
    const clientId = 'client-request-abc-123';
    const req = createMockReq({ 'x-request-id': clientId }) as Request;
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res as Response, next);

    expect(req.requestId).toBe(clientId);
    expect(res.headers['X-Request-ID']).toBe(clientId);
    expect(next).toHaveBeenCalled();
  });

  it('should reject and replace an invalid X-Request-ID (special chars)', () => {
    const req = createMockReq({ 'x-request-id': 'bad<script>id' }) as Request;
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res as Response, next);

    // Should have generated a new UUID, not used the unsafe value
    expect(req.requestId).not.toBe('bad<script>id');
    expect(req.requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-/);
    expect(next).toHaveBeenCalled();
  });

  it('should reject and replace an X-Request-ID that is too long', () => {
    const longId = 'a'.repeat(65);
    const req = createMockReq({ 'x-request-id': longId }) as Request;
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res as Response, next);

    expect(req.requestId).not.toBe(longId);
    expect(req.requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-/);
    expect(next).toHaveBeenCalled();
  });

  it('should accept a UUID-formatted X-Request-ID', () => {
    const uuidId = '550e8400-e29b-41d4-a716-446655440000';
    const req = createMockReq({ 'x-request-id': uuidId }) as Request;
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res as Response, next);

    expect(req.requestId).toBe(uuidId);
    expect(next).toHaveBeenCalled();
  });
});
