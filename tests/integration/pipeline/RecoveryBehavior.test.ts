/**
 * RecoveryTask Behavioral Integration Tests
 *
 * Tests the runRecoveryTask() function which recovers unfinished messages
 * (PROCESSED=0) after a server crash. Verifies:
 * - Source and destination connector recovery (RECEIVED/PENDING -> ERROR)
 * - Cluster isolation (only recovers own messages by SERVER_ID)
 * - Error resilience (one message failure doesn't block others)
 * - Transaction wrapping (all ops for one message in a single transaction)
 * - Error message format
 */

// ─────────────── Mocks (MUST come before imports) ───────────────

const mockPoolConnection = {} as any;
jest.mock('../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
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

const mockGetUnfinishedMessagesByServerId = jest.fn().mockResolvedValue([]);
const mockGetConnectorMessagesByStatus = jest.fn().mockResolvedValue([]);
const mockUpdateConnectorMessageStatus = jest.fn().mockResolvedValue(undefined);
const mockUpdateErrors = jest.fn().mockResolvedValue(undefined);
const mockUpdateStatistics = jest.fn().mockResolvedValue(undefined);
const mockUpdateMessageProcessed = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/db/DonkeyDao.js', () => ({
  getUnfinishedMessagesByServerId: mockGetUnfinishedMessagesByServerId,
  getConnectorMessagesByStatus: mockGetConnectorMessagesByStatus,
  updateConnectorMessageStatus: mockUpdateConnectorMessageStatus,
  updateErrors: mockUpdateErrors,
  updateStatistics: mockUpdateStatistics,
  updateMessageProcessed: mockUpdateMessageProcessed,
}));

// ─────────────── Imports ───────────────

import { runRecoveryTask } from '../../../src/donkey/channel/RecoveryTask';
import { Status } from '../../../src/model/Status';
import { transaction } from '../../../src/db/pool';

const CHANNEL_ID = 'test-channel-001';
const SERVER_ID = 'server-A';

function makeMessageRow(id: number) {
  return { ID: id } as any;
}

function makeConnectorMessageRow(messageId: number, metaDataId: number, status: string) {
  return { MESSAGE_ID: messageId, METADATA_ID: metaDataId, STATUS: status } as any;
}

