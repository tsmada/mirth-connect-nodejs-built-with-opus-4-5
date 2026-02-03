/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DatabaseConnection.java
 *
 * Purpose: Execute SQL queries against a database connection from Mirth Connect scripts.
 *
 * Key behaviors to replicate:
 * - Execute queries returning CachedRowSet (disconnected result set)
 * - Execute updates returning row count
 * - Execute updates returning generated keys
 * - Support prepared statements with parameters
 * - Transaction control: setAutoCommit, commit, rollback
 * - Connection lifecycle: close()
 *
 * Design note: This uses mysql2/promise for MySQL, but the interface is designed
 * to be database-agnostic. Other database drivers (pg, mssql) can be used through
 * DatabaseConnectionFactory's driver mapping.
 */

import type {
  Connection,
  PoolConnection,
  FieldPacket,
  RowDataPacket,
  ResultSetHeader,
  Pool,
} from 'mysql2/promise';
import { MirthCachedRowSet } from './MirthCachedRowSet.js';

/** Logger interface matching Mirth's logging pattern */
export interface Logger {
  debug(message: string): void;
  warn(message: string | Error): void;
  error(message: string, error?: Error): void;
}

/** Default console-based logger */
const defaultLogger: Logger = {
  debug: (msg: string) => {
    if (process.env.DEBUG) {
      console.debug(`[DatabaseConnection] ${msg}`);
    }
  },
  warn: (msg: string | Error) => console.warn(`[DatabaseConnection] ${msg}`),
  error: (msg: string, err?: Error) =>
    console.error(`[DatabaseConnection] ${msg}`, err || ''),
};

/**
 * Configuration options for database connections.
 */
export interface DatabaseConnectionOptions {
  /** The database server address/URL */
  address: string;
  /** Optional username */
  username?: string;
  /** Optional password */
  password?: string;
  /** Optional database name */
  database?: string;
  /** Optional connection timeout in ms */
  connectTimeout?: number;
  /** Custom logger instance */
  logger?: Logger;
}

/**
 * Provides the ability to run SQL queries against a database connection.
 *
 * This class wraps a database connection and provides methods to execute
 * queries and updates. Query results are returned as MirthCachedRowSet,
 * which is a disconnected result set that can be used after the connection
 * is closed.
 *
 * @example
 * ```typescript
 * const dbConn = await DatabaseConnectionFactory.createDatabaseConnection(
 *   'mysql',
 *   'jdbc:mysql://localhost:3306/mydb',
 *   'user',
 *   'password'
 * );
 *
 * try {
 *   const result = await dbConn.executeCachedQuery('SELECT * FROM users');
 *   while (result.next()) {
 *     console.log(result.getString('name'));
 *   }
 * } finally {
 *   dbConn.close();
 * }
 * ```
 */
export class DatabaseConnection {
  private connection: Connection | null = null;
  private pool: Pool | null = null;
  private address: string;
  private logger: Logger;
  private closed = false;

  /**
   * Creates a new DatabaseConnection.
   * Note: This constructor is internal. Use DatabaseConnectionFactory to create connections.
   *
   * @param connection - The underlying database connection
   * @param address - The server address
   * @param logger - Optional logger instance
   */
  constructor(
    connection: Connection,
    address: string,
    logger: Logger = defaultLogger
  ) {
    this.connection = connection;
    this.address = address;
    this.logger = logger;
    this.logger.debug(`Creating new database connection: address=${address}`);
  }

  /**
   * Creates a DatabaseConnection from a connection pool.
   * The connection will be released back to the pool on close().
   */
  static fromPool(
    pool: Pool,
    connection: Connection,
    address: string,
    logger: Logger = defaultLogger
  ): DatabaseConnection {
    const dbConn = new DatabaseConnection(connection, address, logger);
    dbConn.pool = pool;
    return dbConn;
  }

  /**
   * Returns the server address.
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Returns the underlying database connection.
   * Use with caution - direct access should be avoided when possible.
   */
  getConnection(): Connection | null {
    return this.connection;
  }

  /**
   * Ensures the connection is still valid.
   */
  private ensureConnection(): Connection {
    if (this.closed || !this.connection) {
      throw new Error('Database connection is closed');
    }
    return this.connection;
  }

  /**
   * Executes a query and returns a disconnected CachedRowSet.
   *
   * @param expression - The SQL query to execute
   * @returns A CachedRowSet containing the query results
   */
  async executeCachedQuery(expression: string): Promise<MirthCachedRowSet>;

  /**
   * Executes a prepared query with parameters and returns a disconnected CachedRowSet.
   *
   * @param expression - The SQL prepared statement (use ? for placeholders)
   * @param parameters - Array of parameter values
   * @returns A CachedRowSet containing the query results
   */
  async executeCachedQuery(
    expression: string,
    parameters: unknown[]
  ): Promise<MirthCachedRowSet>;

  async executeCachedQuery(
    expression: string,
    parameters?: unknown[]
  ): Promise<MirthCachedRowSet> {
    const conn = this.ensureConnection();
    this.logger.debug(`Executing query:\n${expression}`);

    if (parameters) {
      this.logParameters(parameters);
    }

    try {
      const [rows, fields] = await (parameters
        ? conn.execute<RowDataPacket[]>(expression, parameters)
        : conn.query<RowDataPacket[]>(expression));

      const crs = new MirthCachedRowSet();
      crs.populate(rows as Record<string, unknown>[], fields as FieldPacket[]);
      return crs;
    } catch (error) {
      this.logger.error(`Query failed: ${expression}`, error as Error);
      throw error;
    }
  }

