/**
 * Operation Registry
 *
 * Ported from: @MirthOperation annotations across servlet interfaces
 *
 * Each operation represents an API action with:
 * - name: Unique identifier (used in audit logs)
 * - displayName: Human-readable name for events
 * - permission: Required permission string
 *
 * Operations are organized by servlet/category.
 */

import { createOperation, Operation } from './authorization.js';
import * as P from './permissions.js';

// ============================================================================
// Channel Operations
// ============================================================================

export const CHANNEL_GET_CHANNELS = createOperation(
  'getChannels',
  'Get channels',
  P.CHANNELS_VIEW
);

export const CHANNEL_GET_CHANNEL = createOperation(
  'getChannel',
  'Get channel',
  P.CHANNELS_VIEW
);

export const CHANNEL_GET_CHANNEL_SUMMARY = createOperation(
  'getChannelSummary',
  'Get channel summary',
  P.CHANNELS_VIEW
);

export const CHANNEL_CREATE = createOperation(
  'createChannel',
  'Create channel',
  P.CHANNELS_MANAGE
);

export const CHANNEL_UPDATE = createOperation(
  'updateChannel',
  'Update channel',
  P.CHANNELS_MANAGE
);

export const CHANNEL_REMOVE = createOperation(
  'removeChannel',
  'Remove channel',
  P.CHANNELS_MANAGE
);

export const CHANNEL_GET_IDS_AND_NAMES = createOperation(
  'getChannelIdsAndNames',
  'Get channel IDs and names',
  P.CHANNELS_VIEW
);

// ============================================================================
// Channel Status Operations
// ============================================================================

export const CHANNEL_STATUS_GET = createOperation(
  'getChannelStatus',
  'Get channel status',
  P.DASHBOARD_VIEW
);

export const CHANNEL_STATUS_GET_ALL = createOperation(
  'getAllChannelStatuses',
  'Get all channel statuses',
  P.DASHBOARD_VIEW
);

export const CHANNEL_STATUS_GET_INITIAL = createOperation(
  'getDashboardChannelInfo',
  'Get dashboard channel info',
  P.DASHBOARD_VIEW
);

export const CHANNEL_START = createOperation(
  'startChannel',
  'Start channel',
  P.CHANNELS_START_STOP
);

export const CHANNEL_STOP = createOperation(
  'stopChannel',
  'Stop channel',
  P.CHANNELS_START_STOP
);

export const CHANNEL_PAUSE = createOperation(
  'pauseChannel',
  'Pause channel',
  P.CHANNELS_START_STOP
);

export const CHANNEL_RESUME = createOperation(
  'resumeChannel',
  'Resume channel',
  P.CHANNELS_START_STOP
);

export const CHANNEL_HALT = createOperation(
  'haltChannel',
  'Halt channel',
  P.CHANNELS_START_STOP
);

// ============================================================================
// Channel Statistics Operations
// ============================================================================

export const CHANNEL_STATS_GET = createOperation(
  'getStatistics',
  'Get statistics',
  P.DASHBOARD_VIEW
);

export const CHANNEL_STATS_GET_ALL = createOperation(
  'getAllStatistics',
  'Get all statistics',
  P.DASHBOARD_VIEW
);

export const CHANNEL_STATS_CLEAR = createOperation(
  'clearStatistics',
  'Clear statistics',
  P.CHANNELS_CLEAR_STATISTICS
);

export const CHANNEL_STATS_CLEAR_ALL = createOperation(
  'clearAllStatistics',
  'Clear all statistics',
  P.CHANNELS_CLEAR_STATISTICS
);

// ============================================================================
// Engine Operations (Deploy/Undeploy)
// ============================================================================

export const ENGINE_DEPLOY = createOperation(
  'deployChannels',
  'Deploy channels',
  P.CHANNELS_DEPLOY_UNDEPLOY
);

export const ENGINE_UNDEPLOY = createOperation(
  'undeployChannels',
  'Undeploy channels',
  P.CHANNELS_DEPLOY_UNDEPLOY
);

export const ENGINE_REDEPLOY_ALL = createOperation(
  'redeployAllChannels',
  'Redeploy all channels',
  P.CHANNELS_DEPLOY_UNDEPLOY
);

// ============================================================================
// Channel Group Operations
// ============================================================================

