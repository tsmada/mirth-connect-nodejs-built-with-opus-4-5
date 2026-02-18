/**
 * Tests for deadlock retry wiring in Channel.persistInTransaction().
 *
 * Verifies that persistInTransaction retries on deadlock before
 * incrementing persistenceFailureCount.
 */

const mockPoolConnection = {} as any;

jest.mock('../../../../src/db/pool.js', () => {
  // Working withRetry without delays
  const withRetry = async (fn: () => Promise<any>, maxRetries = 3) => {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const errno = error?.errno ?? error?.code;
        if ((errno === 1213 || errno === 1205) && attempt < maxRetries) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError!;
  };
  return {
    transaction: jest.fn().mockImplementation(async (callback: Function) => {
      return callback(mockPoolConnection);
    }),
    getPool: jest.fn(),
    withRetry,
  };
});

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
    id: 'deadlock-test-0000-0000-000000000001',
    name: 'Deadlock Test',
    enabled: true,
  };
  const channel = new Channel(config);
  const source = new TestSourceConnector();
  const dest = new TestDestConnector('Test Dest');
  channel.setSourceConnector(source);
  channel.addDestinationConnector(dest);
  return channel;
}

describe('Channel deadlock retry in persistInTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: transaction works normally
    mockTransaction.mockImplementation(async (callback: any) => {
      return callback(mockPoolConnection);
    });
  });

  it('should retry transaction on deadlock before swallowing error', async () => {
    const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });
    let callCount = 0;

    mockTransaction.mockImplementation(async (callback: any) => {
      callCount++;
      if (callCount === 1) {
        throw deadlockError;
      }
      return callback(mockPoolConnection);
    });

    const channel = createTestChannel();
    await channel.dispatchRawMessage('test data');

    // Retry succeeded — persistenceFailureCount should NOT increment
    // (some calls go through persistToDb which doesn't use transaction directly)
    expect(channel.getPersistenceFailureCount()).toBe(0);
  });

  it('should swallow error only after retry exhaustion', async () => {
    const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });

    // All transaction calls fail with deadlock
    mockTransaction.mockRejectedValue(deadlockError);

    const channel = createTestChannel();
    await channel.dispatchRawMessage('test data');

    // All retries exhausted → persistenceFailureCount incremented
    expect(channel.getPersistenceFailureCount()).toBeGreaterThanOrEqual(1);
  });

  it('should NOT increment persistenceFailureCount when retry succeeds', async () => {
    const deadlockError = Object.assign(new Error('Deadlock found'), { errno: 1213 });
    let firstCallDone = false;

    // First transaction call deadlocks, all subsequent succeed
    mockTransaction.mockImplementation(async (callback: any) => {
      if (!firstCallDone) {
        firstCallDone = true;
        throw deadlockError;
      }
      return callback(mockPoolConnection);
    });

    const channel = createTestChannel();
    await channel.dispatchRawMessage('test data');

    expect(channel.getPersistenceFailureCount()).toBe(0);
  });

  it('should increment persistenceFailureCount when all retries fail', async () => {
    // Non-retryable error — fails immediately
    const syntaxError = Object.assign(new Error('SQL syntax error'), { errno: 1064 });

    mockTransaction.mockRejectedValue(syntaxError);

    const channel = createTestChannel();
    await channel.dispatchRawMessage('test data');

    // Non-retryable error fails immediately, increments counter
    expect(channel.getPersistenceFailureCount()).toBeGreaterThanOrEqual(1);
  });
});
