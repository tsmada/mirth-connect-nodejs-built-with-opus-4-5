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
  updateConnectorMessageStatus,
  channelTablesExist,
  getNextMessageId,
  getStatistics,
  pruneMessageContent,
  getConnectorMessageStatuses,
} from '../../../../src/db/DonkeyDao';

// Test source connector
class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

// Test destination that returns a response (triggers response transformer path)
class ResponseDestination extends DestinationConnector {
  public executeResponseTransformerCallOrder: number[] = [];
  private static callCounter = 0;

  constructor(metaDataId: number = 1, name: string = 'Response Dest') {
    super({ name, metaDataId, transportName: 'TEST' });
  }

  static resetCallCounter(): void {
    ResponseDestination.callCounter = 0;
  }

  async send(msg: ConnectorMessage): Promise<void> {
    msg.setSendDate(new Date());
  }

  async getResponse(): Promise<string | null> {
    return 'ACK|OK';
  }

  async executeResponseTransformer(_msg: ConnectorMessage): Promise<void> {
    this.executeResponseTransformerCallOrder.push(++ResponseDestination.callCounter);
  }
}

// Test destination with no response (skips response transformer path)
class NoResponseDestination extends DestinationConnector {
  constructor(metaDataId: number = 1, name: string = 'No Response Dest') {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(msg: ConnectorMessage): Promise<void> {
    msg.setSendDate(new Date());
  }
  async getResponse(): Promise<string | null> { return null; }
}

describe('PENDING status checkpoint', () => {
  let channel: Channel;

  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    ResponseDestination.resetCallCounter();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getStatistics as jest.Mock).mockResolvedValue([]);
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map());

    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  it('should set PENDING status before response transformer execution', async () => {
    // Track the order of updateConnectorMessageStatus calls
    const statusCalls: { metaDataId: number; status: Status }[] = [];
    (updateConnectorMessageStatus as jest.Mock).mockImplementation(
      async (_channelId: string, _messageId: number, metaDataId: number, status: Status) => {
        statusCalls.push({ metaDataId, status });
      }
    );

    const dest = new ResponseDestination(1);
    channel = new Channel({
      id: 'pending-test',
      name: 'Pending Test',
      enabled: true,
    });
    channel.setSourceConnector(new TestSourceConnector());
    channel.addDestinationConnector(dest);

    await channel.start();
    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    // Find PENDING and SENT calls for destination (metaDataId=1)
    const destStatusCalls = statusCalls.filter(c => c.metaDataId === 1);
    const pendingIndex = destStatusCalls.findIndex(c => c.status === Status.PENDING);
    const sentIndex = destStatusCalls.findIndex(c => c.status === Status.SENT);

    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(sentIndex).toBeGreaterThanOrEqual(0);
    // PENDING must come before SENT
    expect(pendingIndex).toBeLessThan(sentIndex);
  });

  it('should transition from PENDING to SENT after response transformer', async () => {
    const dest = new ResponseDestination(1);
    channel = new Channel({
      id: 'pending-sent-test',
      name: 'Pending to Sent Test',
      enabled: true,
    });
    channel.setSourceConnector(new TestSourceConnector());
    channel.addDestinationConnector(dest);

    await channel.start();
    const message = await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    // Final status should be SENT (Transaction 3 sets it after response transformer)
    const destMsg = message.getConnectorMessage(1);
    expect(destMsg?.getStatus()).toBe(Status.SENT);

    // PENDING should have been persisted to DB
    expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
      'pending-sent-test',
      expect.any(Number),
      1,
      Status.PENDING
    );

    // SENT should also have been persisted (in transaction)
    expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
      'pending-sent-test',
      expect.any(Number),
      1,
      Status.SENT,
      mockPoolConnection
    );
  });

  it('should NOT set PENDING when destination has no response', async () => {
    const dest = new NoResponseDestination(1);
    channel = new Channel({
      id: 'no-pending-test',
      name: 'No Pending Test',
      enabled: true,
    });
    channel.setSourceConnector(new TestSourceConnector());
    channel.addDestinationConnector(dest);

    await channel.start();
    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    // PENDING should NOT appear because getResponse() returned null
    const pendingCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[3] === Status.PENDING
    );
    expect(pendingCalls).toHaveLength(0);
  });

  it('should NOT set PENDING when storeResponse is false', async () => {
    const settings = new StorageSettings();
    settings.storeResponse = false;

    const dest = new ResponseDestination(1);
    channel = new Channel({
      id: 'no-store-resp-test',
      name: 'No Store Response Test',
      enabled: true,
      storageSettings: settings,
    });
    channel.setSourceConnector(new TestSourceConnector());
    channel.addDestinationConnector(dest);

    await channel.start();
    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    // PENDING should NOT appear because storeResponse is false (entire block skipped)
    const pendingCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[3] === Status.PENDING
    );
    expect(pendingCalls).toHaveLength(0);
  });
});

describe('removeContent DB-backed check', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getStatistics as jest.Mock).mockResolvedValue([]);

    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  function makeChannel(settings: StorageSettings, destCount: number = 1): { channel: Channel; dests: NoResponseDestination[] } {
    const channel = new Channel({
      id: 'remove-content-test',
      name: 'Remove Content Test',
      enabled: true,
      storageSettings: settings,
    });
    channel.setSourceConnector(new TestSourceConnector());
    const dests: NoResponseDestination[] = [];
    for (let i = 0; i < destCount; i++) {
      const dest = new NoResponseDestination(i + 1, `Dest ${i + 1}`);
      channel.addDestinationConnector(dest);
      dests.push(dest);
    }
    return { channel, dests };
  }

  it('should remove content when all destinations are SENT', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.TRANSFORMED],  // source
      [1, Status.SENT],         // destination 1
    ]));

    const { channel } = makeChannel(settings);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.TRANSFORMED],
      [1, Status.SENT],
    ]));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).toHaveBeenCalledWith('remove-content-test', [expect.any(Number)]);
  });

  it('should NOT remove content when a destination is QUEUED', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    const { channel } = makeChannel(settings, 2);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.TRANSFORMED],
      [1, Status.SENT],
      [2, Status.QUEUED],
    ]));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).not.toHaveBeenCalled();
  });

  it('should NOT remove content when a destination is PENDING', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    const { channel } = makeChannel(settings, 2);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.TRANSFORMED],
      [1, Status.SENT],
      [2, Status.PENDING],
    ]));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).not.toHaveBeenCalled();
  });

  it('should NOT remove content when DB query fails', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    const { channel } = makeChannel(settings);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getConnectorMessageStatuses as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).not.toHaveBeenCalled();
  });

  it('should remove content when all destinations are in terminal states (SENT/FILTERED/ERROR mix)', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    const { channel } = makeChannel(settings, 3);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.TRANSFORMED],
      [1, Status.SENT],
      [2, Status.FILTERED],
      [3, Status.ERROR],
    ]));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).toHaveBeenCalledWith('remove-content-test', [expect.any(Number)]);
  });

  it('should skip source connector (metaDataId=0) in terminal state check', async () => {
    const settings = new StorageSettings();
    settings.removeContentOnCompletion = true;

    const { channel } = makeChannel(settings);
    await channel.start();
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

    // Source is RECEIVED (non-terminal), but should be skipped since metaDataId=0
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map<number, Status>([
      [0, Status.RECEIVED],
      [1, Status.SENT],
    ]));

    await channel.dispatchRawMessage('<test/>');
    await channel.stop();

    expect(pruneMessageContent).toHaveBeenCalledWith('remove-content-test', [expect.any(Number)]);
  });
});
