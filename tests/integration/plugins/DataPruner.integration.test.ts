/**
 * DataPruner Integration Tests
 *
 * Tests the Data Pruner plugin against a real MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as MirthDao from '../../../src/db/MirthDao';
import * as DonkeyDao from '../../../src/db/DonkeyDao';
import { Status } from '../../../src/model/Status';
import { ContentType } from '../../../src/model/ContentType';

// Test channel ID (valid UUID format)
const TEST_CHANNEL_ID = 'test0000-0000-0000-0000-pruner000001';

// Simple auto-incrementing message ID
let nextMessageId = 1;
function getNextMessageId(): number {
  return nextMessageId++;
}

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

      // Insert old message (simulate message from 10 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', oldDate);
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, messageId, true);

      // Query for messages older than 7 days using getMessagesToPrune
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      const messagesToPrune = await DonkeyDao.getMessagesToPrune(
        TEST_CHANNEL_ID,
        cutoffDate,
        100
      );

      expect(messagesToPrune.some((m) => m.messageId === messageId)).toBe(true);
    });

    it('should delete messages by age using pruneMessages', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert messages with different ages
      const recentId = getNextMessageId();
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, recentId, 'test-server', recentDate);
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, recentId, true);

      const oldId = getNextMessageId();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, oldId, 'test-server', oldDate);
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, oldId, true);

      // Get messages to prune (older than 10 days)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 10);

      const toPrune = await DonkeyDao.getMessagesToPrune(TEST_CHANNEL_ID, cutoffDate, 100);
      const pruneIds = toPrune.map(m => m.messageId);

      if (pruneIds.length > 0) {
        // Prune the messages
        const deleted = await DonkeyDao.pruneMessages(TEST_CHANNEL_ID, pruneIds);
        expect(deleted).toBeGreaterThanOrEqual(1);
      }

      // Verify older message was deleted
      const oldMessage = await DonkeyDao.getMessage(TEST_CHANNEL_ID, oldId);
      expect(oldMessage).toBeNull();

      // Verify newer message still exists
      const newMessage = await DonkeyDao.getMessage(TEST_CHANNEL_ID, recentId);
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
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, messageId, true);

      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0,
        'Source',
        new Date(),
        Status.RECEIVED
      );

      await DonkeyDao.insertContent(
        TEST_CHANNEL_ID,
        messageId,
        0,
        ContentType.RAW,
        'Large content that should be pruned',
        'HL7V2',
        false
      );

      // Prune content only (takes array of message IDs)
      const pruned = await DonkeyDao.pruneMessageContent(TEST_CHANNEL_ID, [messageId]);
      expect(pruned).toBeGreaterThan(0);

      // Verify metadata still exists
      const message = await DonkeyDao.getMessage(TEST_CHANNEL_ID, messageId);
      expect(message).not.toBeNull();

      // Verify content was pruned
      const content = await DonkeyDao.getContent(
        TEST_CHANNEL_ID,
        messageId,
        0,
        ContentType.RAW
      );
      expect(content).toBeNull();
    });
  });
});
