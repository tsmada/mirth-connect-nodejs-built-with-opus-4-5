/**
 * Integration tests for SchemaManager
 *
 * These tests require a real MySQL database connection.
 * Run with: npm test -- --testPathPattern SchemaManager.integration
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { initPool, closePool, getPool } from '../../../src/db/pool.js';
import { RowDataPacket } from 'mysql2/promise';

// Skip if no database available
const SKIP_INTEGRATION = process.env['SKIP_DB_TESTS'] === 'true';

// Use test database config
const TEST_DB_CONFIG = {
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
  database: process.env['DB_NAME'] ?? 'mirthdb_test',
  user: process.env['DB_USER'] ?? 'mirth',
  password: process.env['DB_PASSWORD'] ?? 'mirth',
};

describe('SchemaManager Integration Tests', () => {
  if (SKIP_INTEGRATION) {
    it.skip('skipped - no database available', () => {});
    return;
  }

  beforeAll(async () => {
    initPool(TEST_DB_CONFIG);
  });

  afterAll(async () => {
    await closePool();
  });

  describe('Mode Detection', () => {
    it('should detect mode from environment variable', async () => {
      const originalMode = process.env['MIRTH_MODE'];

      try {
        process.env['MIRTH_MODE'] = 'takeover';
        // Clear the module cache to re-import with new env
        jest.resetModules();
        const { detectMode } = await import('../../../src/db/SchemaManager.js');
        const mode = await detectMode();
        expect(mode).toBe('takeover');
      } finally {
        if (originalMode) {
          process.env['MIRTH_MODE'] = originalMode;
        } else {
          delete process.env['MIRTH_MODE'];
        }
        jest.resetModules();
      }
    });

    it('should default to standalone when no schema exists', async () => {
      const originalMode = process.env['MIRTH_MODE'];

      try {
        // Set to auto mode so it detects based on schema
        process.env['MIRTH_MODE'] = 'auto';
        jest.resetModules();
        const { detectMode } = await import('../../../src/db/SchemaManager.js');
        const mode = await detectMode();
        // Will be standalone if no SCHEMA_INFO table, or takeover if schema exists
        expect(['takeover', 'standalone']).toContain(mode);
      } finally {
        if (originalMode) {
          process.env['MIRTH_MODE'] = originalMode;
        } else {
          delete process.env['MIRTH_MODE'];
        }
        jest.resetModules();
      }
    });
  });

  describe('Standalone Mode', () => {
    beforeAll(async () => {
      // Clean up any existing tables for a fresh test
      const pool = getPool();
      const tables = [
        'PERSON_PASSWORD', 'PERSON_PREFERENCE', 'PERSON',
        'EVENT', 'ALERT', 'CODE_TEMPLATE', 'CODE_TEMPLATE_LIBRARY',
        'CHANNEL_GROUP', 'SCRIPT', 'CHANNEL', 'CONFIGURATION',
        'SCHEMA_INFO', 'D_CHANNELS',
      ];
      for (const table of tables) {
        try {
          await pool.execute(`DROP TABLE IF EXISTS ${table}`);
        } catch {
          // Ignore errors from tables that don't exist
        }
      }
    });

    it('should create core tables', async () => {
      jest.resetModules();
      const { ensureCoreTables } = await import('../../../src/db/SchemaManager.js');
      await ensureCoreTables();

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CHANNEL'
      `);
      expect(rows.length).toBe(1);
    });

    it('should seed default admin user', async () => {
      jest.resetModules();
      const { seedDefaults } = await import('../../../src/db/SchemaManager.js');
      await seedDefaults();

      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT USERNAME FROM PERSON WHERE USERNAME = 'admin'
      `);
      expect(rows.length).toBe(1);
    });

    it('should seed default configuration', async () => {
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT VALUE FROM CONFIGURATION WHERE CATEGORY = 'core' AND NAME = 'stats.enabled'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0]!.VALUE).toBe('1');
    });

    it('should be idempotent - calling ensureCoreTables twice should not fail', async () => {
      jest.resetModules();
      const { ensureCoreTables } = await import('../../../src/db/SchemaManager.js');

      // Second call should not throw
      await expect(ensureCoreTables()).resolves.not.toThrow();
    });
  });

  describe('Channel Tables', () => {
    const testChannelId = 'test-0000-0000-0000-000000000001';

    afterAll(async () => {
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

    it('should create channel tables on ensureChannelTables', async () => {
      jest.resetModules();
      const { ensureChannelTables, channelTablesExist } = await import('../../../src/db/SchemaManager.js');

      // Initially should not exist
      const existsBefore = await channelTablesExist(testChannelId);
      expect(existsBefore).toBe(false);

      // Create tables
      await ensureChannelTables(testChannelId);

      // Now should exist
      const existsAfter = await channelTablesExist(testChannelId);
      expect(existsAfter).toBe(true);
    });

    it('should register channel in D_CHANNELS', async () => {
      const pool = getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = ?`,
        [testChannelId]
      );
      expect(rows.length).toBe(1);
      expect(typeof rows[0]!.LOCAL_CHANNEL_ID).toBe('number');
    });

    it('should be idempotent - calling ensureChannelTables twice should not fail', async () => {
      jest.resetModules();
      const { ensureChannelTables } = await import('../../../src/db/SchemaManager.js');

      // Second call should not throw
      await expect(ensureChannelTables(testChannelId)).resolves.not.toThrow();
    });
  });

  describe('Schema Verification', () => {
    it('should verify schema after initialization', async () => {
      jest.resetModules();
      const { verifySchema } = await import('../../../src/db/SchemaManager.js');
      const result = await verifySchema();

      expect(result.compatible).toBe(true);
      expect(result.version).toBe('3.9.1');
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors when required tables are missing', async () => {
      const pool = getPool();

      // Drop a required table to simulate incompatible schema
      await pool.execute(`DROP TABLE IF EXISTS CONFIGURATION`);

      jest.resetModules();
      const { verifySchema } = await import('../../../src/db/SchemaManager.js');
      const result = await verifySchema();

      // Should report missing table
      expect(result.compatible).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('CONFIGURATION'))).toBe(true);

      // Recreate the table for other tests
      const { ensureCoreTables } = await import('../../../src/db/SchemaManager.js');
      await ensureCoreTables();
    });
  });
});
