/**
 * File Connector Module
 *
 * Provides file-based source and destination connectors.
 * Supports local filesystem (FILE), SFTP, FTP, S3, and SMB schemes.
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

// Backend exports (FTP, S3, SMB)
export {
  FileSystemClient,
  FtpClient,
  FtpClientOptions,
  S3Client,
  S3ClientOptions,
  SmbClient,
  SmbClientOptions,
  FtpSchemeProperties,
  getDefaultFtpSchemeProperties,
  S3SchemeProperties,
  getDefaultS3SchemeProperties,
  SmbSchemeProperties,
  SmbDialectVersion,
  SMB_DIALECT_VERSIONS,
  getDefaultSmbSchemeProperties,
  getReadableVersion,
  createFileSystemClient,
} from './backends/index.js';
