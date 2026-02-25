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
  timezone?: string;
}

const DEFAULT_POOL_SIZE = 10;
const DB_ACQUIRE_TIMEOUT = parseInt(process.env.DB_ACQUIRE_TIMEOUT || '30000', 10);

const DEFAULT_CONFIG: Partial<DatabaseConfig> = {
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || String(DEFAULT_POOL_SIZE), 10),
  waitForConnections: true,
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '200', 10),
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
  timezone: process.env.DB_TIMEZONE || '+00:00',
};

let pool: Pool | null = null;
let lastPoolConfig: DatabaseConfig | null = null;

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
    // mysql2 uses connectTimeout for new connections; acquireTimeout controls
    // how long pool.getConnection() waits for a free slot (via queueLimit + timeout)
  };

  pool = mysql.createPool(poolOptions);
  lastPoolConfig = { ...DEFAULT_CONFIG, ...config } as DatabaseConfig;

  const logger = getDbLogger();

  const limit = poolOptions.connectionLimit ?? DEFAULT_POOL_SIZE;
  const queueLimit = poolOptions.queueLimit ?? 200;
  logger.info(
    `Database pool initialized: connectionLimit=${limit}, queueLimit=${queueLimit}, acquireTimeout=${DB_ACQUIRE_TIMEOUT}ms`
  );

  // Log new connections at debug level
  pool.on('connection', (connection: mysql.PoolConnection) => {
    if (logger.isDebugEnabled()) {
      logger.debug(`New connection established (threadId: ${connection.threadId})`);
    }
  });

  // mysql2/promise pool wraps the underlying callback pool.
  // Event emitters for pool-level errors and enqueue live on the inner pool.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const innerPool = (pool as any).pool;
  if (innerPool) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    innerPool.on('error', (err: Error) => {
      logger.error('Connection pool error', err);
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    innerPool.on('enqueue', () => {
      const stats = getPoolStats();
      logger.warn(
        `Connection pool saturated — query queued (active: ${stats.active}/${stats.limit}, queued: ${stats.queued}/${queueLimit})`
      );
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
    lastPoolConfig = null;
  }
}

/**
 * Pool statistics snapshot
 */
export interface PoolStats {
  active: number;
  idle: number;
  queued: number;
  total: number;
  limit: number;
}

/**
 * Get current pool statistics.
 * Extracts from mysql2's internal pool state for observability.
 */
export function getPoolStats(): PoolStats {
  if (!pool) {
    return { active: 0, idle: 0, queued: 0, total: 0, limit: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const innerPool = (pool as any).pool;
  if (!innerPool) {
    return { active: 0, idle: 0, queued: 0, total: 0, limit: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const total = (innerPool._allConnections?.length as number) ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const idle = (innerPool._freeConnections?.length as number) ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const queued = (innerPool._connectionQueue?.length as number) ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const limit = (innerPool.config?.connectionLimit as number) ?? DEFAULT_POOL_SIZE;

  return {
    active: total - idle,
    idle,
    queued,
    total,
    limit,
  };
}

/**
 * Get current pool configuration.
 */
export function getPoolConfig(): { connectionLimit: number; queueLimit: number } {
  if (!lastPoolConfig) {
    return {
      connectionLimit: DEFAULT_POOL_SIZE,
      queueLimit: 200,
    };
  }
  return {
    connectionLimit: lastPoolConfig.connectionLimit ?? DEFAULT_POOL_SIZE,
    queueLimit: lastPoolConfig.queueLimit ?? 200,
  };
}

/**
 * Close the current pool and create a new one with updated config.
 * ONLY safe when no active transactions (e.g., at startup before channel deployment).
 */
export async function recreatePool(config: DatabaseConfig): Promise<Pool> {
  const logger = getDbLogger();
  if (pool) {
    logger.info('Closing existing pool for recreation...');
    await pool.end();
    pool = null;
    lastPoolConfig = null;
  }
  return initPool(config);
}

/**
 * Whether DB_POOL_SIZE was explicitly set by the user (disables auto-scaling).
 */
export function isPoolSizeExplicit(): boolean {
  return process.env.DB_POOL_SIZE !== undefined;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const errno = error?.errno ?? error?.code;
      if ((errno === 1213 || errno === 1205) && attempt < maxRetries) {
        const delay = 100 * Math.pow(2, attempt - 1); // 100, 200, 400ms
        logger.warn(
          `Deadlock detected (errno ${errno}), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        lastError = error; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        continue;
      }
      throw error;
    }
  }
  throw lastError!;
}
