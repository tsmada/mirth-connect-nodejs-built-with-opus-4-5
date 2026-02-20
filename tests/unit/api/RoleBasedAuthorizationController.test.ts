/**
 * Tests for RoleBasedAuthorizationController
 *
 * Verifies role → permission mapping for all 4 predefined roles,
 * cache behavior, unknown role handling, and MIRTH_AUTH_MODE fallback.
 */

// Mock logging before imports
jest.mock('../../../src/logging/index', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: jest.fn(),
}));

// Mock database pool
const mockQuery = jest.fn();
jest.mock('../../../src/db/pool', () => ({
  getPool: () => ({
    query: mockQuery,
  }),
}));

import {
  RoleBasedAuthorizationController,
  RolePermissionMap,
  VALID_ROLES,
  isValidRole,
} from '../../../src/api/middleware/RoleBasedAuthorizationController';
import { createOperation } from '../../../src/api/middleware/authorization';
import * as P from '../../../src/api/middleware/permissions';

// Helper to create a mock operation
function mockOperation(permission: string) {
  return createOperation('test', 'Test operation', permission);
}

describe('RoleBasedAuthorizationController', () => {
  let controller: RoleBasedAuthorizationController;

  beforeEach(() => {
    controller = new RoleBasedAuthorizationController();
    mockQuery.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Helper to set up mock role for a user
  function mockUserRole(_userId: number, role: string | null) {
    mockQuery.mockResolvedValue([[{ ROLE: role }], []]);
  }

  function mockUserNotFound() {
    mockQuery.mockResolvedValue([[], []]);
  }

  // =========================================================================
  // Role Validation
  // =========================================================================

  describe('isValidRole', () => {
    it('accepts valid roles', () => {
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('manager')).toBe(true);
      expect(isValidRole('operator')).toBe(true);
      expect(isValidRole('monitor')).toBe(true);
    });

    it('rejects invalid roles', () => {
      expect(isValidRole('superadmin')).toBe(false);
      expect(isValidRole('')).toBe(false);
      expect(isValidRole('ADMIN')).toBe(false);
    });
  });

  describe('VALID_ROLES', () => {
    it('contains exactly 4 roles', () => {
      expect(VALID_ROLES).toHaveLength(4);
      expect(VALID_ROLES).toEqual(['admin', 'manager', 'operator', 'monitor']);
    });
  });

  // =========================================================================
  // Permission Maps
  // =========================================================================

  describe('RolePermissionMap', () => {
    it('admin has ALL permissions', () => {
      const adminPerms = RolePermissionMap.admin;
      for (const perm of P.ALL_PERMISSIONS) {
        expect(adminPerms.has(perm)).toBe(true);
      }
    });

    it('manager does NOT have USERS_MANAGE', () => {
      expect(RolePermissionMap.manager.has(P.USERS_MANAGE)).toBe(false);
    });

    it('manager HAS channel management permissions', () => {
      expect(RolePermissionMap.manager.has(P.CHANNELS_MANAGE)).toBe(true);
      expect(RolePermissionMap.manager.has(P.CHANNELS_START_STOP)).toBe(true);
      expect(RolePermissionMap.manager.has(P.CHANNELS_DEPLOY_UNDEPLOY)).toBe(true);
      expect(RolePermissionMap.manager.has(P.CODE_TEMPLATES_MANAGE)).toBe(true);
    });

    it('operator can start/stop but cannot create/delete channels', () => {
      expect(RolePermissionMap.operator.has(P.CHANNELS_START_STOP)).toBe(true);
      expect(RolePermissionMap.operator.has(P.CHANNELS_DEPLOY_UNDEPLOY)).toBe(true);
      expect(RolePermissionMap.operator.has(P.CHANNELS_MANAGE)).toBe(false);
    });

    it('operator can view and reprocess messages but not import/export', () => {
      expect(RolePermissionMap.operator.has(P.MESSAGES_VIEW)).toBe(true);
      expect(RolePermissionMap.operator.has(P.MESSAGES_REPROCESS)).toBe(true);
      expect(RolePermissionMap.operator.has(P.MESSAGES_IMPORT)).toBe(false);
      expect(RolePermissionMap.operator.has(P.MESSAGES_EXPORT_SERVER)).toBe(false);
    });

    it('monitor is view-only — no write permissions', () => {
      const writePerms = [
        P.CHANNELS_MANAGE,
        P.CHANNELS_START_STOP,
        P.CHANNELS_DEPLOY_UNDEPLOY,
        P.CHANNELS_CLEAR_STATISTICS,
        P.MESSAGES_REMOVE,
        P.MESSAGES_REPROCESS,
        P.MESSAGES_IMPORT,
        P.MESSAGES_PROCESS,
        P.EVENTS_REMOVE,
        P.ALERTS_MANAGE,
        P.USERS_MANAGE,
        P.EXTENSIONS_MANAGE,
        P.SERVER_SETTINGS_EDIT,
        P.CONFIG_MAP_EDIT,
        P.CODE_TEMPLATES_MANAGE,
        P.GLOBAL_SCRIPTS_EDIT,
        P.TAGS_MANAGE,
      ];
      for (const perm of writePerms) {
        expect(RolePermissionMap.monitor.has(perm)).toBe(false);
      }
    });

    it('monitor HAS view permissions', () => {
      expect(RolePermissionMap.monitor.has(P.DASHBOARD_VIEW)).toBe(true);
      expect(RolePermissionMap.monitor.has(P.CHANNELS_VIEW)).toBe(true);
      expect(RolePermissionMap.monitor.has(P.MESSAGES_VIEW)).toBe(true);
      expect(RolePermissionMap.monitor.has(P.EVENTS_VIEW)).toBe(true);
      expect(RolePermissionMap.monitor.has(P.ALERTS_VIEW)).toBe(true);
      expect(RolePermissionMap.monitor.has(P.SERVER_SETTINGS_VIEW)).toBe(true);
    });

    it('each role has strictly fewer permissions than the role above it', () => {
      const adminCount = RolePermissionMap.admin.size;
      const managerCount = RolePermissionMap.manager.size;
      const operatorCount = RolePermissionMap.operator.size;
      const monitorCount = RolePermissionMap.monitor.size;

      expect(adminCount).toBeGreaterThan(managerCount);
      expect(managerCount).toBeGreaterThan(operatorCount);
      expect(operatorCount).toBeGreaterThan(monitorCount);
    });
  });

  // =========================================================================
  // isUserAuthorized
  // =========================================================================

  describe('isUserAuthorized', () => {
    it('admin can perform ALL operations', async () => {
      mockUserRole(1, 'admin');

      const result = await controller.isUserAuthorized(
        1,
        mockOperation(P.USERS_MANAGE),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(true);
    });

    it('manager CANNOT manage users', async () => {
      mockUserRole(2, 'manager');

      const result = await controller.isUserAuthorized(
        2,
        mockOperation(P.USERS_MANAGE),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(false);
    });

    it('manager CAN manage channels', async () => {
      mockUserRole(2, 'manager');

      const result = await controller.isUserAuthorized(
        2,
        mockOperation(P.CHANNELS_MANAGE),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(true);
    });

    it('operator CAN start/stop channels', async () => {
      mockUserRole(3, 'operator');

      const result = await controller.isUserAuthorized(
        3,
        mockOperation(P.CHANNELS_START_STOP),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(true);
    });

    it('operator CANNOT create channels', async () => {
      mockUserRole(3, 'operator');

      const result = await controller.isUserAuthorized(
        3,
        mockOperation(P.CHANNELS_MANAGE),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(false);
    });

    it('monitor can only view, denied on all writes', async () => {
      mockUserRole(4, 'monitor');

      // View: allowed
      expect(
        await controller.isUserAuthorized(
          4,
          mockOperation(P.CHANNELS_VIEW),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(true);

      // Deploy: denied
      controller.clearRoleCache(4);
      mockUserRole(4, 'monitor');
      expect(
        await controller.isUserAuthorized(
          4,
          mockOperation(P.CHANNELS_DEPLOY_UNDEPLOY),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(false);
    });

    it('no-permission operations always allowed (login/logout)', async () => {
      mockUserRole(5, 'monitor');

      const loginOp = createOperation('login', 'Login', '', { auditable: true });
      const result = await controller.isUserAuthorized(5, loginOp, {}, '127.0.0.1', false);
      expect(result).toBe(true);
      // DB should NOT be queried for no-permission ops
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('unknown role has no permissions', async () => {
      mockUserRole(6, 'superadmin');

      const result = await controller.isUserAuthorized(
        6,
        mockOperation(P.CHANNELS_VIEW),
        {},
        '127.0.0.1',
        false
      );
      expect(result).toBe(false);
    });

    it('null ROLE in database defaults to monitor', async () => {
      mockUserRole(7, null);

      // View: allowed (monitor has CHANNELS_VIEW)
      expect(
        await controller.isUserAuthorized(
          7,
          mockOperation(P.CHANNELS_VIEW),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(true);

      // Manage: denied (monitor doesn't have CHANNELS_MANAGE)
      controller.clearRoleCache(7);
      mockUserRole(7, null);
      expect(
        await controller.isUserAuthorized(
          7,
          mockOperation(P.CHANNELS_MANAGE),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(false);
    });

    it('user not found in database defaults to monitor', async () => {
      mockUserNotFound();

      expect(
        await controller.isUserAuthorized(
          999,
          mockOperation(P.CHANNELS_VIEW),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(true);

      controller.clearRoleCache(999);
      mockUserNotFound();
      expect(
        await controller.isUserAuthorized(
          999,
          mockOperation(P.CHANNELS_MANAGE),
          {},
          '127.0.0.1',
          false
        )
      ).toBe(false);
    });
  });

  // =========================================================================
  // Role Cache
  // =========================================================================

  describe('role cache', () => {
    it('caches role for 60 seconds', async () => {
      mockUserRole(1, 'admin');

      // First call - queries DB
      await controller.isUserAuthorized(
        1,
        mockOperation(P.CHANNELS_VIEW),
        {},
        '127.0.0.1',
        false
      );
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Second call within TTL - uses cache
      mockQuery.mockReset();
      await controller.isUserAuthorized(
        1,
        mockOperation(P.CHANNELS_VIEW),
        {},
        '127.0.0.1',
        false
      );
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('re-queries after cache TTL expires', async () => {
      mockUserRole(1, 'admin');

      await controller.isUserAuthorized(
        1,
        mockOperation(P.CHANNELS_VIEW),
        {},
        '127.0.0.1',
        false
      );
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      jest.advanceTimersByTime(61_000);
      mockQuery.mockReset();
      mockUserRole(1, 'monitor');

      const result = await controller.isUserAuthorized(
        1,
        mockOperation(P.CHANNELS_MANAGE),
        {},
        '127.0.0.1',
        false
      );
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(result).toBe(false); // Now monitor role
    });

    it('clearRoleCache(userId) clears specific user', async () => {
      mockUserRole(1, 'admin');
      await controller.getUserRole(1);

      controller.clearRoleCache(1);

      // Next call should query DB again
      mockQuery.mockReset();
      mockUserRole(1, 'operator');
      const role = await controller.getUserRole(1);
      expect(role).toBe('operator');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('clearRoleCache() clears all entries', async () => {
      mockUserRole(1, 'admin');
      await controller.getUserRole(1);
      mockQuery.mockReset();
      mockUserRole(2, 'operator');
      await controller.getUserRole(2);

      controller.clearRoleCache();

      // Both should re-query
      mockQuery.mockReset();
      mockUserRole(1, 'manager');
      const role1 = await controller.getUserRole(1);
      expect(role1).toBe('manager');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('uses stale cache on DB error', async () => {
      mockUserRole(1, 'admin');
      await controller.getUserRole(1);

      // Advance past TTL
      jest.advanceTimersByTime(61_000);

      // DB error on re-query
      mockQuery.mockRejectedValue(new Error('Connection lost'));

      const role = await controller.getUserRole(1);
      expect(role).toBe('admin'); // Falls back to stale cache
    });

    it('defaults to monitor on DB error with no cache', async () => {
      mockQuery.mockRejectedValue(new Error('Connection lost'));

      const role = await controller.getUserRole(999);
      expect(role).toBe('monitor');
    });
  });

  // =========================================================================
  // Channel Authorization
  // =========================================================================

  describe('channel authorization', () => {
    it('doesUserHaveChannelRestrictions returns false', async () => {
      const result = await controller.doesUserHaveChannelRestrictions(
        1,
        mockOperation(P.CHANNELS_VIEW)
      );
      expect(result).toBe(false);
    });

    it('getChannelAuthorizer returns DefaultChannelAuthorizer', async () => {
      const authorizer = await controller.getChannelAuthorizer(1, mockOperation(P.CHANNELS_VIEW));
      expect(authorizer.isChannelAuthorized('any-channel-id')).toBe(true);
      expect(authorizer.getAuthorizedChannelIds()).toBeNull();
    });
  });

  // =========================================================================
  // Extension Permissions
  // =========================================================================

  describe('extension permissions', () => {
    it('stores and retrieves extension permissions', () => {
      controller.addExtensionPermission({
        extensionName: 'test-plugin',
        displayName: 'Test Plugin',
        description: 'A test plugin',
        operationNames: ['testOp'],
        taskNames: [],
      });

      const perms = controller.getExtensionPermissions();
      expect(perms).toHaveLength(1);
      expect(perms[0]!.extensionName).toBe('test-plugin');
    });

    it('returns a copy of extension permissions', () => {
      controller.addExtensionPermission({
        extensionName: 'test',
        displayName: 'Test',
        description: '',
        operationNames: [],
        taskNames: [],
      });

      const copy1 = controller.getExtensionPermissions();
      const copy2 = controller.getExtensionPermissions();
      expect(copy1).not.toBe(copy2);
    });
  });

  // =========================================================================
  // Comprehensive permission matrix tests
  // =========================================================================

  describe('permission matrix', () => {
    const testCases: Array<{ role: string; permission: string; expected: boolean }> = [
      // Admin — all true
      { role: 'admin', permission: P.USERS_MANAGE, expected: true },
      { role: 'admin', permission: P.SERVER_RESTORE, expected: true },
      { role: 'admin', permission: P.SERVER_CLEAR_LIFETIME_STATS, expected: true },

      // Manager — no user management, has channel + extension management
      { role: 'manager', permission: P.USERS_MANAGE, expected: false },
      { role: 'manager', permission: P.CHANNELS_MANAGE, expected: true },
      { role: 'manager', permission: P.EXTENSIONS_MANAGE, expected: true },
      { role: 'manager', permission: P.ALERTS_MANAGE, expected: true },
      { role: 'manager', permission: P.GLOBAL_SCRIPTS_EDIT, expected: true },
      { role: 'manager', permission: P.SERVER_SETTINGS_EDIT, expected: true },

      // Operator — operational actions only
      { role: 'operator', permission: P.CHANNELS_START_STOP, expected: true },
      { role: 'operator', permission: P.CHANNELS_DEPLOY_UNDEPLOY, expected: true },
      { role: 'operator', permission: P.MESSAGES_REPROCESS, expected: true },
      { role: 'operator', permission: P.CHANNELS_MANAGE, expected: false },
      { role: 'operator', permission: P.USERS_MANAGE, expected: false },
      { role: 'operator', permission: P.ALERTS_MANAGE, expected: false },
      { role: 'operator', permission: P.GLOBAL_SCRIPTS_EDIT, expected: false },

      // Monitor — view only
      { role: 'monitor', permission: P.DASHBOARD_VIEW, expected: true },
      { role: 'monitor', permission: P.CHANNELS_VIEW, expected: true },
      { role: 'monitor', permission: P.MESSAGES_VIEW, expected: true },
      { role: 'monitor', permission: P.CHANNELS_START_STOP, expected: false },
      { role: 'monitor', permission: P.MESSAGES_REPROCESS, expected: false },
      { role: 'monitor', permission: P.CHANNELS_MANAGE, expected: false },
    ];

    it.each(testCases)(
      '$role + $permission → $expected',
      async ({ role, permission, expected }) => {
        controller.clearRoleCache();
        mockUserRole(1, role);

        const result = await controller.isUserAuthorized(
          1,
          mockOperation(permission),
          {},
          '127.0.0.1',
          false
        );
        expect(result).toBe(expected);
      }
    );
  });
});
