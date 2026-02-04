/**
 * Data Pruner Plugin
 *
 * Provides scheduled message pruning with configurable retention policies.
 *
 * Features:
 * - Scheduled message pruning
 * - Archive before delete option
 * - Per-channel pruning rules
 * - Statistics cleanup
 * - Event pruning
 */

export * from './DataPrunerStatus.js';
export * from './DataPruner.js';
export * from './DataPrunerController.js';
export { dataPrunerRouter } from './DataPrunerServlet.js';

// Message Archiver
export {
  MessageArchiver,
  messageArchiver,
  MessageWriterOptions,
  ArchiveFormat,
  ArchiveMessage,
  ArchiveConnectorMessage,
  ArchiveContent,
  ArchiveAttachment,
  DEFAULT_ARCHIVE_OPTIONS,
} from './MessageArchiver.js';

/**
 * Plugin point name
 */
export const DATA_PRUNER_PLUGIN_POINT = 'Data Pruner';

/**
 * Permission constants
 */
export const DATA_PRUNER_PERMISSION_VIEW = 'View Data Pruner';
export const DATA_PRUNER_PERMISSION_MANAGE = 'Manage Data Pruner';