export const CHANNEL_GROUP_GET = createOperation(
  'getChannelGroups',
  'Get channel groups',
  P.CHANNEL_GROUPS_VIEW
);

export const CHANNEL_GROUP_UPDATE = createOperation(
  'updateChannelGroups',
  'Update channel groups',
  P.CHANNELS_MANAGE
);

// ============================================================================
// Message Operations
// ============================================================================

export const MESSAGE_GET = createOperation(
  'getMessageContent',
  'Get message content',
  P.MESSAGES_VIEW
);

export const MESSAGE_GET_COUNT = createOperation(
  'getMessageCount',
  'Get message count',
  P.MESSAGES_VIEW
);

export const MESSAGE_SEARCH = createOperation(
  'searchMessages',
  'Search messages',
  P.MESSAGES_VIEW
);

export const MESSAGE_GET_MAX_ID = createOperation(
  'getMaxMessageId',
  'Get max message ID',
  P.MESSAGES_VIEW
);

export const MESSAGE_REMOVE = createOperation(
  'removeMessages',
  'Remove messages',
  P.MESSAGES_REMOVE
);

export const MESSAGE_REMOVE_ALL = createOperation(
  'removeAllMessages',
  'Remove all messages',
  P.MESSAGES_REMOVE_ALL
);

export const MESSAGE_PROCESS = createOperation(
  'processMessage',
  'Process message',
  P.MESSAGES_PROCESS
);

export const MESSAGE_REPROCESS = createOperation(
  'reprocessMessages',
  'Reprocess messages',
  P.MESSAGES_REPROCESS
);

export const MESSAGE_IMPORT = createOperation(
  'importMessage',
  'Import message',
  P.MESSAGES_IMPORT
);

export const MESSAGE_EXPORT = createOperation(
  'exportMessage',
  'Export message',
  P.MESSAGES_EXPORT_SERVER
);

export const MESSAGE_GET_ATTACHMENT = createOperation(
  'getAttachment',
  'Get attachment',
  P.MESSAGES_VIEW
);

export const MESSAGE_CREATE_ATTACHMENT = createOperation(
  'createAttachment',
  'Create attachment',
  P.MESSAGES_IMPORT
);

export const MESSAGE_UPDATE_ATTACHMENT = createOperation(
  'updateAttachment',
  'Update attachment',
  P.MESSAGES_IMPORT
);

export const MESSAGE_DELETE_ATTACHMENT = createOperation(
  'deleteAttachment',
  'Delete attachment',
  P.MESSAGES_REMOVE
);

export const MESSAGE_IMPORT_MULTIPART = createOperation(
  'importMessageMultipart',
  'Import message (multipart)',
  P.MESSAGES_IMPORT
);

export const MESSAGE_EXPORT_ENCRYPTED = createOperation(
  'exportMessageEncrypted',
  'Export message (encrypted)',
  P.MESSAGES_EXPORT_SERVER
);

export const MESSAGE_REPROCESS_BULK = createOperation(
  'reprocessMessagesBulk',
  'Reprocess messages (bulk)',
  P.MESSAGES_REPROCESS
);

export const MESSAGE_GET_CONTENT = createOperation(
  'getMessageContent',
  'Get message content',
  P.MESSAGES_VIEW
);

export const MESSAGE_UPDATE_CONTENT = createOperation(
  'updateMessageContent',
  'Update message content',
  P.MESSAGES_IMPORT
);

export const MESSAGE_TRACE = createOperation(
  'traceMessage',
  'Trace message across channels',
  P.MESSAGES_VIEW
);

// ============================================================================
// Event Operations
// ============================================================================

export const EVENT_GET = createOperation('getEvent', 'Get event', P.EVENTS_VIEW);

export const EVENT_GET_MAX_ID = createOperation(
  'getMaxEventId',
  'Get max event ID',
  P.EVENTS_VIEW
);

export const EVENT_GET_COUNT = createOperation(
  'getEventCount',
  'Get event count',
  P.EVENTS_VIEW
);

export const EVENT_SEARCH = createOperation('getEvents', 'Get events', P.EVENTS_VIEW);

export const EVENT_EXPORT = createOperation(
  'exportAllEvents',
  'Export all events',
  P.EVENTS_VIEW
);

export const EVENT_REMOVE = createOperation(
  'removeAllEvents',
  'Remove all events',
  P.EVENTS_REMOVE
);

