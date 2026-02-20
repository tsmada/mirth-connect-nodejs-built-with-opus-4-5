/**
 * Role-Based Authorization Controller
 *
 * Replaces DefaultAuthorizationController (which allows ALL operations for ALL users)
 * with a predefined role → permission mapping.
 *
 * Roles:
 * - admin:    Full access to all operations
 * - manager:  Channel and configuration management
 * - operator: Day-to-day operations (start/stop, messages, dashboard)
 * - monitor:  Read-only monitoring
 *
 * User roles are stored in the PERSON.ROLE column (default: 'admin' for existing users).
 */

import {
  AuthorizationController,
  ChannelAuthorizer,
  DefaultChannelAuthorizer,
  Operation,
  ExtensionPermission,
} from './authorization.js';
import { ALL_PERMISSIONS } from './permissions.js';
import * as P from './permissions.js';
import { getPool } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2/promise';
import { getLogger } from '../../logging/index.js';

const logger = getLogger('api');

// ============================================================================
// Valid Roles
// ============================================================================

export const VALID_ROLES = ['admin', 'manager', 'operator', 'monitor'] as const;
export type Role = (typeof VALID_ROLES)[number];

export function isValidRole(role: string): role is Role {
  return (VALID_ROLES as readonly string[]).includes(role);
}

// ============================================================================
// Role → Permission Mapping
// ============================================================================

/**
 * Predefined permission sets for each role.
 *
 * admin:    ALL permissions
 * manager:  Channels (all), code templates, global scripts, config map, tags,
 *           alerts, extensions, server settings (view+edit), dashboard, messages
 * operator: Dashboard, channels (view + start/stop + deploy), messages (view + reprocess),
 *           events (view), alerts (view), server settings (view)
 * monitor:  Dashboard, channels (view), messages (view), events (view),
 *           server settings (view), alerts (view)
 */
export const RolePermissionMap: Record<Role, Set<string>> = {
  admin: new Set(ALL_PERMISSIONS),

  manager: new Set([
    // Dashboard
    P.DASHBOARD_VIEW,
    // Channels — full management
    P.CHANNELS_VIEW,
    P.CHANNEL_GROUPS_VIEW,
    P.CHANNELS_MANAGE,
    P.CHANNELS_CLEAR_STATISTICS,
    P.CHANNELS_START_STOP,
    P.CHANNELS_DEPLOY_UNDEPLOY,
    // Code Templates
    P.CODE_TEMPLATES_VIEW,
    P.CODE_TEMPLATES_MANAGE,
    // Global Scripts
    P.GLOBAL_SCRIPTS_VIEW,
    P.GLOBAL_SCRIPTS_EDIT,
    // Messages — full management
    P.MESSAGES_VIEW,
    P.MESSAGES_REMOVE,
    P.MESSAGES_REMOVE_RESULTS,
    P.MESSAGES_REMOVE_ALL,
    P.MESSAGES_PROCESS,
    P.MESSAGES_REPROCESS,
    P.MESSAGES_REPROCESS_RESULTS,
    P.MESSAGES_IMPORT,
    P.MESSAGES_EXPORT_SERVER,
    // Tags
    P.TAGS_VIEW,
    P.TAGS_MANAGE,
    // Events
    P.EVENTS_VIEW,
    P.EVENTS_REMOVE,
    // Alerts
    P.ALERTS_VIEW,
    P.ALERTS_MANAGE,
    // Extensions
    P.EXTENSIONS_MANAGE,
    // Server settings
    P.SERVER_SETTINGS_VIEW,
    P.SERVER_SETTINGS_EDIT,
    P.SERVER_BACKUP,
    P.SERVER_RESTORE,
    P.SERVER_SEND_TEST_EMAIL,
    // Config map
    P.CONFIG_MAP_VIEW,
    P.CONFIG_MAP_EDIT,
    // Database
    P.DATABASE_DRIVERS_EDIT,
    P.DATABASE_TASKS_VIEW,
    P.DATABASE_TASKS_MANAGE,
    // Resources
    P.RESOURCES_VIEW,
    P.RESOURCES_EDIT,
    P.RESOURCES_RELOAD,
  ]),

  operator: new Set([
    // Dashboard
    P.DASHBOARD_VIEW,
    // Channels — view + start/stop + deploy
    P.CHANNELS_VIEW,
    P.CHANNEL_GROUPS_VIEW,
    P.CHANNELS_START_STOP,
    P.CHANNELS_DEPLOY_UNDEPLOY,
    P.CHANNELS_CLEAR_STATISTICS,
    // Messages — view + reprocess
    P.MESSAGES_VIEW,
    P.MESSAGES_REPROCESS,
    P.MESSAGES_REPROCESS_RESULTS,
    P.MESSAGES_PROCESS,
    // Events — view only
    P.EVENTS_VIEW,
    // Alerts — view only
    P.ALERTS_VIEW,
    // Server settings — view only
    P.SERVER_SETTINGS_VIEW,
    // Tags — view only
    P.TAGS_VIEW,
    // Code templates — view only
    P.CODE_TEMPLATES_VIEW,
    // Config map — view only
    P.CONFIG_MAP_VIEW,
    // Resources — view only
    P.RESOURCES_VIEW,
    // Database tasks — view only
    P.DATABASE_TASKS_VIEW,
  ]),

  monitor: new Set([
    // Dashboard
    P.DASHBOARD_VIEW,
    // Channels — view only
    P.CHANNELS_VIEW,
    P.CHANNEL_GROUPS_VIEW,
    // Messages — view only
    P.MESSAGES_VIEW,
    // Events — view only
    P.EVENTS_VIEW,
    // Alerts — view only
    P.ALERTS_VIEW,
    // Server settings — view only
    P.SERVER_SETTINGS_VIEW,
    // Tags — view only
    P.TAGS_VIEW,
    // Code templates — view only
    P.CODE_TEMPLATES_VIEW,
    // Config map — view only
    P.CONFIG_MAP_VIEW,
    // Resources — view only
    P.RESOURCES_VIEW,
    // Database tasks — view only
    P.DATABASE_TASKS_VIEW,
  ]),
};

