import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the pool module before importing DonkeyDao
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

// Mock the Encryptor module
const mockEncrypt = jest.fn((s: string) => `encrypted:${s}`);
const mockDecrypt = jest.fn((s: string) => s.replace('encrypted:', ''));
jest.mock('../../../src/db/Encryptor.js', () => ({
  isEncryptionEnabled: jest.fn(() => false),
  getEncryptor: jest.fn(() => ({ encrypt: mockEncrypt, decrypt: mockDecrypt })),
}));

import {
  resetStatistics,
  resetMessage,
  deleteConnectorMessagesByMetaDataIds,
  deleteMessageContentByMetaDataIds,
  deleteMessageStatistics,
  deleteMessageContent,
  deleteMessageAttachments,
  getUnfinishedMessages,
  getMaxMessageId,
  getMinMessageId,
  insertCustomMetaData,
  addMetaDataColumn,
  insertMessage,
  insertConnectorMessage,
  insertContent,
  storeContent,
  batchInsertContent,
  updateConnectorMessageStatus,
  updateMessageProcessed,
  updateStatistics,
  updateErrors,
  updateMaps,
  updateResponseMap,
  updateSendAttempts,
  getConnectorMessagesByStatus,
  getPendingConnectorMessages,
  messageTable,
  connectorMessageTable,
  contentTable,
  statisticsTable,
  validateChannelId,
  attachmentTable,
  sequenceTable,
  registerChannel,
  unregisterChannel,
  createChannelTables,
  dropChannelTables,
  getNextMessageId,
  getContent,
  getMessage,
  getConnectorMessages,
  addChannelStatistics,
  getStatistics,
  getContentBatch,
  getAttachmentsBatch,
  getLocalChannelIds,
  getLocalChannelId,
  channelTablesExist,
  getMessagesToPrune,
  pruneMessageContent,
  pruneMessageAttachments,
  pruneConnectorMessages,
  pruneMessages,
  getMessageCountBeforeDate,
  getAttachmentIds,
  getAttachments,
  getAttachment,
  insertAttachment,
  updateAttachment,
  deleteAttachment,
  deleteMessage,
  getMessages,
} from '../../../src/db/DonkeyDao.js';
import { getPool, transaction } from '../../../src/db/pool.js';
import { isEncryptionEnabled } from '../../../src/db/Encryptor.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { Status } from '../../../src/model/Status.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

// Helpers: create a mock pool with execute, query, and getConnection methods
function createMockPool() {
  return {
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 0 }]),
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
    getConnection: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
  };
}

// Helper: create a mock connection (same interface as pool for our purposes)
function createMockConn() {
  return {
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 0 }]),
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
  };
}

const TEST_CHANNEL = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
// Table name helper mirrors the source: hyphens replaced with underscores
const CH = TEST_CHANNEL.replace(/-/g, '_');