  /**
   * Executes an INSERT/UPDATE/DELETE statement and returns the row count.
   *
   * @param expression - The SQL statement to execute
   * @returns The number of rows affected, or -1 if a result set was returned
   */
  async executeUpdate(expression: string): Promise<number>;

  /**
   * Executes a prepared INSERT/UPDATE/DELETE statement with parameters.
   *
   * @param expression - The SQL prepared statement
   * @param parameters - Array of parameter values
   * @returns The number of rows affected, or -1 if a result set was returned
   */
  async executeUpdate(
    expression: string,
    parameters: unknown[]
  ): Promise<number>;

  async executeUpdate(
    expression: string,
    parameters?: unknown[]
  ): Promise<number> {
    const conn = this.ensureConnection();
    this.logger.debug(`Executing update:\n${expression}`);

    if (parameters) {
      this.logParameters(parameters);
    }

    try {
      const [result] = await (parameters
        ? conn.execute<ResultSetHeader>(expression, parameters)
        : conn.query<ResultSetHeader>(expression));

      // Check if this was a SELECT (returns rows, not ResultSetHeader)
      if (Array.isArray(result)) {
        return -1;
      }

      return result.affectedRows;
    } catch (error) {
      this.logger.error(`Update failed: ${expression}`, error as Error);
      throw error;
    }
  }

  /**
   * Executes an INSERT statement and returns the generated keys.
   *
   * @param expression - The SQL INSERT statement
   * @returns A CachedRowSet containing the generated keys
   */
  async executeUpdateAndGetGeneratedKeys(
    expression: string
  ): Promise<MirthCachedRowSet>;

  /**
   * Executes a prepared INSERT statement and returns the generated keys.
   *
   * @param expression - The SQL prepared statement
   * @param parameters - Array of parameter values
   * @returns A CachedRowSet containing the generated keys
   */
  async executeUpdateAndGetGeneratedKeys(
    expression: string,
    parameters: unknown[]
  ): Promise<MirthCachedRowSet>;

  async executeUpdateAndGetGeneratedKeys(
    expression: string,
    parameters?: unknown[]
  ): Promise<MirthCachedRowSet> {
    const conn = this.ensureConnection();
    this.logger.debug(`Executing update (with generated keys):\n${expression}`);

    if (parameters) {
      this.logParameters(parameters);
    }

    try {
      const [result] = await (parameters
        ? conn.execute<ResultSetHeader>(expression, parameters)
        : conn.query<ResultSetHeader>(expression));

      // Create a CachedRowSet with the generated key
      const crs = new MirthCachedRowSet();

      if (!Array.isArray(result) && result.insertId) {
        // Return the insert ID as a row
        crs.populate(
          [{ GENERATED_KEY: result.insertId }],
          [{ name: 'GENERATED_KEY', type: 'BIGINT' }]
        );
      } else {
        // No generated key, return empty result
        crs.populate([], []);
      }

      return crs;
    } catch (error) {
      this.logger.error(
        `Update (with generated keys) failed: ${expression}`,
        error as Error
      );
      throw error;
    }
  }

  /**
   * Logs parameter values for debugging.
   */
  private logParameters(parameters: unknown[]): void {
    parameters.forEach((value, index) => {
      this.logger.debug(`Adding parameter: index=${index + 1}, value=${value}`);
    });
  }

  // =====================================================
  // Transaction Control
  // =====================================================

  /**
   * Sets this connection's auto-commit mode.
   * If auto-commit is true, each SQL statement is treated as a transaction.
   * If auto-commit is false, you must call commit() or rollback() explicitly.
   *
   * @param autoCommit - true to enable auto-commit, false to disable
   */
  async setAutoCommit(autoCommit: boolean): Promise<void> {
    const conn = this.ensureConnection();
    if (autoCommit) {
      await conn.query('SET autocommit = 1');
    } else {
      await conn.query('SET autocommit = 0');
      await conn.beginTransaction();
    }
  }

  /**
   * Makes all changes made since the previous commit/rollback permanent.
   */
  async commit(): Promise<void> {
    const conn = this.ensureConnection();
    await conn.commit();
  }

  /**
   * Undoes all changes made in the current transaction.
   */
  async rollback(): Promise<void> {
    const conn = this.ensureConnection();
    await conn.rollback();
  }

  // =====================================================
  // Connection Lifecycle
  // =====================================================

  /**
   * Closes the database connection.
   * If the connection came from a pool, it is released back to the pool.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      if (this.pool && this.connection) {
        // Release back to pool - cast to PoolConnection which has release()
        (this.connection as PoolConnection).release();
      } else if (this.connection) {
        // Direct connection - close it
        await this.connection.end();
      }
    } catch (error) {
      this.logger.warn(error as Error);
    } finally {
      this.connection = null;
    }
  }

  /**
   * Returns true if this connection has been closed.
   */
  isClosed(): boolean {
    return this.closed;
  }
}
