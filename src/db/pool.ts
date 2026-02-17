/**
 * MySQL connection pool for Mirth Connect Node.js Runtime
 *
 * Uses existing Mirth MySQL schema - do NOT modify tables.
 */

import mysql, { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

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
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
};

let pool: Pool | null = null;

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
    connection.release();
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
