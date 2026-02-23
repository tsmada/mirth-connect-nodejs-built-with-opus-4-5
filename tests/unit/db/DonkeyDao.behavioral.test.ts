/**
 * Behavioral tests for DonkeyDao — DAO call patterns and transaction contracts.
 * Ported from: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/util/TestUtils.java
 *
 * Tests verify exact DAO call sequences, parameter ordering, and transaction
 * boundaries matching Java Mirth behavior.
 *
 * Pattern: P4 (Full DAO Mock — hoisted before imports)
 */

// === MOCK HOISTING — must appear before ALL imports ===
const mockQuery = jest.fn().mockResolvedValue([[], []]);
const mockExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
const mockPoolConnection = {
  query: jest.fn().mockResolvedValue([[], []]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }, []]),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn(),
};

jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(() => ({
    query: mockQuery,
    execute: mockExecute,
    getConnection: jest.fn().mockResolvedValue(mockPoolConnection),
  })),
  transaction: jest.fn(async (cb: any) => cb(mockPoolConnection)),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/db/Encryptor.js', () => ({
  isEncryptionEnabled: jest.fn(() => false),
  getEncryptor: jest.fn(() => ({
    encrypt: jest.fn((s: string) => `encrypted:${s}`),
    decrypt: jest.fn((s: string) => s.replace('encrypted:', '')),
  })),
}));

jest.mock('../../../src/logging/index.js', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: jest.fn(),
}));

// === NOW safe to import modules that use pool ===
import {
  insertMessage,
  insertConnectorMessage,
  storeContent,
  updateStatistics,
  updateErrors,
  updateMaps,
  addChannelStatistics,
  safeSerializeMap,
  validateChannelId,
  messageTable,
  connectorMessageTable,
  contentTable,
  statisticsTable,
} from '../../../src/db/DonkeyDao.js';
import { Status } from '../../../src/model/Status.js';
import { ContentType } from '../../../src/model/ContentType.js';

const CHANNEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('DonkeyDao: behavioral contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Contract 1: Table Name Generation ───

  describe('Table name generation: SQL injection prevention', () => {
    it('should validate UUID format and replace hyphens with underscores', () => {
      const result = validateChannelId(CHANNEL_ID);
      expect(result).toBe('aaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee');
    });

    it('should reject non-UUID strings to prevent SQL injection', () => {
      expect(() => validateChannelId('DROP TABLE users;--')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('')).toThrow('Invalid channel ID format');
      expect(() => validateChannelId('abc')).toThrow('Invalid channel ID format');
    });

    it('should generate correct per-channel table names', () => {
      expect(messageTable(CHANNEL_ID)).toBe('D_Maaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee');
      expect(connectorMessageTable(CHANNEL_ID)).toBe('D_MMaaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee');
      expect(contentTable(CHANNEL_ID)).toBe('D_MCaaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee');
      expect(statisticsTable(CHANNEL_ID)).toBe('D_MSaaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee');
    });
  });

  // ─── Contract 2: Insert Ordering ───

  describe('Insert ordering: message → connector message → content', () => {
    it('should insert message with correct parameters', async () => {
      const now = new Date();
      await insertMessage(CHANNEL_ID, 42, 'server-1', now);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0]!;
      expect(sql).toContain('INSERT INTO D_M');
      expect(params).toEqual([42, 'server-1', now]);
    });

    it('should insert connector message with status as single character', async () => {
      const now = new Date();
      await insertConnectorMessage(
        CHANNEL_ID, 42, 0, 'Source', now, Status.RECEIVED
      );

      // insertConnectorMessage without conn uses getPool().execute = mockExecute
      expect(mockExecute).toHaveBeenCalled();
      const call = mockExecute.mock.calls.find(
        (c: any) => typeof c[0] === 'string' && c[0].includes('INSERT INTO D_MM')
      );
      expect(call).toBeDefined();
      // Status.RECEIVED = 'R'
      expect(call![1]).toContain('R');
    });
  });

  // ─── Contract 3: storeContent Upsert Semantics ───

  describe('storeContent: UPDATE-first upsert pattern', () => {
    it('should attempt UPDATE first, INSERT only if 0 rows affected', async () => {
      // First call: UPDATE returns 0 rows (no existing row)
      mockPoolConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 0 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await storeContent(
        CHANNEL_ID, 1, 0, ContentType.RAW, 'test-content', 'HL7V2', false,
        mockPoolConnection as any
      );

      expect(mockPoolConnection.execute).toHaveBeenCalledTimes(2);
      const firstCall = mockPoolConnection.execute.mock.calls[0]![0];
      const secondCall = mockPoolConnection.execute.mock.calls[1]![0];
      expect(firstCall).toContain('UPDATE');
      expect(secondCall).toContain('INSERT');
    });

    it('should skip INSERT when UPDATE succeeds (row exists)', async () => {
      mockPoolConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await storeContent(
        CHANNEL_ID, 1, 0, ContentType.RESPONSE, 'response-data', 'XML', false,
        mockPoolConnection as any
      );

      expect(mockPoolConnection.execute).toHaveBeenCalledTimes(1);
      expect(mockPoolConnection.execute.mock.calls[0]![0]).toContain('UPDATE');
    });
  });

  // ─── Contract 4: updateErrors Content Types ───

  describe('updateErrors: stores correct ContentType per error category', () => {
    it('should store PROCESSING_ERROR (12), POSTPROCESSOR_ERROR (13), and RESPONSE_ERROR (14)', async () => {
      // storeContent mock — track calls via mockPoolConnection
      mockPoolConnection.execute.mockResolvedValue([{ affectedRows: 0 }, []]);

      await updateErrors(
        CHANNEL_ID, 1, 0,
        'processing failed',
        'postprocessor failed',
        undefined,
        'response error',
        mockPoolConnection as any
      );

      // Should have called storeContent for each error type
      // Each storeContent does UPDATE (0 rows) then INSERT = 2 calls per error
      // Plus no ERROR_CODE update since errorCode is undefined
      const calls = mockPoolConnection.execute.mock.calls;
      // Verify all three content types are written
      const insertCalls = calls.filter((c: any) =>
        c[0].includes('INSERT INTO D_MC')
      );
      const contentTypes = insertCalls.map((c: any) => c[1]?.[2]);
      expect(contentTypes).toContain(ContentType.PROCESSING_ERROR);
      expect(contentTypes).toContain(ContentType.POSTPROCESSOR_ERROR);
      expect(contentTypes).toContain(ContentType.RESPONSE_ERROR);
    });

    it('should update ERROR_CODE in D_MM when errorCode is provided', async () => {
      await updateErrors(
        CHANNEL_ID, 1, 0,
        undefined, undefined, 42, undefined,
        mockPoolConnection as any
      );

      const updateCall = mockPoolConnection.execute.mock.calls.find(
        (c: any) => c[0].includes('ERROR_CODE')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toContain(42);
    });
  });

  // ─── Contract 5: Statistics QUEUED → SENT Column Mapping ───

  describe('Statistics: QUEUED maps to SENT column', () => {
    it('should use SENT column for both Status.SENT and Status.QUEUED', async () => {
      await updateStatistics(CHANNEL_ID, 1, 'server-1', Status.SENT, 1);
      await updateStatistics(CHANNEL_ID, 1, 'server-1', Status.QUEUED, 1);

      const calls = mockExecute.mock.calls;
      // Both calls should reference the SENT column
      expect(calls[0]![0]).toContain('SENT');
      expect(calls[1]![0]).toContain('SENT');
    });
  });

  // ─── Contract 6: addChannelStatistics MIRTH-3042 Ordering ───

  describe('addChannelStatistics: MIRTH-3042 deadlock prevention ordering', () => {
    it('should flush channel-level stats (metaDataId=0) before connector stats', async () => {
      const stats = new Map<number, Map<Status, number>>();
      // Connector 3 added first (out of order)
      stats.set(3, new Map([[Status.SENT, 5]]));
      // Channel aggregate added second
      stats.set(0, new Map([[Status.RECEIVED, 10]]));
      // Connector 1
      stats.set(1, new Map([[Status.FILTERED, 2]]));

      await addChannelStatistics(CHANNEL_ID, 'server-1', stats);

      // Verify ordering: metaDataId 0 first, then 1, then 3
      const metaDataIds = mockExecute.mock.calls.map((c: any) => c[1]?.[0]);
      expect(metaDataIds).toEqual([0, 1, 3]);
    });
  });

  // ─── Contract 7: safeSerializeMap Safety ───

  describe('safeSerializeMap: non-serializable value handling', () => {
    it('should serialize functions to their toString()', () => {
      const map = new Map<string, unknown>();
      map.set('fn', function hello() { return 'world'; });
      map.set('normal', 'value');

      const result = JSON.parse(safeSerializeMap(map));
      expect(result.fn).toContain('function hello');
      expect(result.normal).toBe('value');
    });

    it('should handle circular references by falling back per-value', () => {
      const map = new Map<string, unknown>();
      const obj: any = {};
      obj.self = obj; // circular reference
      map.set('circular', obj);
      map.set('safe', 'value');

      // Should not throw
      const result = JSON.parse(safeSerializeMap(map));
      expect(result.safe).toBe('value');
      // Circular value falls back to String()
      expect(result.circular).toBe('[object Object]');
    });

    it('should handle BigInt values', () => {
      const map = new Map<string, unknown>();
      map.set('big', BigInt(9007199254740991));
      map.set('normal', 42);

      const result = JSON.parse(safeSerializeMap(map));
      expect(result.big).toBe('9007199254740991');
      expect(result.normal).toBe(42);
    });
  });

  // ─── Contract 8: updateMaps Only Writes Non-Empty Maps ───

  describe('updateMaps: skips empty maps', () => {
    it('should not write to D_MC when maps are empty', async () => {
      mockPoolConnection.execute.mockResolvedValue([{ affectedRows: 0 }, []]);

      await updateMaps(
        CHANNEL_ID, 1, 0,
        new Map(), // empty connector map
        new Map(), // empty channel map
        new Map(), // empty response map
        mockPoolConnection as any
      );

      // No calls because all maps are empty
      expect(mockPoolConnection.execute).not.toHaveBeenCalled();
    });

    it('should write only non-empty maps', async () => {
      mockPoolConnection.execute.mockResolvedValue([{ affectedRows: 0 }, []]);

      const channelMap = new Map<string, unknown>([['key', 'value']]);
      await updateMaps(
        CHANNEL_ID, 1, 0,
        new Map(), // empty connector map — skipped
        channelMap, // non-empty — written
        new Map(), // empty response map — skipped
        mockPoolConnection as any
      );

      // Only channel map should be written (UPDATE + INSERT = 2 calls)
      expect(mockPoolConnection.execute).toHaveBeenCalled();
      const calls = mockPoolConnection.execute.mock.calls;
      // Verify it's writing CHANNEL_MAP content type
      const contentTypeInParams = calls.find((c: any) =>
        c[1]?.includes(ContentType.CHANNEL_MAP)
      );
      expect(contentTypeInParams).toBeDefined();
    });
  });
});
