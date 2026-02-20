/**
 * Authorization Middleware Unit Tests
 *
 * Tests for the authorization controller, middleware, and helper functions
 * exported from src/api/middleware/authorization.ts.
 *
 * The AuthorizationWiring.test.ts file tests that servlets have authorize()
 * wired on routes. This file tests the authorization middleware ITSELF:
 * - createOperation() factory
 * - DefaultChannelAuthorizer
 * - DefaultAuthorizationController
 * - authorize() middleware behavior
 * - Helper functions (checkUserAuthorized, isChannelAuthorized, etc.)
 * - Global controller get/set
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import {
  createOperation,
  DefaultChannelAuthorizer,
  DefaultAuthorizationController,
  authorize,
  checkUserAuthorized,
  doesUserHaveChannelRestrictions,
  isChannelAuthorized,
  filterAuthorizedChannelIds,
  redactChannels,
  addToParameterMap,
  setAuthorizationController,
  getAuthorizationController,
  type Operation,
  type AuthorizationController,
  type ChannelAuthorizer,
  type ExtensionPermission,
} from '../../../../src/api/middleware/authorization.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockReq(overrides: Record<string, unknown> = {}): any {
  return {
    userId: 1,
    user: { id: 1, username: 'admin' },
    params: {},
    query: {},
    body: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    authContext: undefined,
    ...overrides,
  };
}

function createMockRes(): any {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function createMockNext(): jest.Mock {
  return jest.fn();
}

/** A simple test operation */
function testOperation(overrides: Partial<Operation> = {}): Operation {
  return createOperation('testOp', 'Test Operation', 'viewChannels', overrides);
}

// ---------------------------------------------------------------------------
// createOperation()
// ---------------------------------------------------------------------------

