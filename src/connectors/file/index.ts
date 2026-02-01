/**
 * File Connector Module
 *
 * Provides file-based source and destination connectors.
 */

export {
  FileScheme,
  AfterProcessingAction,
  FileSortBy,
  FileReceiverProperties,
  FileDispatcherProperties,
  getDefaultFileReceiverProperties,
  getDefaultFileDispatcherProperties,
  globToRegex,
  matchesFilter,
  generateOutputFilename,
  FileInfo,
} from './FileConnectorProperties.js';

export { FileReceiver, FileReceiverConfig } from './FileReceiver.js';
export { FileDispatcher, FileDispatcherConfig } from './FileDispatcher.js';
