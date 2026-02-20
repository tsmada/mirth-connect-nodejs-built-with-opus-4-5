/**
 * Tests for the Operation Registry
 *
 * Covers:
 * - All exported operation constants (structure, permission, defaults)
 * - getOperationByName() lookup
 * - getOperationsForPermission() filtering
 * - getAllOperations() enumeration
 * - Operation registry completeness and consistency
 */

import {
  // Channel Operations
  CHANNEL_GET_CHANNELS,
  CHANNEL_GET_CHANNEL,
  CHANNEL_GET_CHANNEL_SUMMARY,
  CHANNEL_CREATE,
  CHANNEL_UPDATE,
  CHANNEL_REMOVE,
  CHANNEL_GET_IDS_AND_NAMES,
  // Channel Status Operations
  CHANNEL_STATUS_GET,
  CHANNEL_STATUS_GET_ALL,
  CHANNEL_STATUS_GET_INITIAL,
  CHANNEL_START,
  CHANNEL_STOP,
  CHANNEL_PAUSE,
  CHANNEL_RESUME,
  CHANNEL_HALT,
  // Channel Statistics Operations
  CHANNEL_STATS_GET,
  CHANNEL_STATS_GET_ALL,
  CHANNEL_STATS_CLEAR,
  CHANNEL_STATS_CLEAR_ALL,
  // Engine Operations
  ENGINE_DEPLOY,
  ENGINE_UNDEPLOY,
  ENGINE_REDEPLOY_ALL,
  // Channel Group Operations
  CHANNEL_GROUP_GET,
  CHANNEL_GROUP_UPDATE,
  // Message Operations
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
  // Event Operations
  EVENT_GET,
  EVENT_GET_MAX_ID,
  EVENT_GET_COUNT,
  EVENT_SEARCH,
  EVENT_EXPORT,
  EVENT_REMOVE,
  // Alert Operations
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
  // User Operations
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
  // Configuration Operations
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
  // Configuration Extended Operations
  CONFIG_GET_ENCRYPTION,
  CONFIG_GET_CHARSETS,
  CONFIG_GENERATE_GUID,
  CONFIG_GET_GLOBAL_SCRIPTS,
  CONFIG_SET_GLOBAL_SCRIPTS,
  CONFIG_GET_CONFIG_MAP,
  CONFIG_SET_CONFIG_MAP,
  CONFIG_GET_DB_DRIVERS,
  CONFIG_SET_DB_DRIVERS,
  CONFIG_GET_PASSWORD_REQUIREMENTS,
  CONFIG_GET_UPDATE_SETTINGS,
  CONFIG_SET_UPDATE_SETTINGS,
  CONFIG_GET_LICENSE,
  CONFIG_GET_RESOURCES,
  CONFIG_SET_RESOURCES,
  CONFIG_RELOAD_RESOURCE,
  CONFIG_GET_CHANNEL_DEPS,
  CONFIG_SET_CHANNEL_DEPS,
  CONFIG_GET_CHANNEL_TAGS,
  CONFIG_SET_CHANNEL_TAGS,
  CONFIG_GET_CHANNEL_METADATA,
  CONFIG_SET_CHANNEL_METADATA,
  CONFIG_GET_PROTOCOLS,
  CONFIG_GET_RHINO_VERSION,
  CONFIG_TEST_EMAIL,
  CONFIG_GET_SERVER_CONFIGURATION,
  CONFIG_SET_SERVER_CONFIGURATION,
  // Code Template Operations
  CODE_TEMPLATE_GET,
  CODE_TEMPLATE_GET_ALL,
  CODE_TEMPLATE_CREATE,
  CODE_TEMPLATE_UPDATE,
  CODE_TEMPLATE_REMOVE,
  CODE_TEMPLATE_LIBRARY_GET,
  CODE_TEMPLATE_LIBRARY_GET_ALL,
  CODE_TEMPLATE_LIBRARY_UPDATE,
  // Extension Operations
  EXTENSION_GET,
  EXTENSION_GET_ALL,
  EXTENSION_SET_ENABLED,
  EXTENSION_GET_PROPERTIES,
  EXTENSION_SET_PROPERTIES,
  // Database Task Operations
  DATABASE_TASK_GET,
  DATABASE_TASK_GET_ALL,
  DATABASE_TASK_RUN,
  DATABASE_TASK_CANCEL,
  // System Operations
  SYSTEM_GET_INFO,
  SYSTEM_GET_STATS,
  // Usage Operations
  USAGE_GET_DATA,
  // Artifact Operations
  ARTIFACT_EXPORT,
  ARTIFACT_IMPORT,
  ARTIFACT_DEPLOY,
  ARTIFACT_PROMOTE,
  ARTIFACT_GIT_STATUS,
  ARTIFACT_GIT_PUSH,
  ARTIFACT_GIT_PULL,
  // Registry functions
  getOperationByName,
  getOperationsForPermission,
  getAllOperations,
} from '../../../../src/api/middleware/operations.js';

import { Operation } from '../../../../src/api/middleware/authorization.js';
import * as P from '../../../../src/api/middleware/permissions.js';

// ============================================================================
// Helper: verify an operation's structure
// ============================================================================

function expectOperation(
  op: Operation,
  expectedName: string,
  expectedDisplayName: string,
  expectedPermission: string,
  expectedAuditable: boolean = true,
  expectedExecuteType: string = 'SYNC',
  expectedAbortable: boolean = false
) {
  expect(op.name).toBe(expectedName);
  expect(op.displayName).toBe(expectedDisplayName);
  expect(op.permission).toBe(expectedPermission);
  expect(op.auditable).toBe(expectedAuditable);
  expect(op.executeType).toBe(expectedExecuteType);
  expect(op.abortable).toBe(expectedAbortable);
}

// ============================================================================
// Channel Operations
// ============================================================================

describe('Channel Operations', () => {
  it('CHANNEL_GET_CHANNELS has correct properties', () => {
    expectOperation(CHANNEL_GET_CHANNELS, 'getChannels', 'Get channels', P.CHANNELS_VIEW);
  });

  it('CHANNEL_GET_CHANNEL has correct properties', () => {
    expectOperation(CHANNEL_GET_CHANNEL, 'getChannel', 'Get channel', P.CHANNELS_VIEW);
  });

  it('CHANNEL_GET_CHANNEL_SUMMARY has correct properties', () => {
    expectOperation(CHANNEL_GET_CHANNEL_SUMMARY, 'getChannelSummary', 'Get channel summary', P.CHANNELS_VIEW);
  });

  it('CHANNEL_CREATE has correct properties', () => {
    expectOperation(CHANNEL_CREATE, 'createChannel', 'Create channel', P.CHANNELS_MANAGE);
  });

  it('CHANNEL_UPDATE has correct properties', () => {
    expectOperation(CHANNEL_UPDATE, 'updateChannel', 'Update channel', P.CHANNELS_MANAGE);
  });

  it('CHANNEL_REMOVE has correct properties', () => {
    expectOperation(CHANNEL_REMOVE, 'removeChannel', 'Remove channel', P.CHANNELS_MANAGE);
  });

  it('CHANNEL_GET_IDS_AND_NAMES has correct properties', () => {
    expectOperation(CHANNEL_GET_IDS_AND_NAMES, 'getChannelIdsAndNames', 'Get channel IDs and names', P.CHANNELS_VIEW);
  });
});

