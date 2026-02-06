/**
 * Message Filter Model
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/filters/MessageFilter.java
 *
 * Used to filter message searches across the per-channel message tables.
 *
 * Key behaviors:
 * - All fields are optional (null = not applied)
 * - Empty includedMetaDataIds with null excludedMetaDataIds = return 0 messages
 * - Multiple content searches are AND'd together
 * - Text search can use regex
 */

// ============================================================================
// Content Types (for content search)
// ============================================================================

/**
 * Content type codes (stored in D_MC.CONTENT_TYPE)
 */
export enum ContentType {
  RAW = 1,
  PROCESSED_RAW = 2,
  TRANSFORMED = 3,
  ENCODED = 4,
  SENT = 5,
  RESPONSE = 6,
  RESPONSE_TRANSFORMED = 7,
  PROCESSED_RESPONSE = 8,
  CONNECTOR_MAP = 9,
  CHANNEL_MAP = 10,
  RESPONSE_MAP = 11,
  PROCESSING_ERROR = 12,
  POSTPROCESSOR_ERROR = 13,
  SOURCE_MAP = 14,
}

/**
 * Message status codes (stored in D_MM.STATUS)
 */
export enum MessageStatus {
  RECEIVED = 'R',
  FILTERED = 'F',
  TRANSFORMED = 'T',
  SENT = 'S',
  QUEUED = 'Q',
  ERROR = 'E',
  PENDING = 'P',
}

// ============================================================================
// Search Element Types
// ============================================================================

/**
 * Content search element - search within message content by type
 *
 * Ported from: ~/Projects/connect/model/filters/elements/ContentSearchElement.java
 */
export interface ContentSearchElement {
  /** Content type code (1-14) */
  contentCode: ContentType;
  /** Search strings (multiple strings are AND'd together) */
  searches: string[];
}

/**
 * Metadata search operators
 */
export type MetaDataOperator =
  | 'EQUAL'
  | 'NOT_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'CONTAINS'
  | 'DOES_NOT_CONTAIN'
  | 'STARTS_WITH'
  | 'DOES_NOT_START_WITH'
  | 'ENDS_WITH'
  | 'DOES_NOT_END_WITH';

/**
 * Custom metadata search element
 *
 * Ported from: ~/Projects/connect/model/filters/elements/MetaDataSearchElement.java
 */
export interface MetaDataSearchElement {
  /** Custom metadata column name */
  columnName: string;
  /** Search operator */
  operator: MetaDataOperator;
  /** Search value */
  value: unknown;
  /** Case-insensitive comparison */
  ignoreCase?: boolean;
}

// ============================================================================
// Message Filter Model
// ============================================================================

/**
 * Message search filter
 *
 * All fields are optional. When undefined, the filter is not applied.
 */
export interface MessageFilter {
  /** Upper bound for message ID (inclusive) */
  maxMessageId?: number;
  /** Lower bound for message ID (inclusive) */
  minMessageId?: number;
  /** Upper bound for original message ID */
  originalIdUpper?: number;
  /** Lower bound for original message ID */
  originalIdLower?: number;
  /** Upper bound for import ID */
  importIdUpper?: number;
  /** Lower bound for import ID */
  importIdLower?: number;
  /** Start date for message received time (inclusive) */
  startDate?: Date;
  /** End date for message received time (inclusive) */
  endDate?: Date;
  /** Free-form text search string */
  textSearch?: string;
  /** Whether text search uses regex */
  textSearchRegex?: boolean;
  /** Message statuses to include */
  statuses?: MessageStatus[];
  /** Connector (metadata) IDs to include */
  includedMetaDataIds?: number[];
  /** Connector (metadata) IDs to exclude */
  excludedMetaDataIds?: number[];
  /** Server ID filter (partial match) */
  serverId?: string;
  /** Content search criteria */
  contentSearch?: ContentSearchElement[];
  /** Custom metadata search criteria */
  metaDataSearch?: MetaDataSearchElement[];
  /** Custom metadata columns to search with text */
  textSearchMetaDataColumns?: string[];
  /** Minimum send attempts */
  sendAttemptsLower?: number;
  /** Maximum send attempts */
  sendAttemptsUpper?: number;
  /** Filter by presence of attachments */
  attachment?: boolean;
  /** Filter by error presence (ERROR_CODE > 0) */
  error?: boolean;
}

// ============================================================================
// Message Search Result
// ============================================================================

/**
 * Result from message search (before fetching full message data)
 */
