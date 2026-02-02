/**
 * File Connector Module
 *
 * Provides file-based source and destination connectors.
 * Supports local filesystem (FILE) and SFTP schemes.
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

// SFTP-specific exports
export {
  SftpConnection,
  SftpConnectionOptions,
  SftpFileInfo,
  SftpSchemeProperties,
  HostKeyChecking,
  getDefaultSftpSchemeProperties,
  validateSftpSchemeProperties,
  getSftpPropertiesSummary,
} from './sftp/index.js';
