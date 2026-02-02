/**
 * Event Logger Service
 *
 * Ported from: ~/Projects/connect/server/event/AuditableEventListener.java
 *
 * Provides centralized audit logging for API operations.
 *
 * Architecture:
 * - Events are queued asynchronously to avoid blocking request handlers
 * - Background worker persists events to database
 * - Integrates with authorization middleware for automatic logging
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ServerEvent,
  EventLevel,
  EventOutcome,
  createServerEvent,
  addEventAttribute,
} from '../models/ServerEvent.js';
import { insertEvent } from '../../db/EventDao.js';
import { Operation } from '../middleware/authorization.js';

// ============================================================================
// Configuration
// ============================================================================

/** Server ID for this instance */
let serverId: string = uuidv4();

/** Event queue for async processing */
const eventQueue: Array<Omit<ServerEvent, 'id'>> = [];

/** Whether the background worker is running */
let workerRunning = false;

/** Interval for processing queued events (ms) */
const WORKER_INTERVAL_MS = 100;

/** Maximum events to process per batch */
const BATCH_SIZE = 50;

// ============================================================================
// Configuration Functions
// ============================================================================

/**
 * Set the server ID (call on startup)
 */
export function setServerId(id: string): void {
  serverId = id;
}

/**
 * Get the current server ID
 */
export function getServerId(): string {
  return serverId;
}

// ============================================================================
// Event Creation
// ============================================================================

/**
 * Log an operation event
 *
 * This is the primary entry point for audit logging from servlets.
 *
 * @param operation The operation being performed
 * @param userId User ID (0 for system)
 * @param ipAddress Client IP address
 * @param outcome Success or failure
 * @param parameters Additional context for the audit log
 */
export function logOperation(
  operation: Operation,
  userId: number,
  ipAddress: string,
  outcome: EventOutcome,
  parameters?: Record<string, unknown>
): void {
  if (!operation.auditable) {
    return; // Skip non-auditable operations
  }

  const event = createServerEvent(serverId, operation.displayName, {
    level: outcome === EventOutcome.SUCCESS ? EventLevel.INFORMATION : EventLevel.WARNING,
    outcome,
    userId,
    ipAddress,
  });

  // Add operation name as attribute
  addEventAttribute(event, 'operation', operation.name);

  // Add parameters as attributes
  if (parameters) {
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null) {
        // Skip sensitive fields
        if (key.toLowerCase().includes('password')) {
          continue;
        }
        addEventAttribute(event, key, value);
      }
    }
  }

  queueEvent(event);
}

/**
 * Log a system event (no user context)
 */
export function logSystemEvent(
  name: string,
  level: EventLevel = EventLevel.INFORMATION,
  attributes?: Record<string, string>
): void {
  const event = createServerEvent(serverId, name, {
    level,
    outcome: level === EventLevel.ERROR ? EventOutcome.FAILURE : EventOutcome.SUCCESS,
  });

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      addEventAttribute(event, key, value);
    }
  }

  queueEvent(event);
}

/**
 * Log a custom event with full control
 */
export function logEvent(event: Omit<ServerEvent, 'id'>): void {
  queueEvent(event);
}

/**
 * Log a warning event
 */
export function logWarning(name: string, attributes?: Record<string, string>): void {
  logSystemEvent(name, EventLevel.WARNING, attributes);
}

/**
 * Log an error event
 */
export function logError(name: string, attributes?: Record<string, string>): void {
  logSystemEvent(name, EventLevel.ERROR, attributes);
}

// ============================================================================
// Event Queue Management
// ============================================================================

/**
 * Add event to the async queue
 */
function queueEvent(event: Omit<ServerEvent, 'id'>): void {
  eventQueue.push(event);
  ensureWorkerRunning();
}

/**
 * Start the background worker if not already running
 */
function ensureWorkerRunning(): void {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  processQueue();
}

/**
 * Process queued events in batches
 */
async function processQueue(): Promise<void> {
  while (eventQueue.length > 0) {
    const batch = eventQueue.splice(0, BATCH_SIZE);

    for (const event of batch) {
      try {
        await insertEvent(event);
      } catch (error) {
        // Log to console but don't throw - event logging should never break the app
        console.error('Failed to insert event:', error);
        console.error('Event:', event);
      }
    }

    // Small delay between batches to avoid overwhelming the database
    if (eventQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_INTERVAL_MS));
    }
  }

  workerRunning = false;
}

/**
 * Flush all pending events (call on shutdown)
 */
export async function flushEvents(): Promise<void> {
  while (eventQueue.length > 0) {
    await processQueue();
  }
}

/**
 * Get the number of queued events (for monitoring)
 */
export function getQueuedEventCount(): number {
  return eventQueue.length;
}

// ============================================================================
// Express Middleware Integration
// ============================================================================

import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to log request completion
 *
 * This should be added after route handlers to capture the response status.
 * Integrates with the authorization context to get operation details.
 */
export function eventLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Capture response on finish
    res.on('finish', () => {
      // Only log if we have authorization context with an operation
      if (!req.authContext?.operation?.auditable) {
        return;
      }

      const operation = req.authContext.operation;
      const userId = req.userId ?? 0;
      const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

      // Determine outcome from response status
      const outcome =
        res.statusCode >= 200 && res.statusCode < 400
          ? EventOutcome.SUCCESS
          : EventOutcome.FAILURE;

      logOperation(operation, userId, ipAddress, outcome, req.authContext.parameterMap);
    });

    next();
  };
}

// ============================================================================
// Startup/Shutdown Hooks
// ============================================================================

/**
 * Initialize the event logger (call on server startup)
 */
export function initializeEventLogger(options?: { serverId?: string }): void {
  if (options?.serverId) {
    setServerId(options.serverId);
  }

  // Log server startup
  logSystemEvent('Server started', EventLevel.INFORMATION, {
    nodeVersion: process.version,
    platform: process.platform,
  });
}

/**
 * Shutdown the event logger (call on server shutdown)
 */
export async function shutdownEventLogger(): Promise<void> {
  // Log server shutdown
  logSystemEvent('Server stopping', EventLevel.INFORMATION);

  // Flush remaining events
  await flushEvents();
}
