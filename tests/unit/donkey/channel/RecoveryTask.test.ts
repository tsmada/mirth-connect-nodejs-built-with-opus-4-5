/**
 * Tests for RecoveryTask — crash recovery on channel start.
 *
 * Verifies that unfinished messages (PROCESSED=0) with connector messages
 * stuck at RECEIVED or PENDING are recovered by marking them as ERROR.
 */

// Mock DAO functions
const mockGetUnfinishedMessagesByServerId = jest.fn();
const mockGetConnectorMessagesByStatus = jest.fn();
const mockUpdateConnectorMessageStatus = jest.fn();
const mockUpdateErrors = jest.fn();
const mockUpdateStatistics = jest.fn();
const mockUpdateMessageProcessed = jest.fn();

jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  getUnfinishedMessagesByServerId: mockGetUnfinishedMessagesByServerId,
  getConnectorMessagesByStatus: mockGetConnectorMessagesByStatus,
  updateConnectorMessageStatus: mockUpdateConnectorMessageStatus,
  updateErrors: mockUpdateErrors,
  updateStatistics: mockUpdateStatistics,
  updateMessageProcessed: mockUpdateMessageProcessed,
}));

// Mock transaction — execute callback with a mock connection
const mockConn = { execute: jest.fn(), query: jest.fn() };
jest.mock('../../../../src/db/pool.js', () => ({
  transaction: jest.fn(async (cb: Function) => cb(mockConn)),
}));

import { runRecoveryTask } from '../../../../src/donkey/channel/RecoveryTask';
import { Status } from '../../../../src/model/Status';

describe('RecoveryTask', () => {
  const channelId = 'abc-123-def';
  const serverId = 'node-1';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdateConnectorMessageStatus.mockResolvedValue(undefined);
    mockUpdateErrors.mockResolvedValue(undefined);
    mockUpdateStatistics.mockResolvedValue(undefined);
    mockUpdateMessageProcessed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns zero counts when no unfinished messages exist', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);

    const result = await runRecoveryTask(channelId, serverId);

    expect(result).toEqual({ recovered: 0, errors: 0 });
    expect(mockGetUnfinishedMessagesByServerId).toHaveBeenCalledWith(channelId, serverId);
    expect(mockUpdateConnectorMessageStatus).not.toHaveBeenCalled();
  });

  it('recovers unfinished message with pending connectors and marks as ERROR', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      { ID: 42, SERVER_ID: 'node-1' },
    ]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      { MESSAGE_ID: 42, METADATA_ID: 0, STATUS: 'R', CONNECTOR_NAME: 'Source' },
      { MESSAGE_ID: 42, METADATA_ID: 1, STATUS: 'P', CONNECTOR_NAME: 'Dest 1' },
    ]);

    const result = await runRecoveryTask(channelId, serverId);

    expect(result).toEqual({ recovered: 1, errors: 2 });

    // Verify DAO calls
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      channelId, 42, 0, Status.ERROR, mockConn
    );
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      channelId, 42, 1, Status.ERROR, mockConn
    );

    // Verify error content stored
    expect(mockUpdateErrors).toHaveBeenCalledTimes(2);
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      channelId, 42, 0,
      expect.stringContaining('recovered after server restart'),
      undefined, undefined, undefined, mockConn
    );

    // Verify statistics updated
    expect(mockUpdateStatistics).toHaveBeenCalledTimes(2);
    expect(mockUpdateStatistics).toHaveBeenCalledWith(
      channelId, 0, serverId, Status.ERROR, 1, mockConn
    );
    expect(mockUpdateStatistics).toHaveBeenCalledWith(
      channelId, 1, serverId, Status.ERROR, 1, mockConn
    );

    // Verify message marked as processed
    expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
      channelId, 42, true, mockConn
    );

    // Verify log message
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Recovered 1 unfinished messages (2 marked as ERROR)')
    );
  });

  it('recovers multiple unfinished messages', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      { ID: 10, SERVER_ID: 'node-1' },
      { ID: 20, SERVER_ID: 'node-1' },
    ]);
    // Message 10: one pending connector
    mockGetConnectorMessagesByStatus
      .mockResolvedValueOnce([{ MESSAGE_ID: 10, METADATA_ID: 0, STATUS: 'R', CONNECTOR_NAME: 'Source' }])
      // Message 20: no pending connectors
      .mockResolvedValueOnce([]);

    const result = await runRecoveryTask(channelId, serverId);

    expect(result).toEqual({ recovered: 2, errors: 1 });
  });

  it('continues recovering other messages if one fails', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      { ID: 10, SERVER_ID: 'node-1' },
      { ID: 20, SERVER_ID: 'node-1' },
    ]);
    // Message 10: query throws
    mockGetConnectorMessagesByStatus
      .mockRejectedValueOnce(new Error('DB error on message 10'))
      // Message 20: one pending
      .mockResolvedValueOnce([{ MESSAGE_ID: 20, METADATA_ID: 0, STATUS: 'P', CONNECTOR_NAME: 'Source' }]);

    const result = await runRecoveryTask(channelId, serverId);

    expect(result).toEqual({ recovered: 1, errors: 1 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error recovering message 10')
    );
  });

  it('handles initial query failure gracefully', async () => {
    mockGetUnfinishedMessagesByServerId.mockRejectedValue(new Error('Table does not exist'));

    const result = await runRecoveryTask(channelId, serverId);

    expect(result).toEqual({ recovered: 0, errors: 0 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to run recovery')
    );
  });

  it('does not log when no messages were recovered', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);

    await runRecoveryTask(channelId, serverId);

    expect(console.log).not.toHaveBeenCalled();
  });

  it('uses transaction for atomicity per message', async () => {
    const { transaction } = require('../../../../src/db/pool');

    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      { ID: 1, SERVER_ID: 'node-1' },
    ]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      { MESSAGE_ID: 1, METADATA_ID: 0, STATUS: 'R', CONNECTOR_NAME: 'Source' },
    ]);

    await runRecoveryTask(channelId, serverId);

    // transaction() should have been called once per recovered message
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('queries unfinished messages filtered by serverId for cluster safety', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([]);

    await runRecoveryTask(channelId, 'cluster-node-A');

    // Must pass serverId so each instance only recovers its own messages
    expect(mockGetUnfinishedMessagesByServerId).toHaveBeenCalledWith(channelId, 'cluster-node-A');
    expect(mockGetUnfinishedMessagesByServerId).toHaveBeenCalledTimes(1);
  });

  it('passes connection to DAO functions within transaction', async () => {
    mockGetUnfinishedMessagesByServerId.mockResolvedValue([
      { ID: 5, SERVER_ID: 'node-1' },
    ]);
    mockGetConnectorMessagesByStatus.mockResolvedValue([
      { MESSAGE_ID: 5, METADATA_ID: 1, STATUS: 'P', CONNECTOR_NAME: 'Dest' },
    ]);

    await runRecoveryTask(channelId, serverId);

    // All DAO calls within the transaction should receive the connection
    expect(mockUpdateConnectorMessageStatus).toHaveBeenCalledWith(
      channelId, 5, 1, Status.ERROR, mockConn
    );
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      channelId, 5, 1,
      expect.any(String),
      undefined, undefined, undefined, mockConn
    );
    expect(mockUpdateStatistics).toHaveBeenCalledWith(
      channelId, 1, serverId, Status.ERROR, 1, mockConn
    );
    expect(mockUpdateMessageProcessed).toHaveBeenCalledWith(
      channelId, 5, true, mockConn
    );
  });
});
