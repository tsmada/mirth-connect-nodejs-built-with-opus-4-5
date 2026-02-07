/**
 * Validation scenarios for queue processing and batch message processing.
 *
 * Covers:
 * 1. Destination queue full lifecycle (dispatch → QUEUED → retry → SENT)
 * 2. Destination queue max retries (fail after retryCount)
 * 3. Batch message processing (HL7BatchAdaptor, SimpleLineBatchAdaptor, dispatchBatchMessage)
 * 4. DestinationChain encoded content chaining
 * 5. AttachmentHandler integration with channel pipeline
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
  getNextMessageId: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockNextMessageId++);
  }),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));
let mockNextMessageId = 1;

import { Channel } from '../../../../src/donkey/channel/Channel';
import { SourceConnector, SourceConnectorConfig } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import { DestinationChain, DestinationChainProvider } from '../../../../src/donkey/channel/DestinationChain';
import { HL7BatchAdaptor } from '../../../../src/donkey/message/HL7BatchAdaptor';
import { SimpleLineBatchAdaptor } from '../../../../src/donkey/message/SimpleLineBatchAdaptor';
import { AttachmentHandler } from '../../../../src/donkey/message/AttachmentHandler';
import { DestinationQueue } from '../../../../src/donkey/queue/DestinationQueue';
import { StorageSettings } from '../../../../src/donkey/channel/StorageSettings';
import {
  channelTablesExist, getNextMessageId,
} from '../../../../src/db/DonkeyDao';

// ── Test helpers ─────────────────────────────────────────────────────────────

class TestSourceConnector extends SourceConnector {
  public started = false;
  public stopped = false;

  constructor(config?: Partial<SourceConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Source',
      transportName: config?.transportName ?? 'TEST',
      waitForDestinations: config?.waitForDestinations,
      queueSendFirst: config?.queueSendFirst,
      respondAfterProcessing: config?.respondAfterProcessing,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopped = true;
  }
}

class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public failCount: number = 0;
  private sendCallCount = 0;

  constructor(metaDataId: number, name: string = 'Test Destination', options?: {
    queueEnabled?: boolean;
    retryCount?: number;
    retryIntervalMillis?: number;
    failCount?: number;
  }) {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
      queueEnabled: options?.queueEnabled ?? false,
      retryCount: options?.retryCount ?? 0,
      retryIntervalMillis: options?.retryIntervalMillis ?? 10,
    });
    this.failCount = options?.failCount ?? 0;
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sendCallCount++;
    if (this.sendCallCount <= this.failCount) {
      throw new Error(`Send failed (attempt ${this.sendCallCount})`);
    }
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

/**
 * Create a minimal mock DestinationQueue backed by an in-memory buffer.
 */
