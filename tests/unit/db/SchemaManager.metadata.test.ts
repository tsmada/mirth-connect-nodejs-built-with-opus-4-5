/**
 * Tests for ensureMetaDataColumns() in SchemaManager.
 *
 * Verifies that custom metadata columns in D_MCM tables are synced
 * to match channel configuration on deploy/redeploy via ALTER TABLE.
 */

import { MetaDataColumnType } from '../../../src/api/models/ServerSettings.js';

// Mock pool before importing SchemaManager
const mockExecute = jest.fn().mockResolvedValue([{ affectedRows: 0 }]);
const mockQuery = jest.fn().mockResolvedValue([[]]);
const mockPool = {
  query: mockQuery,
  execute: mockExecute,
};

jest.mock('../../../src/db/pool.js', () => ({
  getPool: () => mockPool,
  transaction: jest.fn(async (cb: (conn: unknown) => Promise<unknown>) => {
    return cb(mockPool);
  }),
}));

jest.mock('../../../src/db/DonkeyDao.js', () => ({
  createChannelTables: jest.fn(),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  validateChannelId: (id: string) => id.replace(/-/g, '_'),
}));

jest.mock('../../../src/logging/index.js', () => ({
  registerComponent: jest.fn(),
  getLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    isDebugEnabled: () => true,
  }),
}));

import { ensureMetaDataColumns } from '../../../src/db/SchemaManager.js';

const TEST_CHANNEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TABLE_NAME = 'D_MCMaaaaaaaa_bbbb_cccc_dddd_eeeeeeeeeeee';

function makeColumnInfoRows(columns: Array<{ name: string; type: string }>) {
  // Simulate information_schema rows, always including built-in columns
  const builtins = [
    { COLUMN_NAME: 'MESSAGE_ID', COLUMN_TYPE: 'bigint' },
    { COLUMN_NAME: 'METADATA_ID', COLUMN_TYPE: 'int' },
  ];
  const custom = columns.map((c) => ({
    COLUMN_NAME: c.name,
    COLUMN_TYPE: c.type,
  }));
  return [...builtins, ...custom];
}

