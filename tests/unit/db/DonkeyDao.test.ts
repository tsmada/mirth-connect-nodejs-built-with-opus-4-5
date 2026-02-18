import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock the pool module before importing DonkeyDao
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
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
} from '../../../src/db/DonkeyDao.js';
import { getPool } from '../../../src/db/pool.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { Status } from '../../../src/model/Status.js';

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

// Helpers: create a mock pool with execute and query methods
function createMockPool() {
  return {
    execute: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ affectedRows: 0 }]),
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue([[]]),
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
});
