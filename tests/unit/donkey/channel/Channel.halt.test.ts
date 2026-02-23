const mockPoolConnection = {} as any;
jest.mock('../../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
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
  deleteMessageContentByMetaDataIds: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import { channelTablesExist } from '../../../../src/db/DonkeyDao';

class TestSourceConnector extends SourceConnector {
  public started = false;

  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }

  async start(): Promise<void> {
    this.running = true;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.started = false;
  }

  async testDispatch(rawData: string): Promise<void> {
    await this.dispatchRawMessage(rawData);
  }
}

class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public stopCalled = false;
  public stopQueueProcessingCalled = false;

  constructor(metaDataId: number, name: string = 'Test Destination') {
    super({ name, metaDataId, transportName: 'TEST' });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
    await super.stop();
  }

  async stopQueueProcessing(): Promise<void> {
    this.stopQueueProcessingCalled = true;
    await super.stopQueueProcessing();
  }
}

describe('Channel.halt()', () => {
  let channel: Channel;
  let sourceConnector: TestSourceConnector;
  let dest1: TestDestinationConnector;
  let dest2: TestDestinationConnector;

  beforeEach(() => {
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);

    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    const config: ChannelConfig = {
      id: 'halt-test-channel',
      name: 'Halt Test Channel',
      enabled: true,
    };

    channel = new Channel(config);
    sourceConnector = new TestSourceConnector();
    dest1 = new TestDestinationConnector(1, 'Dest 1');
    dest2 = new TestDestinationConnector(2, 'Dest 2');

    channel.setSourceConnector(sourceConnector);
    channel.addDestinationConnector(dest1);
    channel.addDestinationConnector(dest2);
  });

  it('should stop source connector and transition to STOPPED', async () => {
    await channel.start();
    expect(sourceConnector.started).toBe(true);
    expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

    await channel.halt();

    expect(sourceConnector.started).toBe(false);
    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
  });

  it('should stop all destination connectors', async () => {
    await channel.start();

    await channel.halt();

    expect(dest1.stopCalled).toBe(true);
    expect(dest2.stopCalled).toBe(true);
    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
  });

  it('should NOT run the undeploy script', async () => {
    // Create a channel with an undeploy script
    const configWithUndeploy: ChannelConfig = {
      id: 'halt-undeploy-test',
      name: 'Halt Undeploy Test',
      enabled: true,
      undeployScript: 'globalMap.put("undeployed", true);',
    };

    const channelWithUndeploy = new Channel(configWithUndeploy);
    const src = new TestSourceConnector();
    const dst = new TestDestinationConnector(1);
    channelWithUndeploy.setSourceConnector(src);
    channelWithUndeploy.addDestinationConnector(dst);

    await channelWithUndeploy.start();

    // halt() should NOT execute the undeploy script
    await channelWithUndeploy.halt();

    // If the undeploy script ran, globalMap would have "undeployed" = true
    const gm = GlobalMap.getInstance();
    expect(gm.get('undeployed')).toBeUndefined();
    expect(channelWithUndeploy.getCurrentState()).toBe(DeployedState.STOPPED);
  });

  it('should NOT call stopQueueProcessing on destination connectors', async () => {
    await channel.start();

    await channel.halt();

    // halt() skips queue drain — stopQueueProcessing should NOT be called
    expect(dest1.stopQueueProcessingCalled).toBe(false);
    expect(dest2.stopQueueProcessingCalled).toBe(false);
  });

  it('should transition from STARTED to STOPPED', async () => {
    await channel.start();
    expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

    const stateChanges: DeployedState[] = [];
    channel.on('stateChange', (event: { state: DeployedState }) => {
      stateChanges.push(event.state);
    });

    await channel.halt();

    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
    expect(stateChanges).toContain(DeployedState.STOPPING);
    expect(stateChanges).toContain(DeployedState.STOPPED);
  });

  it('should transition from PAUSED to STOPPED', async () => {
    await channel.start();
    await channel.pause();
    expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);

    await channel.halt();

    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
  });

  it('should compare: stop() runs undeploy script, halt() does not', async () => {
    const configWithUndeploy: ChannelConfig = {
      id: 'compare-test',
      name: 'Compare Test',
      enabled: true,
      undeployScript: 'globalMap.put("undeploy_ran", true);',
    };

    // Test halt() — undeploy script should NOT run
    const channelForHalt = new Channel(configWithUndeploy);
    const srcHalt = new TestSourceConnector();
    const dstHalt = new TestDestinationConnector(1);
    channelForHalt.setSourceConnector(srcHalt);
    channelForHalt.addDestinationConnector(dstHalt);
    await channelForHalt.start();

    GlobalMap.resetInstance();
    await channelForHalt.halt();
    expect(GlobalMap.getInstance().get('undeploy_ran')).toBeUndefined();

    // Test stop() — undeploy script SHOULD run
    const channelForStop = new Channel(configWithUndeploy);
    const srcStop = new TestSourceConnector();
    const dstStop = new TestDestinationConnector(1);
    channelForStop.setSourceConnector(srcStop);
    channelForStop.addDestinationConnector(dstStop);
    await channelForStop.start();

    GlobalMap.resetInstance();
    await channelForStop.stop();
    expect(GlobalMap.getInstance().get('undeploy_ran')).toBe(true);
  });

  it('should be a no-op on already STOPPED channel', async () => {
    // Channel starts in STOPPED state — halt() should return immediately
    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);

    const stateChanges: DeployedState[] = [];
    channel.on('stateChange', (event: { state: DeployedState }) => {
      stateChanges.push(event.state);
    });

    await channel.halt();

    expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
    expect(stateChanges).toHaveLength(0); // No state transitions
    expect(dest1.stopCalled).toBe(false); // Connectors not touched
  });

  it('should still end in STOPPED state even if source connector stop throws', async () => {
    const failingSource = new TestSourceConnector();
    failingSource.stop = jest.fn().mockRejectedValue(new Error('source stop failed'));

    const failChannel = new Channel({
      id: 'fail-halt-test',
      name: 'Fail Halt Test',
      enabled: true,
    });
    failChannel.setSourceConnector(failingSource);
    failChannel.addDestinationConnector(new TestDestinationConnector(1));
    await failChannel.start();

    await expect(failChannel.halt()).rejects.toThrow('source stop failed');
    expect(failChannel.getCurrentState()).toBe(DeployedState.STOPPED);
  });
});
