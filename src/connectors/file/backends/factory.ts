/**
 * Factory function to create the appropriate FileSystemClient for a given file scheme.
 *
 * This factory uses the existing SftpConnection for SFTP, and the new backend
 * implementations for FTP, S3, and SMB. Local filesystem operations remain
 * inline in FileReceiver/FileDispatcher (they don't need a separate client class).
 */

import { FileScheme, FileReceiverProperties, FileDispatcherProperties } from '../FileConnectorProperties.js';
import { FileSystemClient } from './types.js';
import { FtpClient } from './FtpClient.js';
import { S3Client } from './S3Client.js';
import { SmbClient } from './SmbClient.js';
import { FtpSchemeProperties } from './FtpSchemeProperties.js';
import { S3SchemeProperties } from './S3SchemeProperties.js';
import { SmbSchemeProperties } from './SmbSchemeProperties.js';

/**
 * Create a FileSystemClient for the given scheme and connector properties.
 *
 * @param scheme - The file scheme (FTP, S3, SMB)
 * @param props - Connector properties (receiver or dispatcher)
 * @returns A new FileSystemClient instance (not yet connected - call connect() first)
 * @throws Error if scheme is FILE or SFTP (handled separately) or unknown
 */
export function createFileSystemClient(
  scheme: FileScheme,
  props: FileReceiverProperties | FileDispatcherProperties
): FileSystemClient {
  switch (scheme) {
    case FileScheme.FTP: {
      const ftpSchemeProps = (props as unknown as Record<string, unknown>).ftpSchemeProperties as Partial<FtpSchemeProperties> | undefined;
      return new FtpClient({
        host: props.host,
        port: props.port,
        username: props.username,
        password: props.password,
        passive: 'passive' in props ? (props as { passive: boolean }).passive : true,
        secure: 'secure' in props ? (props as { secure: boolean }).secure : false,
        timeout: 'timeout' in props ? (props as { timeout: number }).timeout : 10000,
        schemeProperties: ftpSchemeProps,
      });
    }

    case FileScheme.S3: {
      const s3SchemeProps = (props as unknown as Record<string, unknown>).s3SchemeProperties as Partial<S3SchemeProperties> | undefined;
      return new S3Client({
        host: props.host,
        username: props.username,
        password: props.password,
        anonymous: 'anonymous' in props ? (props as { anonymous: boolean }).anonymous : false,
        timeout: 'timeout' in props ? (props as { timeout: number }).timeout : 10000,
        schemeProperties: s3SchemeProps,
      });
    }

    case FileScheme.SMB: {
      const smbSchemeProps = (props as unknown as Record<string, unknown>).smbSchemeProperties as Partial<SmbSchemeProperties> | undefined;
      return new SmbClient({
        host: props.host,
        username: props.username,
        password: props.password,
        timeout: 'timeout' in props ? (props as { timeout: number }).timeout : 10000,
        schemeProperties: smbSchemeProps,
      });
    }

    case FileScheme.FILE:
    case FileScheme.SFTP:
      throw new Error(
        `${scheme} is handled directly by FileReceiver/FileDispatcher, not through the FileSystemClient factory`
      );

    default:
      throw new Error(`Unknown file scheme: ${scheme}`);
  }
}
