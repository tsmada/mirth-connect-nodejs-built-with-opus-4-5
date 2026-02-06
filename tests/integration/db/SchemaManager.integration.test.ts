/**
 * Integration tests for SchemaManager
 *
 * These tests require a real MySQL database connection.
 * Run with: npm test -- --testPathPattern SchemaManager.integration
 *
 * Note: Tests are skipped if DB is not available.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { initPool, closePool, getPool } from '../../../src/db/pool.js';
import { RowDataPacket } from 'mysql2/promise';
import {
  detectMode,
  ensureCoreTables,
  seedDefaults,
  verifySchema,
  ensureChannelTables,
  channelTablesExist,
} from '../../../src/db/SchemaManager.js';

// Use test database config
const TEST_DB_CONFIG = {
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
  database: process.env['DB_NAME'] ?? 'mirthdb',
  user: process.env['DB_USER'] ?? 'mirth',
  password: process.env['DB_PASSWORD'] ?? 'mirth',
};

// Check if DB is available
const isDbAvailable = async (): Promise<boolean> => {
  try {
    initPool(TEST_DB_CONFIG);
    const pool = getPool();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

describe('SchemaManager Integration Tests', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await closePool();
    }
  });

  describe('Mode Detection', () => {
    it('should detect mode from environment variable', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const originalMode = process.env['MIRTH_MODE'];

      try {
        process.env['MIRTH_MODE'] = 'takeover';
        const mode = await detectMode();
        expect(mode).toBe('takeover');
      } finally {
        if (originalMode) {
          process.env['MIRTH_MODE'] = originalMode;
        } else {
          delete process.env['MIRTH_MODE'];
        }
      }
    });

    it('should default to standalone when no schema exists', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const originalMode = process.env['MIRTH_MODE'];

      try {
        // Set to auto mode so it detects based on schema
        process.env['MIRTH_MODE'] = 'auto';
        const mode = await detectMode();
        // Will be standalone if no SCHEMA_INFO table, or takeover if schema exists
        expect(['takeover', 'standalone']).toContain(mode);
      } finally {
        if (originalMode) {
          process.env['MIRTH_MODE'] = originalMode;
        } else {
          delete process.env['MIRTH_MODE'];
        }
      }
    });
  });

  describe('Standalone Mode', () => {
    it('should create core tables', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await ensureCoreTables();

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CHANNEL'
      `);
      expect(rows.length).toBe(1);
    });

    it('should seed default admin user', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await seedDefaults();

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT USERNAME FROM PERSON WHERE USERNAME = 'admin'
      `);
      expect(rows.length).toBe(1);
    });

    it('should seed default configuration', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT VALUE FROM CONFIGURATION WHERE CATEGORY = 'core' AND NAME = 'stats.enabled'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0]!.VALUE).toBe('1');
    });

    it('should be idempotent - calling ensureCoreTables twice should not fail', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Second call should not throw
      await expect(ensureCoreTables()).resolves.not.toThrow();
    });
  });

  describe('Channel Tables', () => {
    const testChannelId = 'test-0000-0000-0000-000000000001';

    afterAll(async () => {
      if (!dbAvailable) return;

      // Clean up test channel tables
      const pool = getPool();
      const tableId = testChannelId.replace(/-/g, '_');
      const tables = ['D_M', 'D_MM', 'D_MC', 'D_MA', 'D_MS', 'D_MSQ', 'D_MCM'];
      for (const prefix of tables) {
        try {
          await pool.execute(`DROP TABLE IF EXISTS ${prefix}${tableId}`);
        } catch {
          // Ignore errors
        }
      }
      try {
        await pool.execute(`DELETE FROM D_CHANNELS WHERE CHANNEL_ID = ?`, [testChannelId]);
      } catch {
        // Ignore errors
      }
    });

    it('should create channel tables and register in D_CHANNELS', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Ensure core tables (including D_CHANNELS) exist first
      await ensureCoreTables();

      // Create channel-specific tables
      await ensureChannelTables(testChannelId);

      // Channel message tables should exist
      const existsAfter = await channelTablesExist(testChannelId);
      expect(existsAfter).toBe(true);

      // Channel should be registered in D_CHANNELS
      const pool = getPool();

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = ?`,
        [testChannelId]
      );
      expect(rows.length).toBe(1);
      expect(typeof rows[0]!.LOCAL_CHANNEL_ID).toBe('number');
    });

    it('should be idempotent - calling ensureChannelTables twice should not fail', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Second call should not throw
      await expect(ensureChannelTables(testChannelId)).resolves.not.toThrow();
    });
  });

  describe('Schema Verification', () => {
    it('should verify schema after initialization', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const result = await verifySchema();

      expect(result.compatible).toBe(true);
      expect(result.version).toBe('3.9.1');
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors when required tables are missing', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const pool = getPool();

      // Drop a required table to simulate incompatible schema
      await pool.execute(`DROP TABLE IF EXISTS CONFIGURATION`);

      const result = await verifySchema();

      // Should report missing table
      expect(result.compatible).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('CONFIGURATION'))).toBe(true);

      // Recreate the table for other tests
      await ensureCoreTables();
    });
  });
});