// ============================================================================
// Alert Operations
// ============================================================================

export const ALERT_GET = createOperation('getAlert', 'Get alert', P.ALERTS_VIEW);

export const ALERT_GET_ALL = createOperation('getAlerts', 'Get alerts', P.ALERTS_VIEW);

export const ALERT_GET_STATUS = createOperation(
  'getAlertStatusList',
  'Get alert status list',
  P.ALERTS_VIEW
);

export const ALERT_GET_INFO = createOperation(
  'getAlertInfo',
  'Get alert info',
  P.ALERTS_VIEW
);

export const ALERT_GET_OPTIONS = createOperation(
  'getAlertProtocolOptions',
  'Get alert protocol options',
  P.ALERTS_VIEW
);

export const ALERT_CREATE = createOperation('createAlert', 'Create alert', P.ALERTS_MANAGE);

export const ALERT_UPDATE = createOperation('updateAlert', 'Update alert', P.ALERTS_MANAGE);

export const ALERT_ENABLE = createOperation('enableAlert', 'Enable alert', P.ALERTS_MANAGE);

export const ALERT_DISABLE = createOperation(
  'disableAlert',
  'Disable alert',
  P.ALERTS_MANAGE
);

export const ALERT_REMOVE = createOperation('removeAlert', 'Remove alert', P.ALERTS_MANAGE);

// ============================================================================
// User Operations
// ============================================================================

export const USER_GET = createOperation('getUser', 'Get user', P.USERS_MANAGE);

export const USER_GET_ALL = createOperation('getAllUsers', 'Get all users', P.USERS_MANAGE);

export const USER_CREATE = createOperation('createUser', 'Create user', P.USERS_MANAGE);

export const USER_UPDATE = createOperation('updateUser', 'Update user', P.USERS_MANAGE);

export const USER_REMOVE = createOperation('removeUser', 'Remove user', P.USERS_MANAGE);

export const USER_CHECK_PASSWORD = createOperation(
  'checkUserPassword',
  'Check user password',
  P.USERS_MANAGE,
  { auditable: false }
);

export const USER_UPDATE_PASSWORD = createOperation(
  'updateUserPassword',
  'Update user password',
  P.USERS_MANAGE
);

export const USER_GET_PREFERENCES = createOperation(
  'getUserPreferences',
  'Get user preferences',
  P.USERS_MANAGE
);

export const USER_SET_PREFERENCES = createOperation(
  'setUserPreferences',
  'Set user preferences',
  P.USERS_MANAGE
);

export const USER_IS_LOGGED_IN = createOperation(
  'isUserLoggedIn',
  'Check if user is logged in',
  P.USERS_MANAGE
);

// Login/logout are not permission-gated (they're the authentication mechanism)
export const USER_LOGIN = createOperation('login', 'Login', '', { auditable: true });
export const USER_LOGOUT = createOperation('logout', 'Logout', '', { auditable: true });

// ============================================================================
// Configuration/Server Operations
// ============================================================================

