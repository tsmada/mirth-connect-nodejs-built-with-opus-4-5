/**
 * Pluggable backend for Mirth global maps.
 *
 * Allows GlobalMap and GlobalChannelMap to be backed by in-memory, database,
 * or Redis storage. In single-instance mode the default InMemoryMapBackend
 * is used (matching current behavior). In clustered mode a DatabaseMapBackend
 * or RedisMapBackend can be swapped in for shared state.
 */

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MapBackend {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  getAll(): Promise<Map<string, unknown>>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// In-memory backend (default, single-instance)
// ---------------------------------------------------------------------------

export class InMemoryMapBackend implements MapBackend {
  private data = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async getAll(): Promise<Map<string, unknown>> {
    return new Map(this.data);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
}

// ---------------------------------------------------------------------------
// Database backend (clustered fallback without Redis)
// ---------------------------------------------------------------------------

interface GlobalMapRow extends RowDataPacket {
  MAP_KEY: string;
  MAP_VALUE: string | null;
}

interface VersionedMapRow extends RowDataPacket {
  MAP_KEY: string;
  MAP_VALUE: string | null;
  VERSION: number;
}

/**
 * Database-backed map using the D_GLOBAL_MAP table.
 *
 * Table schema:
 *   D_GLOBAL_MAP (
 *     SCOPE      VARCHAR(255) NOT NULL,
 *     MAP_KEY    VARCHAR(255) NOT NULL,
 *     MAP_VALUE  LONGTEXT,
 *     UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *     PRIMARY KEY(SCOPE, MAP_KEY)
 *   )
 *
 * Values are JSON.stringify'd before storage and JSON.parse'd on read.
 * The `scope` discriminator allows a single table to serve GlobalMap ('global')
 * and all per-channel GlobalChannelMaps ('gcm:{channelId}').
 */
export class DatabaseMapBackend implements MapBackend {
  private scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  async get(key: string): Promise<unknown | undefined> {
    const pool = getPool();
    const [rows] = await pool.query<GlobalMapRow[]>(
      'SELECT MAP_VALUE FROM D_GLOBAL_MAP WHERE SCOPE = ? AND MAP_KEY = ?',
      [this.scope, key]
    );
    if (rows.length === 0) return undefined;
    const raw = rows[0]!.MAP_VALUE;
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const pool = getPool();
    const serialized = JSON.stringify(value);
    await pool.execute(
      `INSERT INTO D_GLOBAL_MAP (SCOPE, MAP_KEY, MAP_VALUE, VERSION)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE MAP_VALUE = VALUES(MAP_VALUE), VERSION = VERSION + 1`,
      [this.scope, key, serialized]
    );
  }

  async delete(key: string): Promise<boolean> {
    const pool = getPool();
    const [result] = await pool.execute(
      'DELETE FROM D_GLOBAL_MAP WHERE SCOPE = ? AND MAP_KEY = ?',
      [this.scope, key]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }

  async getAll(): Promise<Map<string, unknown>> {
    const pool = getPool();
    const [rows] = await pool.query<GlobalMapRow[]>(
      'SELECT MAP_KEY, MAP_VALUE FROM D_GLOBAL_MAP WHERE SCOPE = ?',
      [this.scope]
    );
    const map = new Map<string, unknown>();
    for (const row of rows) {
      const raw = row.MAP_VALUE;
      if (raw === null) {
        map.set(row.MAP_KEY, undefined);
      } else {
        try {
          map.set(row.MAP_KEY, JSON.parse(raw));
        } catch {
          map.set(row.MAP_KEY, raw);
        }
      }
    }
    return map;
  }

  async clear(): Promise<void> {
    const pool = getPool();
    await pool.execute('DELETE FROM D_GLOBAL_MAP WHERE SCOPE = ?', [this.scope]);
  }

  async has(key: string): Promise<boolean> {
    const pool = getPool();
    const [rows] = await pool.query<GlobalMapRow[]>(
      'SELECT 1 AS MAP_KEY, NULL AS MAP_VALUE FROM D_GLOBAL_MAP WHERE SCOPE = ? AND MAP_KEY = ?',
      [this.scope, key]
    );
    return rows.length > 0;
  }

  /**
   * Get a value along with its version for optimistic locking.
   * Returns undefined if key doesn't exist.
   */
  async getWithVersion(key: string): Promise<{ value: unknown; version: number } | undefined> {
    const pool = getPool();
    const [rows] = await pool.query<VersionedMapRow[]>(
      'SELECT MAP_VALUE, VERSION FROM D_GLOBAL_MAP WHERE SCOPE = ? AND MAP_KEY = ?',
      [this.scope, key]
    );
    if (rows.length === 0) return undefined;
    const raw = rows[0]!.MAP_VALUE;
    const version = rows[0]!.VERSION;
    if (raw === null) return { value: undefined, version };
    try {
      return { value: JSON.parse(raw), version };
    } catch {
      return { value: raw, version };
    }
  }

  /**
   * Set a value only if the current version matches (CAS — Compare And Swap).
   * Returns true if the update succeeded, false if the version didn't match
   * (another writer modified the value since we read it).
   * For new keys (no existing row), use expectedVersion = -1.
   */
  async setIfVersion(key: string, value: unknown, expectedVersion: number): Promise<boolean> {
    const pool = getPool();
    const serialized = JSON.stringify(value);

    if (expectedVersion === -1) {
      // Insert new key — fails if key already exists
      try {
        await pool.execute(
          `INSERT INTO D_GLOBAL_MAP (SCOPE, MAP_KEY, MAP_VALUE, VERSION)
           VALUES (?, ?, ?, 0)`,
          [this.scope, key, serialized]
        );
        return true;
      } catch (err: unknown) {
        const mysqlErr = err as { code?: string };
        if (mysqlErr.code === 'ER_DUP_ENTRY') return false;
        throw err;
      }
    }

    // Update existing key only if version matches
    const [result] = await pool.execute(
      `UPDATE D_GLOBAL_MAP SET MAP_VALUE = ?, VERSION = VERSION + 1
       WHERE SCOPE = ? AND MAP_KEY = ? AND VERSION = ?`,
      [serialized, this.scope, key, expectedVersion]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }
}

// ---------------------------------------------------------------------------
// Redis backend (clustered mode with Redis)
// ---------------------------------------------------------------------------

/**
 * Redis-backed map for clustered mode.
 *
 * Uses Redis hash sets (HGET/HSET/HDEL/HGETALL) for efficient key-value
 * operations scoped by a hash key (e.g. 'gm' for GlobalMap,
 * 'gcm:{channelId}' for per-channel maps).
 *
 * TODO: Requires ioredis dependency. Install with: npm install ioredis
 */
export class RedisMapBackend implements MapBackend {
  private hashKey: string;

  constructor(hashKey: string) {
    this.hashKey = hashKey;
  }

  async get(_key: string): Promise<unknown | undefined> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }

  async set(_key: string, _value: unknown): Promise<void> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }

  async getAll(): Promise<Map<string, unknown>> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }

  async clear(): Promise<void> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }

  async has(_key: string): Promise<boolean> {
    throw new Error(`Redis backend requires ioredis dependency (hashKey: ${this.hashKey})`);
  }
}
