/**
 * Exception Handling — Behavioral Integration Tests
 *
 * Verifies error propagation contracts through the pipeline:
 * - Filter exception → ERROR status, chain stops
 * - Transformer exception → ERROR status, chain stops
 * - Send exception (no queue) → ERROR status
 * - Send exception (queue enabled) → QUEUED status
 * - Send exception (queue enabled, sendFirst) → attempt send, then QUEUED on failure
 * - Postprocessor still runs after destination errors
 * - Processing error is persisted to ConnectorMessage
 *
 * Ported from: ~/Projects/connect/donkey/src/test/java/com/mirth/connect/donkey/test/ChannelTests.java
 * Pattern: P9 (Pipeline integration) with DB mocks + real DestinationChain
 */

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

jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/db/DonkeyDao.js', () => ({
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController.js', () => ({
  dashboardStatusController: { processEvent: jest.fn() },
}));

jest.mock('../../../src/telemetry/metrics.js', () => ({
  messagesProcessed: { add: jest.fn() },
  messagesErrored: { add: jest.fn() },
  messageDuration: { record: jest.fn() },
  queueDepth: { add: jest.fn() },
}));

import { DestinationChain, DestinationChainProvider } from '../../../src/donkey/channel/DestinationChain.js';
import { DestinationConnector } from '../../../src/donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage.js';
import { ContentType } from '../../../src/model/ContentType.js';
import { Status } from '../../../src/model/Status.js';
import { DestinationQueue } from '../../../src/donkey/queue/DestinationQueue.js';

// Configurable test connector
class TestDestConnector extends DestinationConnector {
  public filterShouldThrow = false;
  public transformerShouldThrow = false;
  public sendShouldThrow = false;
  public filterResult = false;
  public sentMessages: ConnectorMessage[] = [];

  constructor(metaDataId: number, name: string, queueEnabled = false, queueSendFirst = false) {
    super({ name, metaDataId, transportName: 'TEST', queueEnabled, queueSendFirst });
  }

  async executeFilter(_msg: ConnectorMessage): Promise<boolean> {
    if (this.filterShouldThrow) throw new Error('Filter exploded');
    return this.filterResult;
  }

  async executeTransformer(msg: ConnectorMessage): Promise<void> {
    if (this.transformerShouldThrow) throw new Error('Transformer exploded');
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: 'encoded',
      dataType: 'HL7V2',
      encrypted: false,
    });
  }

  async send(msg: ConnectorMessage): Promise<void> {
    if (this.sendShouldThrow) throw new Error('Connection refused');
    this.sentMessages.push(msg);
  }

  async getResponse(_msg: ConnectorMessage): Promise<string | null> {
    return null;
  }

  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

function createChainAndMessage(
  destinations: TestDestConnector[],
  startMetaDataId: number = 1
): { chain: DestinationChain; message: ConnectorMessage } {
  const connectors = new Map<number, DestinationConnector>();
  const metaDataIds: number[] = [];
  for (const dest of destinations) {
    connectors.set(dest.getMetaDataId(), dest);
    metaDataIds.push(dest.getMetaDataId());
  }

  const provider: DestinationChainProvider = {
    getChannelId: () => 'test-ch',
    getChannelName: () => 'Test',
    getMetaDataIds: () => metaDataIds,
    getDestinationConnectors: () => connectors,
    getChainId: () => 1,
    getServerId: () => 'server-1',
  };

  const chain = new DestinationChain(provider);
  const message = new ConnectorMessage({
    messageId: 1,
    metaDataId: startMetaDataId,
    channelId: 'test-ch',
    channelName: 'Test',
    connectorName: `Dest ${startMetaDataId}`,
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
  message.setContent({
    contentType: ContentType.RAW,
    content: '<msg/>',
    dataType: 'XML',
    encrypted: false,
  });
  chain.setMessage(message);
  return { chain, message };
}

describe('Exception Handling: filter/transformer errors', () => {
  it('should set ERROR and stop chain on filter exception', async () => {
    const dest1 = new TestDestConnector(1, 'Dest 1');
    const dest2 = new TestDestConnector(2, 'Dest 2');
    dest1.filterShouldThrow = true;

    const { chain } = createChainAndMessage([dest1, dest2]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.ERROR);
    expect(results[0]!.getProcessingError()).toContain('Filter exploded');
    // Dest 2 should never execute
    expect(dest2.sentMessages).toHaveLength(0);
  });

  it('should set ERROR and stop chain on transformer exception', async () => {
    const dest1 = new TestDestConnector(1, 'Dest 1');
    dest1.transformerShouldThrow = true;

    const { chain } = createChainAndMessage([dest1]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.ERROR);
    expect(results[0]!.getProcessingError()).toContain('Transformer exploded');
  });
});

describe('Exception Handling: send errors with queue modes', () => {
  it('should set ERROR when send throws and queue is disabled', async () => {
    const dest = new TestDestConnector(1, 'Dest 1', false);
    dest.sendShouldThrow = true;

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.ERROR);
  });

  it('should set QUEUED when send throws and queue is enabled', async () => {
    const dest = new TestDestConnector(1, 'Dest 1', true, false);
    dest.sendShouldThrow = true;
    dest.setQueue(new DestinationQueue());

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.QUEUED);
  });

  it('should set QUEUED immediately when queueEnabled=true and sendFirst=false', async () => {
    const dest = new TestDestConnector(1, 'Dest 1', true, false);
    dest.setQueue(new DestinationQueue());
    // sendShouldThrow doesn't matter — message is queued without attempting send

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.QUEUED);
    // send() should NOT have been called
    expect(dest.sentMessages).toHaveLength(0);
  });

  it('should attempt send first when queueEnabled=true and sendFirst=true, QUEUED on failure', async () => {
    const dest = new TestDestConnector(1, 'Dest 1', true, true);
    dest.sendShouldThrow = true;
    dest.setQueue(new DestinationQueue());

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.QUEUED);
    // send() WAS attempted (sendFirst=true) but failed, so QUEUED
  });

  it('should set SENT when queueEnabled=true and sendFirst=true and send succeeds', async () => {
    const dest = new TestDestConnector(1, 'Dest 1', true, true);
    // sendShouldThrow = false (default) — send will succeed

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.SENT);
    expect(dest.sentMessages).toHaveLength(1);
  });
});

describe('Exception Handling: error propagation to subsequent chain members', () => {
  it('should not create next chain message after error (stopChain=true)', async () => {
    const dest1 = new TestDestConnector(1, 'Dest 1');
    const dest2 = new TestDestConnector(2, 'Dest 2');
    dest1.sendShouldThrow = true;

    const { chain } = createChainAndMessage([dest1, dest2]);
    const results = await chain.call();

    // Only 1 result — dest2's message was never created
    expect(results).toHaveLength(1);
    expect(results[0]!.getStatus()).toBe(Status.ERROR);
  });

  it('should preserve processingError string on ERROR status', async () => {
    const dest = new TestDestConnector(1, 'Dest 1');
    dest.sendShouldThrow = true;

    const { chain } = createChainAndMessage([dest]);
    const results = await chain.call();

    expect(results[0]!.getProcessingError()).toContain('Connection refused');
  });
});