function createMockQueue(messages: ConnectorMessage[] = []): DestinationQueue {
  const queue = new DestinationQueue();
  let index = 0;
  const released: Array<{ msg: ConnectorMessage; finished: boolean }> = [];

  queue.acquire = jest.fn(() => {
    if (index < messages.length) {
      return messages[index++]!;
    }
    return null;
  });

  queue.release = jest.fn((msg: ConnectorMessage | null, finished: boolean) => {
    if (msg) released.push({ msg, finished });
  });

  queue.add = jest.fn((msg: ConnectorMessage) => {
    messages.push(msg);
  });

  (queue as any).__released = released;
  return queue;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Queue and Batch Validation', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Destination queue full lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Destination queue full lifecycle', () => {
    it('should set QUEUED status when destination send fails with queueEnabled=true', async () => {
      const channel = new Channel({
        id: 'queue-lifecycle',
        name: 'Queue Lifecycle',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1, 'Queued Dest', {
        queueEnabled: true,
        retryCount: 3,
        retryIntervalMillis: 10,
        failCount: 2, // Fail first 2 sends
      });

      const mockQueue = createMockQueue();
      dest.setQueue(mockQueue);

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const message = await channel.dispatchRawMessage('<test>queue lifecycle</test>');

      // First send fails => channel sets QUEUED status
      const destMsg = message.getConnectorMessage(1);
      expect(destMsg).toBeDefined();
      expect(destMsg!.getStatus()).toBe(Status.QUEUED);

      // Message was added to the queue for retry
      expect(mockQueue.add).toHaveBeenCalled();

      // Statistics should reflect queued, not error
      const stats = channel.getStatistics();
      expect(stats.queued).toBe(1);
      expect(stats.error).toBe(0);
    });

    it('should process queued message to SENT after retry succeeds', async () => {
      // Set up a connector that fails the first send then succeeds
      const connector = new TestDestinationConnector(1, 'Retry Dest', {
        queueEnabled: true,
        retryCount: 5,
        retryIntervalMillis: 5,
        failCount: 1, // Fail first send, succeed second
      });

      // Create a message in QUEUED state simulating what the channel puts in the queue
      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-ch',
        channelName: 'Test',
        connectorName: 'Retry Dest',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.QUEUED,
      });

      // Set up mock queue that returns the message twice (fail then succeed)
      const queue = createMockQueue([]);
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 2) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      // Wait for the queue processing loop to execute
      await new Promise(resolve => setTimeout(resolve, 200));
      await connector.stopQueueProcessing();

      // The message should end up SENT after the retry succeeds
      expect(msg.getStatus()).toBe(Status.SENT);
      expect(msg.getSendDate()).toBeDefined();
    });

    it('should increment sendAttempts through queue retries', async () => {
      const connector = new TestDestinationConnector(1, 'Attempts Dest', {
        queueEnabled: true,
        retryCount: 5,
        retryIntervalMillis: 5,
        failCount: 2, // Fail first 2, succeed on 3rd
      });

      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-ch',
        channelName: 'Test',
        connectorName: 'Attempts Dest',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.QUEUED,
      });

      const queue = createMockQueue([]);
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 3) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise(resolve => setTimeout(resolve, 300));
      await connector.stopQueueProcessing();

      // Should have incremented through 3 attempts
      expect(msg.getSendAttempts()).toBeGreaterThanOrEqual(3);
      expect(msg.getStatus()).toBe(Status.SENT);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Destination queue max retries
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Destination queue max retries', () => {
    it('should transition to ERROR after retryCount exceeded', async () => {
      const connector = new TestDestinationConnector(1, 'MaxRetry Dest', {
        queueEnabled: true,
        retryCount: 2,
        retryIntervalMillis: 5,
        failCount: 999, // Always fail
      });

      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-ch',
        channelName: 'Test',
        connectorName: 'MaxRetry Dest',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.QUEUED,
      });

      const queue = createMockQueue([]);
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 3) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise(resolve => setTimeout(resolve, 200));
      await connector.stopQueueProcessing();

      // After retryCount=2 attempts, message should be permanently failed
      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(msg.getProcessingError()).toBeDefined();
      expect(msg.getProcessingError()).toContain('Send failed');
    });

    it('should release message back to queue (not finished) when retryCount=0 (unlimited)', async () => {
      const connector = new TestDestinationConnector(1, 'Unlimited Dest', {
        queueEnabled: true,
        retryCount: 0, // Unlimited retries
        retryIntervalMillis: 5,
        failCount: 999,
      });

      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-ch',
        channelName: 'Test',
        connectorName: 'Unlimited Dest',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.QUEUED,
      });

      const queue = createMockQueue([]);
      let acquireCount = 0;
      queue.acquire = jest.fn(() => {
        acquireCount++;
        if (acquireCount <= 4) return msg;
        return null;
      });

      connector.setQueue(queue);
      connector.startQueueProcessing();

      await new Promise(resolve => setTimeout(resolve, 200));
      await connector.stopQueueProcessing();

      // With retryCount=0, shouldPermanentlyFail always returns false,
      // so the message is released back for retry (not finished)
      expect(queue.release).toHaveBeenCalledWith(msg, false);
      // Message should NOT be permanently errored
      expect(acquireCount).toBeGreaterThanOrEqual(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Batch message processing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Batch message processing', () => {
    it('HL7BatchAdaptor should split multi-MSH payload correctly', async () => {
      const batchPayload = [
        'MSH|^~\\&|SYS1|FAC1|SYS2|FAC2|20240101||ADT^A01|MSG001|P|2.3',
        'PID|||12345||Doe^John',
        'MSH|^~\\&|SYS1|FAC1|SYS2|FAC2|20240101||ADT^A08|MSG002|P|2.3',
        'PID|||67890||Smith^Jane',
        'MSH|^~\\&|SYS1|FAC1|SYS2|FAC2|20240101||ADT^A04|MSG003|P|2.3',
        'PID|||11111||Brown^Bob',
      ].join('\n');

      const adaptor = new HL7BatchAdaptor(batchPayload);

      // Should produce 3 messages
      const messages: string[] = [];
      let msg = await adaptor.getMessage();
      while (msg !== null) {
        messages.push(msg);
        msg = await adaptor.getMessage();
      }

      expect(messages).toHaveLength(3);

      // Each message should start with MSH and contain its PID, joined by \r
      expect(messages[0]).toContain('MSH|^~\\&|SYS1|FAC1|SYS2|FAC2|20240101||ADT^A01');
      expect(messages[0]).toContain('PID|||12345||Doe^John');
      expect(messages[0]).toContain('\r'); // HL7 segment separator

      expect(messages[1]).toContain('ADT^A08');
      expect(messages[1]).toContain('PID|||67890||Smith^Jane');

      expect(messages[2]).toContain('ADT^A04');
      expect(messages[2]).toContain('PID|||11111||Brown^Bob');

      expect(adaptor.isBatchComplete()).toBe(true);
    });

    it('HL7BatchAdaptor should skip batch envelope segments (FHS/BHS/BTS/FTS)', async () => {
      const batchPayload = [
        'FHS|^~\\&|SENDER|',
        'BHS|^~\\&|SENDER|',
        'MSH|^~\\&|SYS1|FAC1|SYS2|FAC2|20240101||ADT^A01|MSG001|P|2.3',
        'PID|||12345||Doe^John',
        'BTS|1',
        'FTS|1',
      ].join('\n');

      const adaptor = new HL7BatchAdaptor(batchPayload);
      const msg1 = await adaptor.getMessage();
      const msg2 = await adaptor.getMessage();

      expect(msg1).not.toBeNull();
      expect(msg1).toContain('MSH');
      expect(msg1).toContain('PID');
      // Envelope segments should not appear in the output
      expect(msg1).not.toContain('FHS');
      expect(msg1).not.toContain('BHS');
      expect(msg1).not.toContain('BTS');
      expect(msg1).not.toContain('FTS');
      expect(msg2).toBeNull();
    });

    it('SimpleLineBatchAdaptor should split multi-line text on newlines', async () => {
      const payload = 'line one\nline two\nline three\n';

      const adaptor = new SimpleLineBatchAdaptor(payload);

      const messages: string[] = [];
      let msg = await adaptor.getMessage();
      while (msg !== null) {
        messages.push(msg);
        msg = await adaptor.getMessage();
      }

      expect(messages).toHaveLength(3);
      expect(messages[0]).toBe('line one');
      expect(messages[1]).toBe('line two');
      expect(messages[2]).toBe('line three');

      // Sequence IDs should be 1-based
      expect(adaptor.getBatchSequenceId()).toBe(3);
      expect(adaptor.isBatchComplete()).toBe(true);
    });

    it('SourceConnector.dispatchBatchMessage should dispatch each sub-message with batch metadata', async () => {
      const channel = new Channel({
        id: 'batch-channel',
        name: 'Batch Channel',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const batchPayload = 'msg-A\nmsg-B\nmsg-C';
      const adaptor = new SimpleLineBatchAdaptor(batchPayload);
      const baseSourceMap = new Map<string, unknown>([['origin', 'test']]);

      // Use the source connector's dispatchBatchMessage
      await (source as any).dispatchBatchMessage(batchPayload, adaptor, baseSourceMap);

      // Should have dispatched 3 sub-messages through the channel
      expect(dest.sentMessages).toHaveLength(3);

      // Verify mockNextMessageId incremented 3 times
      expect(mockNextMessageId).toBe(4);
    });

    it('HL7BatchAdaptor should handle empty batch (no messages)', async () => {
      const adaptor = new HL7BatchAdaptor('');

      const msg = await adaptor.getMessage();
      expect(msg).toBeNull();
      expect(adaptor.isBatchComplete()).toBe(true);
      expect(adaptor.getBatchSequenceId()).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DestinationChain encoded content chaining
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DestinationChain encoded content chaining', () => {
    /**
     * Create a DestinationChainProvider wrapping the given destinations.
     */
    function createChainProvider(
      destinations: Map<number, DestinationConnector>,
      metaDataIds: number[]
    ): DestinationChainProvider {
      return {
        getChannelId: () => 'chain-ch',
        getChannelName: () => 'Chain Channel',
        getMetaDataIds: () => metaDataIds,
        getDestinationConnectors: () => destinations,
        getChainId: () => 1,
        getServerId: () => 'node-1',
      };
    }

    it('should pass D1 encoded output as D2 raw input', async () => {
      // D1: a destination that sets encoded content to "transformed-by-d1"
      const d1 = new TestDestinationConnector(1, 'D1');
      const d2 = new TestDestinationConnector(2, 'D2');

      const destinations = new Map<number, DestinationConnector>();
      destinations.set(1, d1);
      destinations.set(2, d2);

      const provider = createChainProvider(destinations, [1, 2]);
      const chain = new DestinationChain(provider);

      // Create initial message for D1
      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'chain-ch',
        channelName: 'Chain Channel',
        connectorName: 'D1',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setContent({
        contentType: ContentType.RAW,
        content: '<original>data</original>',
        dataType: 'XML',
        encrypted: false,
      });

      chain.setMessage(msg);

      // D1 will be called with RECEIVED status. The chain calls transformAndProcess
      // which runs filter (returns false = not filtered), then transformer (no-op),
      // then send. Since there's no transformer, it copies raw as encoded.
      // After D1 sends, the chain creates D2's message with D1's encoded output.
      const results = await chain.call();

      expect(results).toHaveLength(2);

      // D1 should be SENT
      expect(results[0]!.getStatus()).toBe(Status.SENT);

      // D2 should also be processed
      const d2Msg = results[1]!;

      // D2's raw content should be D1's encoded content
      // Since D1 has no transformer, encoded = raw
      const d2Raw = d2Msg.getRawContent();
      expect(d2Raw).toBeDefined();
      expect(d2Raw!.content).toBe('<original>data</original>');
    });

    it('should pass custom encoded content from D1 to D2 when transformer sets it', async () => {
      // Create a custom D1 that sets encoded content during send
      class EncodingDestConnector extends DestinationConnector {
        public sentMessages: ConnectorMessage[] = [];

        async send(connectorMessage: ConnectorMessage): Promise<void> {
          this.sentMessages.push(connectorMessage);
          connectorMessage.setSendDate(new Date());
        }

        async getResponse(): Promise<string | null> {
          return null;
        }
      }

      const d1 = new EncodingDestConnector({ name: 'D1', metaDataId: 1, transportName: 'TEST' });
      const d2 = new EncodingDestConnector({ name: 'D2', metaDataId: 2, transportName: 'TEST' });

      const destinations = new Map<number, DestinationConnector>();
      destinations.set(1, d1);
      destinations.set(2, d2);

      const provider = createChainProvider(destinations, [1, 2]);
      const chain = new DestinationChain(provider);

      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'chain-ch',
        channelName: 'Chain Channel',
        connectorName: 'D1',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setContent({
        contentType: ContentType.RAW,
        content: '<raw>original</raw>',
        dataType: 'XML',
        encrypted: false,
      });
      // Simulate that D1's transformer set encoded content
      msg.setContent({
        contentType: ContentType.ENCODED,
        content: 'transformed-by-d1',
        dataType: 'HL7V2',
        encrypted: false,
      });
      // Mark as already transformed so chain goes to send
      msg.setStatus(Status.RECEIVED);

      chain.setMessage(msg);
      const results = await chain.call();

      expect(results).toHaveLength(2);

      // D2 should receive D1's encoded content as its raw input
      const d2Msg = results[1]!;
      const d2Raw = d2Msg.getRawContent();
      expect(d2Raw).toBeDefined();
      expect(d2Raw!.content).toBe('transformed-by-d1');
      expect(d2Raw!.dataType).toBe('HL7V2');
    });

    it('should stop chain when a destination errors', async () => {
      // D1 always throws
      class FailingDestConnector extends DestinationConnector {
        async send(): Promise<void> {
          throw new Error('D1 send failure');
        }
        async getResponse(): Promise<string | null> {
          return null;
        }
      }

      const d1 = new FailingDestConnector({ name: 'D1', metaDataId: 1, transportName: 'TEST' });
      const d2 = new TestDestinationConnector(2, 'D2');

      const destinations = new Map<number, DestinationConnector>();
      destinations.set(1, d1);
      destinations.set(2, d2);

      const provider = createChainProvider(destinations, [1, 2]);
      const chain = new DestinationChain(provider);

      const msg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'chain-ch',
        channelName: 'Chain Channel',
        connectorName: 'D1',
        serverId: 'node-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setContent({
        contentType: ContentType.RAW,
        content: '<data/>',
        dataType: 'XML',
        encrypted: false,
      });

      chain.setMessage(msg);
      const results = await chain.call();

      // Chain should stop at D1 — only 1 result
      expect(results).toHaveLength(1);
      expect(results[0]!.getStatus()).toBe(Status.ERROR);
      expect(results[0]!.getProcessingError()).toContain('D1 send failure');

      // D2 should never have been called
      expect(d2.sentMessages).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. AttachmentHandler integration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AttachmentHandler integration', () => {
    it('should replace content via custom AttachmentHandler before persisting', async () => {
      // Custom handler that replaces "SECRET" with an attachment token
      const customHandler: AttachmentHandler = {
        async extractAttachments(
          _channelId: string,
          _messageId: number,
          connectorMessage: ConnectorMessage
        ): Promise<string> {
          const raw = connectorMessage.getRawContent();
          const content = raw?.content ?? '';
          // Replace SECRET with attachment token
          return content.replace('SECRET', '${ATTACH:att-001}');
        },
      };

      const settings = new StorageSettings();
      settings.storeRaw = true;
      settings.storeAttachments = true;
      settings.storeProcessedRaw = false;
      settings.storeTransformed = false;
      settings.storeSourceEncoded = false;
      settings.storeDestinationEncoded = false;
      settings.storeSent = false;
      settings.storeResponse = false;
      settings.storeResponseTransformed = false;
      settings.storeProcessedResponse = false;
      settings.storeMaps = false;
      settings.storeMergedResponseMap = false;
      settings.storeCustomMetaData = false;
      settings.removeContentOnCompletion = false;
      settings.removeOnlyFilteredOnCompletion = false;
      settings.removeAttachmentsOnCompletion = false;
      settings.messageRecoveryEnabled = false;

      const channel = new Channel({
        id: 'attach-channel',
        name: 'Attachment Channel',
        enabled: true,
        storageSettings: settings,
      });
      channel.setAttachmentHandler(customHandler);

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const message = await channel.dispatchRawMessage('Patient data: SECRET info');

      // The raw content in the source message should have the attachment token
      const sourceMsg = message.getConnectorMessage(0);
      expect(sourceMsg).toBeDefined();
      const rawContent = sourceMsg!.getRawContent();
      expect(rawContent).toBeDefined();
      expect(rawContent!.content).toBe('Patient data: ${ATTACH:att-001} info');
      expect(rawContent!.content).not.toContain('SECRET');
    });

    it('should persist original content when attachment handler returns unchanged content', async () => {
      // Handler that returns content unchanged (no attachments found)
      const noopHandler: AttachmentHandler = {
        async extractAttachments(
          _channelId: string,
          _messageId: number,
          connectorMessage: ConnectorMessage
        ): Promise<string> {
          const raw = connectorMessage.getRawContent();
          return raw?.content ?? '';
        },
      };

      const settings2 = new StorageSettings();
      settings2.storeRaw = true;
      settings2.storeAttachments = true;
      settings2.storeProcessedRaw = false;
      settings2.storeTransformed = false;
      settings2.storeSourceEncoded = false;
      settings2.storeDestinationEncoded = false;
      settings2.storeSent = false;
      settings2.storeResponse = false;
      settings2.storeResponseTransformed = false;
      settings2.storeProcessedResponse = false;
      settings2.storeMaps = false;
      settings2.storeMergedResponseMap = false;
      settings2.storeCustomMetaData = false;
      settings2.removeContentOnCompletion = false;
      settings2.removeOnlyFilteredOnCompletion = false;
      settings2.removeAttachmentsOnCompletion = false;
      settings2.messageRecoveryEnabled = false;

      const channel = new Channel({
        id: 'noop-attach',
        name: 'NoOp Attachment',
        enabled: true,
        storageSettings: settings2,
      });
      channel.setAttachmentHandler(noopHandler);

      const source = new TestSourceConnector();
      channel.setSourceConnector(source);

      const message = await channel.dispatchRawMessage('No secrets here');

      const sourceMsg = message.getConnectorMessage(0);
      expect(sourceMsg).toBeDefined();
      const rawContent = sourceMsg!.getRawContent();
      expect(rawContent).toBeDefined();
      expect(rawContent!.content).toBe('No secrets here');
    });
  });
});
