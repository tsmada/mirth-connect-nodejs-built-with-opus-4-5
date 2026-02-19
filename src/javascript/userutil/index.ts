/**
 * User Utility Classes
 *
 * These classes are available in Mirth Connect JavaScript contexts and provide
 * utilities for message routing, response handling, file I/O, HTTP, email, and dates.
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/
 */

// Map utilities for scope variables
export {
  MirthMap,
  SourceMap,
  ChannelMap,
  ResponseMap,
  GlobalMap,
  GlobalChannelMapStore,
  ConfigurationMap,
} from './MirthMap.js';

// Message routing
export {
  VMRouter,
  setChannelController,
  setEngineController,
  getChannelController,
  getEngineController,
  type IChannelController,
  type IEngineController,
  type DispatchResult,
  type ILogger,
} from './VMRouter.js';

// Destination filtering
export {
  DestinationSet,
  createDestinationSet,
  DESTINATION_SET_KEY,
  type IConnectorMessage,
} from './DestinationSet.js';

// Raw message creation for routing
export { RawMessage } from './RawMessage.js';

// Response creation and handling
export { ResponseFactory } from './ResponseFactory.js';
export { ImmutableResponse } from './ImmutableResponse.js';

// File utilities
export { FileUtil } from './FileUtil.js';

// HTTP utilities
export { HTTPUtil } from './HTTPUtil.js';

// SMTP utilities
export { SMTPConnection } from './SMTPConnection.js';
export { SMTPConnectionFactory, SMTPConfig } from './SMTPConnectionFactory.js';

// Date utilities
export { DateUtil } from './DateUtil.js';

// Attachment utilities
export { Attachment } from './Attachment.js';
export { AttachmentUtil, type ImmutableConnectorMessage } from './AttachmentUtil.js';

// Database utilities
export {
  MirthCachedRowSet,
  type ColumnMetaData,
  type RowSetMetaData,
} from './MirthCachedRowSet.js';

export {
  DatabaseConnection,
  type Logger as DatabaseLogger,
  type DatabaseConnectionOptions,
} from './DatabaseConnection.js';

export { DatabaseConnectionFactory, dbConnFactory } from './DatabaseConnectionFactory.js';

// Future for async operations
export { Future, TimeoutError, CancellationError } from './Future.js';

// Deployed state enum
export {
  DeployedState,
  DEPLOYED_STATE_DESCRIPTIONS,
  parseDeployedState,
  isActiveState,
  isTransitionalState,
} from './DeployedState.js';

// Channel utilities
export {
  ChannelUtil,
  setChannelUtilChannelController,
  setChannelUtilEngineController,
  getChannelUtilChannelController,
  getChannelUtilEngineController,
  resetChannelUtilInstance,
  // Static function exports
  getChannelNames,
  getChannelIds,
  getDeployedChannelNames,
  getDeployedChannelIds,
  getChannelName,
  getDeployedChannelName,
  getDeployedChannelId,
  startChannel,
  stopChannel,
  pauseChannel,
  resumeChannel,
  haltChannel,
  deployChannel,
  undeployChannel,
  isChannelDeployed,
  getChannelState,
  startConnector,
  stopConnector,
  getConnectorState,
  getReceivedCount,
  getFilteredCount,
  getQueuedCount,
  getSentCount,
  getErrorCount,
  resetStatistics,
  // Types
  type IChannel,
  type IDashboardStatus,
  type IDeployedChannel,
  type IChannelUtilChannelController,
  type IErrorTaskHandler,
  type IChannelUtilEngineController,
} from './ChannelUtil.js';

// Alert sending
export {
  AlertSender,
  setAlertEventController,
  getAlertEventController,
  ErrorEventType,
  type ErrorEvent,
  type IAlertConnectorMessage,
  type IEventController,
} from './AlertSender.js';

// UUID generation
export { UUIDGenerator } from './UUIDGenerator.js';

// NCPDP utilities
export { NCPDPUtil } from './NCPDPUtil.js';

// JavaScript context information
export {
  ContextFactory,
  DefaultContextFactoryDelegate,
  createDefaultContextFactory,
  createContextFactory,
  type IContextFactoryDelegate,
} from './ContextFactory.js';

// DICOM utilities
export { DICOMUtil, type DicomObject, type DicomElement } from './DICOMUtil.js';

// XML utilities
export { XmlUtil } from './XmlUtil.js';

// JSON utilities
export { JsonUtil } from './JsonUtil.js';

// List builder utilities
export { Lists, ListBuilder } from './Lists.js';

// Map builder utilities
export { Maps, MapBuilder } from './Maps.js';

// HTTP header/parameter wrappers
export { MessageHeaders } from './MessageHeaders.js';
export { MessageParameters } from './MessageParameters.js';
