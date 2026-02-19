/**
 * Server Event Model
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/ServerEvent.java
 *
 * Events are audit log entries for API operations. They include:
 * - Operation name and outcome
 * - User who performed the action
 * - IP address of the client
 * - Arbitrary key-value attributes for context
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Event severity level
 */
export enum EventLevel {
  INFORMATION = 'INFORMATION',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

/**
 * Event outcome
 */
export enum EventOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

// ============================================================================
// Server Event Model
// ============================================================================

/**
 * Server event (audit log entry)
 *
 * Key behaviors from Java:
 * - id: Set by database on insert (auto-increment)
 * - eventTime: Timestamp with millisecond precision
 * - attributes: Preserved insertion order (use Map)
 * - userId: 0 for system events, otherwise user ID
 */
export interface ServerEvent {
  /** Database ID (auto-generated) */
  id: number;
  /** Event timestamp */
  eventTime: Date;
  /** Severity level */
  level: EventLevel;
  /** Event name/display text */
  name: string;
  /** Arbitrary key-value attributes */
  attributes: Map<string, string>;
  /** Operation outcome */
  outcome: EventOutcome;
  /** User ID (0 for system) */
  userId: number;
  /** Client IP address */
  ipAddress: string | null;
  /** Server instance ID */
  serverId: string;
}

/**
 * Create a new ServerEvent with defaults
 */
export function createServerEvent(
  serverId: string,
  name: string,
  options: Partial<Omit<ServerEvent, 'id' | 'serverId' | 'name'>> = {}
): Omit<ServerEvent, 'id'> {
  return {
    eventTime: options.eventTime ?? new Date(),
    level: options.level ?? EventLevel.INFORMATION,
    name,
    attributes: options.attributes ?? new Map(),
    outcome: options.outcome ?? EventOutcome.SUCCESS,
    userId: options.userId ?? 0,
    ipAddress: options.ipAddress ?? null,
    serverId,
  };
}

/**
 * Add an attribute to an event
 */
export function addEventAttribute(
  event: Omit<ServerEvent, 'id'> | ServerEvent,
  key: string,
  value: unknown
): void {
  if (value !== undefined && value !== null) {
    event.attributes.set(key, String(value));
  }
}

/**
 * Convert attributes Map to plain object (for JSON serialization)
 */
export function attributesToObject(attributes: Map<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [key, value] of attributes) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Convert plain object to attributes Map
 */
export function objectToAttributes(
  obj: Record<string, string> | null | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (obj) {
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, value);
    }
  }
  return map;
}

// ============================================================================
// Event Filter Model
// ============================================================================

/**
 * Event search filter
 *
 * Ported from: ~/Projects/connect/model/filters/EventFilter.java
 *
 * All fields are optional. When null/undefined, the field is not included
 * in the WHERE clause.
 */
export interface EventFilter {
  /** Maximum event ID (upper bound, inclusive) */
  maxEventId?: number;
  /** Minimum event ID (lower bound, inclusive) */
  minEventId?: number;
  /** Exact event ID match */
  id?: number;
  /** Filter by levels (multi-select) */
  levels?: EventLevel[];
  /** Start date (inclusive) */
  startDate?: Date;
  /** End date (inclusive) */
  endDate?: Date;
  /** Partial name match (case-insensitive) */
  name?: string;
  /** Exact outcome match */
  outcome?: EventOutcome;
  /** Exact user ID match */
  userId?: number;
  /** Exact IP address match */
  ipAddress?: string;
  /** Partial server ID match */
  serverId?: string;
}

/**
 * Parse EventFilter from query parameters or request body
 */
export function parseEventFilter(input: Record<string, unknown>): EventFilter {
  const filter: EventFilter = {};

  if (input.maxEventId !== undefined) {
    filter.maxEventId = parseInt(String(input.maxEventId), 10);
  }
  if (input.minEventId !== undefined) {
    filter.minEventId = parseInt(String(input.minEventId), 10);
  }
  if (input.id !== undefined) {
    filter.id = parseInt(String(input.id), 10);
  }
  if (input.levels !== undefined) {
    const levels = Array.isArray(input.levels) ? input.levels : [input.levels];
    filter.levels = levels.map((l) => l as EventLevel);
  }
  if (input.level !== undefined) {
    // Single level (from query param)
    filter.levels = [input.level as EventLevel];
  }
  if (input.startDate !== undefined) {
    filter.startDate = new Date(input.startDate as string | number);
  }
  if (input.endDate !== undefined) {
    filter.endDate = new Date(input.endDate as string | number);
  }
  if (input.name !== undefined) {
    filter.name = String(input.name);
  }
  if (input.outcome !== undefined) {
    filter.outcome = input.outcome as EventOutcome;
  }
  if (input.userId !== undefined) {
    filter.userId = parseInt(String(input.userId), 10);
  }
  if (input.ipAddress !== undefined) {
    filter.ipAddress = String(input.ipAddress);
  }
  if (input.serverId !== undefined) {
    filter.serverId = String(input.serverId);
  }

  return filter;
}

// ============================================================================
// Serialization for API responses
// ============================================================================

/**
 * Server event for API response (attributes as object)
 */
export interface ServerEventResponse {
  id: number;
  eventTime: string;
  level: EventLevel;
  name: string;
  attributes: Record<string, string>;
  outcome: EventOutcome;
  userId: number;
  ipAddress: string | null;
  serverId: string;
}

/**
 * Convert ServerEvent to API response format
 */
export function toServerEventResponse(event: ServerEvent): ServerEventResponse {
  return {
    id: event.id,
    eventTime: event.eventTime.toISOString(),
    level: event.level,
    name: event.name,
    attributes: attributesToObject(event.attributes),
    outcome: event.outcome,
    userId: event.userId,
    ipAddress: event.ipAddress,
    serverId: event.serverId,
  };
}
