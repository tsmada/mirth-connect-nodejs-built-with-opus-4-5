/**
 * Authorization Controller and Middleware
 *
 * Ported from:
 * - ~/Projects/connect/server/src/com/mirth/connect/server/controllers/AuthorizationController.java
 * - ~/Projects/connect/server/src/com/mirth/connect/server/api/MirthServlet.java
 * - ~/Projects/connect/server/src/com/mirth/connect/server/api/MirthResourceInvocationHandlerProvider.java
 *
 * Key concepts:
 * - Operations represent actions (name, display, auditable)
 * - Operations bind to Permissions via the permission string
 * - AuthorizationController checks if user can perform operation
 * - ChannelAuthorizer handles per-channel access control
 * - Default implementation allows everything (enterprise overrides)
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Permission } from './permissions.js';

// ============================================================================
// Operation Model
// ============================================================================

export type ExecuteType = 'SYNC' | 'ASYNC' | 'ABORT_PENDING';

export interface Operation {
  /** Unique operation identifier */
  name: string;
  /** Display name for audit logs and events */
  displayName: string;
  /** Permission required for this operation */
  permission: Permission;
  /** Execution type */
  executeType: ExecuteType;
  /** Whether to create audit log entries */
  auditable: boolean;
  /** Whether operation can be aborted */
  abortable: boolean;
}

/**
 * Create an Operation with defaults
 */
export function createOperation(
  name: string,
  displayName: string,
  permission: Permission,
  options: Partial<Pick<Operation, 'executeType' | 'auditable' | 'abortable'>> = {}
): Operation {
  return {
    name,
    displayName,
    permission,
    executeType: options.executeType ?? 'SYNC',
    auditable: options.auditable ?? true,
    abortable: options.abortable ?? false,
  };
}

// ============================================================================
// Channel Authorizer
// ============================================================================

/**
 * Handles per-channel authorization checks
 * In default implementation, all channels are authorized
 */
export interface ChannelAuthorizer {
  /** Check if user can access a specific channel */
  isChannelAuthorized(channelId: string): boolean;

  /** Get set of authorized channel IDs (null = all channels) */
  getAuthorizedChannelIds(): Set<string> | null;

  /** Filter a list of channel IDs to only authorized ones */
  filterChannelIds(channelIds: string[]): string[];
}

/**
 * Default channel authorizer - allows all channels
 */
export class DefaultChannelAuthorizer implements ChannelAuthorizer {
  isChannelAuthorized(_channelId: string): boolean {
    return true;
  }

  getAuthorizedChannelIds(): Set<string> | null {
    return null; // null means all channels
  }

  filterChannelIds(channelIds: string[]): string[] {
    return channelIds; // Return all
  }
}

// ============================================================================
// Authorization Controller Interface
// ============================================================================

export interface AuthorizationController {
  /**
   * Check if user is authorized to perform an operation
   * @param userId User ID
   * @param operation Operation to check
   * @param parameterMap Parameters for audit logging
   * @param ipAddress Client IP address
   * @param audit Whether to create audit log entry
   */
  isUserAuthorized(
    userId: number,
    operation: Operation,
    parameterMap: Record<string, unknown>,
    ipAddress: string,
    audit: boolean
  ): Promise<boolean>;

  /**
   * Check if user has channel-level restrictions for an operation
   */
  doesUserHaveChannelRestrictions(userId: number, operation: Operation): Promise<boolean>;

  /**
   * Get channel authorizer for filtering channel access
   */
  getChannelAuthorizer(userId: number, operation: Operation): Promise<ChannelAuthorizer>;

  /**
   * Register an extension permission
   */
  addExtensionPermission(extensionPermission: ExtensionPermission): void;
}

// ============================================================================
// Extension Permission Model
// ============================================================================

export interface ExtensionPermission {
  extensionName: string;
  displayName: string;
  description: string;
  operationNames: string[];
  taskNames: string[];
}

// ============================================================================
// Default Authorization Controller
// ============================================================================

