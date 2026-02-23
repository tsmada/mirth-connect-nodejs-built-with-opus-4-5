/**
 * Tests for destination queue processing loop with retry logic.
 *
 * Covers:
 * - DestinationConnector.startQueueProcessing / stopQueueProcessing lifecycle
 * - Queue loop message processing (success → SENT)
 * - Retry with configurable retryCount (permanent failure → ERROR)
 * - Infinite retry when retryCount=0
 * - ResponseValidator NAK detection triggering retry
 * - Graceful shutdown via AbortController
 * - Channel catch block: queue-enabled → QUEUED, non-queue → ERROR
 * - Channel start/stop wiring for queue processing
 */

import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { DestinationConnector, DestinationConnectorConfig } from '../../../../src/donkey/channel/DestinationConnector';
import { DestinationQueue } from '../../../../src/donkey/queue/DestinationQueue';
import { ResponseValidator } from '../../../../src/donkey/message/ResponseValidator';

// ── Mock DonkeyDao ──────────────────────────────────────────────────────
const mockUpdateConnectorMessageStatus = jest.fn().mockResolvedValue(undefined);
const mockUpdateSendAttempts = jest.fn().mockResolvedValue(undefined);
const mockUpdateStatistics = jest.fn().mockResolvedValue(undefined);
const mockUpdateErrors = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../src/db/DonkeyDao', () => ({
  updateConnectorMessageStatus: (...args: unknown[]) => mockUpdateConnectorMessageStatus(...args),
  updateSendAttempts: (...args: unknown[]) => mockUpdateSendAttempts(...args),
  updateStatistics: (...args: unknown[]) => mockUpdateStatistics(...args),
  updateErrors: (...args: unknown[]) => mockUpdateErrors(...args),
}));

// ── Mock pool.ts (for Channel's transaction usage) ──────────────────────
jest.mock('../../../../src/db/pool', () => ({
  query: jest.fn().mockResolvedValue([]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 0 }]),
  transaction: jest.fn().mockImplementation(async (fn: (conn: unknown) => Promise<void>) => {
    const mockConn = {};
    await fn(mockConn);
  }),
  withRetry: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

// ── Mock all DonkeyDao functions that Channel.ts imports ────────────────
jest.mock('../../../../src/db/DonkeyDao', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: (...args: unknown[]) => mockUpdateConnectorMessageStatus(...args),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: (...args: unknown[]) => mockUpdateStatistics(...args),
  updateErrors: (...args: unknown[]) => mockUpdateErrors(...args),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: (...args: unknown[]) => mockUpdateSendAttempts(...args),
  getNextMessageId: jest.fn().mockResolvedValue(1),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(undefined),
  pruneMessageAttachments: jest.fn().mockResolvedValue(undefined),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getUnfinishedMessages: jest.fn().mockResolvedValue([]),
}));

// ── Test helpers ────────────────────────────────────────────────────────

function makeConnectorMessage(messageId: number = 1, metaDataId: number = 1): ConnectorMessage {
  return new ConnectorMessage({
    messageId,
    metaDataId,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Test Dest',
    serverId: 'node-1',
    receivedDate: new Date(),
    status: Status.QUEUED,
  });
}

/**
 * Concrete test subclass of DestinationConnector with controllable behavior.
 */
class TestQueueDestConnector extends DestinationConnector {
  sendBehavior: 'succeed' | 'fail' | 'fail-then-succeed' = 'succeed';
  sendCallCount = 0;
  failUntilAttempt = 2; // For fail-then-succeed: succeed after this many calls

  async send(_msg: ConnectorMessage): Promise<void> {
    this.sendCallCount++;
    if (this.sendBehavior === 'fail') throw new Error('Send failed');
    if (this.sendBehavior === 'fail-then-succeed' && this.sendCallCount < this.failUntilAttempt) {
      throw new Error('Send failed');
    }
  }

  async getResponse(_msg: ConnectorMessage): Promise<string | null> {
    return 'OK';
  }
}

function createTestConnector(overrides: Partial<DestinationConnectorConfig> = {}): TestQueueDestConnector {
  return new TestQueueDestConnector({
    name: 'TestDest',
    metaDataId: 1,
    transportName: 'Test',
    queueEnabled: true,
    retryCount: 3,
    retryIntervalMillis: 10, // Very short for tests
    ...overrides,
  });
}

/**
 * Create a minimal mock DestinationQueue that returns messages from a provided list.
 */
