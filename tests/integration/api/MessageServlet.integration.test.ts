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
import { Status } from '../../../src/model/Status';
import { ContentType } from '../../../src/model/ContentType';

// Test channel ID (valid UUID format)
const TEST_CHANNEL_ID = 'test0000-0000-0000-0000-000000000001';

// Simple auto-incrementing message ID (DB would normally handle this)
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
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      // Retrieve the message
      const message = await DonkeyDao.getMessage(TEST_CHANNEL_ID, messageId);

      expect(message).not.toBeNull();
      expect(message?.ID).toBe(messageId);
      expect(message?.SERVER_ID).toBe('test-server');
    });

    it('should search messages with filters', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert multiple messages
      const msg1 = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, msg1, 'test-server', new Date());
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, msg1, true);

      const msg2 = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, msg2, 'test-server', new Date());

      // Retrieve and verify messages exist
      const message1 = await DonkeyDao.getMessage(TEST_CHANNEL_ID, msg1);
      const message2 = await DonkeyDao.getMessage(TEST_CHANNEL_ID, msg2);

      expect(message1).not.toBeNull();
      expect(message2).not.toBeNull();
      expect(message1?.PROCESSED).toBe(1);
    });
  });

  describe('Connector Message Operations', () => {
    it('should insert connector message with content', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      // Insert connector message (positional args)
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0, // metaDataId (Source)
        'Source',
        new Date(),
        Status.RECEIVED
      );

      // Insert content
      await DonkeyDao.insertContent(
        TEST_CHANNEL_ID,
        messageId,
        0, // metaDataId
        ContentType.RAW,
        'Test message content',
        'HL7V2',
        false
      );

      // Retrieve connector messages
      const connectorMsgs = await DonkeyDao.getConnectorMessages(
        TEST_CHANNEL_ID,
        messageId
      );

      expect(connectorMsgs.length).toBeGreaterThan(0);
      const sourceMsg = connectorMsgs.find(m => m.METADATA_ID === 0);
      expect(sourceMsg).toBeDefined();
      expect(sourceMsg?.STATUS).toBe(Status.RECEIVED);
    });
  });

  describe('Attachment Operations', () => {
    it('should create and retrieve attachment', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      // Create attachment (positional args)
      await DonkeyDao.insertAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-001',
        'text/plain',
        Buffer.from('Hello, World!')
      );

      // Retrieve attachment
      const attachmentRows = await DonkeyDao.getAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-001'
      );

      expect(attachmentRows.length).toBeGreaterThan(0);
      expect(attachmentRows[0]!.TYPE).toBe('text/plain');
      expect(attachmentRows[0]!.ATTACHMENT?.toString()).toBe('Hello, World!');
    });

    it('should delete attachment', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert parent message
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      // Create attachment
      await DonkeyDao.insertAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-del-001',
        'text/plain',
        Buffer.from('To be deleted')
      );

      // Delete attachment (returns number of deleted rows)
      const deleted = await DonkeyDao.deleteAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-del-001'
      );

      expect(deleted).toBeGreaterThan(0);

      // Verify deletion
      const attachmentRows = await DonkeyDao.getAttachment(
        TEST_CHANNEL_ID,
        messageId,
        'att-del-001'
      );

      expect(attachmentRows.length).toBe(0);
    });
  });

  describe('Message Reprocessing', () => {
    it('should reprocess a message by updating connector status', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      // Insert message
      const messageId = getNextMessageId();
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());
      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, messageId, true);

      // Insert connector message with ERROR
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        1, // Destination 1
        'Destination 1',
        new Date(),
        Status.ERROR
      );

      // Reprocess by updating status to PENDING
      await DonkeyDao.updateConnectorMessageStatus(
        TEST_CHANNEL_ID,
        messageId,
        1,
        Status.PENDING
      );

      // Verify status changed
      const connectorMsgs = await DonkeyDao.getConnectorMessages(
        TEST_CHANNEL_ID,
        messageId
      );

      const dest1 = connectorMsgs.find(m => m.METADATA_ID === 1);
      expect(dest1?.STATUS).toBe(Status.PENDING);
    });
  });
});
