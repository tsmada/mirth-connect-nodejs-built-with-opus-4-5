/**
 * Database integration tests for MirthDao
 *
 * These tests require a running MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 *
 * Note: These tests are skipped by default if DB is not available.
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as MirthDao from '../../../src/db/MirthDao';

// Check if DB is available
const isDbAvailable = async (): Promise<boolean> => {
  try {
    initPool({
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
      database: process.env['DB_NAME'] ?? 'mirthdb',
      user: process.env['DB_USER'] ?? 'mirth',
      password: process.env['DB_PASSWORD'] ?? 'mirth',
    });
    const pool = getPool();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

describe('MirthDao Integration Tests', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
    } else {
      // Initialize schema for testing
      await MirthDao.initializeSchema();
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test data
      const pool = getPool();
      await pool.query("DELETE FROM CHANNEL WHERE ID LIKE 'test-%'");
      await pool.query("DELETE FROM CONFIGURATION WHERE CATEGORY = 'test'");
      await closePool();
    }
  });

  describe('Channel Operations', () => {
    const testChannelId = 'test-channel-' + Date.now();

    afterEach(async () => {
      if (!dbAvailable) return;
      // Clean up after each test
      try {
        await MirthDao.deleteChannel(testChannelId);
      } catch {
        // Ignore if doesn't exist
      }
    });

    it('should insert and retrieve a channel', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const channelXml = '<channel><name>Test Channel</name></channel>';
      await MirthDao.upsertChannel(testChannelId, 'Test Channel', channelXml, 1);

      const channel = await MirthDao.getChannelById(testChannelId);

      expect(channel).not.toBeNull();
      expect(channel?.ID).toBe(testChannelId);
      expect(channel?.NAME).toBe('Test Channel');
      expect(channel?.REVISION).toBe(1);
      expect(channel?.CHANNEL).toBe(channelXml);
    });

    it('should update a channel on upsert', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const channelXml1 = '<channel><name>Test Channel v1</name></channel>';
      const channelXml2 = '<channel><name>Test Channel v2</name></channel>';

      await MirthDao.upsertChannel(testChannelId, 'Test Channel', channelXml1, 1);
      await MirthDao.upsertChannel(testChannelId, 'Test Channel Updated', channelXml2, 2);

      const channel = await MirthDao.getChannelById(testChannelId);

      expect(channel?.NAME).toBe('Test Channel Updated');
      expect(channel?.REVISION).toBe(2);
      expect(channel?.CHANNEL).toBe(channelXml2);
    });

    it('should find channel by name', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const uniqueName = 'Unique Test Channel ' + Date.now();
      await MirthDao.upsertChannel(testChannelId, uniqueName, '<channel/>', 1);

      const channel = await MirthDao.getChannelByName(uniqueName);

      expect(channel).not.toBeNull();
      expect(channel?.ID).toBe(testChannelId);
    });

    it('should return null for non-existent channel', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const channel = await MirthDao.getChannelById('non-existent-id');
      expect(channel).toBeNull();
    });

    it('should delete a channel', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await MirthDao.upsertChannel(testChannelId, 'To Delete', '<channel/>', 1);
      await MirthDao.deleteChannel(testChannelId);

      const channel = await MirthDao.getChannelById(testChannelId);
      expect(channel).toBeNull();
    });

    it('should list all channels', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await MirthDao.upsertChannel(testChannelId, 'List Test', '<channel/>', 1);

      const channels = await MirthDao.getChannels();

      expect(channels.length).toBeGreaterThanOrEqual(1);
      const found = channels.find((c) => c.ID === testChannelId);
      expect(found).toBeDefined();
    });
  });

  describe('Configuration Operations', () => {
    it('should set and get configuration', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await MirthDao.setConfiguration('test', 'setting1', 'value1');

      const value = await MirthDao.getConfiguration('test', 'setting1');

      expect(value).toBe('value1');
    });

    it('should update configuration on duplicate', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await MirthDao.setConfiguration('test', 'setting2', 'original');
      await MirthDao.setConfiguration('test', 'setting2', 'updated');

      const value = await MirthDao.getConfiguration('test', 'setting2');

      expect(value).toBe('updated');
    });

    it('should return null for non-existent configuration', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const value = await MirthDao.getConfiguration('test', 'non-existent');
      expect(value).toBeNull();
    });

    it('should get configuration by category', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await MirthDao.setConfiguration('test', 'cat1', 'val1');
      await MirthDao.setConfiguration('test', 'cat2', 'val2');

      const configs = await MirthDao.getConfigurationByCategory('test');

      expect(configs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
