/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseReceiver.java
 *
 * Purpose: Database source connector that polls for records
 *
 * Key behaviors to replicate:
 * - Poll-based query execution
 * - Support query mode and script mode
 * - MySQL connection pooling
 * - Post-process update queries
 * - Result caching and aggregation
 */

import { createPool, Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  DatabaseReceiverProperties,
  getDefaultDatabaseReceiverProperties,
  parseJdbcUrl,
  resultsToXml,
  UpdateMode,
} from './DatabaseConnectorProperties.js';
import { getDefaultExecutor } from '../../javascript/runtime/JavaScriptExecutor.js';

export interface DatabaseReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<DatabaseReceiverProperties>;
}

/**
 * Database Source Connector that polls for records
 */
export class DatabaseReceiver extends SourceConnector {
  private properties: DatabaseReceiverProperties;
  private pool: Pool | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connection: PoolConnection | null = null;

  constructor(config: DatabaseReceiverConfig) {
    super({
      name: config.name ?? 'Database Reader',
      transportName: 'JDBC',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultDatabaseReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): DatabaseReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<DatabaseReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the database receiver
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Database Receiver is already running');
    }

    // Create connection pool
    await this.createConnectionPool();

    // Start polling
    this.startPolling();
    this.running = true;
  }

  /**
   * Stop the database receiver
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Stop polling
    this.stopPolling();

    // Close connection
    if (this.connection) {
      this.connection.release();
      this.connection = null;
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
   * Get database connection
   */
  private async getConnection(): Promise<PoolConnection> {
    if (!this.pool) {
      throw new Error('Connection pool not initialized');
    }

    if (this.properties.keepConnectionOpen && this.connection) {
      return this.connection;
    }

    const conn = await this.pool.getConnection();

    if (this.properties.keepConnectionOpen) {
      this.connection = conn;
    }

    return conn;
  }

  /**
   * Release database connection
   */
  private releaseConnection(conn: PoolConnection): void {
    if (!this.properties.keepConnectionOpen) {
      conn.release();
    }
  }

  /**
   * Start polling timer
   */
  private startPolling(): void {
    // Execute first poll immediately
    this.poll().catch((err) => {
      console.error('Poll error:', err);
    });

    // Schedule subsequent polls
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error('Poll error:', err);
      });
    }, this.properties.pollInterval);
  }

  /**
   * Stop polling timer
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Execute poll
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.pool) {
      return;
    }

    let conn: PoolConnection | null = null;
    let retries = 0;

    while (retries <= this.properties.retryCount) {
      try {
        conn = await this.getConnection();
        await this.executeQuery(conn);
        break;
      } catch (error) {
        retries++;

        if (conn) {
          this.releaseConnection(conn);
          conn = null;
        }

        if (retries > this.properties.retryCount) {
          console.error('Database poll failed after retries:', error);
          break;
        }

        // Wait before retry
        await new Promise((resolve) =>
          setTimeout(resolve, this.properties.retryInterval)
        );
      }
    }
  }

  /**
   * Execute select query
   */
  private async executeQuery(conn: PoolConnection): Promise<void> {
    if (this.properties.useScript) {
      // Script mode - execute JavaScript
      await this.executeScript(conn);
    } else {
      // Query mode - execute SQL
      await this.executeSql(conn);
    }
  }

  /**
   * Execute SQL query
   */
  private async executeSql(conn: PoolConnection): Promise<void> {
    const [rows] = await conn.query<RowDataPacket[]>(this.properties.select);

    if (!rows || rows.length === 0) {
      return;
    }

    if (this.properties.aggregateResults) {
      // Send all results as single message
      const xml = resultsToXml(rows as Record<string, unknown>[]);
      await this.dispatchRawMessage(xml);

      // Execute update if needed
      if (
        this.properties.updateMode === UpdateMode.ONCE &&
        this.properties.update
      ) {
        await conn.query(this.properties.update);
      }
    } else {
      // Send each row as separate message
      for (const row of rows) {
        const xml = resultsToXml([row as Record<string, unknown>]);
        await this.dispatchRawMessage(xml);

        // Execute update for each row
        if (
          this.properties.updateMode === UpdateMode.EACH &&
          this.properties.update
        ) {
          await conn.query(this.properties.update);
        }
      }

      // Execute update once after all rows
      if (
        this.properties.updateMode === UpdateMode.ONCE &&
        this.properties.update
      ) {
        await conn.query(this.properties.update);
      }
    }
  }

  /**
   * Execute JavaScript script for script mode polling
   *
   * The script has access to:
   * - dbConn: Database connection wrapper with executeQuery/executeUpdate methods
   * - globalMap, channelMap, etc.: Standard Mirth maps
   *
   * The script should return a string or array of strings to be dispatched as messages.
   */
  private async executeScript(conn: PoolConnection): Promise<void> {
    if (!this.properties.select) {
      return;
    }

    // Create a database connection wrapper for the script
    const dbConn = {
      executeQuery: async (sql: string): Promise<Record<string, unknown>[]> => {
        const [rows] = await conn.query<RowDataPacket[]>(sql);
        return rows as Record<string, unknown>[];
      },
      executeUpdate: async (sql: string): Promise<number> => {
        const [result] = await conn.query(sql);
        return (result as { affectedRows?: number }).affectedRows ?? 0;
      },
    };

    // Build scope with database connection
    const scope = {
      dbConn,
      logger: {
        info: (msg: string) => console.log(`[DB Script] ${msg}`),
        error: (msg: string) => console.error(`[DB Script] ${msg}`),
        warn: (msg: string) => console.warn(`[DB Script] ${msg}`),
        debug: (msg: string) => console.debug(`[DB Script] ${msg}`),
      },
    };

    const executor = getDefaultExecutor();
    const result = executor.executeWithScope<string | string[] | undefined>(
      this.properties.select,
      scope,
      { timeout: 60000 }
    );

    if (!result.success) {
      throw result.error ?? new Error('Script execution failed');
    }

    // Dispatch results as messages
    if (result.result) {
      const messages = Array.isArray(result.result) ? result.result : [result.result];
      for (const message of messages) {
        if (message && typeof message === 'string') {
          await this.dispatchRawMessage(message);
        }
      }
    }

    // Execute post-process update if configured
    if (this.properties.update) {
      await conn.query(this.properties.update);
    }
  }

  /**
   * Get the pool instance (for testing)
   */
  getPool(): Pool | null {
    return this.pool;
  }
}
