/**
 * Database (JDBC) Connector Module
 *
 * Provides Database source (receiver) and destination (dispatcher) connectors
 * for reading from and writing to databases.
 */

export {
  DatabaseReceiverProperties,
  DatabaseDispatcherProperties,
  DatabaseConnectionConfig,
  UpdateMode,
  getDefaultDatabaseReceiverProperties,
  getDefaultDatabaseDispatcherProperties,
  parseJdbcUrl,
  rowToXml,
  resultsToXml,
} from './DatabaseConnectorProperties.js';

export { DatabaseReceiver, DatabaseReceiverConfig } from './DatabaseReceiver.js';

export { DatabaseDispatcher, DatabaseDispatcherConfig } from './DatabaseDispatcher.js';