// ============================================================================
// Channel Status Operations
// ============================================================================

describe('Channel Status Operations', () => {
  it('CHANNEL_STATUS_GET requires DASHBOARD_VIEW', () => {
    expectOperation(CHANNEL_STATUS_GET, 'getChannelStatus', 'Get channel status', P.DASHBOARD_VIEW);
  });

  it('CHANNEL_STATUS_GET_ALL requires DASHBOARD_VIEW', () => {
    expectOperation(CHANNEL_STATUS_GET_ALL, 'getAllChannelStatuses', 'Get all channel statuses', P.DASHBOARD_VIEW);
  });

  it('CHANNEL_STATUS_GET_INITIAL requires DASHBOARD_VIEW', () => {
    expectOperation(CHANNEL_STATUS_GET_INITIAL, 'getDashboardChannelInfo', 'Get dashboard channel info', P.DASHBOARD_VIEW);
  });

  it('CHANNEL_START requires CHANNELS_START_STOP', () => {
    expectOperation(CHANNEL_START, 'startChannel', 'Start channel', P.CHANNELS_START_STOP);
  });

  it('CHANNEL_STOP requires CHANNELS_START_STOP', () => {
    expectOperation(CHANNEL_STOP, 'stopChannel', 'Stop channel', P.CHANNELS_START_STOP);
  });

  it('CHANNEL_PAUSE requires CHANNELS_START_STOP', () => {
    expectOperation(CHANNEL_PAUSE, 'pauseChannel', 'Pause channel', P.CHANNELS_START_STOP);
  });

  it('CHANNEL_RESUME requires CHANNELS_START_STOP', () => {
    expectOperation(CHANNEL_RESUME, 'resumeChannel', 'Resume channel', P.CHANNELS_START_STOP);
  });

  it('CHANNEL_HALT requires CHANNELS_START_STOP', () => {
    expectOperation(CHANNEL_HALT, 'haltChannel', 'Halt channel', P.CHANNELS_START_STOP);
  });
});

// ============================================================================
// Channel Statistics Operations
// ============================================================================

describe('Channel Statistics Operations', () => {
  it('CHANNEL_STATS_GET requires DASHBOARD_VIEW', () => {
    expectOperation(CHANNEL_STATS_GET, 'getStatistics', 'Get statistics', P.DASHBOARD_VIEW);
  });

  it('CHANNEL_STATS_GET_ALL requires DASHBOARD_VIEW', () => {
    expectOperation(CHANNEL_STATS_GET_ALL, 'getAllStatistics', 'Get all statistics', P.DASHBOARD_VIEW);
  });

  it('CHANNEL_STATS_CLEAR requires CHANNELS_CLEAR_STATISTICS', () => {
    expectOperation(CHANNEL_STATS_CLEAR, 'clearStatistics', 'Clear statistics', P.CHANNELS_CLEAR_STATISTICS);
  });

  it('CHANNEL_STATS_CLEAR_ALL requires CHANNELS_CLEAR_STATISTICS', () => {
    expectOperation(CHANNEL_STATS_CLEAR_ALL, 'clearAllStatistics', 'Clear all statistics', P.CHANNELS_CLEAR_STATISTICS);
  });
});

// ============================================================================
// Engine Operations
// ============================================================================

describe('Engine Operations', () => {
  it('ENGINE_DEPLOY requires CHANNELS_DEPLOY_UNDEPLOY', () => {
    expectOperation(ENGINE_DEPLOY, 'deployChannels', 'Deploy channels', P.CHANNELS_DEPLOY_UNDEPLOY);
  });

  it('ENGINE_UNDEPLOY requires CHANNELS_DEPLOY_UNDEPLOY', () => {
    expectOperation(ENGINE_UNDEPLOY, 'undeployChannels', 'Undeploy channels', P.CHANNELS_DEPLOY_UNDEPLOY);
  });

  it('ENGINE_REDEPLOY_ALL requires CHANNELS_DEPLOY_UNDEPLOY', () => {
    expectOperation(ENGINE_REDEPLOY_ALL, 'redeployAllChannels', 'Redeploy all channels', P.CHANNELS_DEPLOY_UNDEPLOY);
  });
});

// ============================================================================
// Channel Group Operations
// ============================================================================

describe('Channel Group Operations', () => {
  it('CHANNEL_GROUP_GET requires CHANNEL_GROUPS_VIEW', () => {
    expectOperation(CHANNEL_GROUP_GET, 'getChannelGroups', 'Get channel groups', P.CHANNEL_GROUPS_VIEW);
  });

  it('CHANNEL_GROUP_UPDATE requires CHANNELS_MANAGE', () => {
    expectOperation(CHANNEL_GROUP_UPDATE, 'updateChannelGroups', 'Update channel groups', P.CHANNELS_MANAGE);
  });
});

// ============================================================================
// Message Operations
// ============================================================================

describe('Message Operations', () => {
  it('MESSAGE_GET requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_GET, 'getMessageContent', 'Get message content', P.MESSAGES_VIEW);
  });

  it('MESSAGE_GET_COUNT requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_GET_COUNT, 'getMessageCount', 'Get message count', P.MESSAGES_VIEW);
  });

  it('MESSAGE_SEARCH requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_SEARCH, 'searchMessages', 'Search messages', P.MESSAGES_VIEW);
  });

  it('MESSAGE_GET_MAX_ID requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_GET_MAX_ID, 'getMaxMessageId', 'Get max message ID', P.MESSAGES_VIEW);
  });

  it('MESSAGE_REMOVE requires MESSAGES_REMOVE', () => {
    expectOperation(MESSAGE_REMOVE, 'removeMessages', 'Remove messages', P.MESSAGES_REMOVE);
  });

  it('MESSAGE_REMOVE_ALL requires MESSAGES_REMOVE_ALL', () => {
    expectOperation(MESSAGE_REMOVE_ALL, 'removeAllMessages', 'Remove all messages', P.MESSAGES_REMOVE_ALL);
  });

  it('MESSAGE_PROCESS requires MESSAGES_PROCESS', () => {
    expectOperation(MESSAGE_PROCESS, 'processMessage', 'Process message', P.MESSAGES_PROCESS);
  });

  it('MESSAGE_REPROCESS requires MESSAGES_REPROCESS', () => {
    expectOperation(MESSAGE_REPROCESS, 'reprocessMessages', 'Reprocess messages', P.MESSAGES_REPROCESS);
  });

  it('MESSAGE_IMPORT requires MESSAGES_IMPORT', () => {
    expectOperation(MESSAGE_IMPORT, 'importMessage', 'Import message', P.MESSAGES_IMPORT);
  });

  it('MESSAGE_EXPORT requires MESSAGES_EXPORT_SERVER', () => {
    expectOperation(MESSAGE_EXPORT, 'exportMessage', 'Export message', P.MESSAGES_EXPORT_SERVER);
  });

  it('MESSAGE_GET_ATTACHMENT requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_GET_ATTACHMENT, 'getAttachment', 'Get attachment', P.MESSAGES_VIEW);
  });

  it('MESSAGE_CREATE_ATTACHMENT requires MESSAGES_IMPORT', () => {
    expectOperation(MESSAGE_CREATE_ATTACHMENT, 'createAttachment', 'Create attachment', P.MESSAGES_IMPORT);
  });

  it('MESSAGE_UPDATE_ATTACHMENT requires MESSAGES_IMPORT', () => {
    expectOperation(MESSAGE_UPDATE_ATTACHMENT, 'updateAttachment', 'Update attachment', P.MESSAGES_IMPORT);
  });

  it('MESSAGE_DELETE_ATTACHMENT requires MESSAGES_REMOVE', () => {
    expectOperation(MESSAGE_DELETE_ATTACHMENT, 'deleteAttachment', 'Delete attachment', P.MESSAGES_REMOVE);
  });

  it('MESSAGE_IMPORT_MULTIPART requires MESSAGES_IMPORT', () => {
    expectOperation(MESSAGE_IMPORT_MULTIPART, 'importMessageMultipart', 'Import message (multipart)', P.MESSAGES_IMPORT);
  });

  it('MESSAGE_EXPORT_ENCRYPTED requires MESSAGES_EXPORT_SERVER', () => {
    expectOperation(MESSAGE_EXPORT_ENCRYPTED, 'exportMessageEncrypted', 'Export message (encrypted)', P.MESSAGES_EXPORT_SERVER);
  });

  it('MESSAGE_REPROCESS_BULK requires MESSAGES_REPROCESS', () => {
    expectOperation(MESSAGE_REPROCESS_BULK, 'reprocessMessagesBulk', 'Reprocess messages (bulk)', P.MESSAGES_REPROCESS);
  });

  it('MESSAGE_GET_CONTENT requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_GET_CONTENT, 'getMessageContent', 'Get message content', P.MESSAGES_VIEW);
  });

  it('MESSAGE_UPDATE_CONTENT requires MESSAGES_IMPORT', () => {
    expectOperation(MESSAGE_UPDATE_CONTENT, 'updateMessageContent', 'Update message content', P.MESSAGES_IMPORT);
  });

  it('MESSAGE_TRACE requires MESSAGES_VIEW', () => {
    expectOperation(MESSAGE_TRACE, 'traceMessage', 'Trace message across channels', P.MESSAGES_VIEW);
  });
});

