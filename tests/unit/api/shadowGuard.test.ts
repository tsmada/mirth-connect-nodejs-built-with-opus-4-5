import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../../src/cluster/ShadowMode', () => ({
  isShadowMode: jest.fn(() => false),
  isChannelPromoted: jest.fn(() => false),
}));

import { isShadowMode, isChannelPromoted } from '../../../src/cluster/ShadowMode.js';
import { shadowGuard } from '../../../src/api/middleware/shadowGuard.js';

// Create mock request/response/next
function createMockReq(method: string, params: Record<string, string> = {}, body: Record<string, unknown> = {}): any {
  return { method, params, body };
}

function createMockRes(): any {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('shadowGuard', () => {
  const middleware = shadowGuard();
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
    (isShadowMode as jest.Mock).mockReturnValue(false);
    (isChannelPromoted as jest.Mock).mockReturnValue(false);
  });

  it('passes through when shadow mode is off', () => {
    const req = createMockReq('POST');
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes through GET requests in shadow mode', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    const req = createMockReq('GET');
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks POST requests in shadow mode', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    const req = createMockReq('POST');
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('blocks PUT requests in shadow mode', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    const req = createMockReq('PUT');
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('blocks DELETE requests in shadow mode', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    const req = createMockReq('DELETE');
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('allows promoted channel POST requests', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    (isChannelPromoted as jest.Mock).mockReturnValue(true);
    const req = createMockReq('POST', { channelId: 'ch-1' });
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks non-promoted channel POST requests', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    (isChannelPromoted as jest.Mock).mockReturnValue(false);
    const req = createMockReq('POST', { channelId: 'ch-1' });
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns shadowMode flag in 409 response', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    const req = createMockReq('POST');
    const res = createMockRes();
    middleware(req, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      shadowMode: true,
      error: 'Shadow Mode Active',
    }));
  });

  it('extracts channelId from request body', () => {
    (isShadowMode as jest.Mock).mockReturnValue(true);
    (isChannelPromoted as jest.Mock).mockImplementation(((id: unknown) => id === 'ch-body') as any);
    const req = createMockReq('POST', {}, { channelId: 'ch-body' });
    const res = createMockRes();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