/**
 * Default implementation that allows everything.
 * In Mirth's architecture, this is overridden by enterprise implementations.
 */
export class DefaultAuthorizationController implements AuthorizationController {
  private extensionPermissions: ExtensionPermission[] = [];

  async isUserAuthorized(
    _userId: number,
    _operation: Operation,
    _parameterMap: Record<string, unknown>,
    _ipAddress: string,
    _audit: boolean
  ): Promise<boolean> {
    // Default: allow everything
    return true;
  }

  async doesUserHaveChannelRestrictions(
    _userId: number,
    _operation: Operation
  ): Promise<boolean> {
    // Default: no restrictions
    return false;
  }

  async getChannelAuthorizer(
    _userId: number,
    _operation: Operation
  ): Promise<ChannelAuthorizer> {
    // Default: allow all channels
    return new DefaultChannelAuthorizer();
  }

  addExtensionPermission(extensionPermission: ExtensionPermission): void {
    this.extensionPermissions.push(extensionPermission);
  }

  getExtensionPermissions(): ExtensionPermission[] {
    return [...this.extensionPermissions];
  }
}

// Global authorization controller instance
let authorizationController: AuthorizationController = new DefaultAuthorizationController();

export function setAuthorizationController(controller: AuthorizationController): void {
  authorizationController = controller;
}

export function getAuthorizationController(): AuthorizationController {
  return authorizationController;
}

// ============================================================================
// Authorization Context (attached to request)
// ============================================================================

export interface AuthorizationContext {
  /** Current operation being performed */
  operation?: Operation;
  /** Parameters for audit logging */
  parameterMap: Record<string, unknown>;
  /** Channel authorizer for this request */
  channelAuthorizer?: ChannelAuthorizer;
  /** Whether authorization was already checked */
  authChecked: boolean;
}

// Extend Express Request to include authorization context
declare global {
  namespace Express {
    interface Request {
      authContext?: AuthorizationContext;
    }
  }
}

// ============================================================================
// Authorization Middleware
// ============================================================================

export interface AuthorizeOptions {
  /** Operation for this endpoint */
  operation: Operation;
  /** Skip automatic authorization check (servlet handles it) */
  dontCheckAuthorized?: boolean;
  /** Parameter name containing channel ID to verify */
  checkAuthorizedChannelId?: string;
  /** Parameter name containing user ID to verify */
  checkAuthorizedUserId?: string;
  /** Allow current user access even without USERS_MANAGE */
  auditCurrentUser?: boolean;
}

/**
 * Create authorization middleware for an endpoint
 *
 * This middleware:
 * 1. Creates authorization context on request
 * 2. Checks if user has permission (unless dontCheckAuthorized)
 * 3. Validates channel/user ID if specified
 * 4. Sets up channel authorizer for result filtering
 */
