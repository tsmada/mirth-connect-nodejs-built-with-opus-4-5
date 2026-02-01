/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseDispatcher.java
 *
 * Purpose: Database destination connector that executes INSERT/UPDATE queries
 *
 * Key behaviors to replicate:
 * - Execute SQL queries with parameters
 * - Support query mode and script mode
 * - MySQL connection pooling
 * - Return affected row count in response
 */

import { createPool, Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import {
  DatabaseDispatcherProperties,
  getDefaultDatabaseDispatcherProperties,
  parseJdbcUrl,
} from './DatabaseConnectorProperties.js';

export interface DatabaseDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<DatabaseDispatcherProperties>;
}

/**
 * Database Destination Connector that executes INSERT/UPDATE queries
 */
export class DatabaseDispatcher extends DestinationConnector {
  private properties: DatabaseDispatcherProperties;
  private pool: Pool | null = null;

  constructor(config: DatabaseDispatcherConfig) {
    super({
      name: config.name ?? 'Database Writer',
      metaDataId: config.metaDataId,
      transportName: 'JDBC',
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultDatabaseDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): DatabaseDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DatabaseDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the database dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Create connection pool
    await this.createConnectionPool();
    this.running = true;
  }

  /**
   * Stop the database dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Close pool
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }

    this.running = false;
  }

  /**
   * Create connection pool
   */
  private async createConnectionPool(): Promise<void> {
    const connConfig = parseJdbcUrl(this.properties.url);
    if (!connConfig) {
      throw new Error(`Invalid database URL: ${this.properties.url}`);
    }

    this.pool = createPool({
      host: connConfig.host,
      port: connConfig.port,
      user: this.properties.username || connConfig.user,
      password: this.properties.password || connConfig.password,
      database: connConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  /**
   * Send message to database
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    let conn: PoolConnection | null = null;

    try {
      conn = await this.pool.getConnection();

      // Get the query and parameters
      const query = this.properties.query;
      const params = this.properties.parameters || [];

      // Execute query
      const [result] = await conn.execute<ResultSetHeader>(query, params);

      // Set send date
      connectorMessage.setSendDate(new Date());

      // Set response with affected rows
      const response = this.buildResponse(result);
      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: response,
        dataType: 'XML',
        encrypted: false,
      });

      // Update status
      connectorMessage.setStatus(Status.SENT);

      // Store result in connector map
      connectorMessage.getConnectorMap().set('affectedRows', result.affectedRows);
      connectorMessage.getConnectorMap().set('insertId', result.insertId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(errorMessage);
      throw error;
    } finally {
      if (conn) {
        conn.release();
      }
    }
  }

  /**
   * Build response XML from query result
   */
  private buildResponse(result: ResultSetHeader): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <affectedRows>${result.affectedRows}</affectedRows>
  <insertId>${result.insertId || ''}</insertId>
  <warningStatus>${result.warningStatus || 0}</warningStatus>
</result>`;
  }

  /**
   * Get response from the last request
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Get the pool instance (for testing)
   */
  getPool(): Pool | null {
    return this.pool;
  }
}