describe('createOperation', () => {
  it('creates an operation with required fields', () => {
    const op = createOperation('getChannels', 'Get channels', 'viewChannels');
    expect(op.name).toBe('getChannels');
    expect(op.displayName).toBe('Get channels');
    expect(op.permission).toBe('viewChannels');
  });

  it('applies default values for optional fields', () => {
    const op = createOperation('getChannels', 'Get channels', 'viewChannels');
    expect(op.executeType).toBe('SYNC');
    expect(op.auditable).toBe(true);
    expect(op.abortable).toBe(false);
  });

  it('overrides executeType', () => {
    const op = createOperation('deployAll', 'Deploy all', 'deployUndeployChannels', {
      executeType: 'ASYNC',
    });
    expect(op.executeType).toBe('ASYNC');
  });

  it('overrides auditable to false', () => {
    const op = createOperation('getVersion', 'Get version', 'viewChannels', {
      auditable: false,
    });
    expect(op.auditable).toBe(false);
  });

  it('overrides abortable to true', () => {
    const op = createOperation('longOp', 'Long operation', 'viewChannels', {
      abortable: true,
    });
    expect(op.abortable).toBe(true);
  });

  it('supports ABORT_PENDING executeType', () => {
    const op = createOperation('abortOp', 'Abort operation', 'viewChannels', {
      executeType: 'ABORT_PENDING',
    });
    expect(op.executeType).toBe('ABORT_PENDING');
  });

  it('applies multiple overrides at once', () => {
    const op = createOperation('multiOp', 'Multi override', 'viewChannels', {
      executeType: 'ASYNC',
      auditable: false,
      abortable: true,
    });
    expect(op.executeType).toBe('ASYNC');
    expect(op.auditable).toBe(false);
    expect(op.abortable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DefaultChannelAuthorizer
// ---------------------------------------------------------------------------

describe('DefaultChannelAuthorizer', () => {
  let authorizer: DefaultChannelAuthorizer;

  beforeEach(() => {
    authorizer = new DefaultChannelAuthorizer();
  });

  it('authorizes any channel ID', () => {
    expect(authorizer.isChannelAuthorized('abc-123')).toBe(true);
    expect(authorizer.isChannelAuthorized('')).toBe(true);
    expect(authorizer.isChannelAuthorized('any-random-id')).toBe(true);
  });

  it('returns null for authorized channel IDs (meaning all channels)', () => {
    expect(authorizer.getAuthorizedChannelIds()).toBeNull();
  });

  it('returns the same list of channel IDs passed in', () => {
    const ids = ['ch-1', 'ch-2', 'ch-3'];
    const result = authorizer.filterChannelIds(ids);
    expect(result).toEqual(ids);
    expect(result).toBe(ids); // same reference
  });

  it('returns empty array when passed empty array', () => {
    expect(authorizer.filterChannelIds([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DefaultAuthorizationController
// ---------------------------------------------------------------------------

describe('DefaultAuthorizationController', () => {
  let controller: DefaultAuthorizationController;
  const op = testOperation();

  beforeEach(() => {
    controller = new DefaultAuthorizationController();
  });

  describe('isUserAuthorized', () => {
    it('always returns true (default allows everything)', async () => {
      const result = await controller.isUserAuthorized(1, op, {}, '127.0.0.1', true);
      expect(result).toBe(true);
    });

    it('returns true regardless of user ID', async () => {
      expect(await controller.isUserAuthorized(999, op, {}, '10.0.0.1', false)).toBe(true);
    });

    it('returns true regardless of audit flag', async () => {
      expect(await controller.isUserAuthorized(1, op, {}, '127.0.0.1', false)).toBe(true);
      expect(await controller.isUserAuthorized(1, op, {}, '127.0.0.1', true)).toBe(true);
    });
  });

  describe('doesUserHaveChannelRestrictions', () => {
    it('always returns false (no restrictions)', async () => {
      const result = await controller.doesUserHaveChannelRestrictions(1, op);
      expect(result).toBe(false);
    });
  });

  describe('getChannelAuthorizer', () => {
    it('returns a DefaultChannelAuthorizer', async () => {
      const authorizer = await controller.getChannelAuthorizer(1, op);
      expect(authorizer).toBeInstanceOf(DefaultChannelAuthorizer);
    });

    it('returns an authorizer that allows all channels', async () => {
      const authorizer = await controller.getChannelAuthorizer(1, op);
      expect(authorizer.isChannelAuthorized('anything')).toBe(true);
      expect(authorizer.getAuthorizedChannelIds()).toBeNull();
    });
  });

  describe('addExtensionPermission / getExtensionPermissions', () => {
    it('starts with no extension permissions', () => {
      expect(controller.getExtensionPermissions()).toEqual([]);
    });

    it('adds an extension permission', () => {
      const perm: ExtensionPermission = {
        extensionName: 'Data Pruner',
        displayName: 'Data Pruner Settings',
        description: 'Access pruner configuration',
        operationNames: ['getPrunerConfig', 'setPrunerConfig'],
        taskNames: ['prunerTask'],
      };
      controller.addExtensionPermission(perm);
      const result = controller.getExtensionPermissions();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(perm);
    });

    it('accumulates multiple extension permissions', () => {
      const perm1: ExtensionPermission = {
        extensionName: 'Ext1',
        displayName: 'Extension 1',
        description: 'First',
        operationNames: ['op1'],
        taskNames: [],
      };
      const perm2: ExtensionPermission = {
        extensionName: 'Ext2',
        displayName: 'Extension 2',
        description: 'Second',
        operationNames: ['op2'],
        taskNames: ['task2'],
      };
      controller.addExtensionPermission(perm1);
      controller.addExtensionPermission(perm2);
      expect(controller.getExtensionPermissions()).toHaveLength(2);
    });

    it('returns a copy (not original array)', () => {
      const perm: ExtensionPermission = {
        extensionName: 'Ext',
        displayName: 'Ext',
        description: '',
        operationNames: [],
        taskNames: [],
      };
      controller.addExtensionPermission(perm);
      const result = controller.getExtensionPermissions();
      result.push(perm); // mutate the copy
      expect(controller.getExtensionPermissions()).toHaveLength(1); // original unchanged
    });
  });
});

// ---------------------------------------------------------------------------
// Global controller get/set
// ---------------------------------------------------------------------------

describe('get/setAuthorizationController', () => {
  let originalController: AuthorizationController;

  beforeEach(() => {
    originalController = getAuthorizationController();
  });

  afterEach(() => {
    // Restore to avoid leaking state across tests
    setAuthorizationController(originalController);
  });

  it('returns a DefaultAuthorizationController by default', () => {
    const controller = getAuthorizationController();
    expect(controller).toBeDefined();
    // Default controller allows everything
    expect(controller.isUserAuthorized(1, testOperation(), {}, '', true)).resolves.toBe(true);
  });

  it('sets a custom controller', () => {
    const custom: AuthorizationController = {
      async isUserAuthorized() {
        return false;
      },
      async doesUserHaveChannelRestrictions() {
        return true;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(custom);
    expect(getAuthorizationController()).toBe(custom);
  });
});

// ---------------------------------------------------------------------------
// authorize() middleware
// ---------------------------------------------------------------------------

describe('authorize() middleware', () => {
  let originalController: AuthorizationController;

  beforeEach(() => {
    originalController = getAuthorizationController();
    // Reset to default controller before each test
    setAuthorizationController(new DefaultAuthorizationController());
  });

  afterEach(() => {
    setAuthorizationController(originalController);
  });

  // -- Authentication checks --

  it('returns 401 when userId is missing', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ userId: undefined });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Authentication required',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when user object is missing', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ user: undefined });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when both userId and user are missing', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ userId: undefined, user: undefined });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // -- Authorization context initialization --

  it('initializes authContext on the request', async () => {
    const op = testOperation();
    const middleware = authorize({ operation: op });
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(req.authContext).toBeDefined();
    expect(req.authContext.operation).toBe(op);
    expect(req.authContext.authChecked).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  // -- Parameter extraction for audit --

  it('includes route params in parameterMap', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ params: { channelId: 'ch-1' } });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(req.authContext.parameterMap.channelId).toBe('ch-1');
  });

  it('includes query params in parameterMap', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ query: { limit: '10', offset: '0' } });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(req.authContext.parameterMap.limit).toBe('10');
    expect(req.authContext.parameterMap.offset).toBe('0');
  });

  it('includes safe body params in parameterMap', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ body: { name: 'Test Channel', enabled: true } });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(req.authContext.parameterMap.name).toBe('Test Channel');
    expect(req.authContext.parameterMap.enabled).toBe(true);
  });

  it('excludes sensitive keys from parameterMap', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({
      body: {
        username: 'admin',
        password: 'secret123',
        token: 'abc',
        apiKey: 'key',
        secret: 'shh',
        passphrase: 'phrase',
        credential: 'cred',
        credentials: 'creds',
        authorization: 'Bearer xyz',
        accessToken: 'at',
        refreshToken: 'rt',
        privateKey: 'pk',
        secretKey: 'sk',
        safeName: 'visible',
      },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    const pm = req.authContext.parameterMap;
    expect(pm.password).toBeUndefined();
    expect(pm.token).toBeUndefined();
    expect(pm.apiKey).toBeUndefined();
    expect(pm.secret).toBeUndefined();
    expect(pm.passphrase).toBeUndefined();
    expect(pm.credential).toBeUndefined();
    expect(pm.credentials).toBeUndefined();
    expect(pm.authorization).toBeUndefined();
    expect(pm.accessToken).toBeUndefined();
    expect(pm.refreshToken).toBeUndefined();
    expect(pm.privateKey).toBeUndefined();
    expect(pm.secretKey).toBeUndefined();
    // Non-sensitive keys should be present
    expect(pm.username).toBe('admin');
    expect(pm.safeName).toBe('visible');
  });

  it('handles case-insensitive sensitive key detection', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({
      body: {
        Password: 'should-be-filtered',
        TOKEN: 'should-be-filtered',
        name: 'visible',
      },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    const pm = req.authContext.parameterMap;
    // The code checks both the key itself and key.toLowerCase() against the set
    expect(pm.Password).toBeUndefined();
    expect(pm.name).toBe('visible');
  });

  it('handles null body gracefully', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ body: null });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext).toBeDefined();
  });

  it('handles non-object body gracefully', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ body: 'raw string body' });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // -- Standard authorization check --

  it('calls next when user is authorized (default controller)', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext.authChecked).toBe(true);
  });

  it('returns 403 when user is not authorized', async () => {
    const op = testOperation();
    const denyController: AuthorizationController = {
      async isUserAuthorized() {
        return false;
      },
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(denyController);

    const middleware = authorize({ operation: op });
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: expect.stringContaining(op.permission),
        operation: op.name,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('passes correct arguments to isUserAuthorized', async () => {
    const op = testOperation();
    const mockIsAuthorized = jest.fn(async () => true);
    const customController: AuthorizationController = {
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const middleware = authorize({ operation: op });
    const req = createMockReq({
      userId: 42,
      ip: '192.168.1.1',
      params: { id: '123' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(mockIsAuthorized).toHaveBeenCalledWith(
      42,
      op,
      expect.objectContaining({ id: '123' }),
      '192.168.1.1',
      op.auditable
    );
  });

  // -- dontCheckAuthorized option --

  it('skips authorization check when dontCheckAuthorized is true', async () => {
    const denyController: AuthorizationController = {
      async isUserAuthorized() {
        return false;
      },
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(denyController);

    const middleware = authorize({
      operation: testOperation(),
      dontCheckAuthorized: true,
    });
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    // Should call next even though controller denies (check was skipped)
    expect(next).toHaveBeenCalled();
    expect(req.authContext.authChecked).toBe(false);
  });

  // -- checkAuthorizedChannelId --

  it('validates channel ID from route params when authorized', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
    });
    const req = createMockReq({ params: { channelId: 'ch-001' } });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext.channelAuthorizer).toBeDefined();
  });

  it('returns 403 when channel is not authorized', async () => {
    const restrictedAuthorizer: ChannelAuthorizer = {
      isChannelAuthorized(id: string) {
        return id === 'allowed-ch';
      },
      getAuthorizedChannelIds() {
        return new Set(['allowed-ch']);
      },
      filterChannelIds(ids: string[]) {
        return ids.filter((id) => id === 'allowed-ch');
      },
    };

    const customController: AuthorizationController = {
      async isUserAuthorized() {
        return true;
      },
      async doesUserHaveChannelRestrictions() {
        return true;
      },
      async getChannelAuthorizer() {
        return restrictedAuthorizer;
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
    });
    const req = createMockReq({ params: { channelId: 'denied-ch' } });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: expect.stringContaining('denied-ch'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('reads channel ID from body when not in params', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
    });
    const req = createMockReq({
      params: {},
      body: { channelId: 'ch-from-body' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('skips channel check when channelId is not present', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
    });
    const req = createMockReq({
      params: {},
      body: {},
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    // Should proceed without channel authorization since no channelId found
    expect(next).toHaveBeenCalled();
  });

  it('skips channel check when channelId is not a string', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
    });
    const req = createMockReq({
      params: {},
      body: { channelId: 12345 },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // -- checkAuthorizedUserId --

  it('allows access to own user profile', async () => {
    const denyController: AuthorizationController = {
      async isUserAuthorized() {
        return false;
      },
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(denyController);

    const middleware = authorize({
      operation: testOperation(),
      dontCheckAuthorized: true,
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { userId: '42' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    // Own user always allowed, even when controller denies
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when accessing another user without permission', async () => {
    const denyController: AuthorizationController = {
      async isUserAuthorized() {
        return false;
      },
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(denyController);

    const middleware = authorize({
      operation: testOperation(),
      dontCheckAuthorized: true,
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { userId: '99' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Forbidden',
        message: expect.stringContaining('manage other users'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access to another user when authorized', async () => {
    // Default controller allows everything
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { userId: '99' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('reads userId from body when not in params', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: {},
      body: { userId: '42' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('handles numeric userId in body', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: {},
      body: { userId: 42 },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('skips user check when userId is not present', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: {},
      body: {},
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('respects auditCurrentUser option for non-own user', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    const customController: AuthorizationController = {
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const op = testOperation({ auditable: true });
    const middleware = authorize({
      operation: op,
      checkAuthorizedUserId: 'userId',
      auditCurrentUser: false,
    });
    const req = createMockReq({
      userId: 42,
      params: { userId: '99' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    // The user ID check call should have audit=false because auditCurrentUser is false
    // First call is the standard auth check, second is the user ID check
    const calls = mockIsAuthorized.mock.calls;
    // The user ID authorization check is the last call
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall[4]).toBe(false); // audit param should be false
  });

  // -- Channel authorizer setup --

  it('sets up channel authorizer when not already set by channel check', async () => {
    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext.channelAuthorizer).toBeDefined();
  });

  // -- IP address extraction --

  it('uses req.ip for client address', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    const customController: AuthorizationController = {
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({ ip: '10.0.0.5' });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(mockIsAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '10.0.0.5',
      expect.anything()
    );
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    const customController: AuthorizationController = {
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({
      ip: undefined,
      socket: { remoteAddress: '192.168.0.10' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(mockIsAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '192.168.0.10',
      expect.anything()
    );
  });

  it('uses "unknown" when both ip and socket.remoteAddress are undefined', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    const customController: AuthorizationController = {
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    };
    setAuthorizationController(customController);

    const middleware = authorize({ operation: testOperation() });
    const req = createMockReq({
      ip: undefined,
      socket: { remoteAddress: undefined },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(mockIsAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'unknown',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// checkUserAuthorized()
// ---------------------------------------------------------------------------

describe('checkUserAuthorized', () => {
  let originalController: AuthorizationController;

  beforeEach(() => {
    originalController = getAuthorizationController();
    setAuthorizationController(new DefaultAuthorizationController());
  });

  afterEach(() => {
    setAuthorizationController(originalController);
  });

  it('returns false when userId is missing', async () => {
    const req = createMockReq({
      userId: undefined,
      authContext: { operation: testOperation(), parameterMap: {}, authChecked: false },
    });
    expect(await checkUserAuthorized(req)).toBe(false);
  });

  it('returns false when authContext is missing', async () => {
    const req = createMockReq({ authContext: undefined });
    expect(await checkUserAuthorized(req)).toBe(false);
  });

  it('returns false when authContext.operation is missing', async () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    expect(await checkUserAuthorized(req)).toBe(false);
  });

  it('delegates to authorization controller when valid', async () => {
    const req = createMockReq({
      authContext: {
        operation: testOperation(),
        parameterMap: { key: 'value' },
        authChecked: false,
      },
    });
    const result = await checkUserAuthorized(req);
    expect(result).toBe(true); // Default controller allows everything
  });

  it('passes audit parameter correctly', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    setAuthorizationController({
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    });

    const req = createMockReq({
      authContext: {
        operation: testOperation(),
        parameterMap: {},
        authChecked: false,
      },
    });

    await checkUserAuthorized(req, false);
    expect(mockIsAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false
    );
  });

  it('defaults audit to true', async () => {
    const mockIsAuthorized = jest.fn(async () => true);
    setAuthorizationController({
      isUserAuthorized: mockIsAuthorized as any,
      async doesUserHaveChannelRestrictions() {
        return false;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    });

    const req = createMockReq({
      authContext: {
        operation: testOperation(),
        parameterMap: {},
        authChecked: false,
      },
    });

    await checkUserAuthorized(req);
    expect(mockIsAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// doesUserHaveChannelRestrictions()
// ---------------------------------------------------------------------------

describe('doesUserHaveChannelRestrictions', () => {
  let originalController: AuthorizationController;

  beforeEach(() => {
    originalController = getAuthorizationController();
    setAuthorizationController(new DefaultAuthorizationController());
  });

  afterEach(() => {
    setAuthorizationController(originalController);
  });

  it('returns false when userId is missing', async () => {
    const req = createMockReq({
      userId: undefined,
      authContext: { operation: testOperation(), parameterMap: {}, authChecked: false },
    });
    expect(await doesUserHaveChannelRestrictions(req)).toBe(false);
  });

  it('returns false when authContext is missing', async () => {
    const req = createMockReq({ authContext: undefined });
    expect(await doesUserHaveChannelRestrictions(req)).toBe(false);
  });

  it('returns false when operation is missing', async () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    expect(await doesUserHaveChannelRestrictions(req)).toBe(false);
  });

  it('delegates to controller when valid', async () => {
    const req = createMockReq({
      authContext: {
        operation: testOperation(),
        parameterMap: {},
        authChecked: false,
      },
    });
    const result = await doesUserHaveChannelRestrictions(req);
    expect(result).toBe(false); // Default controller has no restrictions
  });

  it('returns true when custom controller says user has restrictions', async () => {
    setAuthorizationController({
      async isUserAuthorized() {
        return true;
      },
      async doesUserHaveChannelRestrictions() {
        return true;
      },
      async getChannelAuthorizer() {
        return new DefaultChannelAuthorizer();
      },
      addExtensionPermission() {},
    });

    const req = createMockReq({
      authContext: {
        operation: testOperation(),
        parameterMap: {},
        authChecked: false,
      },
    });
    expect(await doesUserHaveChannelRestrictions(req)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isChannelAuthorized()
// ---------------------------------------------------------------------------

describe('isChannelAuthorized', () => {
  it('returns true when no authContext exists', () => {
    const req = createMockReq({ authContext: undefined });
    expect(isChannelAuthorized(req, 'ch-1')).toBe(true);
  });

  it('returns true when no channelAuthorizer is set', () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    expect(isChannelAuthorized(req, 'ch-1')).toBe(true);
  });

  it('delegates to channel authorizer when present', () => {
    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized(id: string) {
        return id === 'allowed';
      },
      getAuthorizedChannelIds() {
        return new Set(['allowed']);
      },
      filterChannelIds(ids: string[]) {
        return ids.filter((id) => id === 'allowed');
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    expect(isChannelAuthorized(req, 'allowed')).toBe(true);
    expect(isChannelAuthorized(req, 'denied')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterAuthorizedChannelIds()
// ---------------------------------------------------------------------------

describe('filterAuthorizedChannelIds', () => {
  it('returns all IDs when no authContext exists', () => {
    const req = createMockReq({ authContext: undefined });
    const ids = ['ch-1', 'ch-2'];
    expect(filterAuthorizedChannelIds(req, ids)).toEqual(ids);
  });

  it('returns all IDs when no channelAuthorizer is set', () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    const ids = ['ch-1', 'ch-2'];
    expect(filterAuthorizedChannelIds(req, ids)).toEqual(ids);
  });

  it('filters using channel authorizer when present', () => {
    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized(id: string) {
        return id.startsWith('allowed');
      },
      getAuthorizedChannelIds() {
        return new Set(['allowed-1', 'allowed-2']);
      },
      filterChannelIds(ids: string[]) {
        return ids.filter((id) => id.startsWith('allowed'));
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    const result = filterAuthorizedChannelIds(req, ['allowed-1', 'denied-1', 'allowed-2']);
    expect(result).toEqual(['allowed-1', 'allowed-2']);
  });

  it('returns empty array when all IDs filtered out', () => {
    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized() {
        return false;
      },
      getAuthorizedChannelIds() {
        return new Set();
      },
      filterChannelIds() {
        return [];
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    expect(filterAuthorizedChannelIds(req, ['ch-1', 'ch-2'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// redactChannels()
// ---------------------------------------------------------------------------

describe('redactChannels', () => {
  const channels = [
    { id: 'ch-1', name: 'ADT Receiver' },
    { id: 'ch-2', name: 'Lab Orders' },
    { id: 'ch-3', name: 'Pharmacy' },
  ];

  it('returns all channels when no authContext exists', () => {
    const req = createMockReq({ authContext: undefined });
    expect(redactChannels(req, channels)).toEqual(channels);
  });

  it('returns all channels when no channelAuthorizer is set', () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    expect(redactChannels(req, channels)).toEqual(channels);
  });

  it('filters channels based on authorizer', () => {
    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized(id: string) {
        return id === 'ch-1' || id === 'ch-3';
      },
      getAuthorizedChannelIds() {
        return new Set(['ch-1', 'ch-3']);
      },
      filterChannelIds(ids: string[]) {
        return ids.filter((id) => id === 'ch-1' || id === 'ch-3');
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    const result = redactChannels(req, channels);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('ch-1');
    expect(result[1]!.id).toBe('ch-3');
  });

  it('returns empty array when all channels denied', () => {
    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized() {
        return false;
      },
      getAuthorizedChannelIds() {
        return new Set();
      },
      filterChannelIds() {
        return [];
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    expect(redactChannels(req, channels)).toEqual([]);
  });

  it('preserves all properties on filtered channel objects', () => {
    const richChannels = [
      { id: 'ch-1', name: 'ADT', enabled: true, revision: 5 },
      { id: 'ch-2', name: 'Lab', enabled: false, revision: 3 },
    ];

    const authorizer: ChannelAuthorizer = {
      isChannelAuthorized(id: string) {
        return id === 'ch-1';
      },
      getAuthorizedChannelIds() {
        return new Set(['ch-1']);
      },
      filterChannelIds(ids: string[]) {
        return ids.filter((id) => id === 'ch-1');
      },
    };

    const req = createMockReq({
      authContext: {
        parameterMap: {},
        authChecked: true,
        channelAuthorizer: authorizer,
      },
    });

    const result = redactChannels(req, richChannels);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'ch-1', name: 'ADT', enabled: true, revision: 5 });
  });
});

// ---------------------------------------------------------------------------
// addToParameterMap()
// ---------------------------------------------------------------------------

describe('addToParameterMap', () => {
  it('adds parameter to authContext parameterMap', () => {
    const req = createMockReq({
      authContext: { parameterMap: { existing: 'value' }, authChecked: false },
    });
    addToParameterMap(req, 'newKey', 'newValue');
    expect(req.authContext.parameterMap.newKey).toBe('newValue');
    expect(req.authContext.parameterMap.existing).toBe('value');
  });

  it('overwrites existing parameter', () => {
    const req = createMockReq({
      authContext: { parameterMap: { key: 'old' }, authChecked: false },
    });
    addToParameterMap(req, 'key', 'new');
    expect(req.authContext.parameterMap.key).toBe('new');
  });

  it('does nothing when authContext is undefined', () => {
    const req = createMockReq({ authContext: undefined });
    // Should not throw
    addToParameterMap(req, 'key', 'value');
    expect(req.authContext).toBeUndefined();
  });

  it('supports various value types', () => {
    const req = createMockReq({
      authContext: { parameterMap: {}, authChecked: false },
    });
    addToParameterMap(req, 'str', 'text');
    addToParameterMap(req, 'num', 42);
    addToParameterMap(req, 'bool', true);
    addToParameterMap(req, 'arr', [1, 2, 3]);
    addToParameterMap(req, 'obj', { nested: true });
    addToParameterMap(req, 'nil', null);

    const pm = req.authContext.parameterMap;
    expect(pm.str).toBe('text');
    expect(pm.num).toBe(42);
    expect(pm.bool).toBe(true);
    expect(pm.arr).toEqual([1, 2, 3]);
    expect(pm.obj).toEqual({ nested: true });
    expect(pm.nil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration-style: authorize() with combined options
// ---------------------------------------------------------------------------

describe('authorize() with combined options', () => {
  let originalController: AuthorizationController;

  beforeEach(() => {
    originalController = getAuthorizationController();
    setAuthorizationController(new DefaultAuthorizationController());
  });

  afterEach(() => {
    setAuthorizationController(originalController);
  });

  it('handles checkAuthorizedChannelId and checkAuthorizedUserId together', async () => {
    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { channelId: 'ch-1', userId: '42' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext.channelAuthorizer).toBeDefined();
  });

  it('denies at channel check before reaching user check', async () => {
    const restrictedAuthorizer: ChannelAuthorizer = {
      isChannelAuthorized() {
        return false;
      },
      getAuthorizedChannelIds() {
        return new Set();
      },
      filterChannelIds() {
        return [];
      },
    };

    setAuthorizationController({
      async isUserAuthorized() {
        return true;
      },
      async doesUserHaveChannelRestrictions() {
        return true;
      },
      async getChannelAuthorizer() {
        return restrictedAuthorizer;
      },
      addExtensionPermission() {},
    });

    const middleware = authorize({
      operation: testOperation(),
      checkAuthorizedChannelId: 'channelId',
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { channelId: 'ch-denied', userId: '42' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('ch-denied'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('dontCheckAuthorized still checks channel and user', async () => {
    const middleware = authorize({
      operation: testOperation(),
      dontCheckAuthorized: true,
      checkAuthorizedChannelId: 'channelId',
      checkAuthorizedUserId: 'userId',
    });
    const req = createMockReq({
      userId: 42,
      params: { channelId: 'ch-1', userId: '42' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.authContext.authChecked).toBe(false); // main check was skipped
  });
});
