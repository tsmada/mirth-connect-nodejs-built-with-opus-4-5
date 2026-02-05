/**
 * DataPruner Integration Tests
 *
 * Tests the Data Pruner plugin against a real MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as MirthDao from '../../../src/db/MirthDao';
import * as DonkeyDao from '../../../src/db/DonkeyDao';

// Test channel ID (valid UUID format)
const TEST_CHANNEL_ID = 'test0000-0000-0000-0000-pruner000001';

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

describe('DataPruner Integration Tests', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
      return;
    }

    // Initialize schema
    await MirthDao.initializeSchema();

    // Create test channel with pruning settings
    const channelXml = `<channel>
      <id>${TEST_CHANNEL_ID}</id>
      <name>Pruner Test Channel</name>
      <properties>
        <messageStorageMode>DEVELOPMENT</messageStorageMode>
        <pruneMetaDataDays>7</pruneMetaDataDays>
        <pruneContentDays>3</pruneContentDays>
      </properties>
    </channel>`;
    await MirthDao.upsertChannel(TEST_CHANNEL_ID, 'Pruner Test Channel', channelXml, 1);

    // Create message tables for the channel
    await DonkeyDao.createChannelTables(TEST_CHANNEL_ID);
  });

  afterAll(async () => {
    if (dbAvailable) {
      try {
        await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);
        await MirthDao.deleteChannel(TEST_CHANNEL_ID);
      } catch {
        // Ignore cleanup errors
      }
      await closePool();
    }
  });

  describe('Pruner Configuration', () => {
    it('should store and retrieve pruner settings', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const prunerConfig = {
        enabled: true,
        pollingInterval: 3600000, // 1 hour
        pruneEvents: true,
        pruneEventAge: 31, // days
        archiverEnabled: true,
        archiverIncludeAttachments: true,
        archiverBlockSize: 50,
      };

      // Store in CONFIGURATION table
      await MirthDao.setConfiguration('datapruner', 'settings', JSON.stringify(prunerConfig));

      // Retrieve
      const retrieved = await MirthDao.getConfiguration('datapruner', 'settings');

      expect(retrieved).not.toBeNull();
      const config = JSON.parse(retrieved!);
      expect(config.enabled).toBe(true);
      expect(config.pruneEventAge).toBe(31);
    });

    it('should get channel pruning settings', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const channel = await MirthDao.getChannelById(TEST_CHANNEL_ID);
      expect(channel).not.toBeNull();

      // Parse channel XML to verify pruning settings
      const channelXml = channel?.CHANNEL || '';
      expect(channelXml).toContain('pruneMetaDataDays');
      expect(channelXml).toContain('7');
    });
  });

  describe('Message Pruning', () => {
    it('should identify messages eligible for pruning', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert old messages (simulate messages from 10 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: oldDate,
        processed: true,
      });

      // Query for messages older than 7 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      const messagesToPrune = await DonkeyDao.searchMessages(TEST_CHANNEL_ID, {
        maxDate: cutoffDate,
        processed: true,
        limit: 100,
        offset: 0,
      });

      expect(messagesToPrune.some((m) => m.id === messageId)).toBe(true);
    });

    it('should delete messages by age', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert messages with different ages
      const dates = [
        { daysOld: 1, shouldDelete: false },
        { daysOld: 5, shouldDelete: false },
        { daysOld: 15, shouldDelete: true },
      ];

      const messageIds: number[] = [];
      for (const d of dates) {
        const date = new Date();
        date.setDate(date.getDate() - d.daysOld);

        const id = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
          serverId: 'test-server',
          received: date,
          processed: true,
        });
        messageIds.push(id);
      }

      // Delete messages older than 10 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 10);

      const deleted = await DonkeyDao.deleteMessagesOlderThan(
        TEST_CHANNEL_ID,
        cutoffDate
      );

      expect(deleted).toBeGreaterThanOrEqual(1);

      // Verify older message was deleted
      const oldMessage = await DonkeyDao.getMessageById(TEST_CHANNEL_ID, messageIds[2]);
      expect(oldMessage).toBeNull();

      // Verify newer messages still exist
      const newMessage = await DonkeyDao.getMessageById(TEST_CHANNEL_ID, messageIds[0]);
      expect(newMessage).not.toBeNull();
    });
  });

  describe('Content Pruning', () => {
    it('should prune message content while keeping metadata', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert message with content
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: true,
      });

      await DonkeyDao.insertConnectorMessage(TEST_CHANNEL_ID, {
        messageId,
        metaDataId: 0,
        connectorName: 'Source',
        receivedDate: new Date(),
        status: 'RECEIVED',
      });

      await DonkeyDao.insertMessageContent(TEST_CHANNEL_ID, {
        messageId,
        metaDataId: 0,
        contentType: 1,
        content: 'Large content that should be pruned',
        encrypted: false,
      });

      // Prune content only
      await DonkeyDao.pruneMessageContent(TEST_CHANNEL_ID, messageId);

      // Verify metadata still exists
      const message = await DonkeyDao.getMessageById(TEST_CHANNEL_ID, messageId);
      expect(message).not.toBeNull();

      // Verify content was pruned
      const content = await DonkeyDao.getMessageContent(TEST_CHANNEL_ID, messageId, 0);
      expect(content).toBeNull();
    });
  });
});
