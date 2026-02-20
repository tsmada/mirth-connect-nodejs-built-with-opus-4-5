import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock the database pool before importing DatabaseMapBackend
// ---------------------------------------------------------------------------

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.mock('../../../src/db/pool.js', () => ({
  getPool: () => ({
    query: mockQuery,
    execute: mockExecute,
  }),
  withRetry: jest.fn((fn: any) => fn()),
}));

import { DatabaseMapBackend } from '../../../src/cluster/MapBackend.js';

// ---------------------------------------------------------------------------
// DatabaseMapBackend — Optimistic Locking (CAS) Methods
// ---------------------------------------------------------------------------

describe('DatabaseMapBackend optimistic locking', () => {
  let backend: DatabaseMapBackend;
  const SCOPE = 'global';

  beforeEach(() => {
    backend = new DatabaseMapBackend(SCOPE);
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  afterEach(() => {
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  // -------------------------------------------------------------------------
  // getWithVersion
  // -------------------------------------------------------------------------

  describe('getWithVersion', () => {
    it('should return value and version for existing key', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: '"hello"', VERSION: 3 }]]);
      const result = await backend.getWithVersion('key1');
      expect(result).toEqual({ value: 'hello', version: 3 });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT MAP_VALUE, VERSION FROM D_GLOBAL_MAP'),
        [SCOPE, 'key1']
      );
    });

    it('should return undefined for non-existent key', async () => {
      mockQuery.mockResolvedValue([[]]);
      const result = await backend.getWithVersion('missing');
      expect(result).toBeUndefined();
    });

    it('should return parsed object with version', async () => {
      const obj = { count: 42, name: 'test' };
      mockQuery.mockResolvedValue([[{ MAP_VALUE: JSON.stringify(obj), VERSION: 7 }]]);
      const result = await backend.getWithVersion('objKey');
      expect(result).toEqual({ value: obj, version: 7 });
    });

    it('should return raw string when JSON parse fails', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: 'not-json{', VERSION: 1 }]]);
      const result = await backend.getWithVersion('badJson');
      expect(result).toEqual({ value: 'not-json{', version: 1 });
    });

    it('should return undefined value with version when MAP_VALUE is null', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: null, VERSION: 0 }]]);
      const result = await backend.getWithVersion('nullVal');
      expect(result).toEqual({ value: undefined, version: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // setIfVersion
  // -------------------------------------------------------------------------

  describe('setIfVersion', () => {
    it('should succeed when version matches', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      const ok = await backend.setIfVersion('key1', 'newValue', 3);
      expect(ok).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE D_GLOBAL_MAP SET MAP_VALUE = ?, VERSION = VERSION + 1'),
        ['"newValue"', SCOPE, 'key1', 3]
      );
    });

    it('should fail (return false) when version does not match (stale read)', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
      const ok = await backend.setIfVersion('key1', 'staleUpdate', 2);
      expect(ok).toBe(false);
    });

    it('should insert new key with expectedVersion = -1', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      const ok = await backend.setIfVersion('newKey', { data: 'fresh' }, -1);
      expect(ok).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO D_GLOBAL_MAP'),
        [SCOPE, 'newKey', JSON.stringify({ data: 'fresh' })]
      );
    });

    it('should fail insert when key already exists (expectedVersion = -1)', async () => {
      const dupErr = new Error('Duplicate entry') as Error & { code: string };
      dupErr.code = 'ER_DUP_ENTRY';
      mockExecute.mockRejectedValue(dupErr);
      const ok = await backend.setIfVersion('existingKey', 'value', -1);
      expect(ok).toBe(false);
    });

    it('should rethrow non-duplicate-entry errors on insert', async () => {
      const dbErr = new Error('Connection lost') as Error & { code: string };
      dbErr.code = 'ER_CONN_LOST';
      mockExecute.mockRejectedValue(dbErr);
      await expect(backend.setIfVersion('key', 'val', -1)).rejects.toThrow('Connection lost');
    });
  });

  // -------------------------------------------------------------------------
  // CAS workflow (read-modify-write)
  // -------------------------------------------------------------------------

  describe('CAS workflow', () => {
    it('should complete a read-modify-write cycle', async () => {
      // Step 1: read key with version
      mockQuery.mockResolvedValue([[{ MAP_VALUE: '10', VERSION: 5 }]]);
      const entry = await backend.getWithVersion('counter');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe(10);
      expect(entry!.version).toBe(5);

      // Step 2: modify and write with expected version
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      const incremented = (entry!.value as number) + 1;
      const ok = await backend.setIfVersion('counter', incremented, entry!.version);
      expect(ok).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE D_GLOBAL_MAP'),
        [JSON.stringify(11), SCOPE, 'counter', 5]
      );
    });

    it('should detect conflict when two readers race', async () => {
      // Both readers see version 5
      mockQuery.mockResolvedValue([[{ MAP_VALUE: '10', VERSION: 5 }]]);
      const reader1 = await backend.getWithVersion('counter');
      const reader2 = await backend.getWithVersion('counter');

      // Reader 1 writes first — succeeds (version still 5)
      mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const ok1 = await backend.setIfVersion('counter', 11, reader1!.version);
      expect(ok1).toBe(true);

      // Reader 2 writes second — fails (version is now 6 after reader 1's write)
      mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const ok2 = await backend.setIfVersion('counter', 11, reader2!.version);
      expect(ok2).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // set() method VERSION integration
  // -------------------------------------------------------------------------

  describe('set() with VERSION', () => {
    it('should include VERSION in upsert SQL', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      await backend.set('key1', 'value1');
      const sql = mockExecute.mock.calls[0]![0] as string;
      expect(sql).toContain('VERSION');
      expect(sql).toContain('VERSION = VERSION + 1');
    });
  });
});
