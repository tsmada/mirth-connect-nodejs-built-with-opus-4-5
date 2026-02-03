/**
 * VM (Virtual Machine) Connector Module
 *
 * Provides inter-channel message routing capabilities.
 * - Channel Reader: Source connector that receives messages from other channels
 * - Channel Writer: Destination connector that sends messages to other channels
 *
 * This enables building complex message flows where a message passes through
 * multiple channels, with source tracking to maintain the chain of custody.
 */

export {
  // Properties
  VmReceiverProperties,
  VmDispatcherProperties,
  getDefaultVmReceiverProperties,
  getDefaultVmDispatcherProperties,
  formatVmDispatcherProperties,
  // Source tracking
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
  SOURCE_MESSAGE_ID,
  SOURCE_MESSAGE_IDS,
  getSourceChannelIds,
  getSourceMessageIds,
} from './VmConnectorProperties.js';

export {
  VmReceiver,
  VmReceiverConfig,
  VmConnectionStatus,
  ConnectionStatusListener,
} from './VmReceiver.js';

export {
  VmDispatcher,
  VmDispatcherConfig,
  VmDispatcherStatus,
  DispatcherStatusListener,
  EngineController,
  DispatchResult,
  TemplateReplacer,
} from './VmDispatcher.js';