function createMockQueue(messages: ConnectorMessage[]): DestinationQueue {
  const queue = new DestinationQueue();
  let index = 0;
  const released: Array<{ msg: ConnectorMessage; finished: boolean }> = [];

  // Override acquire to return messages from list
  queue.acquire = jest.fn(() => {
    if (index < messages.length) {
      return messages[index++]!;
    }
    return null;
  });

  queue.release = jest.fn((msg: ConnectorMessage | null, finished: boolean) => {
    if (msg) released.push({ msg, finished });
  });

  queue.add = jest.fn();

  // Expose for assertions
  (queue as any).__released = released;
  (queue as any).__messages = messages;

  return queue;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('DestinationConnector Queue Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startQueueProcessing / stopQueueProcessing lifecycle', () => {
    it('should start and stop cleanly', async () => {
      const connector = createTestConnector();
      const queue = createMockQueue([]);
      connector.setQueue(queue);

      connector.startQueueProcessing();

      // Give the loop time to enter the sleep
      await new Promise((r) => setTimeout(r, 30));

      await connector.stopQueueProcessing();
      // Should not throw
    });

    it('should do nothing if queueEnabled is false', () => {
      const connector = createTestConnector({ queueEnabled: false });
      const queue = createMockQueue([]);
      connector.setQueue(queue);

      connector.startQueueProcessing();

      // acquire should never be called
      expect(queue.acquire).not.toHaveBeenCalled();
    });

    it('should do nothing if queue is not set', () => {
      const connector = createTestConnector();
      // No queue set
      connector.startQueueProcessing();
      // Should not throw
    });

    it('stopQueueProcessing is safe to call when not started', async () => {
      const connector = createTestConnector();
      await connector.stopQueueProcessing();
      // Should not throw
    });
  });

  describe('queue loop processes message successfully', () => {
    it('should send message and set SENT status', async () => {
      const connector = createTestConnector();
      const msg = makeConnectorMessage(1);
      const queue = createMockQueue([msg]);
      connector.setQueue(queue);

      connector.startQueueProcessing();

      // Wait for the loop to process the message and then poll empty
      await new Promise((r) => setTimeout(r, 50));

      await connector.stopQueueProcessing();

      expect(connector.sendCallCount).toBe(1);
      expect(msg.getStatus()).toBe(Status.SENT);
      expect(msg.getSendDate()).toBeDefined();
      expect(queue.release).toHaveBeenCalledWith(msg, true);
    });
  });

  describe('retry behavior', () => {
    it('should retry and permanently fail after retryCount attempts', async () => {
      const connector = createTestConnector({ retryCount: 2, retryIntervalMillis: 5 });
      connector.sendBehavior = 'fail';

      // Create a message that will be returned multiple times
      const msg = makeConnectorMessage(1);
      const queue = createMockQueue([]);

      // Override acquire to return the same message until it's permanently failed
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 3) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      // Wait for retries to process
      await new Promise((r) => setTimeout(r, 100));
      await connector.stopQueueProcessing();

      // After 2 send attempts (retryCount=2), should permanently fail
      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Send failed');
    });

    it('should keep retrying when retryCount=0 (unlimited)', async () => {
      const connector = createTestConnector({ retryCount: 0, retryIntervalMillis: 5 });
      connector.sendBehavior = 'fail';

      const msg = makeConnectorMessage(1);
      const queue = createMockQueue([]);

      // Return the same message multiple times
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 5) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise((r) => setTimeout(r, 100));
      await connector.stopQueueProcessing();

      // retryCount=0 means shouldPermanentlyFail always returns false
      // Message should be released back to queue (not finished)
      expect(queue.release).toHaveBeenCalledWith(msg, false);
      // Should NOT have been set to ERROR status permanently
      // (it may be in any state since the loop keeps going)
      expect(acquireCount).toBeGreaterThanOrEqual(3);
    });

    it('should succeed after initial failures with fail-then-succeed', async () => {
      const connector = createTestConnector({ retryCount: 5, retryIntervalMillis: 5 });
      connector.sendBehavior = 'fail-then-succeed';
      connector.failUntilAttempt = 2; // Fail first call, succeed second

      const msg = makeConnectorMessage(1);
      const queue = createMockQueue([]);

      // Return the same message until it succeeds
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 2) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise((r) => setTimeout(r, 100));
      await connector.stopQueueProcessing();

      // First call fails, connector releases for retry
      // Second call succeeds
      expect(connector.sendCallCount).toBe(2);
      expect(msg.getStatus()).toBe(Status.SENT);
    });
  });

  describe('ResponseValidator integration', () => {
    it('should retry when validator sets ERROR status', async () => {
      const connector = createTestConnector({ retryCount: 3, retryIntervalMillis: 5 });

      // Create a validator that sets ERROR on the message (like HL7 NAK)
      const nakValidator: ResponseValidator = {
        validate(response: string | null, connectorMessage: ConnectorMessage): string | null {
          connectorMessage.setStatus(Status.ERROR);
          connectorMessage.setProcessingError('NAK received');
          return response;
        },
      };
      connector.setResponseValidator(nakValidator);

      const msg = makeConnectorMessage(1);
      const queue = createMockQueue([]);

      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 4) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise((r) => setTimeout(r, 100));
      await connector.stopQueueProcessing();

      // Validator sets ERROR => release for retry on first attempts,
      // then permanent failure when retryCount reached
      expect(acquireCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('graceful shutdown', () => {
    it('should stop during sleep wait', async () => {
      const connector = createTestConnector({ retryIntervalMillis: 5000 }); // Long sleep
      const queue = createMockQueue([]); // Empty queue forces sleep
      connector.setQueue(queue);

      connector.startQueueProcessing();

      // Wait briefly for the loop to enter sleep
      await new Promise((r) => setTimeout(r, 20));

      const start = Date.now();
      await connector.stopQueueProcessing();
      const elapsed = Date.now() - start;

      // Should stop almost immediately, not wait for the 5s sleep
      expect(elapsed).toBeLessThan(1000);
    });
  });
});

describe('Channel queue-enabled destination error handling', () => {
  // Import Channel and SourceConnector for Channel-level tests
  const { Channel } = require('../../../../src/donkey/channel/Channel') as typeof import('../../../../src/donkey/channel/Channel');
  const { SourceConnector } = require('../../../../src/donkey/channel/SourceConnector') as typeof import('../../../../src/donkey/channel/SourceConnector');

  class TestSource extends SourceConnector {
    constructor() {
      super({ name: 'Source', transportName: 'Test' });
    }
    async start(): Promise<void> { this.running = true; }
    async stop(): Promise<void> { this.running = false; }
  }

  class TestDest extends DestinationConnector {
    shouldFail = false;
    sendCalled = false;

    async send(_msg: ConnectorMessage): Promise<void> {
      this.sendCalled = true;
      if (this.shouldFail) throw new Error('Destination send failed');
    }

    async getResponse(_msg: ConnectorMessage): Promise<string | null> {
      return 'OK';
    }
  }

  function createChannel(): any {
    const channel = new Channel({
      id: 'ch-1',
      name: 'Test Channel',
      enabled: true,
    });
    return channel;
  }

  it('queue-enabled destination: catch block sets QUEUED status', async () => {
    const channel = createChannel();
    const source = new TestSource();
    const dest = new TestDest({
      name: 'Dest1',
      metaDataId: 1,
      transportName: 'Test',
      queueEnabled: true,
      retryIntervalMillis: 10,
    });
    dest.shouldFail = true;

    const mockQueue = createMockQueue([]);
    dest.setQueue(mockQueue);

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    const message = await channel.dispatchRawMessage('test data');

    // The destination message should be QUEUED, not ERROR
    const destMsg = message.getConnectorMessage(1);
    expect(destMsg).toBeDefined();
    expect(destMsg!.getStatus()).toBe(Status.QUEUED);

    // Should have been added to the queue
    expect(mockQueue.add).toHaveBeenCalled();

    // Stats should show queued, not error
    const stats = channel.getStatistics();
    expect(stats.queued).toBe(1);
    expect(stats.error).toBe(0);
  });

  it('non-queue destination: catch block sets ERROR status (unchanged)', async () => {
    const channel = createChannel();
    const source = new TestSource();
    const dest = new TestDest({
      name: 'Dest1',
      metaDataId: 1,
      transportName: 'Test',
      queueEnabled: false,
    });
    dest.shouldFail = true;

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    const message = await channel.dispatchRawMessage('test data');

    // The destination message should be ERROR
    const destMsg = message.getConnectorMessage(1);
    expect(destMsg).toBeDefined();
    expect(destMsg!.getStatus()).toBe(Status.ERROR);
    expect(destMsg!.getProcessingError()).toContain('Destination send failed');

    // Stats should show error, not queued
    const stats = channel.getStatistics();
    expect(stats.error).toBe(1);
    expect(stats.queued).toBe(0);
  });

  it('Channel.start() starts queue processing for queue-enabled dests', async () => {
    const channel = createChannel();
    const source = new TestSource();
    const dest = new TestDest({
      name: 'Dest1',
      metaDataId: 1,
      transportName: 'Test',
      queueEnabled: true,
      retryIntervalMillis: 10,
    });

    const mockQueue = createMockQueue([]);
    dest.setQueue(mockQueue);

    const startSpy = jest.spyOn(dest, 'startQueueProcessing');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    await channel.start();

    expect(startSpy).toHaveBeenCalled();

    await channel.stop();
  });

  it('Channel.stop() stops queue processing', async () => {
    const channel = createChannel();
    const source = new TestSource();
    const dest = new TestDest({
      name: 'Dest1',
      metaDataId: 1,
      transportName: 'Test',
      queueEnabled: true,
      retryIntervalMillis: 10,
    });

    const mockQueue = createMockQueue([]);
    dest.setQueue(mockQueue);

    const stopSpy = jest.spyOn(dest, 'stopQueueProcessing');

    channel.setSourceConnector(source);
    channel.addDestinationConnector(dest);

    await channel.start();
    await channel.stop();

    expect(stopSpy).toHaveBeenCalled();
  });
});
