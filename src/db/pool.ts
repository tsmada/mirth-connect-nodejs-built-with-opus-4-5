/**
 * MySQL connection pool for Mirth Connect Node.js Runtime
 *
 * Uses existing Mirth MySQL schema - do NOT modify tables.
 */

import mysql, { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getLogger, registerComponent } from '../logging/index.js';
import type { Logger } from '../logging/index.js';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit?: number;
  waitForConnections?: boolean;
  queueLimit?: number;
  connectTimeout?: number;
}

const DEFAULT_CONFIG: Partial<DatabaseConfig> = {
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  waitForConnections: true,
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '200', 10),
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
};

let pool: Pool | null = null;

const DB_DEADLOCK_RETRIES = parseInt(process.env.DB_DEADLOCK_RETRIES || '3', 10);

let dbLogger: Logger | null = null;
function getDbLogger(): Logger {
  if (!dbLogger) {
    registerComponent('database', 'Database connection pool');
    dbLogger = getLogger('database');
  }
  return dbLogger;
}

/**
 * Initialize the database connection pool
 */
export function initPool(config: DatabaseConfig): Pool {
  if (pool) {
    return pool;
  }

  const poolOptions: PoolOptions = {
    ...DEFAULT_CONFIG,
    ...config,
    namedPlaceholders: true,
  };

  pool = mysql.createPool(poolOptions);

  const logger = getDbLogger();

  // Log new connections at debug level
  pool.on('connection', (connection: mysql.PoolConnection) => {
    if (logger.isDebugEnabled()) {
      logger.debug(`New connection established (threadId: ${connection.threadId})`);
    }
  });

  // mysql2/promise pool wraps the underlying callback pool.
  // Event emitters for pool-level errors and enqueue live on the inner pool.
  const innerPool = (pool as any).pool;
  if (innerPool) {
    innerPool.on('error', (err: Error) => {
      logger.error('Connection pool error', err);
    });

    innerPool.on('enqueue', () => {
      logger.warn('Connection pool exhausted — query queued waiting for available connection');
    });
  }

  return pool;
}

/**
 * Get the current pool instance
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return pool;
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a SELECT query and return rows
 */
export async function query<T extends RowDataPacket>(
  sql: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const p = getPool();
  const [rows] = await p.query<T[]>(sql, params);
  return rows;
}

/**
 * Execute an INSERT/UPDATE/DELETE query and return result
 */
export async function execute(
  sql: string,
  params?: Record<string, unknown>
): Promise<ResultSetHeader> {
  const p = getPool();
  const [result] = await p.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Execute multiple statements in a transaction
 */
export async function transaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const p = getPool();
  const connection = await p.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    try {
      connection.release();
    } catch (releaseErr) {
      getDbLogger().error('Failed to release connection', releaseErr as Error);
    }
  }
}

/**
 * Check if the database connection is healthy
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a database operation with automatic retry on deadlock.
 * Retries on MySQL error 1213 (ER_LOCK_DEADLOCK) and 1205 (ER_LOCK_WAIT_TIMEOUT).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = DB_DEADLOCK_RETRIES
): Promise<T> {
  const logger = getDbLogger();
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const errno = error?.errno ?? error?.code;
      if ((errno === 1213 || errno === 1205) && attempt < maxRetries) {
        const delay = 100 * Math.pow(2, attempt - 1); // 100, 200, 400ms
        logger.warn(
          `Deadlock detected (errno ${errno}), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError!;
}
