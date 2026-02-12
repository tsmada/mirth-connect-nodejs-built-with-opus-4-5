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
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';

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

    // Dispatch IDLE on deploy — matches Java's onDeploy()
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

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
   *
   * Matches Java DatabaseDispatcher.send() event lifecycle:
   *   READING (with URL info) → execute → IDLE (in finally)
   *
   * Java uses READING (not WRITING) for JDBC dispatchers because the
   * operation reads/writes the database — the event type reflects the
   * connector protocol semantics, not the direction.
   *
   * On SQL error: if queue is enabled, returns QUEUED status for retry
   * instead of throwing (matching Java's catch of DatabaseDispatcherException).
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    const info = `URL: ${this.properties.url}`;
    this.dispatchConnectionEvent(ConnectionStatusEventType.READING, info);

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

      // Java catches DatabaseDispatcherException and returns QUEUED when queue is enabled.
      // This allows the message to be retried rather than permanently failing.
      if (this.isQueueEnabled()) {
        connectorMessage.setStatus(Status.QUEUED);
        connectorMessage.setProcessingError(errorMessage);
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: this.buildErrorResponse('Error writing to database.', errorMessage),
          dataType: 'XML',
          encrypted: false,
        });
        // Do not throw — message will be retried via queue
      } else {
        connectorMessage.setStatus(Status.ERROR);
        connectorMessage.setProcessingError(errorMessage);
        throw error;
      }
    } finally {
      if (conn) {
        conn.release();
      }
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Build an error response XML matching Java's ErrorMessageBuilder format
   */
  private buildErrorResponse(summary: string, detail: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <error>${this.escapeXml(summary)} ${this.escapeXml(detail)}</error>
</response>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