describe('ensureMetaDataColumns', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockExecute.mockReset();
    mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
  });

  test('first deploy with 3 columns — runs 3 ALTER TABLE ADD COLUMN', async () => {
    // No existing custom columns
    mockQuery.mockResolvedValueOnce([makeColumnInfoRows([])]);

    const columns = [
      { name: 'mirth_source', type: MetaDataColumnType.STRING, mappingName: 'source' },
      { name: 'mirth_priority', type: MetaDataColumnType.NUMBER, mappingName: 'priority' },
      { name: 'mirth_flag', type: MetaDataColumnType.BOOLEAN, mappingName: 'flag' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // Should have queried information_schema
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![1]).toEqual([TABLE_NAME]);

    // Should have run 3 ADD COLUMN statements
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute.mock.calls[0]![0]).toContain('ADD COLUMN');
    expect(mockExecute.mock.calls[0]![0]).toContain('`mirth_source`');
    expect(mockExecute.mock.calls[0]![0]).toContain('VARCHAR(255)');

    expect(mockExecute.mock.calls[1]![0]).toContain('ADD COLUMN');
    expect(mockExecute.mock.calls[1]![0]).toContain('`mirth_priority`');
    expect(mockExecute.mock.calls[1]![0]).toContain('DECIMAL(31, 15)');

    expect(mockExecute.mock.calls[2]![0]).toContain('ADD COLUMN');
    expect(mockExecute.mock.calls[2]![0]).toContain('`mirth_flag`');
    expect(mockExecute.mock.calls[2]![0]).toContain('TINYINT(1)');
  });

  test('redeploy adding 1 column — runs 1 ALTER TABLE ADD COLUMN', async () => {
    // 3 existing custom columns
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_source', type: 'VARCHAR(255)' },
        { name: 'mirth_priority', type: 'DECIMAL(31, 15)' },
        { name: 'mirth_flag', type: 'TINYINT(1)' },
      ]),
    ]);

    const columns = [
      { name: 'mirth_source', type: MetaDataColumnType.STRING, mappingName: 'source' },
      { name: 'mirth_priority', type: MetaDataColumnType.NUMBER, mappingName: 'priority' },
      { name: 'mirth_flag', type: MetaDataColumnType.BOOLEAN, mappingName: 'flag' },
      { name: 'mirth_timestamp', type: MetaDataColumnType.TIMESTAMP, mappingName: 'ts' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // Only 1 ADD COLUMN for the new column
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]![0]).toContain('ADD COLUMN');
    expect(mockExecute.mock.calls[0]![0]).toContain('`mirth_timestamp`');
    expect(mockExecute.mock.calls[0]![0]).toContain('DATETIME');
  });

  test('redeploy removing 1 column — runs 1 ALTER TABLE DROP COLUMN', async () => {
    // 3 existing custom columns
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_source', type: 'VARCHAR(255)' },
        { name: 'mirth_priority', type: 'DECIMAL(31, 15)' },
        { name: 'mirth_flag', type: 'TINYINT(1)' },
      ]),
    ]);

    // Only want 2 columns now
    const columns = [
      { name: 'mirth_source', type: MetaDataColumnType.STRING, mappingName: 'source' },
      { name: 'mirth_priority', type: MetaDataColumnType.NUMBER, mappingName: 'priority' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // Only 1 DROP COLUMN for the removed column
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]![0]).toContain('DROP COLUMN');
    expect(mockExecute.mock.calls[0]![0]).toContain('`MIRTH_FLAG`');
  });

  test('redeploy changing column type (STRING→NUMBER) — runs ALTER TABLE MODIFY COLUMN', async () => {
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_source', type: 'VARCHAR(255)' },
      ]),
    ]);

    const columns = [
      { name: 'mirth_source', type: MetaDataColumnType.NUMBER, mappingName: 'source' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]![0]).toContain('MODIFY COLUMN');
    expect(mockExecute.mock.calls[0]![0]).toContain('`mirth_source`');
    expect(mockExecute.mock.calls[0]![0]).toContain('DECIMAL(31, 15)');
  });

  test('redeploy with no changes — no ALTER TABLE statements (idempotent)', async () => {
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_source', type: 'VARCHAR(255)' },
        { name: 'mirth_priority', type: 'DECIMAL(31, 15)' },
      ]),
    ]);

    const columns = [
      { name: 'mirth_source', type: MetaDataColumnType.STRING, mappingName: 'source' },
      { name: 'mirth_priority', type: MetaDataColumnType.NUMBER, mappingName: 'priority' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // No ALTER TABLE statements
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('empty columns list — no changes', async () => {
    mockQuery.mockResolvedValueOnce([makeColumnInfoRows([])]);

    await ensureMetaDataColumns(TEST_CHANNEL_ID, []);

    // Queried information_schema but no ALTER TABLE
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('column name safely quoted with backticks', async () => {
    mockQuery.mockResolvedValueOnce([makeColumnInfoRows([])]);

    const columns = [
      { name: 'my column', type: MetaDataColumnType.STRING, mappingName: 'col' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    // Column name is wrapped in backticks for SQL safety
    expect(mockExecute.mock.calls[0]![0]).toContain('`my column`');
  });

  test('mixed operations — add 1, remove 1, modify 1 in single call', async () => {
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'keep_same', type: 'VARCHAR(255)' },
        { name: 'to_modify', type: 'VARCHAR(255)' },
        { name: 'to_remove', type: 'TINYINT(1)' },
      ]),
    ]);

    const columns = [
      { name: 'keep_same', type: MetaDataColumnType.STRING, mappingName: 'ks' },
      { name: 'to_modify', type: MetaDataColumnType.TIMESTAMP, mappingName: 'tm' },
      { name: 'to_add', type: MetaDataColumnType.BOOLEAN, mappingName: 'ta' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // Should have 3 ALTER TABLE statements: 1 ADD + 1 DROP + 1 MODIFY
    expect(mockExecute).toHaveBeenCalledTimes(3);

    const allSql = mockExecute.mock.calls.map((c: unknown[]) => c[0] as string);

    // ADD
    const addSql = allSql.find((s: string) => s.includes('ADD COLUMN'));
    expect(addSql).toBeDefined();
    expect(addSql).toContain('`to_add`');
    expect(addSql).toContain('TINYINT(1)');

    // DROP
    const dropSql = allSql.find((s: string) => s.includes('DROP COLUMN'));
    expect(dropSql).toBeDefined();
    expect(dropSql).toContain('`TO_REMOVE`');

    // MODIFY
    const modifySql = allSql.find((s: string) => s.includes('MODIFY COLUMN'));
    expect(modifySql).toBeDefined();
    expect(modifySql).toContain('`to_modify`');
    expect(modifySql).toContain('DATETIME');
  });

  test('case-insensitive column name comparison', async () => {
    // Existing column has lowercase name, desired has uppercase
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_source', type: 'VARCHAR(255)' },
      ]),
    ]);

    const columns = [
      { name: 'MIRTH_SOURCE', type: MetaDataColumnType.STRING, mappingName: 'source' },
    ];

    await ensureMetaDataColumns(TEST_CHANNEL_ID, columns);

    // Should be idempotent — same column, same type
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('built-in columns are never dropped', async () => {
    // Even if desired list is empty, MESSAGE_ID and METADATA_ID must not be dropped
    mockQuery.mockResolvedValueOnce([
      makeColumnInfoRows([
        { name: 'mirth_extra', type: 'VARCHAR(255)' },
      ]),
    ]);

    await ensureMetaDataColumns(TEST_CHANNEL_ID, []);

    // Should drop mirth_extra but NOT MESSAGE_ID or METADATA_ID
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sql = mockExecute.mock.calls[0]![0] as string;
    expect(sql).toContain('DROP COLUMN');
    expect(sql).toContain('`MIRTH_EXTRA`');
    expect(sql).not.toContain('MESSAGE_ID');
    expect(sql).not.toContain('METADATA_ID');
  });
});
