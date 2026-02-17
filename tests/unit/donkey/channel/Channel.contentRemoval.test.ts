/**
 * Tests for source queue content removal safety.
 *
 * Verifies that both the sync path (dispatchRawMessage) and async path
 * (processFromSourceQueue) check allDestinationsTerminal() before pruning
 * message content. Content must not be removed while any destination
 * is still in a non-terminal state (e.g. QUEUED).
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
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { StorageSettings } from '../../../../src/donkey/channel/StorageSettings';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  pruneMessageContent,
  getConnectorMessageStatuses,
} from '../../../../src/db/DonkeyDao';

// --- Test connector classes ---

class TestSourceConnector extends SourceConnector {
  constructor(private respondAfter: boolean = true) {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
  getRespondAfterProcessing(): boolean { return this.respondAfter; }
}

class TestDestinationConnector extends DestinationConnector {
  constructor(metaDataId: number, name: string = 'Test Dest') {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(msg: ConnectorMessage): Promise<void> {
    msg.setSendDate(new Date());
  }
  async getResponse(): Promise<string | null> { return null; }
  getResponseDataType(): string { return 'RAW'; }
}

// --- Helpers ---

function createChannel(overrides?: Partial<StorageSettings>): Channel {
  const storageSettings = new StorageSettings();
  storageSettings.removeContentOnCompletion = true;
  storageSettings.removeOnlyFilteredOnCompletion = false;
  if (overrides) {
    Object.assign(storageSettings, overrides);
  }

  const channel = new Channel({
    id: 'test-channel-id',
    name: 'Content Removal Test Channel',
    enabled: true,
    storageSettings,
  });

  const source = new TestSourceConnector(true);
  channel.setSourceConnector(source);

  const dest1 = new TestDestinationConnector(1, 'Dest 1');
  const dest2 = new TestDestinationConnector(2, 'Dest 2');
  channel.addDestinationConnector(dest1);
  channel.addDestinationConnector(dest2);

  return channel;
}

// --- Tests ---

describe('Channel content removal safety', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    GlobalMap.getInstance().clear();
    ConfigurationMap.getInstance().clear();
    GlobalChannelMapStore.getInstance().clear('test-channel-id');
    resetDefaultExecutor();
  });

  describe('allDestinationsTerminal check (sync path)', () => {
    it('removes content when all destinations are SENT', async () => {
      const channel = createChannel();

      // Mock: both destinations are SENT (terminal)
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.SENT],     // source
          [1, Status.SENT],     // dest 1
          [2, Status.SENT],     // dest 2
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).toHaveBeenCalled();
    });

    it('does NOT remove content when one destination is QUEUED', async () => {
      const channel = createChannel();

      // Mock: dest 2 is QUEUED (non-terminal)
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.SENT],
          [2, Status.QUEUED],   // still in queue — NOT terminal
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).not.toHaveBeenCalled();
    });

    it('removes content when all destinations are FILTERED', async () => {
      const channel = createChannel();

      // Mock: both destinations are FILTERED (terminal)
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.TRANSFORMED],
          [1, Status.FILTERED],
          [2, Status.FILTERED],
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).toHaveBeenCalled();
    });

    it('removes content when one destination is ERROR among SENT (ERROR is terminal)', async () => {
      const channel = createChannel();

      // Mock: dest 1 is SENT, dest 2 is ERROR — both are terminal
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.SENT],
          [2, Status.ERROR],
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).toHaveBeenCalled();
    });

    it('does NOT remove content when one destination is PENDING', async () => {
      const channel = createChannel();

      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.SENT],
          [2, Status.PENDING],  // waiting for response — NOT terminal
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).not.toHaveBeenCalled();
    });

    it('does NOT remove content when one destination is RECEIVED', async () => {
      const channel = createChannel();

      (getConnectorMessageStatuses as jest.Mock).mockResolvedValueOnce(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.SENT],
          [2, Status.RECEIVED],  // just received — NOT terminal
        ])
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).not.toHaveBeenCalled();
    });

    it('does NOT remove content when DB status check fails (safe default)', async () => {
      const channel = createChannel();

      // Simulate DB error
      (getConnectorMessageStatuses as jest.Mock).mockRejectedValueOnce(
        new Error('DB connection lost')
      );

      await channel.dispatchRawMessage('test message');

      expect(pruneMessageContent).not.toHaveBeenCalled();
    });
  });

  describe('async path (processFromSourceQueue) uses same safety check', () => {
    it('removes content in async path when all destinations are SENT', async () => {
      // Use respondAfterProcessing=false to trigger async/source queue path
      const storageSettings = new StorageSettings();
      storageSettings.removeContentOnCompletion = true;
      storageSettings.removeOnlyFilteredOnCompletion = false;

      const channel = new Channel({
        id: 'async-test-channel',
        name: 'Async Content Removal Channel',
        enabled: true,
        storageSettings,
      });

      const source = new TestSourceConnector(false); // async mode
      channel.setSourceConnector(source);

      const dest = new TestDestinationConnector(1, 'Async Dest');
      channel.addDestinationConnector(dest);

      // Start the channel to initialize source queue
      await channel.start();

      // Mock statuses for async processing
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.SENT],
        ])
      );

      // Dispatch a message — it will be queued and processed asynchronously
      await channel.dispatchRawMessage('async test');

      // Wait for the source queue to process
      await new Promise(resolve => setTimeout(resolve, 300));

      await channel.stop();

      // The async path should have called pruneMessageContent
      expect(pruneMessageContent).toHaveBeenCalled();
    });

    it('does NOT remove content in async path when a destination is QUEUED', async () => {
      const storageSettings = new StorageSettings();
      storageSettings.removeContentOnCompletion = true;
      storageSettings.removeOnlyFilteredOnCompletion = false;

      const channel = new Channel({
        id: 'async-test-channel-2',
        name: 'Async No Remove Channel',
        enabled: true,
        storageSettings,
      });

      const source = new TestSourceConnector(false); // async mode
      channel.setSourceConnector(source);

      const dest = new TestDestinationConnector(1, 'Async Dest');
      channel.addDestinationConnector(dest);

      await channel.start();

      // One destination still QUEUED — should block content removal
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(
        new Map<number, Status>([
          [0, Status.SENT],
          [1, Status.QUEUED],
        ])
      );

      await channel.dispatchRawMessage('async test queued');

      await new Promise(resolve => setTimeout(resolve, 300));

      await channel.stop();

      expect(pruneMessageContent).not.toHaveBeenCalled();
    });
  });
});