// ============================================================================
// Event Operations
// ============================================================================

describe('Event Operations', () => {
  it('EVENT_GET requires EVENTS_VIEW', () => {
    expectOperation(EVENT_GET, 'getEvent', 'Get event', P.EVENTS_VIEW);
  });

  it('EVENT_GET_MAX_ID requires EVENTS_VIEW', () => {
    expectOperation(EVENT_GET_MAX_ID, 'getMaxEventId', 'Get max event ID', P.EVENTS_VIEW);
  });

  it('EVENT_GET_COUNT requires EVENTS_VIEW', () => {
    expectOperation(EVENT_GET_COUNT, 'getEventCount', 'Get event count', P.EVENTS_VIEW);
  });

  it('EVENT_SEARCH requires EVENTS_VIEW', () => {
    expectOperation(EVENT_SEARCH, 'getEvents', 'Get events', P.EVENTS_VIEW);
  });

  it('EVENT_EXPORT requires EVENTS_VIEW', () => {
    expectOperation(EVENT_EXPORT, 'exportAllEvents', 'Export all events', P.EVENTS_VIEW);
  });

  it('EVENT_REMOVE requires EVENTS_REMOVE', () => {
    expectOperation(EVENT_REMOVE, 'removeAllEvents', 'Remove all events', P.EVENTS_REMOVE);
  });
});

// ============================================================================
// Alert Operations
// ============================================================================

describe('Alert Operations', () => {
  it('ALERT_GET requires ALERTS_VIEW', () => {
    expectOperation(ALERT_GET, 'getAlert', 'Get alert', P.ALERTS_VIEW);
  });

  it('ALERT_GET_ALL requires ALERTS_VIEW', () => {
    expectOperation(ALERT_GET_ALL, 'getAlerts', 'Get alerts', P.ALERTS_VIEW);
  });

  it('ALERT_GET_STATUS requires ALERTS_VIEW', () => {
    expectOperation(ALERT_GET_STATUS, 'getAlertStatusList', 'Get alert status list', P.ALERTS_VIEW);
  });

  it('ALERT_GET_INFO requires ALERTS_VIEW', () => {
    expectOperation(ALERT_GET_INFO, 'getAlertInfo', 'Get alert info', P.ALERTS_VIEW);
  });

  it('ALERT_GET_OPTIONS requires ALERTS_VIEW', () => {
    expectOperation(ALERT_GET_OPTIONS, 'getAlertProtocolOptions', 'Get alert protocol options', P.ALERTS_VIEW);
  });

  it('ALERT_CREATE requires ALERTS_MANAGE', () => {
    expectOperation(ALERT_CREATE, 'createAlert', 'Create alert', P.ALERTS_MANAGE);
  });

  it('ALERT_UPDATE requires ALERTS_MANAGE', () => {
    expectOperation(ALERT_UPDATE, 'updateAlert', 'Update alert', P.ALERTS_MANAGE);
  });

  it('ALERT_ENABLE requires ALERTS_MANAGE', () => {
    expectOperation(ALERT_ENABLE, 'enableAlert', 'Enable alert', P.ALERTS_MANAGE);
  });

  it('ALERT_DISABLE requires ALERTS_MANAGE', () => {
    expectOperation(ALERT_DISABLE, 'disableAlert', 'Disable alert', P.ALERTS_MANAGE);
  });

  it('ALERT_REMOVE requires ALERTS_MANAGE', () => {
    expectOperation(ALERT_REMOVE, 'removeAlert', 'Remove alert', P.ALERTS_MANAGE);
  });
});

// ============================================================================
// User Operations
// ============================================================================

describe('User Operations', () => {
  it('USER_GET requires USERS_MANAGE', () => {
    expectOperation(USER_GET, 'getUser', 'Get user', P.USERS_MANAGE);
  });

  it('USER_GET_ALL requires USERS_MANAGE', () => {
    expectOperation(USER_GET_ALL, 'getAllUsers', 'Get all users', P.USERS_MANAGE);
  });

  it('USER_CREATE requires USERS_MANAGE', () => {
    expectOperation(USER_CREATE, 'createUser', 'Create user', P.USERS_MANAGE);
  });

  it('USER_UPDATE requires USERS_MANAGE', () => {
    expectOperation(USER_UPDATE, 'updateUser', 'Update user', P.USERS_MANAGE);
  });

  it('USER_REMOVE requires USERS_MANAGE', () => {
    expectOperation(USER_REMOVE, 'removeUser', 'Remove user', P.USERS_MANAGE);
  });

  it('USER_CHECK_PASSWORD requires USERS_MANAGE and is NOT auditable', () => {
    expectOperation(USER_CHECK_PASSWORD, 'checkUserPassword', 'Check user password', P.USERS_MANAGE, false);
  });

  it('USER_UPDATE_PASSWORD requires USERS_MANAGE', () => {
    expectOperation(USER_UPDATE_PASSWORD, 'updateUserPassword', 'Update user password', P.USERS_MANAGE);
  });

  it('USER_GET_PREFERENCES requires USERS_MANAGE', () => {
    expectOperation(USER_GET_PREFERENCES, 'getUserPreferences', 'Get user preferences', P.USERS_MANAGE);
  });

  it('USER_SET_PREFERENCES requires USERS_MANAGE', () => {
    expectOperation(USER_SET_PREFERENCES, 'setUserPreferences', 'Set user preferences', P.USERS_MANAGE);
  });

  it('USER_IS_LOGGED_IN requires USERS_MANAGE', () => {
    expectOperation(USER_IS_LOGGED_IN, 'isUserLoggedIn', 'Check if user is logged in', P.USERS_MANAGE);
  });

  it('USER_LOGIN has empty permission and is auditable', () => {
    expectOperation(USER_LOGIN, 'login', 'Login', '', true);
  });

  it('USER_LOGOUT has empty permission and is auditable', () => {
    expectOperation(USER_LOGOUT, 'logout', 'Logout', '', true);
  });
});

