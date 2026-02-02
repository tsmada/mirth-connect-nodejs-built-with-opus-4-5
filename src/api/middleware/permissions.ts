/**
 * Mirth Connect Permission Constants
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/Permissions.java
 *
 * These are string constants (not enums) to allow extensions to add custom permissions.
 * Each permission represents a specific capability that can be granted to users.
 */

// ============================================================================
// Permission Constants
// ============================================================================

// Alerts
export const ALERTS_VIEW = 'viewAlerts';
export const ALERTS_MANAGE = 'manageAlerts';

// Dashboard
export const DASHBOARD_VIEW = 'viewDashboard';

// Channels
export const CHANNELS_VIEW = 'viewChannels';
export const CHANNEL_GROUPS_VIEW = 'viewChannelGroups';
export const CHANNELS_MANAGE = 'manageChannels';
export const CHANNELS_CLEAR_STATISTICS = 'clearStatistics';
export const CHANNELS_START_STOP = 'startStopChannels';
export const CHANNELS_DEPLOY_UNDEPLOY = 'deployUndeployChannels';

// Code Templates
export const CODE_TEMPLATES_VIEW = 'viewCodeTemplates';
export const CODE_TEMPLATES_MANAGE = 'manageCodeTemplates';

// Global Scripts
export const GLOBAL_SCRIPTS_VIEW = 'viewGlobalScripts';
export const GLOBAL_SCRIPTS_EDIT = 'editGlobalScripts';

// Messages
export const MESSAGES_VIEW = 'viewMessages';
export const MESSAGES_REMOVE = 'removeMessages';
export const MESSAGES_REMOVE_RESULTS = 'removeResults';
export const MESSAGES_REMOVE_ALL = 'removeAllMessages';
export const MESSAGES_PROCESS = 'processMessages';
export const MESSAGES_REPROCESS = 'reprocessMessages';
export const MESSAGES_REPROCESS_RESULTS = 'reprocessResults';
export const MESSAGES_IMPORT = 'importMessages';
export const MESSAGES_EXPORT_SERVER = 'exportMessagesServer';

// Tags
export const TAGS_VIEW = 'viewTags';
export const TAGS_MANAGE = 'manageTags';

// Events
export const EVENTS_VIEW = 'viewEvents';
export const EVENTS_REMOVE = 'removeEvents';

// Users
export const USERS_MANAGE = 'manageUsers';

// Extensions
export const EXTENSIONS_MANAGE = 'manageExtensions';

// Server Configuration and Settings
export const SERVER_BACKUP = 'backupServerConfiguration';
export const SERVER_RESTORE = 'restoreServerConfiguration';
export const SERVER_SETTINGS_VIEW = 'viewServerSettings';
export const SERVER_SETTINGS_EDIT = 'editServerSettings';
export const SERVER_CLEAR_LIFETIME_STATS = 'clearLifetimeStats';
export const SERVER_SEND_TEST_EMAIL = 'sendTestEmail';

// Configuration Map
export const CONFIG_MAP_VIEW = 'viewConfigurationMap';
export const CONFIG_MAP_EDIT = 'editConfigurationMap';

// Database Drivers
export const DATABASE_DRIVERS_EDIT = 'editDatabaseDrivers';

// Database Tasks
export const DATABASE_TASKS_VIEW = 'viewDatabaseTasks';
export const DATABASE_TASKS_MANAGE = 'manageDatabaseTasks';

// Resources
export const RESOURCES_VIEW = 'viewResources';
export const RESOURCES_EDIT = 'editResources';
export const RESOURCES_RELOAD = 'reloadResources';

// ============================================================================
// Permission Type (union of all permission strings)
// ============================================================================

export type Permission =
  | typeof ALERTS_VIEW
  | typeof ALERTS_MANAGE
  | typeof DASHBOARD_VIEW
  | typeof CHANNELS_VIEW
  | typeof CHANNEL_GROUPS_VIEW
  | typeof CHANNELS_MANAGE
  | typeof CHANNELS_CLEAR_STATISTICS
  | typeof CHANNELS_START_STOP
  | typeof CHANNELS_DEPLOY_UNDEPLOY
  | typeof CODE_TEMPLATES_VIEW
  | typeof CODE_TEMPLATES_MANAGE
  | typeof GLOBAL_SCRIPTS_VIEW
  | typeof GLOBAL_SCRIPTS_EDIT
  | typeof MESSAGES_VIEW
  | typeof MESSAGES_REMOVE
  | typeof MESSAGES_REMOVE_RESULTS
  | typeof MESSAGES_REMOVE_ALL
  | typeof MESSAGES_PROCESS
  | typeof MESSAGES_REPROCESS
  | typeof MESSAGES_REPROCESS_RESULTS
  | typeof MESSAGES_IMPORT
  | typeof MESSAGES_EXPORT_SERVER
  | typeof TAGS_VIEW
  | typeof TAGS_MANAGE
  | typeof EVENTS_VIEW
  | typeof EVENTS_REMOVE
  | typeof USERS_MANAGE
  | typeof EXTENSIONS_MANAGE
  | typeof SERVER_BACKUP
  | typeof SERVER_RESTORE
  | typeof SERVER_SETTINGS_VIEW
  | typeof SERVER_SETTINGS_EDIT
  | typeof SERVER_CLEAR_LIFETIME_STATS
  | typeof SERVER_SEND_TEST_EMAIL
  | typeof CONFIG_MAP_VIEW
  | typeof CONFIG_MAP_EDIT
  | typeof DATABASE_DRIVERS_EDIT
  | typeof DATABASE_TASKS_VIEW
  | typeof DATABASE_TASKS_MANAGE
  | typeof RESOURCES_VIEW
  | typeof RESOURCES_EDIT
  | typeof RESOURCES_RELOAD
  | string; // Allow extension permissions

