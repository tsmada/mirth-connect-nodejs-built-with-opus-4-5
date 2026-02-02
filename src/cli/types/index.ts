/**
 * CLI-specific type definitions
 *
 * These types are used throughout the CLI for configuration, API responses,
 * and command options. They're separate from the server-side types to maintain
 * loose coupling between the CLI and server implementations.
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * CLI configuration stored in ~/.mirth-cli.json
 */
export interface CliConfig {
  /** Mirth Connect server URL */
  url: string;
  /** Default username */
  username?: string;
  /** Session token (stored after login) */
  sessionToken?: string;
  /** Session expiry timestamp */
  sessionExpiry?: number;
  /** Output format preference */
  outputFormat?: 'table' | 'json';
  /** Dashboard refresh interval in seconds */
  dashboardRefresh?: number;
}

/**
 * Global CLI options available on all commands
 */
export interface GlobalOptions {
  url?: string;
  user?: string;
  password?: string;
  json?: boolean;
  verbose?: boolean;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Login status returned by /users/_login
 */
export interface LoginStatus {
  status: 'SUCCESS' | 'SUCCESS_GRACE_PERIOD' | 'FAIL' | 'FAIL_LOCKED_OUT';
  message: string;
  updatedUsername?: string;
}

/**
 * System information from /system/info
 */
export interface SystemInfo {
  jvmVersion: string;
  osName: string;
  osVersion: string;
  osArchitecture: string;
  dbName: string;
  dbVersion: string;
}

/**
 * System statistics from /system/stats
 */
export interface SystemStats {
  timestamp: string;
  cpuUsagePercent: number;
  allocatedMemoryBytes: number;
  freeMemoryBytes: number;
  maxMemoryBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
}

/**
 * Server version info
 */
export interface ServerVersion {
  version: string;
  buildDate?: string;
}

// =============================================================================
// Channel Types
// =============================================================================

/**
 * Channel status states
 */
export type ChannelState =
  | 'STARTED'
  | 'STOPPED'
  | 'PAUSED'
  | 'STARTING'
  | 'STOPPING'
  | 'PAUSING'
  | 'UNDEPLOYED';

/**
 * Connector status
 */
export interface ConnectorStatus {
  metaDataId: number;
  name: string;
  state: ChannelState;
  statistics: ConnectorStatistics;
}

/**
 * Connector statistics
 */
export interface ConnectorStatistics {
  received: number;
  filtered: number;
  transformed?: number;
  pending?: number;
  queued: number;
  sent: number;
  errored: number;
}

/**
 * Channel status with statistics
 */
export interface ChannelStatus {
  channelId: string;
  name: string;
  state: ChannelState;
  deployedDate?: string;
  deployedRevisionDelta?: number;
  statistics: ChannelStatistics;
  childStatuses?: ConnectorStatus[];
}

/**
 * Channel statistics (aggregated)
 */
export interface ChannelStatistics {
  received: number;
  filtered: number;
  queued: number;
  sent: number;
  errored: number;
}

/**
 * Channel summary for listing
 */
export interface ChannelSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  revision: number;
  lastModified?: string;
}

/**
 * Full channel details
 */
export interface Channel {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  revision: number;
  lastModified?: string;
  sourceConnector: {
    name: string;
    transportName: string;
    metaDataId: number;
  };
  destinationConnectors: Array<{
    name: string;
    transportName: string;
    metaDataId: number;
    enabled: boolean;
  }>;
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message status codes
 * R=RECEIVED, F=FILTERED, T=TRANSFORMED, S=SENT, Q=QUEUED, E=ERROR, P=PENDING
 */
export type MessageStatus = 'R' | 'F' | 'T' | 'S' | 'Q' | 'E' | 'P';

/**
 * Content type identifiers
 */
export type ContentType =
  | 'RAW'
  | 'PROCESSED_RAW'
  | 'TRANSFORMED'
  | 'ENCODED'
  | 'SENT'
  | 'RESPONSE'
  | 'RESPONSE_TRANSFORMED'
  | 'PROCESSED_RESPONSE'
  | 'CONNECTOR_MAP'
  | 'CHANNEL_MAP'
  | 'RESPONSE_MAP'
  | 'PROCESSING_ERROR'
  | 'POSTPROCESSOR_ERROR'
  | 'RESPONSE_ERROR'
  | 'SOURCE_MAP';

/**
 * Message content
 */
export interface MessageContent {
  contentType: ContentType;
  content: string;
  dataType: string;
  encrypted: boolean;
}

/**
 * Connector message within a message
 */
export interface ConnectorMessage {
  messageId: number;
  metaDataId: number;
  channelId: string;
  connectorName: string;
  receivedDate: string;
  status: MessageStatus;
  sendAttempts: number;
  sendDate?: string;
  responseDate?: string;
  errorCode?: number;
  content?: Record<number, MessageContent>;
}

/**
 * Full message with connector messages
 */
export interface Message {
  messageId: number;
  channelId: string;
  serverId: string;
  receivedDate: string;
  processed: boolean;
  originalId?: number;
  importId?: number;
  connectorMessages: Record<number, ConnectorMessage>;
}

/**
 * Message search filter
 */
export interface MessageFilter {
  minMessageId?: number;
  maxMessageId?: number;
  startDate?: string;
  endDate?: string;
  statuses?: MessageStatus[];
  textSearch?: string;
  textSearchRegex?: boolean;
  includedMetaDataIds?: number[];
  excludedMetaDataIds?: number[];
}

/**
 * Attachment info
 */
export interface AttachmentInfo {
  id: string;
  messageId: number;
  type: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event/audit log level
 */
export type EventLevel = 'INFORMATION' | 'WARNING' | 'ERROR';

/**
 * Event outcome
 */
export type EventOutcome = 'SUCCESS' | 'FAILURE';

/**
 * Server event (audit log entry)
 */
export interface ServerEvent {
  id: number;
  serverId: string;
  serverName?: string;
  level: EventLevel;
  outcome: EventOutcome;
  name: string;
  userId?: number;
  ipAddress?: string;
  dateTime: string;
  attributes?: Record<string, string>;
}

/**
 * Event search filter
 */
export interface EventFilter {
  minEventId?: number;
  maxEventId?: number;
  startDate?: string;
  endDate?: string;
  levels?: EventLevel[];
  outcomes?: EventOutcome[];
  userId?: number;
  ipAddress?: string;
  name?: string;
}

// =============================================================================
// MLLP/HTTP Send Types
// =============================================================================

/**
 * MLLP send options
 */
export interface MllpSendOptions {
  host: string;
  port: number;
  timeout?: number;
}

/**
 * HTTP send options
 */
export interface HttpSendOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Send response (for both MLLP and HTTP)
 */
export interface SendResponse {
  success: boolean;
  statusCode?: number;
  message: string;
  response?: string;
  error?: string;
  duration?: number;
}
