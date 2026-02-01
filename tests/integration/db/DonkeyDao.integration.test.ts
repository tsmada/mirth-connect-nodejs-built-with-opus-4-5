/**
 * Database integration tests for DonkeyDao
 *
 * These tests require a running MySQL database.
 * Run with: npm run docker:up && npm test -- --testPathPattern=integration
 *
 * Note: These tests are skipped by default if DB is not available.
 */

import { initPool, closePool, getPool } from '../../../src/db/pool';
import * as DonkeyDao from '../../../src/db/DonkeyDao';
import { Status } from '../../../src/model/Status';
import { ContentType } from '../../../src/model/ContentType';

const TEST_CHANNEL_ID = 'test_integration_channel';

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

describe('DonkeyDao Integration Tests', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) {
      console.warn('Database not available, skipping integration tests');
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test tables
      try {
        await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);
      } catch {
        // Ignore if tables don't exist
      }
      await closePool();
    }
  });

  describe('Channel Tables', () => {
    beforeEach(async () => {
      if (!dbAvailable) return;
      // Ensure clean state
      try {
        await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);
      } catch {
        // Ignore if tables don't exist
      }
    });

    it('should create channel tables', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await DonkeyDao.createChannelTables(TEST_CHANNEL_ID);

      // Verify tables exist by trying to query them
      const pool = getPool();
      const channelIdSafe = TEST_CHANNEL_ID.replace(/-/g, '_');

      const [msgRows] = await pool.query(`SELECT * FROM D_M${channelIdSafe} LIMIT 1`);
      expect(Array.isArray(msgRows)).toBe(true);

      const [connRows] = await pool.query(`SELECT * FROM D_MM${channelIdSafe} LIMIT 1`);
      expect(Array.isArray(connRows)).toBe(true);

      const [contentRows] = await pool.query(`SELECT * FROM D_MC${channelIdSafe} LIMIT 1`);
      expect(Array.isArray(contentRows)).toBe(true);
    });

    it('should drop channel tables', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      await DonkeyDao.createChannelTables(TEST_CHANNEL_ID);
      await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);

      // Verify tables don't exist
      const pool = getPool();
      const channelIdSafe = TEST_CHANNEL_ID.replace(/-/g, '_');

      await expect(pool.query(`SELECT * FROM D_M${channelIdSafe}`)).rejects.toThrow();
    });
  });

  describe('Message Operations', () => {
    beforeAll(async () => {
      if (!dbAvailable) return;
      await DonkeyDao.createChannelTables(TEST_CHANNEL_ID);
    });

    afterAll(async () => {
      if (!dbAvailable) return;
      await DonkeyDao.dropChannelTables(TEST_CHANNEL_ID);
    });

    it('should get next message ID', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const id1 = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      const id2 = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);

      expect(id2).toBe(id1 + 1);
    });

    it('should insert and retrieve a message', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const messageId = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      const receivedDate = new Date();

      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', receivedDate);

      const message = await DonkeyDao.getMessage(TEST_CHANNEL_ID, messageId);

      expect(message).not.toBeNull();
      expect(message?.ID).toBe(messageId);
      expect(message?.SERVER_ID).toBe('test-server');
      expect(message?.PROCESSED).toBe(0);
    });

    it('should update message processed status', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const messageId = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      await DonkeyDao.updateMessageProcessed(TEST_CHANNEL_ID, messageId, true);

      const message = await DonkeyDao.getMessage(TEST_CHANNEL_ID, messageId);
      expect(message?.PROCESSED).toBe(1);
    });

    it('should insert and retrieve connector messages', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const messageId = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());

      // Insert source connector (metaDataId = 0)
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0,
        'Source',
        new Date(),
        Status.RECEIVED
      );

      // Insert destination connector (metaDataId = 1)
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        1,
        'Destination 1',
        new Date(),
        Status.RECEIVED
      );

      const connectorMessages = await DonkeyDao.getConnectorMessages(TEST_CHANNEL_ID, messageId);

      expect(connectorMessages).toHaveLength(2);
      expect(connectorMessages[0]?.METADATA_ID).toBe(0);
      expect(connectorMessages[0]?.CONNECTOR_NAME).toBe('Source');
      expect(connectorMessages[1]?.METADATA_ID).toBe(1);
      expect(connectorMessages[1]?.CONNECTOR_NAME).toBe('Destination 1');
    });

    it('should update connector message status', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const messageId = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0,
        'Source',
        new Date(),
        Status.RECEIVED
      );

      await DonkeyDao.updateConnectorMessageStatus(
        TEST_CHANNEL_ID,
        messageId,
        0,
        Status.TRANSFORMED
      );

      const connectorMessages = await DonkeyDao.getConnectorMessages(TEST_CHANNEL_ID, messageId);
      expect(connectorMessages[0]?.STATUS).toBe(Status.TRANSFORMED);
    });

    it('should insert and retrieve message content', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: DB not available');
        return;
      }

      const messageId = await DonkeyDao.getNextMessageId(TEST_CHANNEL_ID);
      await DonkeyDao.insertMessage(TEST_CHANNEL_ID, messageId, 'test-server', new Date());
      await DonkeyDao.insertConnectorMessage(
        TEST_CHANNEL_ID,
        messageId,
        0,
        'Source',
        new Date(),
        Status.RECEIVED
      );

      const rawContent = 'MSH|^~\\&|TEST|||';
      await DonkeyDao.insertContent(
        TEST_CHANNEL_ID,
        messageId,
        0,
        ContentType.RAW,
        rawContent,
        'HL7V2',
        false
      );

      const content = await DonkeyDao.getContent(
        TEST_CHANNEL_ID,
        messageId,
        0,
        ContentType.RAW
      );

      expect(content).not.toBeNull();
      expect(content?.CONTENT).toBe(rawContent);
      expect(content?.DATA_TYPE).toBe('HL7V2');
      expect(content?.IS_ENCRYPTED).toBe(0);
    });
  });
});
