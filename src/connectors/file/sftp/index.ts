/**
 * SFTP File Connector Module
 *
 * Exports SFTP connection and configuration classes for use
 * by FileReceiver and FileDispatcher.
 */

export {
  SftpConnection,
  SftpConnectionOptions,
  SftpFileInfo,
} from './SftpConnection.js';

export {
  SftpSchemeProperties,
  HostKeyChecking,
  getDefaultSftpSchemeProperties,
  validateSftpSchemeProperties,
  getSftpPropertiesSummary,
} from './SftpSchemeProperties.js';