export const CONFIG_GET_SERVER_ID = createOperation(
  'getServerId',
  'Get server ID',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_VERSION = createOperation(
  'getVersion',
  'Get version',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_BUILD_DATE = createOperation(
  'getBuildDate',
  'Get build date',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_STATUS = createOperation(
  'getStatus',
  'Get status',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_TIMEZONE = createOperation(
  'getServerTimezone',
  'Get server timezone',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_TIME = createOperation(
  'getServerTime',
  'Get server time',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_JVM = createOperation(
  'getJVMName',
  'Get JVM name',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_ABOUT = createOperation(
  'getAbout',
  'Get about info',
  P.SERVER_SETTINGS_VIEW,
  { auditable: false }
);

export const CONFIG_GET_SETTINGS = createOperation(
  'getServerSettings',
  'Get server settings',
  P.SERVER_SETTINGS_VIEW
);

export const CONFIG_SET_SETTINGS = createOperation(
  'setServerSettings',
  'Set server settings',
  P.SERVER_SETTINGS_EDIT
);

// ============================================================================
// Code Template Operations
// ============================================================================

export const CODE_TEMPLATE_GET = createOperation(
  'getCodeTemplate',
  'Get code template',
  P.CODE_TEMPLATES_VIEW
);

export const CODE_TEMPLATE_GET_ALL = createOperation(
  'getCodeTemplates',
  'Get code templates',
  P.CODE_TEMPLATES_VIEW
);

export const CODE_TEMPLATE_CREATE = createOperation(
  'createCodeTemplate',
  'Create code template',
  P.CODE_TEMPLATES_MANAGE
);

export const CODE_TEMPLATE_UPDATE = createOperation(
  'updateCodeTemplate',
  'Update code template',
  P.CODE_TEMPLATES_MANAGE
);

export const CODE_TEMPLATE_REMOVE = createOperation(
  'removeCodeTemplate',
  'Remove code template',
  P.CODE_TEMPLATES_MANAGE
);

export const CODE_TEMPLATE_LIBRARY_GET = createOperation(
  'getCodeTemplateLibrary',
  'Get code template library',
  P.CODE_TEMPLATES_VIEW
);

export const CODE_TEMPLATE_LIBRARY_GET_ALL = createOperation(
  'getCodeTemplateLibraries',
  'Get code template libraries',
  P.CODE_TEMPLATES_VIEW
);

export const CODE_TEMPLATE_LIBRARY_UPDATE = createOperation(
  'updateCodeTemplateLibraries',
  'Update code template libraries',
  P.CODE_TEMPLATES_MANAGE
);

// ============================================================================
// Extension Operations
// ============================================================================

export const EXTENSION_GET = createOperation(
  'getExtension',
  'Get extension',
  P.SERVER_SETTINGS_VIEW
);

export const EXTENSION_GET_ALL = createOperation(
  'getExtensions',
  'Get extensions',
  P.SERVER_SETTINGS_VIEW
);

export const EXTENSION_SET_ENABLED = createOperation(
  'setExtensionEnabled',
  'Set extension enabled',
  P.EXTENSIONS_MANAGE
);

export const EXTENSION_GET_PROPERTIES = createOperation(
  'getExtensionProperties',
  'Get extension properties',
  P.SERVER_SETTINGS_VIEW
);

export const EXTENSION_SET_PROPERTIES = createOperation(
  'setExtensionProperties',
  'Set extension properties',
  P.EXTENSIONS_MANAGE
);

// ============================================================================
// Database Task Operations
// ============================================================================

export const DATABASE_TASK_GET = createOperation(
  'getDatabaseTask',
  'Get database task',
  P.DATABASE_TASKS_VIEW
);

export const DATABASE_TASK_GET_ALL = createOperation(
  'getDatabaseTasks',
  'Get database tasks',
  P.DATABASE_TASKS_VIEW
);

export const DATABASE_TASK_RUN = createOperation(
  'runDatabaseTask',
  'Run database task',
  P.DATABASE_TASKS_MANAGE
);

export const DATABASE_TASK_CANCEL = createOperation(
  'cancelDatabaseTask',
  'Cancel database task',
  P.DATABASE_TASKS_MANAGE
);

// ============================================================================
// System Operations
// ============================================================================

export const SYSTEM_GET_INFO = createOperation(
  'getSystemInfo',
  'Get system info',
  P.SERVER_SETTINGS_VIEW
);

export const SYSTEM_GET_STATS = createOperation(
  'getSystemStats',
  'Get system stats',
  P.SERVER_SETTINGS_VIEW
);

// ============================================================================
// Usage Operations
// ============================================================================

export const USAGE_GET_DATA = createOperation(
  'getUsageData',
  'Get usage data',
  P.SERVER_SETTINGS_VIEW
);

// ============================================================================
// Operation Registry (for lookup by name)
// ============================================================================

const allOperations: Operation[] = [
  // Channels
  CHANNEL_GET_CHANNELS,
  CHANNEL_GET_CHANNEL,
  CHANNEL_GET_CHANNEL_SUMMARY,
  CHANNEL_CREATE,
  CHANNEL_UPDATE,
  CHANNEL_REMOVE,
  CHANNEL_GET_IDS_AND_NAMES,
  // Channel Status
  CHANNEL_STATUS_GET,
  CHANNEL_STATUS_GET_ALL,
  CHANNEL_STATUS_GET_INITIAL,
  CHANNEL_START,
  CHANNEL_STOP,
  CHANNEL_PAUSE,
  CHANNEL_RESUME,
  CHANNEL_HALT,
  // Channel Statistics
  CHANNEL_STATS_GET,
  CHANNEL_STATS_GET_ALL,
  CHANNEL_STATS_CLEAR,
  CHANNEL_STATS_CLEAR_ALL,
  // Engine
  ENGINE_DEPLOY,
  ENGINE_UNDEPLOY,
  ENGINE_REDEPLOY_ALL,
  // Channel Groups
  CHANNEL_GROUP_GET,
  CHANNEL_GROUP_UPDATE,
  // Messages
  MESSAGE_GET,
  MESSAGE_GET_COUNT,
  MESSAGE_SEARCH,
  MESSAGE_GET_MAX_ID,
  MESSAGE_REMOVE,
  MESSAGE_REMOVE_ALL,
  MESSAGE_PROCESS,
  MESSAGE_REPROCESS,
  MESSAGE_IMPORT,
  MESSAGE_EXPORT,
  MESSAGE_GET_ATTACHMENT,
  MESSAGE_CREATE_ATTACHMENT,
  MESSAGE_UPDATE_ATTACHMENT,
  MESSAGE_DELETE_ATTACHMENT,
  MESSAGE_IMPORT_MULTIPART,
  MESSAGE_EXPORT_ENCRYPTED,
  MESSAGE_REPROCESS_BULK,
  MESSAGE_GET_CONTENT,
  MESSAGE_UPDATE_CONTENT,
  MESSAGE_TRACE,
  // Events
  EVENT_GET,
  EVENT_GET_MAX_ID,
  EVENT_GET_COUNT,
  EVENT_SEARCH,
  EVENT_EXPORT,
  EVENT_REMOVE,
  // Alerts
  ALERT_GET,
  ALERT_GET_ALL,
  ALERT_GET_STATUS,
  ALERT_GET_INFO,
  ALERT_GET_OPTIONS,
  ALERT_CREATE,
  ALERT_UPDATE,
  ALERT_ENABLE,
  ALERT_DISABLE,
  ALERT_REMOVE,
  // Users
  USER_GET,
  USER_GET_ALL,
  USER_CREATE,
  USER_UPDATE,
  USER_REMOVE,
  USER_CHECK_PASSWORD,
  USER_UPDATE_PASSWORD,
  USER_GET_PREFERENCES,
  USER_SET_PREFERENCES,
  USER_IS_LOGGED_IN,
  USER_LOGIN,
  USER_LOGOUT,
  // Configuration
  CONFIG_GET_SERVER_ID,
  CONFIG_GET_VERSION,
  CONFIG_GET_BUILD_DATE,
  CONFIG_GET_STATUS,
  CONFIG_GET_TIMEZONE,
  CONFIG_GET_TIME,
  CONFIG_GET_JVM,
  CONFIG_GET_ABOUT,
  CONFIG_GET_SETTINGS,
  CONFIG_SET_SETTINGS,
  // Code Templates
  CODE_TEMPLATE_GET,
  CODE_TEMPLATE_GET_ALL,
  CODE_TEMPLATE_CREATE,
  CODE_TEMPLATE_UPDATE,
  CODE_TEMPLATE_REMOVE,
  CODE_TEMPLATE_LIBRARY_GET,
  CODE_TEMPLATE_LIBRARY_GET_ALL,
  CODE_TEMPLATE_LIBRARY_UPDATE,
  // Extensions
  EXTENSION_GET,
  EXTENSION_GET_ALL,
  EXTENSION_SET_ENABLED,
  EXTENSION_GET_PROPERTIES,
  EXTENSION_SET_PROPERTIES,
  // Database Tasks
  DATABASE_TASK_GET,
  DATABASE_TASK_GET_ALL,
  DATABASE_TASK_RUN,
  DATABASE_TASK_CANCEL,
  // System
  SYSTEM_GET_INFO,
  SYSTEM_GET_STATS,
  // Usage
  USAGE_GET_DATA,
];

const operationsByName = new Map<string, Operation>();
for (const op of allOperations) {
  operationsByName.set(op.name, op);
}

export function getOperationByName(name: string): Operation | undefined {
  return operationsByName.get(name);
}

export function getOperationsForPermission(permission: string): Operation[] {
  return allOperations.filter((op) => op.permission === permission);
}

export function getAllOperations(): Operation[] {
  return [...allOperations];
}
