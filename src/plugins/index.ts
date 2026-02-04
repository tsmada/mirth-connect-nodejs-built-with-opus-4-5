/**
 * Mirth Connect Plugins
 *
 * Exports all plugin modules for the Mirth Connect Node.js runtime.
 */

// Code Templates Plugin
export * from './codetemplates/index.js';

// Data Pruner Plugin
export * from './datapruner/index.js';

// JavaScript Rule Plugin (Filter rules)
export * from './javascriptrule/index.js';

// JavaScript Step Plugin (Transformer steps)
export * from './javascriptstep/index.js';

// Mapper Plugin (Variable mapping)
// Note: ReplacementPair and IteratorProperties are also in messagebuilder
// Import from './mapper/index.js' or './messagebuilder/index.js' directly if needed
export {
  MapperStep,
  MapperStepData,
  MapperScope,
  ReplacementPair,
  IteratorProperties,
  MAPPER_STEP_PLUGIN_POINT,
  SCOPE_MAP_NAMES,
  SCOPE_LABELS,
  createMapperStep,
  isMapperStep,
  isMapperStepType,
  getScopeFromString,
  getScopeLabel,
} from './mapper/index.js';

// Message Builder Plugin (Segment building)
// Note: Has its own ReplacementPair and IteratorProperties types (identical structure)
// Import directly from './messagebuilder/index.js' if you need MessageBuilder-specific types
export {
  MessageBuilderStep,
  MessageBuilderStepData,
  ExprPart,
  MESSAGE_BUILDER_STEP_PLUGIN_POINT,
  createMessageBuilderStep,
  isMessageBuilderStep,
  isMessageBuilderStepType,
} from './messagebuilder/index.js';

// XSLT Step Plugin (XSLT transformations)
export {
  XsltStep,
  XsltTransformer,
  XsltIteratorProperties,
  XSLT_STEP_PLUGIN_POINT,
  createXsltStep,
  isXsltStep,
  isXsltStepType,
  XsltStepProperties,
  DEFAULT_XSLT_STEP_PROPERTIES,
  validateXsltStepProperties,
  mergeWithDefaults as mergeXsltStepDefaults,
} from './xsltstep/index.js';

// Server Log Plugin (Real-time log streaming)
export {
  ServerLogItem,
  SerializableServerLogItem,
  LogLevel,
  LOG_DATE_FORMAT,
  createServerLogItem,
  createSimpleLogItem,
  serializeServerLogItem,
  formatServerLogItem,
  parseLogLevel,
  shouldDisplayLogLevel,
  ServerLogController,
  serverLogController,
  LogFilter,
  hookConsole,
  hookWinston,
  ServerLogWebSocketHandler,
  serverLogWebSocket,
  serverLogRouter,
  SERVER_LOG_PLUGIN_POINT,
  SERVER_LOG_PERMISSION_VIEW,
} from './serverlog/index.js';

// Dashboard Status Plugin (Real-time connector status)
export {
  ConnectionLogItem,
  SerializableConnectionLogItem,
  ConnectionStatusEventType,
  createConnectionLogItem,
  serializeConnectionLogItem,
  parseConnectionStatusEventType,
  isStateEvent,
  ConnectionStateItem,
  SerializableConnectionStateItem,
  createConnectionStateItem,
  serializeConnectionStateItem,
  getStateColor,
  formatStateDisplay,
  DashboardStatusController,
  dashboardStatusController,
  ConnectionStatusEvent,
  ConnectorCountEvent,
  DashboardStatusWebSocketHandler,
  dashboardStatusWebSocket,
  dashboardStatusRouter,
  DASHBOARD_STATUS_PLUGIN_POINT,
  DASHBOARD_STATUS_PERMISSION_VIEW,
} from './dashboardstatus/index.js';
