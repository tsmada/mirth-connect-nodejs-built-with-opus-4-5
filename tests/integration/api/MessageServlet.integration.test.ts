/**
 * MessageServlet Integration Tests
 *
 * Tests the Message API endpoints against a real MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 *
 * Note: Tests are skipped if DB is not available.
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as MirthDao from '../../../src/db/MirthDao';
import * as DonkeyDao from '../../../src/db/DonkeyDao';

// Test channel ID (valid UUID format)
const TEST_CHANNEL_ID = 'test0000-0000-0000-0000-000000000001';

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

describe('MessageServlet Integration Tests', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
      return;
    }

    // Initialize schema
    await MirthDao.initializeSchema();

    // Create test channel
    const channelXml = `<channel><id>${TEST_CHANNEL_ID}</id><name>Test Channel</name></channel>`;
    await MirthDao.upsertChannel(TEST_CHANNEL_ID, 'Test Channel', channelXml, 1);

    // Create message tables for the channel
    await DonkeyDao.createChannelTables(TEST_CHANNEL_ID);
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test data
      try {
        await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);
        await MirthDao.deleteChannel(TEST_CHANNEL_ID);
      } catch {
        // Ignore cleanup errors
      }
      await closePool();
    }
  });

  describe('Message CRUD Operations', () => {
    it('should insert and retrieve a message', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert a test message
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: false,
      });

      expect(messageId).toBeGreaterThan(0);

      // Retrieve the message
      const message = await DonkeyDao.getMessageById(TEST_CHANNEL_ID, messageId);

      expect(message).not.toBeNull();
      expect(message?.id).toBe(messageId);
      expect(message?.serverId).toBe('test-server');
    });

    it('should search messages with filters', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert multiple messages
      const msg1 = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: true,
      });

      const msg2 = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: false,
      });

      // Search for processed messages
      const results = await DonkeyDao.searchMessages(TEST_CHANNEL_ID, {
        processed: true,
        limit: 10,
        offset: 0,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((m) => m.id === msg1)).toBe(true);
    });

    it('should get message count', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const count = await DonkeyDao.getMessageCount(TEST_CHANNEL_ID, {});

      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Connector Message Operations', () => {
    it('should insert connector message with content', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: false,
      });

      // Insert connector message
      await DonkeyDao.insertConnectorMessage(TEST_CHANNEL_ID, {
        messageId,
        metaDataId: 0, // Source
        connectorName: 'Source',
        receivedDate: new Date(),
        status: 'RECEIVED',
      });

      // Insert content
      await DonkeyDao.insertMessageContent(TEST_CHANNEL_ID, {
        messageId,
        metaDataId: 0,
        contentType: 1, // RAW
        content: 'Test message content',
        encrypted: false,
      });

      // Retrieve connector message
      const connectorMsg = await DonkeyDao.getConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0
      );

      expect(connectorMsg).not.toBeNull();
      expect(connectorMsg?.status).toBe('RECEIVED');
    });
  });

  describe('Attachment Operations', () => {
    it('should create and retrieve attachment', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: false,
      });

      // Create attachment
      const attachmentId = await DonkeyDao.insertAttachment(TEST_CHANNEL_ID, {
        messageId,
        id: 'att-001',
        type: 'text/plain',
        content: Buffer.from('Hello, World!'),
      });

      expect(attachmentId).toBeDefined();

      // Retrieve attachment
      const attachment = await DonkeyDao.getAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-001'
      );

      expect(attachment).not.toBeNull();
      expect(attachment?.type).toBe('text/plain');
      expect(attachment?.content.toString()).toBe('Hello, World!');
    });

    it('should delete attachment', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: false,
      });

      // Create attachment
      await DonkeyDao.insertAttachment(TEST_CHANNEL_ID, {
        messageId,
        id: 'att-del-001',
        type: 'text/plain',
        content: Buffer.from('To be deleted'),
      });

      // Delete attachment
      const deleted = await DonkeyDao.deleteAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-del-001'
      );

      expect(deleted).toBe(true);

      // Verify deletion
      const attachment = await DonkeyDao.getAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-del-001'
      );

      expect(attachment).toBeNull();
    });
  });

  describe('Message Reprocessing', () => {
    it('should reprocess a message', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert message with ERROR status
      const messageId = await DonkeyDao.insertMessage(TEST_CHANNEL_ID, {
        serverId: 'test-server',
        received: new Date(),
        processed: true,
      });

      // Insert connector message with ERROR
      await DonkeyDao.insertConnectorMessage(TEST_CHANNEL_ID, {
        messageId,
        metaDataId: 1, // Destination 1
        connectorName: 'Destination 1',
        receivedDate: new Date(),
        status: 'ERROR',
        errors: 'Connection timeout',
      });

      // Mark for reprocessing
      const marked = await DonkeyDao.markForReprocessing(TEST_CHANNEL_ID, messageId);

      expect(marked).toBe(true);

      // Verify status changed
      const updated = await DonkeyDao.getConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        1
      );

      expect(updated?.status).toBe('PENDING');
    });
  });
});