describe('RecoveryTask Behavioral Contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([]);
  });

  // T1.1: Source RECEIVED recovery
  it('should recover 10 unfinished messages with source connector in RECEIVED status', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessageRow(i + 1));
    mockGetUnfinishedMessagesByServerId.mockResolvedValue(messages);

    // Each message has its source connector (metaDataId=0) in RECEIVED
    mockGetConnectorMessagesByStatus.mockImplementation(async (_chId: string, _statuses: Status[], msgId: number) => {
      return [makeConnectorMessageRow(msgId, 0, Status.RECEIVED)];
    });

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(result.recovered).toBe(10);
    expect(result.errors).toBe(10);
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledTimes(10);
    expect(mockUpdateErrors).toHaveBeenCalledTimes(10);
    expect(mockUpdateStatistics).toHaveBeenCalledTimes(10);
    expect(mockUpdateMessageProcessed).toHaveBeenCalledTimes(10);

    // Verify each call used the correct arguments
    for (let i = 0; i < 10; i++) {
      expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
        CHANNEL_ID, i + 1, 0, Status.ERROR, mockPoolConnection
      );
      expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
        CHANNEL_ID, i + 1, true, mockPoolConnection
      );
    }
  });

  // T1.2: Mixed destination recovery — only RECEIVED/PENDING connectors are returned
  it('should only recover connectors in RECEIVED or PENDING status, leaving SENT untouched', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessageRow(i + 1));
    mockGetUnfinishedMessagesByServerId.mockResolvedValue(messages);

    // getConnectorMessagesByStatus filters by [RECEIVED, PENDING] — only returns dest1 + dest4
    mockGetConnectorMessagesByStatus.mockImplementation(async (_chId: string, _statuses: Status[], msgId: number) => {
      return [
        makeConnectorMessageRow(msgId, 1, Status.RECEIVED),
        makeConnectorMessageRow(msgId, 4, Status.RECEIVED),
      ];
    });

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(result.recovered).toBe(10);
    expect(result.errors).toBe(20); // 2 connectors per message
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledTimes(20);

    // Verify only metaDataIds 1 and 4 were updated, never 2 or 3
    const calledMetaDataIds = mockUpdateConnectorMessageStatus.mock.calls.map((c: any[]) => c[2]);
    expect(calledMetaDataIds.filter((id: number) => id === 1)).toHaveLength(10);
    expect(calledMetaDataIds.filter((id: number) => id === 4)).toHaveLength(10);
    expect(calledMetaDataIds.filter((id: number) => id === 2)).toHaveLength(0);
    expect(calledMetaDataIds.filter((id: number) => id === 3)).toHaveLength(0);
  });

  // T1.3: Destination PENDING recovery
  it('should recover PENDING destinations with error message containing original status P', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([makeMessageRow(100)]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      makeConnectorMessageRow(100, 2, Status.PENDING),
    ]);

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(result.recovered).toBe(1);
    expect(result.errors).toBe(1);
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      CHANNEL_ID, 100, 2, Status.ERROR, mockPoolConnection
    );
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      CHANNEL_ID, 100, 2,
      expect.stringContaining('Original status: P'),
      undefined, undefined, undefined, mockPoolConnection
    );
  });

  // T1.4: updateMessageProcessed called for every recovered message
  it('should mark every recovered message as PROCESSED=true', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessageRow(i + 1));
    mockGetUnfinishedMessagesByServerId.mockResolvedValue(messages);
    mockGetConnectorMessagesByStatus.mockImplementation(async (_chId: string, _statuses: Status[], msgId: number) => {
      return [makeConnectorMessageRow(msgId, 0, Status.RECEIVED)];
    });

    await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(mockUpdateMessageProcessed).toHaveBeenCalledTimes(10);
    for (let i = 0; i < 10; i++) {
      expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
        CHANNEL_ID, i + 1, true, mockPoolConnection
      );
    }
  });

  // T1.5: Empty recovery — no unfinished messages
  it('should return zero counts and make no DAO mutations when no unfinished messages exist', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(result).toEqual({ recovered: 0, errors: 0 });
    expect(mockGetConnectorMessagesByStatus).not.toHaveBeenCalled();
    expect(mockUpdateConnectorMessageStatus).not.toHaveBeenCalled();
    expect(mockUpdateErrors).not.toHaveBeenCalled();
    expect(mockUpdateStatistics).not.toHaveBeenCalled();
    expect(mockUpdateMessageProcessed).not.toHaveBeenCalled();
  });

  // T1.6: Cluster isolation — different server ID returns no messages
  it('should recover zero messages when queried with a different server ID', async () => {
    // server-B has no unfinished messages (they belong to server-A)
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);

    const result = await runRecoveryTask(CHANNEL_ID, 'server-B');

    expect(result).toEqual({ recovered: 0, errors: 0 });
    expect(mockGetUnfinishedMessagesByServerId).toHaveBeenCalledWith(CHANNEL_ID, 'server-B');
    expect(mockUpdateConnectorMessageStatus).not.toHaveBeenCalled();
  });

  // T1.7: Recovery with mixed RECEIVED and PENDING in same message
  it('should recover both RECEIVED and PENDING connectors in the same message', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([makeMessageRow(50)]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      makeConnectorMessageRow(50, 1, Status.RECEIVED),
      makeConnectorMessageRow(50, 2, Status.PENDING),
    ]);

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(result.recovered).toBe(1);
    expect(result.errors).toBe(2);

    // Verify both were marked ERROR
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      CHANNEL_ID, 50, 1, Status.ERROR, mockPoolConnection
    );
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      CHANNEL_ID, 50, 2, Status.ERROR, mockPoolConnection
    );

    // Verify error messages reflect original status
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      CHANNEL_ID, 50, 1,
      expect.stringContaining('Original status: R'),
      undefined, undefined, undefined, mockPoolConnection
    );
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      CHANNEL_ID, 50, 2,
      expect.stringContaining('Original status: P'),
      undefined, undefined, undefined, mockPoolConnection
    );
  });

  // T1.8: Recovery error in one message doesn't stop others
  it('should continue recovering other messages when one message throws an error', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      makeMessageRow(1),
      makeMessageRow(2),
      makeMessageRow(3),
    ]);

    mockGetConnectorMessagesByStatus.mockImplementation(async (_chId: string, _statuses: Status[], msgId: number) => {
      if (msgId === 2) {
        throw new Error('Simulated DB failure for message 2');
      }
      return [makeConnectorMessageRow(msgId, 0, Status.RECEIVED)];
    });

    const result = await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    // Messages 1 and 3 recovered, message 2 failed
    expect(result.recovered).toBe(2);
    expect(result.errors).toBe(2);

    // Verify messages 1 and 3 were processed, but not message 2
    expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
      CHANNEL_ID, 1, true, mockPoolConnection
    );
    expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
      CHANNEL_ID, 3, true, mockPoolConnection
    );
    expect(mockUpdateMessageProcessed).not.toHaveBeenCalledWith(
      CHANNEL_ID, 2, true, expect.anything()
    );
  });

  // T1.9: Verify error message format
  it('should store a recovery error message with the correct format', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([makeMessageRow(99)]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      makeConnectorMessageRow(99, 0, Status.RECEIVED),
    ]);

    await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    expect(mockUpdateErrors).toHaveBeenCalledWith(
      CHANNEL_ID,
      99,
      0,
      'Message recovered after server restart. Original status: R',
      undefined,
      undefined,
      undefined,
      mockPoolConnection
    );
  });

  // T1.10: Transaction wrapping — all operations for one message in a single transaction
  it('should wrap all recovery operations for each message in a transaction', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      makeMessageRow(1),
      makeMessageRow(2),
    ]);
    mockGetConnectorMessagesByStatus.mockImplementation(async (_chId: string, _statuses: Status[], msgId: number) => {
      return [makeConnectorMessageRow(msgId, 0, Status.RECEIVED)];
    });

    await runRecoveryTask(CHANNEL_ID, SERVER_ID);

    // transaction() should be called once per message
    expect(transaction).toHaveBeenCalledTimes(2);

    // All DAO mutation calls should receive mockPoolConnection (the transaction's connection)
    for (const call of mockUpdateConnectorMessageStatus.mock.calls) {
      expect(call[4]).toBe(mockPoolConnection);
    }
    for (const call of mockUpdateErrors.mock.calls) {
      expect(call[7]).toBe(mockPoolConnection);
    }
    for (const call of mockUpdateStatistics.mock.calls) {
      expect(call[5]).toBe(mockPoolConnection);
    }
    for (const call of mockUpdateMessageProcessed.mock.calls) {
      expect(call[3]).toBe(mockPoolConnection);
    }
  });
});