// ============================================================================
// Role Cache
// ============================================================================

interface CacheEntry {
  role: string;
  expiry: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

// ============================================================================
// Controller Implementation
// ============================================================================

interface RoleRow extends RowDataPacket {
  ROLE: string | null;
}

export class RoleBasedAuthorizationController implements AuthorizationController {
  private extensionPermissions: ExtensionPermission[] = [];
  private roleCache = new Map<number, CacheEntry>();

  async isUserAuthorized(
    userId: number,
    operation: Operation,
    _parameterMap: Record<string, unknown>,
    _ipAddress: string,
    _audit: boolean
  ): Promise<boolean> {
    // No permission required (e.g., login/logout) → always allow
    if (!operation.permission) {
      return true;
    }

    const role = await this.getUserRole(userId);
    const permissions = RolePermissionMap[role as Role] ?? new Set<string>();
    return permissions.has(operation.permission);
  }

  async doesUserHaveChannelRestrictions(_userId: number, _operation: Operation): Promise<boolean> {
    // Channel-level restrictions not implemented in predefined roles.
    // All channels are accessible to users with the correct permission.
    return false;
  }

  async getChannelAuthorizer(_userId: number, _operation: Operation): Promise<ChannelAuthorizer> {
    return new DefaultChannelAuthorizer();
  }

  addExtensionPermission(extensionPermission: ExtensionPermission): void {
    this.extensionPermissions.push(extensionPermission);
  }

  getExtensionPermissions(): ExtensionPermission[] {
    return [...this.extensionPermissions];
  }

  /**
   * Look up user role from database with caching.
   * Defaults to 'monitor' if ROLE column is NULL (least privilege for new users).
   */
  async getUserRole(userId: number): Promise<string> {
    const now = Date.now();

    // Check cache
    const cached = this.roleCache.get(userId);
    if (cached && cached.expiry > now) {
      return cached.role;
    }

    // Query database
    let role = 'monitor'; // Default to least privilege
    try {
      const pool = getPool();
      const [rows] = await pool.query<RoleRow[]>('SELECT ROLE FROM PERSON WHERE ID = ?', [userId]);
      if (rows.length > 0 && rows[0]!.ROLE) {
        role = rows[0]!.ROLE;
      }
    } catch (err) {
      logger.warn(`Failed to query user role for userId=${userId}: ${String(err)}`);
      // On error, check if we have a stale cache entry
      if (cached) {
        return cached.role;
      }
    }

    // Update cache
    this.roleCache.set(userId, { role, expiry: now + CACHE_TTL_MS });
    return role;
  }

  /**
   * Clear role cache. Called when a user's role is updated.
   * If no userId specified, clears entire cache.
   */
  clearRoleCache(userId?: number): void {
    if (userId !== undefined) {
      this.roleCache.delete(userId);
    } else {
      this.roleCache.clear();
    }
  }
}
