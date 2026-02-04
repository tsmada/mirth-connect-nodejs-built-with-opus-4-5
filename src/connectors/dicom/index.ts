/**
 * DICOM Connector Module
 *
 * Provides DICOM medical imaging connectivity for Mirth Connect.
 * Supports DIMSE operations including:
 * - C-STORE (send/receive images)
 * - C-ECHO (verification)
 * - C-FIND (query) - stub
 * - C-MOVE (retrieve) - stub
 */

// Properties
export {
  DICOMReceiverProperties,
  getDefaultDICOMReceiverProperties,
  ListenerConnectorProperties,
  SourceConnectorProperties,
  DicomTlsMode,
  DimseCommand,
  TransferSyntax,
  SopClass,
  getProtocol as getReceiverProtocol,
  getName as getReceiverName,
} from './DICOMReceiverProperties.js';

export {
  DICOMDispatcherProperties,
  DestinationConnectorProperties,
  getDefaultDICOMDispatcherProperties,
  DicomPriority,
  getProtocol as getDispatcherProtocol,
  getName as getDispatcherName,
} from './DICOMDispatcherProperties.js';

// Connection
export {
  DicomConnection,
  AssociationParams,
  PresentationContext,
  DimseMessage,
  PduType,
  DimseCommandType,
  DicomStatus,
  AssociationState,
} from './DicomConnection.js';

// Connectors
export { DICOMReceiver, DICOMReceiverConfig } from './DICOMReceiver.js';
export { DICOMDispatcher, DICOMDispatcherConfig } from './DICOMDispatcher.js';
