/**
 * Tests for Channel persistence failure tracking.
 *
 * Verifies that persistenceFailureCount increments when DB operations fail,
 * and that getPersistenceFailureCount() exposes the count for observability.
 */

const mockPoolConnection = {} as any;
jest.mock('../../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
}));

jest.mock('../../../../src/donkey/channel/RecoveryTask.js', () => ({
  runRecoveryTask: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  batchInsertContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockResolvedValue(1),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { transaction } from '../../../../src/db/pool';

const mockTransaction = transaction as jest.MockedFunction<typeof transaction>;

class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start() { this.running = true; }
  async stop() { this.running = false; }
  async dispatchRaw(rawData: string) {
    return this.getChannel()!.dispatchRawMessage(rawData);
  }
}

class TestDestConnector extends DestinationConnector {
  constructor(name: string, metaDataId: number = 1) {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async start() { this.running = true; }
  async stop() { this.running = false; }
  async send(message: ConnectorMessage): Promise<void> {
    message.setSendDate(new Date());
  }
  async getResponse(_message: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

function createTestChannel(): Channel {
  const config: ChannelConfig = {
    id: 'persist-test-channel',
    name: 'Persist Test',
    enabled: true,
  };
  const channel = new Channel(config);
  const source = new TestSourceConnector();
  const dest = new TestDestConnector('Test Dest');
  channel.setSourceConnector(source);
  channel.addDestinationConnector(dest);
  return channel;
}

describe('Channel persistence failure tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: transaction works normally
    mockTransaction.mockImplementation(async (callback: any) => {
      return callback(mockPoolConnection);
    });
  });

  it('should start with persistenceFailureCount at 0', () => {
    const channel = createTestChannel();
    expect(channel.getPersistenceFailureCount()).toBe(0);
  });

  it('should increment persistenceFailureCount when transaction fails', async () => {
    const channel = createTestChannel();

    // Make the first transaction call fail (source intake persist)
    let callCount = 0;
    mockTransaction.mockImplementation(async (callback: any) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('DB connection lost');
      }
      return callback(mockPoolConnection);
    });

    // dispatchRawMessage calls persistInTransaction multiple times
    // The first failure should increment the counter
    await channel.dispatchRawMessage('test data');

    expect(channel.getPersistenceFailureCount()).toBeGreaterThanOrEqual(1);
  });

  it('should accumulate failure count across multiple messages', async () => {
    const channel = createTestChannel();

    // Make all transactions fail
    mockTransaction.mockRejectedValue(new Error('DB gone'));

    await channel.dispatchRawMessage('msg 1');
    const countAfterFirst = channel.getPersistenceFailureCount();

    await channel.dispatchRawMessage('msg 2');
    const countAfterSecond = channel.getPersistenceFailureCount();

    expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
  });

  it('should not increment count on successful transactions', async () => {
    const channel = createTestChannel();

    // All transactions succeed (default mock)
    await channel.dispatchRawMessage('test data');

    expect(channel.getPersistenceFailureCount()).toBe(0);
  });
});
