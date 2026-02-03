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
