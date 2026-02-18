/**
 * Tests for DonkeyDao getUnfinishedMessagesByServerId.
 *
 * Verifies that the server-filtered recovery query passes the correct
 * SQL and parameters to the database pool.
 */

const mockQuery = jest.fn();
const mockPool = { query: mockQuery };

jest.mock('../../../src/db/pool.js', () => ({
  getPool: () => mockPool,
  transaction: jest.fn(async (cb: Function) => cb(mockPool)),
  withRetry: jest.fn((fn: any) => fn()),
}));

import { getUnfinishedMessages, getUnfinishedMessagesByServerId } from '../../../src/db/DonkeyDao';

describe('DonkeyDao recovery queries', () => {
  const channelId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUnfinishedMessagesByServerId', () => {
    it('should query with SERVER_ID filter', async () => {
      const fakeRows = [{ ID: 1, SERVER_ID: 'node-1', PROCESSED: 0 }];
      mockQuery.mockResolvedValue([fakeRows]);

      const result = await getUnfinishedMessagesByServerId(channelId, 'node-1');

      expect(result).toEqual(fakeRows);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const [sql, params] = mockQuery.mock.calls[0]!;
      expect(sql).toContain('WHERE PROCESSED = 0 AND SERVER_ID = ?');
      expect(sql).toContain('ORDER BY ID');
      expect(params).toEqual(['node-1']);
    });

    it('should use the correct table name from channelId', async () => {
      mockQuery.mockResolvedValue([[]]);

      await getUnfinishedMessagesByServerId('aabbccdd-0011-2233-4455-667788990011', 'srv-1');

      const [sql] = mockQuery.mock.calls[0]!;
      // Dashes replaced with underscores for MySQL table name
      expect(sql).toContain('D_Maabbccdd_0011_2233_4455_667788990011');
    });

    it('should return empty array when no unfinished messages', async () => {
      mockQuery.mockResolvedValue([[]]);

      const result = await getUnfinishedMessagesByServerId(channelId, 'node-2');

      expect(result).toEqual([]);
    });
  });

  describe('getUnfinishedMessages (deprecated)', () => {
    it('should query without SERVER_ID filter', async () => {
      const fakeRows = [
        { ID: 1, SERVER_ID: 'node-1', PROCESSED: 0 },
        { ID: 2, SERVER_ID: 'node-2', PROCESSED: 0 },
      ];
      mockQuery.mockResolvedValue([fakeRows]);

      const result = await getUnfinishedMessages(channelId);

      expect(result).toEqual(fakeRows);
      const [sql] = mockQuery.mock.calls[0]!;
      expect(sql).toContain('WHERE PROCESSED = 0');
      expect(sql).not.toContain('SERVER_ID = ?');
    });
  });
});