export interface MessageSearchResult {
  messageId: number;
  metaDataIds: Set<number>;
  processed?: boolean;
  importId?: number;
}

// ============================================================================
// Parse Helpers
// ============================================================================

/**
 * Parse MessageFilter from request body or query parameters
 */
export function parseMessageFilter(input: Record<string, unknown>): MessageFilter {
  const filter: MessageFilter = {};

  // ID range filters
  if (input.maxMessageId !== undefined) {
    filter.maxMessageId = Number(input.maxMessageId);
  }
  if (input.minMessageId !== undefined) {
    filter.minMessageId = Number(input.minMessageId);
  }
  if (input.originalIdUpper !== undefined) {
    filter.originalIdUpper = Number(input.originalIdUpper);
  }
  if (input.originalIdLower !== undefined) {
    filter.originalIdLower = Number(input.originalIdLower);
  }
  if (input.importIdUpper !== undefined) {
    filter.importIdUpper = Number(input.importIdUpper);
  }
  if (input.importIdLower !== undefined) {
    filter.importIdLower = Number(input.importIdLower);
  }

  // Date filters
  if (input.startDate !== undefined) {
    filter.startDate = new Date(input.startDate as string | number);
  }
  if (input.endDate !== undefined) {
    filter.endDate = new Date(input.endDate as string | number);
  }

  // Text search
  if (input.textSearch !== undefined) {
    filter.textSearch = String(input.textSearch);
  }
  if (input.textSearchRegex !== undefined) {
    filter.textSearchRegex = Boolean(input.textSearchRegex);
  }

  // Status filter
  if (input.statuses !== undefined) {
    const statuses = Array.isArray(input.statuses) ? input.statuses : [input.statuses];
    filter.statuses = statuses.map((s) => s as MessageStatus);
  }
  if (input.status !== undefined) {
    // Single status (from query param)
    filter.statuses = [input.status as MessageStatus];
  }

  // Metadata ID filters
  if (input.includedMetaDataIds !== undefined) {
    const ids = Array.isArray(input.includedMetaDataIds)
      ? input.includedMetaDataIds
      : [input.includedMetaDataIds];
    filter.includedMetaDataIds = ids.map(Number);
  }
  if (input.excludedMetaDataIds !== undefined) {
    const ids = Array.isArray(input.excludedMetaDataIds)
      ? input.excludedMetaDataIds
      : [input.excludedMetaDataIds];
    filter.excludedMetaDataIds = ids.map(Number);
  }

  // Server ID
  if (input.serverId !== undefined) {
    filter.serverId = String(input.serverId);
  }

  // Content search
  if (input.contentSearch !== undefined) {
    filter.contentSearch = input.contentSearch as ContentSearchElement[];
  }

  // Metadata search
  if (input.metaDataSearch !== undefined) {
    filter.metaDataSearch = input.metaDataSearch as MetaDataSearchElement[];
  }

  // Text search metadata columns
  if (input.textSearchMetaDataColumns !== undefined) {
    const cols = Array.isArray(input.textSearchMetaDataColumns)
      ? input.textSearchMetaDataColumns
      : [input.textSearchMetaDataColumns];
    filter.textSearchMetaDataColumns = cols.map(String);
  }

  // Send attempts
  if (input.sendAttemptsLower !== undefined) {
    filter.sendAttemptsLower = Number(input.sendAttemptsLower);
  }
  if (input.sendAttemptsUpper !== undefined) {
    filter.sendAttemptsUpper = Number(input.sendAttemptsUpper);
  }

  // Boolean filters
  if (input.attachment !== undefined) {
    filter.attachment = Boolean(input.attachment);
  }
  if (input.error !== undefined) {
    filter.error = Boolean(input.error);
  }

  return filter;
}

/**
 * Check if filter requires custom metadata table search
 */
export function requiresCustomMetaDataSearch(filter: MessageFilter): boolean {
  return (
    (filter.metaDataSearch !== undefined && filter.metaDataSearch.length > 0) ||
    (filter.textSearchMetaDataColumns !== undefined &&
      filter.textSearchMetaDataColumns.length > 0 &&
      filter.textSearch !== undefined)
  );
}

/**
 * Check if filter requires content table search
 */
export function requiresContentSearch(filter: MessageFilter): boolean {
  return filter.contentSearch !== undefined && filter.contentSearch.length > 0;
}

/**
 * Check if filter requires text search in content
 */
export function requiresTextSearch(filter: MessageFilter): boolean {
  return filter.textSearch !== undefined && filter.textSearch.trim() !== '';
}