// ============================================================================
// All Permissions Array (for iteration/validation)
// ============================================================================

export const ALL_PERMISSIONS: string[] = [
  ALERTS_VIEW,
  ALERTS_MANAGE,
  DASHBOARD_VIEW,
  CHANNELS_VIEW,
  CHANNEL_GROUPS_VIEW,
  CHANNELS_MANAGE,
  CHANNELS_CLEAR_STATISTICS,
  CHANNELS_START_STOP,
  CHANNELS_DEPLOY_UNDEPLOY,
  CODE_TEMPLATES_VIEW,
  CODE_TEMPLATES_MANAGE,
  GLOBAL_SCRIPTS_VIEW,
  GLOBAL_SCRIPTS_EDIT,
  MESSAGES_VIEW,
  MESSAGES_REMOVE,
  MESSAGES_REMOVE_RESULTS,
  MESSAGES_REMOVE_ALL,
  MESSAGES_PROCESS,
  MESSAGES_REPROCESS,
  MESSAGES_REPROCESS_RESULTS,
  MESSAGES_IMPORT,
  MESSAGES_EXPORT_SERVER,
  TAGS_VIEW,
  TAGS_MANAGE,
  EVENTS_VIEW,
  EVENTS_REMOVE,
  USERS_MANAGE,
  EXTENSIONS_MANAGE,
  SERVER_BACKUP,
  SERVER_RESTORE,
  SERVER_SETTINGS_VIEW,
  SERVER_SETTINGS_EDIT,
  SERVER_CLEAR_LIFETIME_STATS,
  SERVER_SEND_TEST_EMAIL,
  CONFIG_MAP_VIEW,
  CONFIG_MAP_EDIT,
  DATABASE_DRIVERS_EDIT,
  DATABASE_TASKS_VIEW,
  DATABASE_TASKS_MANAGE,
  RESOURCES_VIEW,
  RESOURCES_EDIT,
  RESOURCES_RELOAD,
];

// ============================================================================
// Permission Categories (for UI grouping)
// ============================================================================

export const PERMISSION_CATEGORIES: Record<string, string[]> = {
  Alerts: [ALERTS_VIEW, ALERTS_MANAGE],
  Dashboard: [DASHBOARD_VIEW],
  Channels: [
    CHANNELS_VIEW,
    CHANNEL_GROUPS_VIEW,
    CHANNELS_MANAGE,
    CHANNELS_CLEAR_STATISTICS,
    CHANNELS_START_STOP,
    CHANNELS_DEPLOY_UNDEPLOY,
  ],
  'Code Templates': [CODE_TEMPLATES_VIEW, CODE_TEMPLATES_MANAGE],
  'Global Scripts': [GLOBAL_SCRIPTS_VIEW, GLOBAL_SCRIPTS_EDIT],
  Messages: [
    MESSAGES_VIEW,
    MESSAGES_REMOVE,
    MESSAGES_REMOVE_RESULTS,
    MESSAGES_REMOVE_ALL,
    MESSAGES_PROCESS,
    MESSAGES_REPROCESS,
    MESSAGES_REPROCESS_RESULTS,
    MESSAGES_IMPORT,
    MESSAGES_EXPORT_SERVER,
  ],
  Tags: [TAGS_VIEW, TAGS_MANAGE],
  Events: [EVENTS_VIEW, EVENTS_REMOVE],
  Users: [USERS_MANAGE],
  Extensions: [EXTENSIONS_MANAGE],
  Server: [
    SERVER_BACKUP,
    SERVER_RESTORE,
    SERVER_SETTINGS_VIEW,
    SERVER_SETTINGS_EDIT,
    SERVER_CLEAR_LIFETIME_STATS,
    SERVER_SEND_TEST_EMAIL,
  ],
  'Configuration Map': [CONFIG_MAP_VIEW, CONFIG_MAP_EDIT],
  'Database Drivers': [DATABASE_DRIVERS_EDIT],
  'Database Tasks': [DATABASE_TASKS_VIEW, DATABASE_TASKS_MANAGE],
  Resources: [RESOURCES_VIEW, RESOURCES_EDIT, RESOURCES_RELOAD],
};
