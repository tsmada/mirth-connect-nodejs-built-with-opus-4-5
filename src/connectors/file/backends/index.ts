/**
 * File System Backends Module
 *
 * Provides pluggable file system implementations for the File connector.
 * Each backend matches a FileScheme and implements the FileSystemClient interface.
 *
 * Backend dependencies are dynamically imported on first use:
 * - FTP: basic-ftp (npm install basic-ftp)
 * - S3: @aws-sdk/client-s3 (npm install @aws-sdk/client-s3)
 * - SMB: @marsaud/smb2 (npm install @marsaud/smb2)
 */

// Interface
export { FileSystemClient } from './types.js';

// Backends
export { FtpClient, FtpClientOptions } from './FtpClient.js';
export { S3Client, S3ClientOptions } from './S3Client.js';
export { SmbClient, SmbClientOptions } from './SmbClient.js';

// Scheme properties
export { FtpSchemeProperties, getDefaultFtpSchemeProperties } from './FtpSchemeProperties.js';
export { S3SchemeProperties, getDefaultS3SchemeProperties } from './S3SchemeProperties.js';
export {
  SmbSchemeProperties,
  getDefaultSmbSchemeProperties,
  SmbDialectVersion,
  SMB_DIALECT_VERSIONS,
  getReadableVersion,
} from './SmbSchemeProperties.js';

// Factory
export { createFileSystemClient } from './factory.js';
