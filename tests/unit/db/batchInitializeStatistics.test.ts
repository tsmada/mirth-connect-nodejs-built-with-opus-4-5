import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Mock pool
const mockPool = {
  execute: jest
    .fn<(sql: string, params: unknown[]) => Promise<[unknown, unknown]>>()
    .mockResolvedValue([{}, undefined]),
};

jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(() => mockPool),
}));

jest.mock('../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn(() => false),
  })),
}));

import { batchInitializeStatistics } from '../../../src/db/DonkeyDao.js';

// Valid UUID-format channel IDs (required by validateChannelId)
const CH1 = 'a0000001-0001-0001-0001-000000000001';
const CH2 = 'b0000002-0002-0002-0002-000000000002';

describe('batchInitializeStatistics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do nothing when metadataIds is empty', async () => {
    await batchInitializeStatistics(CH1, [], 'server-1');
    expect(mockPool.execute).not.toHaveBeenCalled();
  });

  it('should generate single-value INSERT for source-only channel', async () => {
    await batchInitializeStatistics(CH1, [0], 'server-1');

    expect(mockPool.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.execute.mock.calls[0]!;

    // SQL should have one value tuple
    expect(sql).toContain('VALUES (?, ?, 0, 0, 0, 0, 0, 0)');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE RECEIVED = RECEIVED');

    // Params: [metaDataId, serverId]
    expect(params).toEqual([0, 'server-1']);
  });

  it('should generate multi-value INSERT for channel with destinations', async () => {
    await batchInitializeStatistics(CH1, [0, 1, 2, 3], 'server-1');

    expect(mockPool.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.execute.mock.calls[0]!;

    // SQL should have 4 value tuples
    const valueTuples = (sql as string).match(/\(\?, \?, 0, 0, 0, 0, 0, 0\)/g);
    expect(valueTuples).toHaveLength(4);

    // Params: alternating metaDataId, serverId pairs
    expect(params).toEqual([0, 'server-1', 1, 'server-1', 2, 'server-1', 3, 'server-1']);
  });

  it('should use the correct table name with underscored UUID', async () => {
    await batchInitializeStatistics(CH2, [0], 'server-1');

    const [sql] = mockPool.execute.mock.calls[0]!;
    // UUID hyphens are replaced with underscores in table names
    expect(sql).toContain('D_MSb0000002_0002_0002_0002_000000000002');
  });

  it('should use provided connection instead of pool', async () => {
    const mockConn = {
      execute: jest
        .fn<(sql: string, params: unknown[]) => Promise<[unknown, unknown]>>()
        .mockResolvedValue([{}, undefined]),
    };

    await batchInitializeStatistics(CH1, [0, 1], 'server-1', mockConn as any);

    expect(mockPool.execute).not.toHaveBeenCalled();
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
  });
});