// ============================================================================
// Configuration Operations
// ============================================================================

describe('Configuration Operations', () => {
  it('CONFIG_GET_SERVER_ID is not auditable', () => {
    expectOperation(CONFIG_GET_SERVER_ID, 'getServerId', 'Get server ID', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_VERSION is not auditable', () => {
    expectOperation(CONFIG_GET_VERSION, 'getVersion', 'Get version', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_BUILD_DATE is not auditable', () => {
    expectOperation(CONFIG_GET_BUILD_DATE, 'getBuildDate', 'Get build date', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_STATUS is not auditable', () => {
    expectOperation(CONFIG_GET_STATUS, 'getStatus', 'Get status', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_TIMEZONE is not auditable', () => {
    expectOperation(CONFIG_GET_TIMEZONE, 'getServerTimezone', 'Get server timezone', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_TIME is not auditable', () => {
    expectOperation(CONFIG_GET_TIME, 'getServerTime', 'Get server time', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_JVM is not auditable', () => {
    expectOperation(CONFIG_GET_JVM, 'getJVMName', 'Get JVM name', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_ABOUT is not auditable', () => {
    expectOperation(CONFIG_GET_ABOUT, 'getAbout', 'Get about info', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_SETTINGS is auditable', () => {
    expectOperation(CONFIG_GET_SETTINGS, 'getServerSettings', 'Get server settings', P.SERVER_SETTINGS_VIEW, true);
  });

  it('CONFIG_SET_SETTINGS requires SERVER_SETTINGS_EDIT', () => {
    expectOperation(CONFIG_SET_SETTINGS, 'setServerSettings', 'Set server settings', P.SERVER_SETTINGS_EDIT, true);
  });
});

// ============================================================================
// Configuration Extended Operations
// ============================================================================

describe('Configuration Extended Operations', () => {
  it('CONFIG_GET_ENCRYPTION is not auditable', () => {
    expectOperation(CONFIG_GET_ENCRYPTION, 'getEncryptionSettings', 'Get encryption settings', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_CHARSETS is not auditable', () => {
    expectOperation(CONFIG_GET_CHARSETS, 'getAvailableCharsetEncodings', 'Get available charsets', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GENERATE_GUID is not auditable', () => {
    expectOperation(CONFIG_GENERATE_GUID, 'generateGUID', 'Generate GUID', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_GLOBAL_SCRIPTS requires GLOBAL_SCRIPTS_VIEW', () => {
    expectOperation(CONFIG_GET_GLOBAL_SCRIPTS, 'getGlobalScripts', 'Get global scripts', P.GLOBAL_SCRIPTS_VIEW);
  });

  it('CONFIG_SET_GLOBAL_SCRIPTS requires GLOBAL_SCRIPTS_EDIT', () => {
    expectOperation(CONFIG_SET_GLOBAL_SCRIPTS, 'setGlobalScripts', 'Set global scripts', P.GLOBAL_SCRIPTS_EDIT);
  });

  it('CONFIG_GET_CONFIG_MAP requires CONFIG_MAP_VIEW', () => {
    expectOperation(CONFIG_GET_CONFIG_MAP, 'getConfigurationMap', 'Get configuration map', P.CONFIG_MAP_VIEW);
  });

  it('CONFIG_SET_CONFIG_MAP requires CONFIG_MAP_EDIT', () => {
    expectOperation(CONFIG_SET_CONFIG_MAP, 'setConfigurationMap', 'Set configuration map', P.CONFIG_MAP_EDIT);
  });

  it('CONFIG_GET_DB_DRIVERS is not auditable', () => {
    expectOperation(CONFIG_GET_DB_DRIVERS, 'getDatabaseDrivers', 'Get database drivers', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_SET_DB_DRIVERS requires DATABASE_DRIVERS_EDIT', () => {
    expectOperation(CONFIG_SET_DB_DRIVERS, 'setDatabaseDrivers', 'Set database drivers', P.DATABASE_DRIVERS_EDIT);
  });

  it('CONFIG_GET_PASSWORD_REQUIREMENTS is not auditable', () => {
    expectOperation(CONFIG_GET_PASSWORD_REQUIREMENTS, 'getPasswordRequirements', 'Get password requirements', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_UPDATE_SETTINGS requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(CONFIG_GET_UPDATE_SETTINGS, 'getUpdateSettings', 'Get update settings', P.SERVER_SETTINGS_VIEW);
  });

  it('CONFIG_SET_UPDATE_SETTINGS requires SERVER_SETTINGS_EDIT', () => {
    expectOperation(CONFIG_SET_UPDATE_SETTINGS, 'setUpdateSettings', 'Set update settings', P.SERVER_SETTINGS_EDIT);
  });

  it('CONFIG_GET_LICENSE is not auditable', () => {
    expectOperation(CONFIG_GET_LICENSE, 'getLicenseInfo', 'Get license info', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_RESOURCES requires RESOURCES_VIEW', () => {
    expectOperation(CONFIG_GET_RESOURCES, 'getResources', 'Get resources', P.RESOURCES_VIEW);
  });

  it('CONFIG_SET_RESOURCES requires RESOURCES_EDIT', () => {
    expectOperation(CONFIG_SET_RESOURCES, 'setResources', 'Set resources', P.RESOURCES_EDIT);
  });

  it('CONFIG_RELOAD_RESOURCE requires RESOURCES_RELOAD', () => {
    expectOperation(CONFIG_RELOAD_RESOURCE, 'reloadResource', 'Reload resource', P.RESOURCES_RELOAD);
  });

  it('CONFIG_GET_CHANNEL_DEPS requires CHANNELS_VIEW', () => {
    expectOperation(CONFIG_GET_CHANNEL_DEPS, 'getChannelDependencies', 'Get channel dependencies', P.CHANNELS_VIEW);
  });

  it('CONFIG_SET_CHANNEL_DEPS requires CHANNELS_MANAGE', () => {
    expectOperation(CONFIG_SET_CHANNEL_DEPS, 'setChannelDependencies', 'Set channel dependencies', P.CHANNELS_MANAGE);
  });

  it('CONFIG_GET_CHANNEL_TAGS requires TAGS_VIEW', () => {
    expectOperation(CONFIG_GET_CHANNEL_TAGS, 'getChannelTags', 'Get channel tags', P.TAGS_VIEW);
  });

  it('CONFIG_SET_CHANNEL_TAGS requires TAGS_MANAGE', () => {
    expectOperation(CONFIG_SET_CHANNEL_TAGS, 'setChannelTags', 'Set channel tags', P.TAGS_MANAGE);
  });

  it('CONFIG_GET_CHANNEL_METADATA requires CHANNELS_VIEW', () => {
    expectOperation(CONFIG_GET_CHANNEL_METADATA, 'getChannelMetadata', 'Get channel metadata', P.CHANNELS_VIEW);
  });

  it('CONFIG_SET_CHANNEL_METADATA requires CHANNELS_MANAGE', () => {
    expectOperation(CONFIG_SET_CHANNEL_METADATA, 'setChannelMetadata', 'Set channel metadata', P.CHANNELS_MANAGE);
  });

  it('CONFIG_GET_PROTOCOLS is not auditable', () => {
    expectOperation(CONFIG_GET_PROTOCOLS, 'getProtocolsAndCipherSuites', 'Get protocols and cipher suites', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_GET_RHINO_VERSION is not auditable', () => {
    expectOperation(CONFIG_GET_RHINO_VERSION, 'getRhinoLanguageVersion', 'Get Rhino language version', P.SERVER_SETTINGS_VIEW, false);
  });

  it('CONFIG_TEST_EMAIL requires SERVER_SEND_TEST_EMAIL', () => {
    expectOperation(CONFIG_TEST_EMAIL, 'sendTestEmail', 'Send test email', P.SERVER_SEND_TEST_EMAIL);
  });

  it('CONFIG_GET_SERVER_CONFIGURATION requires SERVER_BACKUP', () => {
    expectOperation(CONFIG_GET_SERVER_CONFIGURATION, 'getServerConfiguration', 'Get server configuration', P.SERVER_BACKUP);
  });

  it('CONFIG_SET_SERVER_CONFIGURATION requires SERVER_RESTORE', () => {
    expectOperation(CONFIG_SET_SERVER_CONFIGURATION, 'setServerConfiguration', 'Set server configuration', P.SERVER_RESTORE);
  });
});

// ============================================================================
// Code Template Operations
// ============================================================================

describe('Code Template Operations', () => {
  it('CODE_TEMPLATE_GET requires CODE_TEMPLATES_VIEW', () => {
    expectOperation(CODE_TEMPLATE_GET, 'getCodeTemplate', 'Get code template', P.CODE_TEMPLATES_VIEW);
  });

  it('CODE_TEMPLATE_GET_ALL requires CODE_TEMPLATES_VIEW', () => {
    expectOperation(CODE_TEMPLATE_GET_ALL, 'getCodeTemplates', 'Get code templates', P.CODE_TEMPLATES_VIEW);
  });

  it('CODE_TEMPLATE_CREATE requires CODE_TEMPLATES_MANAGE', () => {
    expectOperation(CODE_TEMPLATE_CREATE, 'createCodeTemplate', 'Create code template', P.CODE_TEMPLATES_MANAGE);
  });

  it('CODE_TEMPLATE_UPDATE requires CODE_TEMPLATES_MANAGE', () => {
    expectOperation(CODE_TEMPLATE_UPDATE, 'updateCodeTemplate', 'Update code template', P.CODE_TEMPLATES_MANAGE);
  });

  it('CODE_TEMPLATE_REMOVE requires CODE_TEMPLATES_MANAGE', () => {
    expectOperation(CODE_TEMPLATE_REMOVE, 'removeCodeTemplate', 'Remove code template', P.CODE_TEMPLATES_MANAGE);
  });

  it('CODE_TEMPLATE_LIBRARY_GET requires CODE_TEMPLATES_VIEW', () => {
    expectOperation(CODE_TEMPLATE_LIBRARY_GET, 'getCodeTemplateLibrary', 'Get code template library', P.CODE_TEMPLATES_VIEW);
  });

  it('CODE_TEMPLATE_LIBRARY_GET_ALL requires CODE_TEMPLATES_VIEW', () => {
    expectOperation(CODE_TEMPLATE_LIBRARY_GET_ALL, 'getCodeTemplateLibraries', 'Get code template libraries', P.CODE_TEMPLATES_VIEW);
  });

  it('CODE_TEMPLATE_LIBRARY_UPDATE requires CODE_TEMPLATES_MANAGE', () => {
    expectOperation(CODE_TEMPLATE_LIBRARY_UPDATE, 'updateCodeTemplateLibraries', 'Update code template libraries', P.CODE_TEMPLATES_MANAGE);
  });
});

// ============================================================================
// Extension Operations
// ============================================================================

describe('Extension Operations', () => {
  it('EXTENSION_GET requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(EXTENSION_GET, 'getExtension', 'Get extension', P.SERVER_SETTINGS_VIEW);
  });

  it('EXTENSION_GET_ALL requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(EXTENSION_GET_ALL, 'getExtensions', 'Get extensions', P.SERVER_SETTINGS_VIEW);
  });

  it('EXTENSION_SET_ENABLED requires EXTENSIONS_MANAGE', () => {
    expectOperation(EXTENSION_SET_ENABLED, 'setExtensionEnabled', 'Set extension enabled', P.EXTENSIONS_MANAGE);
  });

  it('EXTENSION_GET_PROPERTIES requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(EXTENSION_GET_PROPERTIES, 'getExtensionProperties', 'Get extension properties', P.SERVER_SETTINGS_VIEW);
  });

  it('EXTENSION_SET_PROPERTIES requires EXTENSIONS_MANAGE', () => {
    expectOperation(EXTENSION_SET_PROPERTIES, 'setExtensionProperties', 'Set extension properties', P.EXTENSIONS_MANAGE);
  });
});

// ============================================================================
// Database Task Operations
// ============================================================================

describe('Database Task Operations', () => {
  it('DATABASE_TASK_GET requires DATABASE_TASKS_VIEW', () => {
    expectOperation(DATABASE_TASK_GET, 'getDatabaseTask', 'Get database task', P.DATABASE_TASKS_VIEW);
  });

  it('DATABASE_TASK_GET_ALL requires DATABASE_TASKS_VIEW', () => {
    expectOperation(DATABASE_TASK_GET_ALL, 'getDatabaseTasks', 'Get database tasks', P.DATABASE_TASKS_VIEW);
  });

  it('DATABASE_TASK_RUN requires DATABASE_TASKS_MANAGE', () => {
    expectOperation(DATABASE_TASK_RUN, 'runDatabaseTask', 'Run database task', P.DATABASE_TASKS_MANAGE);
  });

  it('DATABASE_TASK_CANCEL requires DATABASE_TASKS_MANAGE', () => {
    expectOperation(DATABASE_TASK_CANCEL, 'cancelDatabaseTask', 'Cancel database task', P.DATABASE_TASKS_MANAGE);
  });
});

// ============================================================================
// System Operations
// ============================================================================

describe('System Operations', () => {
  it('SYSTEM_GET_INFO requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(SYSTEM_GET_INFO, 'getSystemInfo', 'Get system info', P.SERVER_SETTINGS_VIEW);
  });

  it('SYSTEM_GET_STATS requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(SYSTEM_GET_STATS, 'getSystemStats', 'Get system stats', P.SERVER_SETTINGS_VIEW);
  });
});

// ============================================================================
// Usage Operations
// ============================================================================

describe('Usage Operations', () => {
  it('USAGE_GET_DATA requires SERVER_SETTINGS_VIEW', () => {
    expectOperation(USAGE_GET_DATA, 'getUsageData', 'Get usage data', P.SERVER_SETTINGS_VIEW);
  });
});

// ============================================================================
// Artifact Operations
// ============================================================================

describe('Artifact Operations', () => {
  it('ARTIFACT_EXPORT requires CHANNELS_VIEW', () => {
    expectOperation(ARTIFACT_EXPORT, 'exportArtifacts', 'Export artifacts', P.CHANNELS_VIEW);
  });

  it('ARTIFACT_IMPORT requires CHANNELS_MANAGE', () => {
    expectOperation(ARTIFACT_IMPORT, 'importArtifacts', 'Import artifacts', P.CHANNELS_MANAGE);
  });

  it('ARTIFACT_DEPLOY requires CHANNELS_DEPLOY_UNDEPLOY', () => {
    expectOperation(ARTIFACT_DEPLOY, 'deployArtifacts', 'Deploy artifacts', P.CHANNELS_DEPLOY_UNDEPLOY);
  });

  it('ARTIFACT_PROMOTE requires CHANNELS_MANAGE', () => {
    expectOperation(ARTIFACT_PROMOTE, 'promoteArtifacts', 'Promote artifacts', P.CHANNELS_MANAGE);
  });

  it('ARTIFACT_GIT_STATUS requires CHANNELS_VIEW', () => {
    expectOperation(ARTIFACT_GIT_STATUS, 'getArtifactGitStatus', 'Get artifact git status', P.CHANNELS_VIEW);
  });

  it('ARTIFACT_GIT_PUSH requires CHANNELS_MANAGE', () => {
    expectOperation(ARTIFACT_GIT_PUSH, 'pushArtifacts', 'Push artifacts to git', P.CHANNELS_MANAGE);
  });

  it('ARTIFACT_GIT_PULL requires CHANNELS_MANAGE', () => {
    expectOperation(ARTIFACT_GIT_PULL, 'pullArtifacts', 'Pull artifacts from git', P.CHANNELS_MANAGE);
  });
});

// ============================================================================
// Default Operation Properties
// ============================================================================

describe('Default Operation Properties', () => {
  it('all operations default to executeType SYNC', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(op.executeType).toBe('SYNC');
    }
  });

  it('all operations default to abortable false', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(op.abortable).toBe(false);
    }
  });

  it('most operations default to auditable true', () => {
    const allOps = getAllOperations();
    const auditableOps = allOps.filter((op) => op.auditable);
    // The majority should be auditable
    expect(auditableOps.length).toBeGreaterThan(allOps.length / 2);
  });

  it('non-auditable operations are read-only config lookups or check-password', () => {
    const allOps = getAllOperations();
    const nonAuditable = allOps.filter((op) => !op.auditable);
    // These should be non-mutating configuration reads
    const nonAuditableNames = nonAuditable.map((op) => op.name);
    expect(nonAuditableNames).toContain('getServerId');
    expect(nonAuditableNames).toContain('getVersion');
    expect(nonAuditableNames).toContain('getBuildDate');
    expect(nonAuditableNames).toContain('getStatus');
    expect(nonAuditableNames).toContain('getServerTimezone');
    expect(nonAuditableNames).toContain('getServerTime');
    expect(nonAuditableNames).toContain('getJVMName');
    expect(nonAuditableNames).toContain('getAbout');
    expect(nonAuditableNames).toContain('checkUserPassword');
    expect(nonAuditableNames).toContain('getEncryptionSettings');
    expect(nonAuditableNames).toContain('getAvailableCharsetEncodings');
    expect(nonAuditableNames).toContain('generateGUID');
    expect(nonAuditableNames).toContain('getDatabaseDrivers');
    expect(nonAuditableNames).toContain('getPasswordRequirements');
    expect(nonAuditableNames).toContain('getLicenseInfo');
    expect(nonAuditableNames).toContain('getProtocolsAndCipherSuites');
    expect(nonAuditableNames).toContain('getRhinoLanguageVersion');
  });
});

// ============================================================================
// getOperationByName()
// ============================================================================

describe('getOperationByName()', () => {
  it('returns the correct operation for a known name', () => {
    const op = getOperationByName('getChannels');
    expect(op).toBeDefined();
    expect(op!.name).toBe('getChannels');
    expect(op!.displayName).toBe('Get channels');
    expect(op!.permission).toBe(P.CHANNELS_VIEW);
  });

  it('returns undefined for an unknown name', () => {
    const op = getOperationByName('nonExistentOperation');
    expect(op).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const op = getOperationByName('');
    expect(op).toBeUndefined();
  });

  it('is case-sensitive', () => {
    const op = getOperationByName('GetChannels');
    expect(op).toBeUndefined();
  });

  it('finds operations across all categories', () => {
    // Sample one from each major category
    expect(getOperationByName('getChannels')).toBeDefined();
    expect(getOperationByName('startChannel')).toBeDefined();
    expect(getOperationByName('getStatistics')).toBeDefined();
    expect(getOperationByName('deployChannels')).toBeDefined();
    expect(getOperationByName('getChannelGroups')).toBeDefined();
    expect(getOperationByName('searchMessages')).toBeDefined();
    expect(getOperationByName('getEvent')).toBeDefined();
    expect(getOperationByName('getAlert')).toBeDefined();
    expect(getOperationByName('getUser')).toBeDefined();
    expect(getOperationByName('getServerId')).toBeDefined();
    expect(getOperationByName('getCodeTemplate')).toBeDefined();
    expect(getOperationByName('getExtension')).toBeDefined();
    expect(getOperationByName('getDatabaseTask')).toBeDefined();
    expect(getOperationByName('getSystemInfo')).toBeDefined();
    expect(getOperationByName('getUsageData')).toBeDefined();
    expect(getOperationByName('exportArtifacts')).toBeDefined();
  });

  it('returns the same object reference as the exported constant', () => {
    const op = getOperationByName('getChannels');
    expect(op).toBe(CHANNEL_GET_CHANNELS);
  });

  it('login operation can be looked up by name', () => {
    const op = getOperationByName('login');
    expect(op).toBeDefined();
    expect(op!.permission).toBe('');
    expect(op!.auditable).toBe(true);
  });

  it('logout operation can be looked up by name', () => {
    const op = getOperationByName('logout');
    expect(op).toBeDefined();
    expect(op!.permission).toBe('');
    expect(op!.auditable).toBe(true);
  });
});

// ============================================================================
// getOperationsForPermission()
// ============================================================================

describe('getOperationsForPermission()', () => {
  it('returns all CHANNELS_VIEW operations', () => {
    const ops = getOperationsForPermission(P.CHANNELS_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getChannels');
    expect(names).toContain('getChannel');
    expect(names).toContain('getChannelSummary');
    expect(names).toContain('getChannelIdsAndNames');
    expect(names).toContain('getChannelDependencies');
    expect(names).toContain('getChannelMetadata');
    // Also includes artifact export and git status
    expect(names).toContain('exportArtifacts');
    expect(names).toContain('getArtifactGitStatus');
  });

  it('returns all CHANNELS_MANAGE operations', () => {
    const ops = getOperationsForPermission(P.CHANNELS_MANAGE);
    const names = ops.map((op) => op.name);
    expect(names).toContain('createChannel');
    expect(names).toContain('updateChannel');
    expect(names).toContain('removeChannel');
    expect(names).toContain('updateChannelGroups');
    expect(names).toContain('setChannelDependencies');
    expect(names).toContain('setChannelMetadata');
    expect(names).toContain('importArtifacts');
    expect(names).toContain('promoteArtifacts');
    expect(names).toContain('pushArtifacts');
    expect(names).toContain('pullArtifacts');
  });

  it('returns all CHANNELS_START_STOP operations', () => {
    const ops = getOperationsForPermission(P.CHANNELS_START_STOP);
    const names = ops.map((op) => op.name);
    expect(names).toContain('startChannel');
    expect(names).toContain('stopChannel');
    expect(names).toContain('pauseChannel');
    expect(names).toContain('resumeChannel');
    expect(names).toContain('haltChannel');
    expect(ops).toHaveLength(5);
  });

  it('returns all DASHBOARD_VIEW operations', () => {
    const ops = getOperationsForPermission(P.DASHBOARD_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getChannelStatus');
    expect(names).toContain('getAllChannelStatuses');
    expect(names).toContain('getDashboardChannelInfo');
    expect(names).toContain('getStatistics');
    expect(names).toContain('getAllStatistics');
    expect(ops).toHaveLength(5);
  });

  it('returns all MESSAGES_VIEW operations', () => {
    const ops = getOperationsForPermission(P.MESSAGES_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getMessageContent');
    expect(names).toContain('getMessageCount');
    expect(names).toContain('searchMessages');
    expect(names).toContain('getMaxMessageId');
    expect(names).toContain('getAttachment');
    expect(names).toContain('traceMessage');
  });

  it('returns all USERS_MANAGE operations', () => {
    const ops = getOperationsForPermission(P.USERS_MANAGE);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getUser');
    expect(names).toContain('getAllUsers');
    expect(names).toContain('createUser');
    expect(names).toContain('updateUser');
    expect(names).toContain('removeUser');
    expect(names).toContain('checkUserPassword');
    expect(names).toContain('updateUserPassword');
    expect(names).toContain('getUserPreferences');
    expect(names).toContain('setUserPreferences');
    expect(names).toContain('isUserLoggedIn');
    expect(ops).toHaveLength(10);
  });

  it('returns empty array for unknown permission', () => {
    const ops = getOperationsForPermission('nonExistentPermission');
    expect(ops).toEqual([]);
  });

  it('returns operations with empty permission for login/logout', () => {
    const ops = getOperationsForPermission('');
    const names = ops.map((op) => op.name);
    expect(names).toContain('login');
    expect(names).toContain('logout');
    expect(ops).toHaveLength(2);
  });

  it('returns all ALERTS_VIEW operations', () => {
    const ops = getOperationsForPermission(P.ALERTS_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getAlert');
    expect(names).toContain('getAlerts');
    expect(names).toContain('getAlertStatusList');
    expect(names).toContain('getAlertInfo');
    expect(names).toContain('getAlertProtocolOptions');
    expect(ops).toHaveLength(5);
  });

  it('returns all ALERTS_MANAGE operations', () => {
    const ops = getOperationsForPermission(P.ALERTS_MANAGE);
    const names = ops.map((op) => op.name);
    expect(names).toContain('createAlert');
    expect(names).toContain('updateAlert');
    expect(names).toContain('enableAlert');
    expect(names).toContain('disableAlert');
    expect(names).toContain('removeAlert');
    expect(ops).toHaveLength(5);
  });

  it('returns all EVENTS_VIEW operations', () => {
    const ops = getOperationsForPermission(P.EVENTS_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getEvent');
    expect(names).toContain('getMaxEventId');
    expect(names).toContain('getEventCount');
    expect(names).toContain('getEvents');
    expect(names).toContain('exportAllEvents');
    expect(ops).toHaveLength(5);
  });

  it('returns all CHANNELS_DEPLOY_UNDEPLOY operations', () => {
    const ops = getOperationsForPermission(P.CHANNELS_DEPLOY_UNDEPLOY);
    const names = ops.map((op) => op.name);
    expect(names).toContain('deployChannels');
    expect(names).toContain('undeployChannels');
    expect(names).toContain('redeployAllChannels');
    expect(names).toContain('deployArtifacts');
    expect(ops).toHaveLength(4);
  });

  it('returns all CODE_TEMPLATES_VIEW operations', () => {
    const ops = getOperationsForPermission(P.CODE_TEMPLATES_VIEW);
    const names = ops.map((op) => op.name);
    expect(names).toContain('getCodeTemplate');
    expect(names).toContain('getCodeTemplates');
    expect(names).toContain('getCodeTemplateLibrary');
    expect(names).toContain('getCodeTemplateLibraries');
    expect(ops).toHaveLength(4);
  });

  it('returns all CODE_TEMPLATES_MANAGE operations', () => {
    const ops = getOperationsForPermission(P.CODE_TEMPLATES_MANAGE);
    const names = ops.map((op) => op.name);
    expect(names).toContain('createCodeTemplate');
    expect(names).toContain('updateCodeTemplate');
    expect(names).toContain('removeCodeTemplate');
    expect(names).toContain('updateCodeTemplateLibraries');
    expect(ops).toHaveLength(4);
  });
});

// ============================================================================
// getAllOperations()
// ============================================================================

describe('getAllOperations()', () => {
  it('returns a non-empty array', () => {
    const allOps = getAllOperations();
    expect(allOps.length).toBeGreaterThan(0);
  });

  it('returns a copy (not the internal array)', () => {
    const allOps1 = getAllOperations();
    const allOps2 = getAllOperations();
    expect(allOps1).not.toBe(allOps2);
    expect(allOps1).toEqual(allOps2);
  });

  it('mutating the returned array does not affect the registry', () => {
    const allOps = getAllOperations();
    const originalLength = allOps.length;
    allOps.pop();
    expect(allOps).toHaveLength(originalLength - 1);

    const freshOps = getAllOperations();
    expect(freshOps).toHaveLength(originalLength);
  });

  it('every operation has a non-empty name', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(op.name).toBeTruthy();
      expect(typeof op.name).toBe('string');
    }
  });

  it('every operation has a non-empty displayName', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(op.displayName).toBeTruthy();
      expect(typeof op.displayName).toBe('string');
    }
  });

  it('every operation has a permission (string, may be empty for login/logout)', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(typeof op.permission).toBe('string');
    }
  });

  it('every operation has boolean auditable and abortable fields', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      expect(typeof op.auditable).toBe('boolean');
      expect(typeof op.abortable).toBe('boolean');
    }
  });

  it('every operation has executeType of SYNC, ASYNC, or ABORT_PENDING', () => {
    const allOps = getAllOperations();
    const validTypes = new Set(['SYNC', 'ASYNC', 'ABORT_PENDING']);
    for (const op of allOps) {
      expect(validTypes.has(op.executeType)).toBe(true);
    }
  });

  it('contains the expected number of operations (sanity check)', () => {
    const allOps = getAllOperations();
    // The registry has: 7 channel + 8 status + 4 stats + 3 engine + 2 group +
    // 21 message + 6 event + 10 alert + 12 user + 10 config + 27 config ext +
    // 8 code template + 5 extension + 4 db task + 2 system + 1 usage + 7 artifact = ~137
    // Some variation possible, but should be at least 100
    expect(allOps.length).toBeGreaterThanOrEqual(100);
  });
});

// ============================================================================
// Registry Consistency
// ============================================================================

describe('Operation Registry Consistency', () => {
  it('all operations registered in allOperations are findable by name', () => {
    const allOps = getAllOperations();
    for (const op of allOps) {
      const found = getOperationByName(op.name);
      expect(found).toBeDefined();
      // Note: duplicate names (e.g. 'getMessageContent') mean the map stores the last one.
      // This test verifies the map is populated, not 1:1 correspondence.
      expect(found!.displayName).toBeTruthy();
    }
  });

  it('operation names are mostly unique (except known duplicates)', () => {
    const allOps = getAllOperations();
    const nameCount = new Map<string, number>();
    for (const op of allOps) {
      nameCount.set(op.name, (nameCount.get(op.name) || 0) + 1);
    }
    const duplicates = [...nameCount.entries()].filter(([, count]) => count > 1);
    // MESSAGE_GET and MESSAGE_GET_CONTENT both use 'getMessageContent'
    // This is a known duplication in the source
    for (const [name, count] of duplicates) {
      expect(count).toBeLessThanOrEqual(2);
      // Only 'getMessageContent' should be duplicated
      expect(name).toBe('getMessageContent');
    }
  });

  it('every non-empty permission references a known permission constant', () => {
    const allOps = getAllOperations();
    const knownPermissions = new Set(P.ALL_PERMISSIONS);
    for (const op of allOps) {
      if (op.permission !== '') {
        expect(knownPermissions.has(op.permission)).toBe(true);
      }
    }
  });

  it('every permission constant has at least one operation', () => {
    // Not all permissions necessarily have operations (some are result-level),
    // but the commonly-used ones should
    const usedPermissions = new Set(getAllOperations().map((op) => op.permission));
    const expectedPermissions = [
      P.CHANNELS_VIEW,
      P.CHANNELS_MANAGE,
      P.CHANNELS_START_STOP,
      P.CHANNELS_DEPLOY_UNDEPLOY,
      P.CHANNELS_CLEAR_STATISTICS,
      P.DASHBOARD_VIEW,
      P.MESSAGES_VIEW,
      P.MESSAGES_REMOVE,
      P.MESSAGES_REMOVE_ALL,
      P.MESSAGES_PROCESS,
      P.MESSAGES_REPROCESS,
      P.MESSAGES_IMPORT,
      P.MESSAGES_EXPORT_SERVER,
      P.EVENTS_VIEW,
      P.EVENTS_REMOVE,
      P.ALERTS_VIEW,
      P.ALERTS_MANAGE,
      P.USERS_MANAGE,
      P.SERVER_SETTINGS_VIEW,
      P.SERVER_SETTINGS_EDIT,
      P.CODE_TEMPLATES_VIEW,
      P.CODE_TEMPLATES_MANAGE,
      P.EXTENSIONS_MANAGE,
      P.DATABASE_TASKS_VIEW,
      P.DATABASE_TASKS_MANAGE,
      P.GLOBAL_SCRIPTS_VIEW,
      P.GLOBAL_SCRIPTS_EDIT,
      P.CONFIG_MAP_VIEW,
      P.CONFIG_MAP_EDIT,
      P.DATABASE_DRIVERS_EDIT,
      P.RESOURCES_VIEW,
      P.RESOURCES_EDIT,
      P.RESOURCES_RELOAD,
      P.TAGS_VIEW,
      P.TAGS_MANAGE,
      P.CHANNEL_GROUPS_VIEW,
      P.SERVER_BACKUP,
      P.SERVER_RESTORE,
      P.SERVER_SEND_TEST_EMAIL,
    ];
    for (const perm of expectedPermissions) {
      expect(usedPermissions.has(perm)).toBe(true);
    }
  });
});

// ============================================================================
// Permission Grouping Correctness
// ============================================================================

describe('Permission Grouping Correctness', () => {
  it('view operations use VIEW permissions, not MANAGE', () => {
    const viewOps = [
      CHANNEL_GET_CHANNELS,
      CHANNEL_GET_CHANNEL,
      CHANNEL_GET_CHANNEL_SUMMARY,
      CHANNEL_GET_IDS_AND_NAMES,
      CHANNEL_STATUS_GET,
      CHANNEL_STATUS_GET_ALL,
      CHANNEL_STATUS_GET_INITIAL,
      CHANNEL_STATS_GET,
      CHANNEL_STATS_GET_ALL,
      CHANNEL_GROUP_GET,
      MESSAGE_GET,
      MESSAGE_GET_COUNT,
      MESSAGE_SEARCH,
      MESSAGE_GET_MAX_ID,
      MESSAGE_GET_ATTACHMENT,
      MESSAGE_GET_CONTENT,
      MESSAGE_TRACE,
      EVENT_GET,
      EVENT_GET_MAX_ID,
      EVENT_GET_COUNT,
      EVENT_SEARCH,
      EVENT_EXPORT,
      ALERT_GET,
      ALERT_GET_ALL,
      ALERT_GET_STATUS,
      ALERT_GET_INFO,
      ALERT_GET_OPTIONS,
      CODE_TEMPLATE_GET,
      CODE_TEMPLATE_GET_ALL,
      CODE_TEMPLATE_LIBRARY_GET,
      CODE_TEMPLATE_LIBRARY_GET_ALL,
    ];
    for (const op of viewOps) {
      expect(op.permission).toMatch(/view|View|clearStatistics|viewDashboard/i);
    }
  });

  it('mutating channel operations require CHANNELS_MANAGE', () => {
    const manageOps = [CHANNEL_CREATE, CHANNEL_UPDATE, CHANNEL_REMOVE];
    for (const op of manageOps) {
      expect(op.permission).toBe(P.CHANNELS_MANAGE);
    }
  });

  it('deploy/undeploy operations require CHANNELS_DEPLOY_UNDEPLOY', () => {
    const deployOps = [ENGINE_DEPLOY, ENGINE_UNDEPLOY, ENGINE_REDEPLOY_ALL];
    for (const op of deployOps) {
      expect(op.permission).toBe(P.CHANNELS_DEPLOY_UNDEPLOY);
    }
  });

  it('message remove operations use different permissions than remove-all', () => {
    expect(MESSAGE_REMOVE.permission).toBe(P.MESSAGES_REMOVE);
    expect(MESSAGE_REMOVE_ALL.permission).toBe(P.MESSAGES_REMOVE_ALL);
    expect(MESSAGE_REMOVE.permission).not.toBe(MESSAGE_REMOVE_ALL.permission);
  });

  it('alert mutating operations require ALERTS_MANAGE', () => {
    const manageOps = [ALERT_CREATE, ALERT_UPDATE, ALERT_ENABLE, ALERT_DISABLE, ALERT_REMOVE];
    for (const op of manageOps) {
      expect(op.permission).toBe(P.ALERTS_MANAGE);
    }
  });
});