describe('DonkeyDao', () => {
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();
    mockGetPool.mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  // ==========================================================================
  // Phase 1D: Exported table name helpers
  // ==========================================================================
  describe('table name helpers', () => {
    it('messageTable should produce correct name', () => {
      expect(messageTable(TEST_CHANNEL)).toBe(`D_M${CH}`);
    });

    it('connectorMessageTable should produce correct name', () => {
      expect(connectorMessageTable(TEST_CHANNEL)).toBe(`D_MM${CH}`);
    });

    it('contentTable should produce correct name', () => {
      expect(contentTable(TEST_CHANNEL)).toBe(`D_MC${CH}`);
    });

    it('statisticsTable should produce correct name', () => {
      expect(statisticsTable(TEST_CHANNEL)).toBe(`D_MS${CH}`);
    });

    it('should handle UUIDs with multiple hyphens', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(messageTable(uuid)).toBe('D_Ma1b2c3d4_e5f6_7890_abcd_ef1234567890');
    });

    it('should reject non-UUID channel IDs', () => {
      expect(() => messageTable('invalid-id')).toThrow('Invalid channel ID format');
    });
  });

  // ==========================================================================
  // Phase 0A: updateErrors uses ContentType.RESPONSE_ERROR (14)
  // ==========================================================================
  describe('updateErrors', () => {
    it('should use ContentType.RESPONSE_ERROR (14) for responseError', async () => {
      // storeContent does an UPDATE first, then INSERT on miss.
      // The UPDATE call will include contentType 14 in the WHERE clause.
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await updateErrors(TEST_CHANNEL, 1, 0, undefined, undefined, undefined, 'resp error');

      // The first call should be the UPDATE from storeContent with RESPONSE_ERROR = 14
      const firstCall = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(firstCall[0]).toContain(`D_MC${CH}`);
      // The params should include 14 (RESPONSE_ERROR), not 15
      expect(firstCall[1]).toContain(ContentType.RESPONSE_ERROR);
      expect(firstCall[1]).toContain(14);
      expect(firstCall[1]).not.toContain(15);
    });

    it('should store processing error with correct content type', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await updateErrors(TEST_CHANNEL, 1, 0, 'proc error');

      const firstCall = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(firstCall[1]).toContain(ContentType.PROCESSING_ERROR);
    });

    it('should update ERROR_CODE in connector message table', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await updateErrors(TEST_CHANNEL, 1, 0, undefined, undefined, 7);

      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining(`UPDATE D_MM${CH} SET ERROR_CODE`),
        [7, 1, 0]
      );
    });

    it('should accept optional conn parameter', async () => {
      const mockConn = createMockConn();
      mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await updateErrors(TEST_CHANNEL, 1, 0, undefined, undefined, 5, undefined,
        mockConn as unknown as Parameters<typeof updateErrors>[7]);

      // Should use conn, not pool
      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Phase 1A: Optional conn parameter
  // ==========================================================================
  describe('optional conn parameter (Phase 1A)', () => {
    it('insertMessage should use conn when provided', async () => {
      const mockConn = createMockConn();
      await insertMessage(TEST_CHANNEL, 1, 'srv', new Date(),
        mockConn as unknown as Parameters<typeof insertMessage>[4]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('insertMessage should use pool when conn not provided', async () => {
      await insertMessage(TEST_CHANNEL, 1, 'srv', new Date());

      expect(mockPool.execute).toHaveBeenCalled();
    });

    it('updateConnectorMessageStatus should use conn when provided', async () => {
      const mockConn = createMockConn();
      await updateConnectorMessageStatus(TEST_CHANNEL, 1, 0, Status.SENT,
        mockConn as unknown as Parameters<typeof updateConnectorMessageStatus>[4]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('updateMessageProcessed should use conn when provided', async () => {
      const mockConn = createMockConn();
      await updateMessageProcessed(TEST_CHANNEL, 1, true,
        mockConn as unknown as Parameters<typeof updateMessageProcessed>[3]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('updateStatistics should use conn when provided', async () => {
      const mockConn = createMockConn();
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.RECEIVED, 1,
        mockConn as unknown as Parameters<typeof updateStatistics>[5]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('insertContent should use conn when provided', async () => {
      const mockConn = createMockConn();
      await insertContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'data', 'HL7V2', false,
        mockConn as unknown as Parameters<typeof insertContent>[7]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('storeContent should use conn for both UPDATE and INSERT fallback', async () => {
      const mockConn = createMockConn();
      // UPDATE returns 0 rows affected, triggering INSERT fallback
      mockConn.execute.mockResolvedValue([{ affectedRows: 0 }]);

      await storeContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'data', 'HL7V2', false,
        mockConn as unknown as Parameters<typeof storeContent>[7]);

      // Should have called conn.execute twice (UPDATE then INSERT)
      expect(mockConn.execute).toHaveBeenCalledTimes(2);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('updateMaps should use conn when provided', async () => {
      const mockConn = createMockConn();
      mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);
      const map = new Map([['key', 'val']]);

      await updateMaps(TEST_CHANNEL, 1, 0, map, undefined, undefined,
        mockConn as unknown as Parameters<typeof updateMaps>[6]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('updateResponseMap should use conn when provided', async () => {
      const mockConn = createMockConn();
      mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);
      const map = new Map([['key', 'val']]);

      await updateResponseMap(TEST_CHANNEL, 1, 0, map,
        mockConn as unknown as Parameters<typeof updateResponseMap>[4]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('updateSendAttempts should use conn when provided', async () => {
      const mockConn = createMockConn();
      await updateSendAttempts(TEST_CHANNEL, 1, 0, 3, undefined, undefined,
        mockConn as unknown as Parameters<typeof updateSendAttempts>[6]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('insertCustomMetaData should use conn when provided', async () => {
      const mockConn = createMockConn();
      await insertCustomMetaData(TEST_CHANNEL, 1, 0, { Name: 'test' },
        mockConn as unknown as Parameters<typeof insertCustomMetaData>[4]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Phase 1B: batchInsertContent
  // ==========================================================================
  describe('batchInsertContent', () => {
    it('should do nothing for empty rows array', async () => {
      await batchInsertContent(TEST_CHANNEL, []);

      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should insert multiple rows in single statement', async () => {
      await batchInsertContent(TEST_CHANNEL, [
        { messageId: 1, metaDataId: 0, contentType: ContentType.RAW, content: 'msg1', dataType: 'HL7V2', encrypted: false },
        { messageId: 1, metaDataId: 0, contentType: ContentType.TRANSFORMED, content: 'msg2', dataType: 'XML', encrypted: false },
      ]);

      expect(mockPool.execute).toHaveBeenCalledTimes(1);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      const sql = call[0];
      const params = call[1];

      expect(sql).toContain(`D_MC${CH}`);
      expect(sql).toContain('(?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)');
      expect(params).toEqual([
        1, 0, ContentType.RAW, 'msg1', 'HL7V2', 0,
        1, 0, ContentType.TRANSFORMED, 'msg2', 'XML', 0,
      ]);
    });

    it('should handle encrypted flag', async () => {
      await batchInsertContent(TEST_CHANNEL, [
        { messageId: 1, metaDataId: 0, contentType: ContentType.RAW, content: 'enc', dataType: 'HL7V2', encrypted: true },
      ]);

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      const params = call[1];
      // Last param should be 1 for encrypted=true
      expect(params[5]).toBe(1);
    });

    it('should accept optional conn parameter', async () => {
      const mockConn = createMockConn();
      await batchInsertContent(TEST_CHANNEL, [
        { messageId: 1, metaDataId: 0, contentType: ContentType.RAW, content: 'msg', dataType: 'HL7V2', encrypted: false },
      ], mockConn as unknown as Parameters<typeof batchInsertContent>[2]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Phase 1C: getConnectorMessagesByStatus / getPendingConnectorMessages
  // ==========================================================================
  describe('getConnectorMessagesByStatus', () => {
    it('should query by single status', async () => {
      const fakeRows = [{ MESSAGE_ID: 1, METADATA_ID: 0, STATUS: 'R' }];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getConnectorMessagesByStatus(TEST_CHANNEL, [Status.RECEIVED]);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
      expect(call[0]).toContain('STATUS IN (?)');
      expect(call[0]).toContain('ORDER BY MESSAGE_ID, METADATA_ID');
      expect(call[1]).toEqual(['R']);
    });

    it('should query by multiple statuses', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getConnectorMessagesByStatus(TEST_CHANNEL, [Status.RECEIVED, Status.PENDING]);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('STATUS IN (?, ?)');
      expect(call[1]).toEqual(['R', 'P']);
    });

    it('should filter by messageId when provided', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getConnectorMessagesByStatus(TEST_CHANNEL, [Status.ERROR], 42);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('AND MESSAGE_ID = ?');
      expect(call[1]).toEqual(['E', 42]);
    });

    it('should not include messageId filter when undefined', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getConnectorMessagesByStatus(TEST_CHANNEL, [Status.SENT]);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).not.toContain('AND MESSAGE_ID = ?');
      expect(call[1]).toEqual(['S']);
    });

    it('should use conn when provided', async () => {
      const mockConn = createMockConn();
      mockConn.query.mockResolvedValue([[]]);

      await getConnectorMessagesByStatus(TEST_CHANNEL, [Status.RECEIVED], undefined,
        mockConn as unknown as Parameters<typeof getConnectorMessagesByStatus>[3]);

      expect(mockConn.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('getPendingConnectorMessages', () => {
    it('should query for RECEIVED and PENDING statuses', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getPendingConnectorMessages(TEST_CHANNEL);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('STATUS IN (?, ?)');
      expect(call[1]).toEqual(['R', 'P']);
    });
  });

  // ==========================================================================
  // Phase 5A: insertConnectorMessage with options
  // ==========================================================================
  describe('insertConnectorMessage', () => {
    it('should insert basic connector message without options', async () => {
      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED);

      expect(mockPool.execute).toHaveBeenCalledTimes(1);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
    });

    it('should store maps when storeMaps option provided', async () => {
      // First call = INSERT connector message, subsequent = storeContent calls
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const sourceMap = new Map<string, unknown>([['src', 'val']]);
      const channelMap = new Map<string, unknown>([['ch', 'val']]);

      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        storeMaps: { sourceMap, channelMap },
      });

      // 1 INSERT for connector message + 2 UPDATEs for storeContent (sourceMap, channelMap)
      // storeContent does UPDATE first; if affectedRows=1 it stops (no INSERT)
      expect(mockPool.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should skip empty maps', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const emptyMap = new Map<string, unknown>();

      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        storeMaps: { sourceMap: emptyMap, connectorMap: emptyMap },
      });

      // Only the connector message INSERT, no storeContent calls
      expect(mockPool.execute).toHaveBeenCalledTimes(1);
    });

    it('should update statistics when updateStats option provided', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        updateStats: true,
        serverId: 'node-1',
      });

      // 1 INSERT + 1 updateStatistics
      expect(mockPool.execute).toHaveBeenCalledTimes(2);
      const statsCall = mockPool.execute.mock.calls[1] as unknown as [string, unknown[]];
      expect(statsCall[0]).toContain(`D_MS${CH}`);
      expect(statsCall[1]).toContain('node-1');
    });

    it('should not update statistics when serverId missing', async () => {
      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        updateStats: true,
        // serverId intentionally omitted
      });

      // Only the connector message INSERT
      expect(mockPool.execute).toHaveBeenCalledTimes(1);
    });

    it('should use conn when provided', async () => {
      const mockConn = createMockConn();
      mockConn.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0,
        undefined,
        mockConn as unknown as Parameters<typeof insertConnectorMessage>[8]);

      expect(mockConn.execute).toHaveBeenCalled();
      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // resetStatistics (existing tests)
  // ==========================================================================
  describe('resetStatistics', () => {
    it('should reset all statistics when no filter given', async () => {
      await resetStatistics(TEST_CHANNEL);

      expect(mockPool.execute).toHaveBeenCalledWith(
        `UPDATE D_MS${CH} SET RECEIVED=0, FILTERED=0, TRANSFORMED=0, PENDING=0, SENT=0, ERROR=0`,
        []
      );
    });

    it('should filter by metaDataId only', async () => {
      await resetStatistics(TEST_CHANNEL, 1);

      expect(mockPool.execute).toHaveBeenCalledWith(
        `UPDATE D_MS${CH} SET RECEIVED=0, FILTERED=0, TRANSFORMED=0, PENDING=0, SENT=0, ERROR=0 WHERE METADATA_ID = ?`,
        [1]
      );
    });

    it('should filter by metaDataId and serverId', async () => {
      await resetStatistics(TEST_CHANNEL, 2, 'server-1');

      expect(mockPool.execute).toHaveBeenCalledWith(
        `UPDATE D_MS${CH} SET RECEIVED=0, FILTERED=0, TRANSFORMED=0, PENDING=0, SENT=0, ERROR=0 WHERE METADATA_ID = ? AND SERVER_ID = ?`,
        [2, 'server-1']
      );
    });

    it('should not add serverId filter when metaDataId is undefined', async () => {
      await resetStatistics(TEST_CHANNEL, undefined, 'server-1');

      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.not.stringContaining('SERVER_ID'),
        []
      );
    });
  });

  // ==========================================================================
  // resetMessage (existing tests)
  // ==========================================================================
  describe('resetMessage', () => {
    it('should set PROCESSED=0 and reset destination connector messages', async () => {
      await resetMessage(TEST_CHANNEL, 42);

      expect(mockPool.execute).toHaveBeenCalledTimes(2);

      // First call: mark message as unprocessed
      expect(mockPool.execute).toHaveBeenNthCalledWith(1,
        `UPDATE D_M${CH} SET PROCESSED = 0 WHERE ID = ?`,
        [42]
      );

      // Second call: reset all destination connectors (METADATA_ID > 0) to PENDING
      expect(mockPool.execute).toHaveBeenNthCalledWith(2,
        expect.stringContaining(`UPDATE D_MM${CH} SET STATUS = 'P'`),
        [42]
      );
    });
  });

  // ==========================================================================
  // deleteConnectorMessagesByMetaDataIds (existing tests)
  // ==========================================================================
  describe('deleteConnectorMessagesByMetaDataIds', () => {
    it('should return 0 for empty metaDataIds array', async () => {
      const result = await deleteConnectorMessagesByMetaDataIds(TEST_CHANNEL, 1, []);
      expect(result).toBe(0);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should delete connector messages by metadata IDs', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 3 }]);

      const result = await deleteConnectorMessagesByMetaDataIds(TEST_CHANNEL, 10, [1, 2, 3]);

      expect(result).toBe(3);
      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MM${CH} WHERE MESSAGE_ID = ? AND METADATA_ID IN (?, ?, ?)`,
        [10, 1, 2, 3]
      );
    });

    it('should handle single metaDataId', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const result = await deleteConnectorMessagesByMetaDataIds(TEST_CHANNEL, 5, [1]);

      expect(result).toBe(1);
      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MM${CH} WHERE MESSAGE_ID = ? AND METADATA_ID IN (?)`,
        [5, 1]
      );
    });
  });

  // ==========================================================================
  // deleteMessageContentByMetaDataIds (existing tests)
  // ==========================================================================
  describe('deleteMessageContentByMetaDataIds', () => {
    it('should return 0 for empty metaDataIds array', async () => {
      const result = await deleteMessageContentByMetaDataIds(TEST_CHANNEL, 1, []);
      expect(result).toBe(0);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should delete content by metadata IDs', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 6 }]);

      const result = await deleteMessageContentByMetaDataIds(TEST_CHANNEL, 10, [1, 2]);

      expect(result).toBe(6);
      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MC${CH} WHERE MESSAGE_ID = ? AND METADATA_ID IN (?, ?)`,
        [10, 1, 2]
      );
    });
  });

  // ==========================================================================
  // deleteMessageStatistics (existing tests)
  // ==========================================================================
  describe('deleteMessageStatistics', () => {
    it('should delete statistics row for a specific metaDataId', async () => {
      await deleteMessageStatistics(TEST_CHANNEL, 3);

      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MS${CH} WHERE METADATA_ID = ?`,
        [3]
      );
    });
  });

  // ==========================================================================
  // deleteMessageContent (existing tests)
  // ==========================================================================
  describe('deleteMessageContent', () => {
    it('should delete all content for a message', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 5 }]);

      const result = await deleteMessageContent(TEST_CHANNEL, 99);

      expect(result).toBe(5);
      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MC${CH} WHERE MESSAGE_ID = ?`,
        [99]
      );
    });
  });

  // ==========================================================================
  // deleteMessageAttachments (existing tests)
  // ==========================================================================
  describe('deleteMessageAttachments', () => {
    it('should delete all attachments for a message', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 2 }]);

      const result = await deleteMessageAttachments(TEST_CHANNEL, 77);

      expect(result).toBe(2);
      expect(mockPool.execute).toHaveBeenCalledWith(
        `DELETE FROM D_MA${CH} WHERE MESSAGE_ID = ?`,
        [77]
      );
    });
  });

  // ==========================================================================
  // getUnfinishedMessages (existing tests)
  // ==========================================================================
  describe('getUnfinishedMessages', () => {
    it('should return unprocessed messages ordered by ID', async () => {
      const fakeRows = [
        { ID: 1, SERVER_ID: 's1', RECEIVED_DATE: new Date(), PROCESSED: 0 },
        { ID: 5, SERVER_ID: 's1', RECEIVED_DATE: new Date(), PROCESSED: 0 },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getUnfinishedMessages(TEST_CHANNEL);

      expect(result).toEqual(fakeRows);
      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT * FROM D_M${CH} WHERE PROCESSED = 0 ORDER BY ID`
      );
    });

    it('should return empty array when no unfinished messages', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getUnfinishedMessages(TEST_CHANNEL);

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // getMaxMessageId (existing tests)
  // ==========================================================================
  describe('getMaxMessageId', () => {
    it('should return the max message ID', async () => {
      mockPool.query.mockResolvedValue([[{ maxId: 42 }]]);

      const result = await getMaxMessageId(TEST_CHANNEL);

      expect(result).toBe(42);
      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT MAX(ID) as maxId FROM D_M${CH}`
      );
    });

    it('should return null when table is empty (MAX returns null)', async () => {
      mockPool.query.mockResolvedValue([[{ maxId: null }]]);

      const result = await getMaxMessageId(TEST_CHANNEL);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getMinMessageId (existing tests)
  // ==========================================================================
  describe('getMinMessageId', () => {
    it('should return the min message ID', async () => {
      mockPool.query.mockResolvedValue([[{ minId: 1 }]]);

      const result = await getMinMessageId(TEST_CHANNEL);

      expect(result).toBe(1);
      expect(mockPool.query).toHaveBeenCalledWith(
        `SELECT MIN(ID) as minId FROM D_M${CH}`
      );
    });

    it('should return null when table is empty', async () => {
      mockPool.query.mockResolvedValue([[{ minId: null }]]);

      const result = await getMinMessageId(TEST_CHANNEL);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // insertCustomMetaData (existing tests)
  // ==========================================================================
  describe('insertCustomMetaData', () => {
    it('should skip insert when data is empty', async () => {
      await insertCustomMetaData(TEST_CHANNEL, 1, 0, {});

      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should insert custom metadata with upsert', async () => {
      await insertCustomMetaData(TEST_CHANNEL, 10, 1, {
        PatientName: 'John Doe',
        MRN: '12345',
      });

      expect(mockPool.execute).toHaveBeenCalledTimes(1);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      const sql = call[0];
      const params = call[1];
      expect(sql).toContain(`D_MCM${CH}`);
      expect(sql).toContain('MESSAGE_ID, METADATA_ID');
      expect(sql).toContain('`PatientName`');
      expect(sql).toContain('`MRN`');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(params).toEqual([10, 1, 'John Doe', '12345']);
    });

    it('should handle single column', async () => {
      await insertCustomMetaData(TEST_CHANNEL, 5, 0, { Status: 'active' });

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('`Status`');
      expect(call[1]).toEqual([5, 0, 'active']);
    });
  });

  // ==========================================================================
  // addMetaDataColumn (existing tests)
  // ==========================================================================
  describe('addMetaDataColumn', () => {
    it('should add a column with default TEXT type', async () => {
      await addMetaDataColumn(TEST_CHANNEL, 'PatientName');

      expect(mockPool.execute).toHaveBeenCalledWith(
        `ALTER TABLE D_MCM${CH} ADD COLUMN \`PatientName\` TEXT`
      );
    });

    it('should add a column with custom type', async () => {
      await addMetaDataColumn(TEST_CHANNEL, 'Age', 'INT');

      expect(mockPool.execute).toHaveBeenCalledWith(
        `ALTER TABLE D_MCM${CH} ADD COLUMN \`Age\` INT`
      );
    });

    it('should silently ignore duplicate column errors', async () => {
      const dupError = new Error('Duplicate column name') as Error & { code: string };
      dupError.code = 'ER_DUP_FIELDNAME';
      mockPool.execute.mockRejectedValue(dupError);

      // Should NOT throw
      await expect(addMetaDataColumn(TEST_CHANNEL, 'Existing')).resolves.toBeUndefined();
    });

    it('should rethrow non-duplicate-column errors', async () => {
      const otherError = new Error('Connection lost') as Error & { code: string };
      otherError.code = 'ER_CONN_LOST';
      mockPool.execute.mockRejectedValue(otherError);

      await expect(addMetaDataColumn(TEST_CHANNEL, 'Bad')).rejects.toThrow('Connection lost');
    });
  });

  // ==========================================================================
  // Additional table name helpers
  // ==========================================================================
  describe('additional table name helpers', () => {
    it('attachmentTable should produce correct name', () => {
      expect(attachmentTable(TEST_CHANNEL)).toBe(`D_MA${CH}`);
    });

    it('sequenceTable should produce correct name', () => {
      expect(sequenceTable(TEST_CHANNEL)).toBe(`D_MSQ${CH}`);
    });

    it('validateChannelId should reject SQL injection attempts', () => {
      expect(() => validateChannelId('DROP TABLE--')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId("'; DROP TABLE")).toThrow('Invalid channel ID format');
    });

    it('validateChannelId should accept valid UUIDs and return underscore-replaced', () => {
      const result = validateChannelId(TEST_CHANNEL);
      expect(result).toBe(CH);
    });
  });

  // ==========================================================================
  // registerChannel
  // ==========================================================================
  describe('registerChannel', () => {
    it('should create D_CHANNELS table, insert channel, and return local ID', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockPool.query.mockResolvedValue([[{ LOCAL_CHANNEL_ID: 42 }]]);

      const result = await registerChannel(TEST_CHANNEL);

      expect(result).toBe(42);
      expect(mockPool.execute).toHaveBeenCalledTimes(2); // CREATE TABLE + INSERT IGNORE
      expect(mockPool.query).toHaveBeenCalledTimes(1); // SELECT
      const createCall = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(createCall[0]).toContain('CREATE TABLE IF NOT EXISTS D_CHANNELS');
      const insertCall = mockPool.execute.mock.calls[1] as unknown as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT IGNORE INTO D_CHANNELS');
      expect(insertCall[1]).toEqual([TEST_CHANNEL]);
    });
  });

  // ==========================================================================
  // unregisterChannel
  // ==========================================================================
  describe('unregisterChannel', () => {
    it('should delete channel from D_CHANNELS', async () => {
      await unregisterChannel(TEST_CHANNEL);

      expect(mockPool.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM D_CHANNELS WHERE CHANNEL_ID'),
        [TEST_CHANNEL]
      );
    });
  });

  // ==========================================================================
  // createChannelTables
  // ==========================================================================
  describe('createChannelTables', () => {
    it('should create all 7 tables plus indexes within a transaction', async () => {
      const mockConn = createMockConn();
      mockTransaction.mockImplementation(async (cb: any) => cb(mockConn));

      await createChannelTables(TEST_CHANNEL);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // 7 CREATE TABLE + 1 INSERT IGNORE (sequence init) + 3 CREATE INDEX = 11
      expect(mockConn.query.mock.calls.length).toBeGreaterThanOrEqual(8);

      const calls = mockConn.query.mock.calls as unknown as [string][];
      // Verify key tables are created
      const allSql = calls.map((c) => c[0]).join(' ');
      expect(allSql).toContain(`D_M${CH}`);
      expect(allSql).toContain(`D_MM${CH}`);
      expect(allSql).toContain(`D_MC${CH}`);
      expect(allSql).toContain(`D_MA${CH}`);
      expect(allSql).toContain(`D_MS${CH}`);
      expect(allSql).toContain(`D_MSQ${CH}`);
      expect(allSql).toContain(`D_MCM${CH}`);
    });

    it('should silently ignore index creation errors', async () => {
      const mockConn = createMockConn();
      // Make index creation fail for the 3 CREATE INDEX calls
      let callCount = 0;
      mockConn.query.mockImplementation(async () => {
        callCount++;
        // Calls 9, 10, 11 are CREATE INDEX (after 7 CREATE TABLE + 1 INSERT IGNORE)
        if (callCount >= 9) throw new Error('Duplicate key name');
        return [[]];
      });
      mockTransaction.mockImplementation(async (cb: any) => cb(mockConn));

      // Should NOT throw despite index creation errors
      await expect(createChannelTables(TEST_CHANNEL)).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // dropChannelTables
  // ==========================================================================
  describe('dropChannelTables', () => {
    it('should drop all 7 tables within a transaction', async () => {
      const mockConn = createMockConn();
      mockTransaction.mockImplementation(async (cb: any) => cb(mockConn));

      await dropChannelTables(TEST_CHANNEL);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockConn.query).toHaveBeenCalledTimes(7);
      const calls = mockConn.query.mock.calls as unknown as [string][];
      for (const call of calls) {
        expect(call[0]).toMatch(/^DROP TABLE IF EXISTS/);
      }
    });
  });

  // ==========================================================================
  // getNextMessageId
  // ==========================================================================
  describe('getNextMessageId', () => {
    it('should get current ID, increment, and return current', async () => {
      const mockConn = {
        beginTransaction: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        commit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        rollback: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[{ LOCAL_CHANNEL_ID: 5 }]]),
      };
      mockPool.getConnection = jest.fn<() => Promise<unknown>>().mockResolvedValue(mockConn) as any;

      const result = await getNextMessageId(TEST_CHANNEL);

      expect(result).toBe(5);
      expect(mockConn.beginTransaction).toHaveBeenCalled();
      expect(mockConn.commit).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
      // First query: SELECT ... FOR UPDATE, second: UPDATE
      expect(mockConn.query).toHaveBeenCalledTimes(2);
    });

    it('should rollback and release on error', async () => {
      const mockConn = {
        beginTransaction: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        commit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        rollback: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error('deadlock')),
      };
      mockPool.getConnection = jest.fn<() => Promise<unknown>>().mockResolvedValue(mockConn) as any;

      await expect(getNextMessageId(TEST_CHANNEL)).rejects.toThrow('deadlock');
      expect(mockConn.rollback).toHaveBeenCalled();
      expect(mockConn.release).toHaveBeenCalled();
    });

    it('should default to 1 when no rows exist', async () => {
      const mockConn = {
        beginTransaction: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        commit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        rollback: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
      };
      mockPool.getConnection = jest.fn<() => Promise<unknown>>().mockResolvedValue(mockConn) as any;

      const result = await getNextMessageId(TEST_CHANNEL);
      expect(result).toBe(1);
    });
  });

  // ==========================================================================
  // insertContent - encryption branches
  // ==========================================================================
  describe('insertContent - encryption branches', () => {
    it('should store as plaintext when encrypted=true but no encryptor configured', async () => {
      // isEncryptionEnabled() returns false by default
      await insertContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'data', 'HL7V2', true);

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      // IS_ENCRYPTED should be 0 because no real encryptor configured
      expect(call[1]![5]).toBe(0);
    });

    it('should encrypt content when encryption is enabled', async () => {
      (isEncryptionEnabled as jest.Mock).mockReturnValueOnce(true);

      await insertContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'secret', 'HL7V2', true);

      expect(mockEncrypt).toHaveBeenCalledWith('secret');
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      // Content should be encrypted, IS_ENCRYPTED should be 1
      expect(call[1]![3]).toBe('encrypted:secret');
      expect(call[1]![5]).toBe(1);
    });
  });

  // ==========================================================================
  // storeContent - encryption branches
  // ==========================================================================
  describe('storeContent - encryption branches', () => {
    it('should fall back to plaintext when encrypted=true but no encryptor', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await storeContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'data', 'HL7V2', true);

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      // IS_ENCRYPTED should be 0
      expect(call[1]![2]).toBe(0);
    });

    it('should encrypt content when encryption is enabled', async () => {
      (isEncryptionEnabled as jest.Mock).mockReturnValueOnce(true);
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await storeContent(TEST_CHANNEL, 1, 0, ContentType.RAW, 'secret', 'HL7V2', true);

      expect(mockEncrypt).toHaveBeenCalledWith('secret');
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      // Content should be encrypted, IS_ENCRYPTED should be 1
      expect(call[1]![0]).toBe('encrypted:secret');
      expect(call[1]![2]).toBe(1);
    });
  });

  // ==========================================================================
  // insertConnectorMessage - connectorMap and responseMap branches
  // ==========================================================================
  describe('insertConnectorMessage - all map branches', () => {
    it('should store connectorMap when non-empty', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const connectorMap = new Map<string, unknown>([['key', 'val']]);
      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        storeMaps: { connectorMap },
      });

      // 1 INSERT + 1 storeContent for connectorMap
      expect(mockPool.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should store responseMap when non-empty', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const responseMap = new Map<string, unknown>([['resp', 'ok']]);
      await insertConnectorMessage(TEST_CHANNEL, 1, 0, 'Source', new Date(), Status.RECEIVED, 0, {
        storeMaps: { responseMap },
      });

      expect(mockPool.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // updateErrors - postProcessorError branch
  // ==========================================================================
  describe('updateErrors - postProcessorError', () => {
    it('should store postProcessorError with POSTPROCESSOR_ERROR content type', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      await updateErrors(TEST_CHANNEL, 1, 0, undefined, 'post error');

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[1]).toContain(ContentType.POSTPROCESSOR_ERROR);
    });
  });

  // ==========================================================================
  // updateMaps - channelMap and responseMap branches
  // ==========================================================================
  describe('updateMaps - all map branches', () => {
    it('should store channelMap when non-empty', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const channelMap = new Map<string, unknown>([['ch', 'val']]);
      await updateMaps(TEST_CHANNEL, 1, 0, undefined, channelMap);

      expect(mockPool.execute).toHaveBeenCalled();
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[1]).toContain(ContentType.CHANNEL_MAP);
    });

    it('should store responseMap when non-empty', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const responseMap = new Map<string, unknown>([['resp', 'ok']]);
      await updateMaps(TEST_CHANNEL, 1, 0, undefined, undefined, responseMap);

      expect(mockPool.execute).toHaveBeenCalled();
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[1]).toContain(ContentType.RESPONSE_MAP);
    });

    it('should skip empty maps', async () => {
      await updateMaps(TEST_CHANNEL, 1, 0, new Map(), new Map(), new Map());

      expect(mockPool.execute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getContent
  // ==========================================================================
  describe('getContent', () => {
    it('should return content row when found', async () => {
      const fakeRow = {
        MESSAGE_ID: 1,
        METADATA_ID: 0,
        CONTENT_TYPE: 1,
        CONTENT: 'MSH|test',
        DATA_TYPE: 'HL7V2',
        IS_ENCRYPTED: 0,
      };
      mockPool.query.mockResolvedValue([[fakeRow]]);

      const result = await getContent(TEST_CHANNEL, 1, 0, ContentType.RAW);

      expect(result).toEqual(fakeRow);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MC${CH}`);
      expect(call[1]).toEqual([1, 0, ContentType.RAW]);
    });

    it('should return null when not found', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getContent(TEST_CHANNEL, 99, 0, ContentType.RAW);

      expect(result).toBeNull();
    });

    it('should decrypt encrypted content', async () => {
      const fakeRow = {
        MESSAGE_ID: 1,
        METADATA_ID: 0,
        CONTENT_TYPE: 1,
        CONTENT: 'encrypted-data',
        DATA_TYPE: 'HL7V2',
        IS_ENCRYPTED: 1,
      };
      mockPool.query.mockResolvedValue([[fakeRow]]);

      const result = await getContent(TEST_CHANNEL, 1, 0, ContentType.RAW);

      expect(result).not.toBeNull();
      // IS_ENCRYPTED should be set to 0 after decryption
      expect(result!.IS_ENCRYPTED).toBe(0);
    });

    it('should handle decrypt failure gracefully and return row unchanged', async () => {
      const fakeRow = {
        MESSAGE_ID: 1,
        METADATA_ID: 0,
        CONTENT_TYPE: 1,
        CONTENT: 'corrupt-data',
        DATA_TYPE: 'HL7V2',
        IS_ENCRYPTED: 1,
      };
      mockPool.query.mockResolvedValue([[fakeRow]]);
      mockDecrypt.mockImplementationOnce(() => { throw new Error('Bad decrypt'); });

      const result = await getContent(TEST_CHANNEL, 1, 0, ContentType.RAW);

      // Should return the row without crashing (content unchanged)
      expect(result).not.toBeNull();
      expect(result!.CONTENT).toBe('corrupt-data');
    });
  });

  // ==========================================================================
  // getMessage
  // ==========================================================================
  describe('getMessage', () => {
    it('should return message row when found', async () => {
      const fakeRow = { ID: 42, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1 };
      mockPool.query.mockResolvedValue([[fakeRow]]);

      const result = await getMessage(TEST_CHANNEL, 42);

      expect(result).toEqual(fakeRow);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_M${CH}`);
      expect(call[1]).toEqual([42]);
    });

    it('should return null when not found', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getMessage(TEST_CHANNEL, 999);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getConnectorMessages
  // ==========================================================================
  describe('getConnectorMessages', () => {
    it('should return connector messages ordered by METADATA_ID', async () => {
      const fakeRows = [
        { MESSAGE_ID: 1, METADATA_ID: 0, STATUS: 'R' },
        { MESSAGE_ID: 1, METADATA_ID: 1, STATUS: 'S' },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getConnectorMessages(TEST_CHANNEL, 1);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
      expect(call[0]).toContain('ORDER BY METADATA_ID');
      expect(call[1]).toEqual([1]);
    });

    it('should return empty array when none found', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getConnectorMessages(TEST_CHANNEL, 999);

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // addChannelStatistics
  // ==========================================================================
  describe('addChannelStatistics', () => {
    it('should batch update statistics sorted by metaDataId (0 first)', async () => {
      const stats = new Map<number, Map<Status, number>>();
      stats.set(1, new Map([[Status.SENT, 5]]));
      stats.set(0, new Map([[Status.RECEIVED, 10]]));

      await addChannelStatistics(TEST_CHANNEL, 'srv', stats);

      // metaDataId 0 should be processed first (sorted)
      expect(mockPool.execute).toHaveBeenCalledTimes(2);
      const firstCall = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(firstCall[1]![0]).toBe(0); // metaDataId 0 first
      const secondCall = mockPool.execute.mock.calls[1] as unknown as [string, unknown[]];
      expect(secondCall[1]![0]).toBe(1); // then metaDataId 1
    });

    it('should handle multiple statuses per metaDataId', async () => {
      const stats = new Map<number, Map<Status, number>>();
      stats.set(0, new Map([
        [Status.RECEIVED, 10],
        [Status.ERROR, 2],
      ]));

      await addChannelStatistics(TEST_CHANNEL, 'srv', stats);

      expect(mockPool.execute).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // getStatistics
  // ==========================================================================
  describe('getStatistics', () => {
    it('should return statistics rows', async () => {
      const fakeRows = [
        { METADATA_ID: 0, SERVER_ID: 'srv', RECEIVED: 10, FILTERED: 2, TRANSFORMED: 0, PENDING: 0, SENT: 8, ERROR: 0 },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getStatistics(TEST_CHANNEL);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string];
      expect(call[0]).toContain(`D_MS${CH}`);
    });
  });

  // ==========================================================================
  // getContentBatch
  // ==========================================================================
  describe('getContentBatch', () => {
    it('should return empty array for empty messageIds', async () => {
      const result = await getContentBatch(TEST_CHANNEL, []);

      expect(result).toEqual([]);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should batch query content rows', async () => {
      const fakeRows = [
        { MESSAGE_ID: 1, METADATA_ID: 0, CONTENT_TYPE: 1, CONTENT: 'data', DATA_TYPE: 'HL7V2', IS_ENCRYPTED: 0 },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getContentBatch(TEST_CHANNEL, [1, 2]);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MC${CH}`);
      expect(call[0]).toContain('IN (?, ?)');
      expect(call[1]).toEqual([1, 2]);
    });
  });

  // ==========================================================================
  // getAttachmentsBatch
  // ==========================================================================
  describe('getAttachmentsBatch', () => {
    it('should return empty array for empty messageIds', async () => {
      const result = await getAttachmentsBatch(TEST_CHANNEL, []);

      expect(result).toEqual([]);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should batch query attachment rows', async () => {
      const fakeRows = [
        { ID: 'att-1', MESSAGE_ID: 1, TYPE: 'application/pdf', SEGMENT_ID: 0, ATTACHMENT: Buffer.from('data') },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getAttachmentsBatch(TEST_CHANNEL, [1, 2, 3]);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[0]).toContain('IN (?, ?, ?)');
      expect(call[0]).toContain('ORDER BY ID, SEGMENT_ID');
      expect(call[1]).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // getLocalChannelIds
  // ==========================================================================
  describe('getLocalChannelIds', () => {
    it('should return map from D_CHANNELS table', async () => {
      mockPool.query.mockResolvedValue([[
        { CHANNEL_ID: 'ch-1', LOCAL_CHANNEL_ID: 1 },
        { CHANNEL_ID: 'ch-2', LOCAL_CHANNEL_ID: 2 },
      ]]);

      const result = await getLocalChannelIds();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('ch-1')).toBe(1);
      expect(result.get('ch-2')).toBe(2);
    });

    it('should fall back to information_schema when D_CHANNELS does not exist', async () => {
      // First call throws (D_CHANNELS doesn't exist), second returns table names
      mockPool.query
        .mockRejectedValueOnce(new Error('Table does not exist'))
        .mockResolvedValueOnce([[
          { TABLE_NAME: 'D_Ma1b2c3d4_e5f6_7890_abcd_ef1234567890' },
        ]]);

      const result = await getLocalChannelIds();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      expect(result.get('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(1);
    });
  });

  // ==========================================================================
  // getLocalChannelId
  // ==========================================================================
  describe('getLocalChannelId', () => {
    it('should return local ID when channel exists', async () => {
      mockPool.query.mockResolvedValue([[
        { CHANNEL_ID: TEST_CHANNEL, LOCAL_CHANNEL_ID: 42 },
      ]]);

      const result = await getLocalChannelId(TEST_CHANNEL);

      expect(result).toBe(42);
    });

    it('should return null when channel not found', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await getLocalChannelId('nonexistent-00-0000-0000-000000000000');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // channelTablesExist
  // ==========================================================================
  describe('channelTablesExist', () => {
    it('should return true when table exists', async () => {
      mockPool.query.mockResolvedValue([[{ TABLE_NAME: `D_M${CH}` }]]);

      const result = await channelTablesExist(TEST_CHANNEL);

      expect(result).toBe(true);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('information_schema.TABLES');
      expect(call[1]).toEqual([`D_M${CH}`]);
    });

    it('should return false when table does not exist', async () => {
      mockPool.query.mockResolvedValue([[]]);

      const result = await channelTablesExist(TEST_CHANNEL);

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getMessagesToPrune
  // ==========================================================================
  describe('getMessagesToPrune', () => {
    it('should query messages before date threshold with limit', async () => {
      const threshold = new Date('2024-01-01');
      const fakeRows = [{ messageId: 1, receivedDate: new Date() }];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getMessagesToPrune(TEST_CHANNEL, threshold, 100);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_M${CH}`);
      expect(call[0]).toContain('RECEIVED_DATE < ?');
      expect(call[0]).toContain('PROCESSED = 1');
      expect(call[0]).toContain('LIMIT ?');
      expect(call[1]).toEqual([threshold, 100]);
    });

    it('should skip incomplete when skipIncomplete=false', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getMessagesToPrune(TEST_CHANNEL, new Date(), 100, undefined, false);

      const call = mockPool.query.mock.calls[0] as unknown as [string];
      expect(call[0]).not.toContain('PROCESSED = 1');
    });

    it('should filter by skipStatuses', async () => {
      mockPool.query.mockResolvedValue([[]]);

      await getMessagesToPrune(TEST_CHANNEL, new Date(), 50, ['Q', 'P']);

      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('NOT EXISTS');
      expect(call[0]).toContain('STATUS IN (?, ?)');
      expect(call[1]).toContain('Q');
      expect(call[1]).toContain('P');
    });
  });

  // ==========================================================================
  // pruneMessageContent
  // ==========================================================================
  describe('pruneMessageContent', () => {
    it('should return 0 for empty messageIds', async () => {
      const result = await pruneMessageContent(TEST_CHANNEL, []);

      expect(result).toBe(0);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should delete content for specified messages', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 5 }]);

      const result = await pruneMessageContent(TEST_CHANNEL, [1, 2, 3]);

      expect(result).toBe(5);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MC${CH}`);
      expect(call[0]).toContain('IN (?, ?, ?)');
      expect(call[1]).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // pruneMessageAttachments
  // ==========================================================================
  describe('pruneMessageAttachments', () => {
    it('should return 0 for empty messageIds', async () => {
      const result = await pruneMessageAttachments(TEST_CHANNEL, []);

      expect(result).toBe(0);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should delete attachments for specified messages', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 3 }]);

      const result = await pruneMessageAttachments(TEST_CHANNEL, [1, 2]);

      expect(result).toBe(3);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[0]).toContain('IN (?, ?)');
    });
  });

  // ==========================================================================
  // pruneConnectorMessages
  // ==========================================================================
  describe('pruneConnectorMessages', () => {
    it('should return 0 for empty messageIds', async () => {
      const result = await pruneConnectorMessages(TEST_CHANNEL, []);

      expect(result).toBe(0);
      expect(mockPool.execute).not.toHaveBeenCalled();
    });

    it('should delete connector messages for specified messages', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 4 }]);

      const result = await pruneConnectorMessages(TEST_CHANNEL, [10, 20]);

      expect(result).toBe(4);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MM${CH}`);
      expect(call[0]).toContain('IN (?, ?)');
    });
  });

  // ==========================================================================
  // pruneMessages
  // ==========================================================================
  describe('pruneMessages', () => {
    it('should return 0 for empty messageIds', async () => {
      const result = await pruneMessages(TEST_CHANNEL, []);

      expect(result).toBe(0);
    });

    it('should delete from all tables in correct order within transaction', async () => {
      const mockConn = createMockConn();
      mockConn.execute.mockResolvedValue([{ affectedRows: 2 }]);
      mockTransaction.mockImplementation(async (cb: any) => cb(mockConn));

      const result = await pruneMessages(TEST_CHANNEL, [1, 2]);

      expect(result).toBe(2);
      expect(mockConn.execute).toHaveBeenCalledTimes(5); // content, attachments, custom metadata, connector messages, messages
      const calls = mockConn.execute.mock.calls as unknown as [string, unknown[]][];
      expect(calls[0]![0]).toContain(`D_MC${CH}`);
      expect(calls[1]![0]).toContain(`D_MA${CH}`);
      expect(calls[2]![0]).toContain(`D_MCM${CH}`);
      expect(calls[3]![0]).toContain(`D_MM${CH}`);
      expect(calls[4]![0]).toContain(`D_M${CH}`);
    });
  });

  // ==========================================================================
  // getMessageCountBeforeDate
  // ==========================================================================
  describe('getMessageCountBeforeDate', () => {
    it('should return count of messages before date', async () => {
      mockPool.query.mockResolvedValue([[{ count: 42 }]]);
      const threshold = new Date('2024-06-01');

      const result = await getMessageCountBeforeDate(TEST_CHANNEL, threshold);

      expect(result).toBe(42);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_M${CH}`);
      expect(call[0]).toContain('RECEIVED_DATE < ?');
      expect(call[1]).toEqual([threshold]);
    });

    it('should return 0 when no messages', async () => {
      mockPool.query.mockResolvedValue([[{ count: 0 }]]);

      const result = await getMessageCountBeforeDate(TEST_CHANNEL, new Date());

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // Attachment methods
  // ==========================================================================
  describe('getAttachmentIds', () => {
    it('should return distinct attachment IDs', async () => {
      mockPool.query.mockResolvedValue([[{ ID: 'att-1' }, { ID: 'att-2' }]]);

      const result = await getAttachmentIds(TEST_CHANNEL, 1);

      expect(result).toEqual(['att-1', 'att-2']);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('DISTINCT ID');
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[1]).toEqual([1]);
    });
  });

  describe('getAttachments', () => {
    it('should return all attachments for a message', async () => {
      const fakeRows = [
        { ID: 'att-1', MESSAGE_ID: 1, TYPE: 'text/plain', SEGMENT_ID: 0, ATTACHMENT: Buffer.from('data') },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getAttachments(TEST_CHANNEL, 1);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[0]).toContain('ORDER BY ID, SEGMENT_ID');
    });
  });

  describe('getAttachment', () => {
    it('should return attachment segments by ID', async () => {
      const fakeRows = [
        { ID: 'att-1', MESSAGE_ID: 1, TYPE: 'text/plain', SEGMENT_ID: 0, ATTACHMENT: Buffer.from('data') },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getAttachment(TEST_CHANNEL, 1, 'att-1');

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[0]).toContain('WHERE MESSAGE_ID = ? AND ID = ?');
      expect(call[0]).toContain('ORDER BY SEGMENT_ID');
      expect(call[1]).toEqual([1, 'att-1']);
    });
  });

  describe('insertAttachment', () => {
    it('should insert attachment with segment 0', async () => {
      await insertAttachment(TEST_CHANNEL, 1, 'att-1', 'application/pdf', Buffer.from('content'));

      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[0]).toContain('INSERT INTO');
      expect(call[1]).toEqual(['att-1', 1, 'application/pdf', Buffer.from('content')]);
    });
  });

  describe('updateAttachment', () => {
    it('should delete existing segments then insert new', async () => {
      await updateAttachment(TEST_CHANNEL, 1, 'att-1', 'text/plain', Buffer.from('new'));

      // First execute: DELETE existing, second: INSERT new
      expect(mockPool.execute).toHaveBeenCalledTimes(2);
      const deleteCall = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(deleteCall[0]).toContain('DELETE FROM');
      expect(deleteCall[0]).toContain(`D_MA${CH}`);
      expect(deleteCall[1]).toEqual([1, 'att-1']);

      const insertCall = mockPool.execute.mock.calls[1] as unknown as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO');
    });
  });

  describe('deleteAttachment', () => {
    it('should delete attachment and return affected rows', async () => {
      mockPool.execute.mockResolvedValue([{ affectedRows: 2 }]);

      const result = await deleteAttachment(TEST_CHANNEL, 1, 'att-1');

      expect(result).toBe(2);
      const call = mockPool.execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain('DELETE FROM');
      expect(call[0]).toContain(`D_MA${CH}`);
      expect(call[1]).toEqual([1, 'att-1']);
    });
  });

  // ==========================================================================
  // deleteMessage (single)
  // ==========================================================================
  describe('deleteMessage', () => {
    it('should delete from all 5 tables in transaction', async () => {
      const mockConn = createMockConn();
      mockTransaction.mockImplementation(async (cb: any) => cb(mockConn));

      await deleteMessage(TEST_CHANNEL, 42);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockConn.execute).toHaveBeenCalledTimes(5);
      const calls = mockConn.execute.mock.calls as unknown as [string, unknown[]][];
      // Order: content, attachments, custom metadata, connector messages, messages
      expect(calls[0]![0]).toContain(`D_MC${CH}`);
      expect(calls[1]![0]).toContain(`D_MA${CH}`);
      expect(calls[2]![0]).toContain(`D_MCM${CH}`);
      expect(calls[3]![0]).toContain(`D_MM${CH}`);
      expect(calls[4]![0]).toContain(`D_M${CH}`);
      // All should have messageId 42
      for (const call of calls) {
        expect(call[1]).toEqual([42]);
      }
    });
  });

  // ==========================================================================
  // getMessages (bulk)
  // ==========================================================================
  describe('getMessages', () => {
    it('should return empty array for empty messageIds', async () => {
      const result = await getMessages(TEST_CHANNEL, []);

      expect(result).toEqual([]);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return messages by IDs ordered by ID', async () => {
      const fakeRows = [
        { ID: 1, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1 },
        { ID: 5, SERVER_ID: 'srv', RECEIVED_DATE: new Date(), PROCESSED: 1 },
      ];
      mockPool.query.mockResolvedValue([fakeRows]);

      const result = await getMessages(TEST_CHANNEL, [1, 5]);

      expect(result).toEqual(fakeRows);
      const call = mockPool.query.mock.calls[0] as unknown as [string, unknown[]];
      expect(call[0]).toContain(`D_M${CH}`);
      expect(call[0]).toContain('IN (?, ?)');
      expect(call[0]).toContain('ORDER BY ID');
      expect(call[1]).toEqual([1, 5]);
    });
  });

  // ==========================================================================
  // statusToColumn (tested indirectly via updateStatistics)
  // ==========================================================================
  describe('statusToColumn (via updateStatistics)', () => {
    it('should map RECEIVED to RECEIVED column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.RECEIVED);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toContain('RECEIVED');
    });

    it('should map FILTERED to FILTERED column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.FILTERED);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/FILTERED[\s\S]*VALUES/);
    });

    it('should map TRANSFORMED to TRANSFORMED column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.TRANSFORMED);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/TRANSFORMED[\s\S]*VALUES/);
    });

    it('should map SENT to SENT column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.SENT);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/\bSENT\b[\s\S]*VALUES/);
    });

    it('should map QUEUED to SENT column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.QUEUED);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/\bSENT\b[\s\S]*VALUES/);
    });

    it('should map ERROR to ERROR column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.ERROR);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/\bERROR\b[\s\S]*VALUES/);
    });

    it('should map PENDING to PENDING column', async () => {
      await updateStatistics(TEST_CHANNEL, 0, 'srv', Status.PENDING);
      const call = mockPool.execute.mock.calls[0] as unknown as [string];
      expect(call[0]).toMatch(/PENDING[\s\S]*VALUES/);
    });
  });
});