export function authorize(options: AuthorizeOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Ensure user is authenticated
    if (!req.userId || !req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Initialize authorization context
    req.authContext = {
      operation: options.operation,
      parameterMap: {},
      authChecked: false,
    };

    // Extract parameters for audit logging
    const parameterMap: Record<string, unknown> = {
      ...req.params,
      ...req.query,
    };

    // Include body params for audit (excluding sensitive data)
    if (req.body && typeof req.body === 'object') {
      const { password: _password, ...safeBody } = req.body as Record<string, unknown>;
      Object.assign(parameterMap, safeBody);
    }

    req.authContext.parameterMap = parameterMap;

    // Get client IP
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

    // Check authorization (unless deferred to servlet)
    if (!options.dontCheckAuthorized) {
      const authorized = await authorizationController.isUserAuthorized(
        req.userId,
        options.operation,
        parameterMap,
        ipAddress,
        options.operation.auditable
      );

      if (!authorized) {
        res.status(403).json({
          error: 'Forbidden',
          message: `User does not have permission: ${options.operation.permission}`,
          operation: options.operation.name,
        });
        return;
      }

      req.authContext.authChecked = true;
    }

    // Validate channel ID if specified
    if (options.checkAuthorizedChannelId) {
      const channelId =
        req.params[options.checkAuthorizedChannelId] ||
        (req.body as Record<string, unknown>)?.[options.checkAuthorizedChannelId];

      if (channelId && typeof channelId === 'string') {
        const channelAuthorizer = await authorizationController.getChannelAuthorizer(
          req.userId,
          options.operation
        );

        if (!channelAuthorizer.isChannelAuthorized(channelId)) {
          res.status(403).json({
            error: 'Forbidden',
            message: `User does not have access to channel: ${channelId}`,
            operation: options.operation.name,
          });
          return;
        }

        req.authContext.channelAuthorizer = channelAuthorizer;
      }
    }

    // Validate user ID if specified (allow access to own user)
    if (options.checkAuthorizedUserId) {
      const targetUserId =
        req.params[options.checkAuthorizedUserId] ||
        (req.body as Record<string, unknown>)?.[options.checkAuthorizedUserId];

      if (targetUserId !== undefined) {
        const targetId =
          typeof targetUserId === 'string' ? parseInt(targetUserId, 10) : targetUserId;

        // Check if accessing own user (always allowed)
        const isOwnUser = targetId === req.userId;

        if (!isOwnUser) {
          // Must have USERS_MANAGE permission
          const authorized = await authorizationController.isUserAuthorized(
            req.userId,
            options.operation,
            parameterMap,
            ipAddress,
            options.auditCurrentUser !== false && options.operation.auditable
          );

          if (!authorized) {
            res.status(403).json({
              error: 'Forbidden',
              message: 'User does not have permission to manage other users',
              operation: options.operation.name,
            });
            return;
          }
        }
      }
    }

    // Set up channel authorizer for result filtering
    if (!req.authContext.channelAuthorizer) {
      req.authContext.channelAuthorizer = await authorizationController.getChannelAuthorizer(
        req.userId,
        options.operation
      );
    }

    next();
  };
}

// ============================================================================
// Helper Functions for Servlets
// ============================================================================

/**
 * Check if user is authorized (for use in @DontCheckAuthorized servlets)
 */
export async function checkUserAuthorized(
  req: Request,
  audit: boolean = true
): Promise<boolean> {
  if (!req.userId || !req.authContext?.operation) {
    return false;
  }

  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

  return authorizationController.isUserAuthorized(
    req.userId,
    req.authContext.operation,
    req.authContext.parameterMap,
    ipAddress,
    audit
  );
}

/**
 * Check if user has channel restrictions
 */
export async function doesUserHaveChannelRestrictions(req: Request): Promise<boolean> {
  if (!req.userId || !req.authContext?.operation) {
    return false;
  }

  return authorizationController.doesUserHaveChannelRestrictions(
    req.userId,
    req.authContext.operation
  );
}

/**
 * Check if a specific channel is authorized for the current user
 */
export function isChannelAuthorized(req: Request, channelId: string): boolean {
  if (!req.authContext?.channelAuthorizer) {
    return true; // No authorizer = no restrictions
  }

  return req.authContext.channelAuthorizer.isChannelAuthorized(channelId);
}

/**
 * Filter channel IDs to only those the user can access
 */
export function filterAuthorizedChannelIds(req: Request, channelIds: string[]): string[] {
  if (!req.authContext?.channelAuthorizer) {
    return channelIds;
  }

  return req.authContext.channelAuthorizer.filterChannelIds(channelIds);
}

/**
 * Redact channels from a list based on user authorization
 */
export function redactChannels<T extends { id: string }>(req: Request, channels: T[]): T[] {
  if (!req.authContext?.channelAuthorizer) {
    return channels;
  }

  return channels.filter((channel) =>
    req.authContext!.channelAuthorizer!.isChannelAuthorized(channel.id)
  );
}

/**
 * Add parameter to the audit log
 */
export function addToParameterMap(req: Request, name: string, value: unknown): void {
  if (req.authContext) {
    req.authContext.parameterMap[name] = value;
  }
}
