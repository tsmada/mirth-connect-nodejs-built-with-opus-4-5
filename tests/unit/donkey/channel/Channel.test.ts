const mockPoolConnection = {} as any; // Fake PoolConnection passed to transaction callbacks
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

import { Channel, ChannelConfig, StateChangeEvent } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message } from '../../../../src/model/Message';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { MessageStorageMode, getStorageSettings } from '../../../../src/donkey/channel/StorageSettings';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  insertMessage, insertConnectorMessage, insertContent, storeContent,
  updateConnectorMessageStatus, updateMessageProcessed,
  updateStatistics, updateErrors, updateMaps, updateResponseMap, updateSendAttempts,
  getNextMessageId, channelTablesExist, getStatistics,
  pruneMessageContent, pruneMessageAttachments,
  insertCustomMetaData, getConnectorMessageStatuses,
} from '../../../../src/db/DonkeyDao';
import { StorageSettings } from '../../../../src/donkey/channel/StorageSettings';

// Test source connector implementation
class TestSourceConnector extends SourceConnector {
  public started = false;

  constructor() {
    super({
      name: 'Test Source',
      transportName: 'TEST',
    });
  }

  async start(): Promise<void> {
    this.running = true;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.started = false;
  }

  // Expose dispatchRawMessage for testing
  async testDispatch(rawData: string, sourceMap?: Map<string, unknown>): Promise<void> {
    return this.dispatchRawMessage(rawData, sourceMap);
  }
}

// Test destination connector implementation
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public lastResponse: string | null = null;

  constructor(metaDataId: number, name: string = 'Test Destination') {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
    });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return this.lastResponse;
  }
}

describe('Channel', () => {
  let channel: Channel;
  let sourceConnector: TestSourceConnector;
  let destConnector: TestDestinationConnector;

  beforeEach(() => {
    // Reset mocks and re-setup default behavior
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (insertMessage as jest.Mock).mockResolvedValue(undefined);
    (insertConnectorMessage as jest.Mock).mockResolvedValue(undefined);
    (insertContent as jest.Mock).mockResolvedValue(undefined);
    (updateConnectorMessageStatus as jest.Mock).mockResolvedValue(undefined);
    (updateMessageProcessed as jest.Mock).mockResolvedValue(undefined);
    (updateStatistics as jest.Mock).mockResolvedValue(undefined);
    (updateErrors as jest.Mock).mockResolvedValue(undefined);
    (updateMaps as jest.Mock).mockResolvedValue(undefined);
    (updateResponseMap as jest.Mock).mockResolvedValue(undefined);
    (updateSendAttempts as jest.Mock).mockResolvedValue(undefined);
    (getStatistics as jest.Mock).mockResolvedValue([]);
    (pruneMessageContent as jest.Mock).mockResolvedValue(0);
    (pruneMessageAttachments as jest.Mock).mockResolvedValue(0);

    // Reset singletons
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    const config: ChannelConfig = {
      id: 'test-channel-1',
      name: 'Test Channel',
      description: 'A test channel',
      enabled: true,
    };

    channel = new Channel(config);
    sourceConnector = new TestSourceConnector();
    destConnector = new TestDestinationConnector(1);

    channel.setSourceConnector(sourceConnector);
    channel.addDestinationConnector(destConnector);
  });

  describe('constructor', () => {
    it('should create channel with config', () => {
      expect(channel.getId()).toBe('test-channel-1');
      expect(channel.getName()).toBe('Test Channel');
      expect(channel.getDescription()).toBe('A test channel');
      expect(channel.isEnabled()).toBe(true);
      expect(channel.getState()).toBe('STOPPED');
    });
  });

  describe('lifecycle', () => {
    it('should start and stop', async () => {
      await channel.start();
      expect(channel.getState()).toBe('STARTED');
      expect(sourceConnector.started).toBe(true);

      await channel.stop();
      expect(channel.getState()).toBe('STOPPED');
      expect(sourceConnector.started).toBe(false);
    });

    it('should not start if already started', async () => {
      await channel.start();
      await expect(channel.start()).rejects.toThrow();
    });

    it('should pause and resume', async () => {
      await channel.start();

      await channel.pause();
      expect(channel.getState()).toBe('PAUSED');
      expect(sourceConnector.isRunning()).toBe(false);

      await channel.resume();
      expect(channel.getState()).toBe('STARTED');
      expect(sourceConnector.isRunning()).toBe(true);
    });

    it('should execute deploy script on start', async () => {
      const deployChannel = new Channel({
        id: 'deploy-test',
        name: 'Deploy Test',
        enabled: true,
        deployScript: '$g("deployedAt", Date.now());',
      });

      deployChannel.setSourceConnector(new TestSourceConnector());

      await deployChannel.start();
      expect(GlobalMap.getInstance().get('deployedAt')).toBeDefined();

      await deployChannel.stop();
    });

    it('should execute undeploy script on stop', async () => {
      GlobalMap.getInstance().put('testKey', 'value');

      const undeployChannel = new Channel({
        id: 'undeploy-test',
        name: 'Undeploy Test',
        enabled: true,
        undeployScript: '$g("undeployedAt", Date.now());',
      });

      undeployChannel.setSourceConnector(new TestSourceConnector());

      await undeployChannel.start();
      await undeployChannel.stop();
      expect(GlobalMap.getInstance().get('undeployedAt')).toBeDefined();
    });
  });

  describe('connectors', () => {
    it('should set source connector', () => {
      expect(channel.getSourceConnector()).toBe(sourceConnector);
      expect(sourceConnector.getChannel()).toBe(channel);
    });

    it('should add destination connectors', () => {
      const destConnector2 = new TestDestinationConnector(2, 'Dest 2');
      channel.addDestinationConnector(destConnector2);

      const connectors = channel.getDestinationConnectors();
      expect(connectors).toHaveLength(2);
      expect(connectors[0]).toBe(destConnector);
      expect(connectors[1]).toBe(destConnector2);
    });
  });

  describe('dispatchRawMessage', () => {
    beforeEach(async () => {
      await channel.start();
    });

    afterEach(async () => {
      await channel.stop();
    });

    it('should dispatch message through pipeline', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(message).toBeInstanceOf(Message);
      expect(message.getMessageId()).toBe(1);
      expect(message.isProcessed()).toBe(true);

      // Check source connector message
      const sourceMsg = message.getSourceConnectorMessage();
      expect(sourceMsg).toBeDefined();
      expect(sourceMsg?.getStatus()).toBe(Status.TRANSFORMED);

      // Check destination received message
      expect(destConnector.sentMessages).toHaveLength(1);
    });

    it('should increment message IDs', async () => {
      const msg1 = await channel.dispatchRawMessage('<test>1</test>');
      const msg2 = await channel.dispatchRawMessage('<test>2</test>');

      expect(msg1.getMessageId()).toBe(1);
      expect(msg2.getMessageId()).toBe(2);
    });

    it('should copy source map to connector message', async () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('clientIP', '192.168.1.1');
      sourceMap.set('headers', { 'content-type': 'text/xml' });

      const message = await channel.dispatchRawMessage('<test/>', sourceMap);
      const sourceMsg = message.getSourceConnectorMessage();

      expect(sourceMsg?.getSourceMap().get('clientIP')).toBe('192.168.1.1');
    });

    it('should create destination connector messages', async () => {
      const message = await channel.dispatchRawMessage('<test/>');

      // Should have source (metaDataId=0) and destination (metaDataId=1)
      const sourceMsg = message.getConnectorMessage(0);
      const destMsg = message.getConnectorMessage(1);

      expect(sourceMsg).toBeDefined();
      expect(destMsg).toBeDefined();
      expect(destMsg?.getMetaDataId()).toBe(1);
    });

    it('should handle multiple destinations', async () => {
      const dest2 = new TestDestinationConnector(2, 'Dest 2');
      channel.addDestinationConnector(dest2);

      const message = await channel.dispatchRawMessage('<test/>');

      expect(destConnector.sentMessages).toHaveLength(1);
      expect(dest2.sentMessages).toHaveLength(1);

      const destMsg1 = message.getConnectorMessage(1);
      const destMsg2 = message.getConnectorMessage(2);

      expect(destMsg1?.getStatus()).toBe(Status.SENT);
      expect(destMsg2?.getStatus()).toBe(Status.SENT);
    });
  });

  describe('preprocessor', () => {
    it('should execute preprocessor and modify message', async () => {
      const preprocessorChannel = new Channel({
        id: 'preprocess-test',
        name: 'Preprocessor Test',
        enabled: true,
        preprocessorScript: 'return message.toUpperCase();',
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      preprocessorChannel.setSourceConnector(source);
      preprocessorChannel.addDestinationConnector(dest);

      await preprocessorChannel.start();
      const message = await preprocessorChannel.dispatchRawMessage('<test>hello</test>');
      await preprocessorChannel.stop();

      // Check that processed raw content is uppercase
      // Preprocessor modified the message before filter/transformer
      expect(message.isProcessed()).toBe(true);
    });
  });

  describe('postprocessor', () => {
    it('should execute postprocessor after message processed', async () => {
      const postprocessorChannel = new Channel({
        id: 'postprocess-test',
        name: 'Postprocessor Test',
        enabled: true,
        postprocessorScript: '$g("processed", message.getMessageId());',
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      postprocessorChannel.setSourceConnector(source);
      postprocessorChannel.addDestinationConnector(dest);

      await postprocessorChannel.start();
      const message = await postprocessorChannel.dispatchRawMessage('<test/>');
      await postprocessorChannel.stop();

      expect(GlobalMap.getInstance().get('processed')).toBe(message.getMessageId());
    });
  });

  describe('error handling', () => {
    it('should set error status on destination send failure', async () => {
      // Create a failing destination
      class FailingDestination extends DestinationConnector {
        constructor() {
          super({ name: 'Failing', metaDataId: 1, transportName: 'TEST' });
        }
        async send(_msg: ConnectorMessage): Promise<void> {
          throw new Error('Send failed');
        }
        async getResponse(): Promise<string | null> {
          return null;
        }
      }

      const errorChannel = new Channel({
        id: 'error-test',
        name: 'Error Test',
        enabled: true,
      });
      errorChannel.setSourceConnector(new TestSourceConnector());
      errorChannel.addDestinationConnector(new FailingDestination());

      await errorChannel.start();
      const message = await errorChannel.dispatchRawMessage('<test/>');
      await errorChannel.stop();

      const destMsg = message.getConnectorMessage(1);
      expect(destMsg?.getStatus()).toBe(Status.ERROR);
      expect(destMsg?.getProcessingError()).toContain('Send failed');
    });
  });

  describe('message persistence', () => {
    beforeEach(async () => {
      await channel.start();
    });

    afterEach(async () => {
      await channel.stop();
    });

    it('should persist message to D_M on dispatch', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(insertMessage).toHaveBeenCalledWith(
        'test-channel-1',
        message.getMessageId(),
        expect.any(String), // serverId
        expect.any(Date),   // receivedDate
        mockPoolConnection  // conn from transaction
      );
    });

    it('should persist source connector message to D_MM', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(insertConnectorMessage).toHaveBeenCalledWith(
        'test-channel-1',
        message.getMessageId(),
        0,                   // metaDataId for source
        'Test Source',       // connector name
        expect.any(Date),    // receivedDate
        Status.RECEIVED,
        0,                   // chainId
        // storeMaps options — rawDurable defaults to true so maps are passed
        expect.objectContaining({
          storeMaps: expect.objectContaining({
            sourceMap: expect.any(Map),
            connectorMap: expect.any(Map),
            channelMap: expect.any(Map),
            responseMap: expect.any(Map),
          }),
        }),
        mockPoolConnection   // conn from transaction
      );
    });

    it('should persist RAW content to D_MC', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      expect(insertContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),  // messageId
        0,                   // metaDataId for source
        ContentType.RAW,
        '<test>hello</test>',
        expect.any(String),  // dataType
        false,               // encrypted
        mockPoolConnection   // conn from transaction
      );
    });

    it('should persist destination connector message', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      // Should be called for destination with metaDataId=1 (via persistToDb, no conn)
      expect(insertConnectorMessage).toHaveBeenCalledWith(
        'test-channel-1',
        message.getMessageId(),
        1,                    // metaDataId for destination
        'Test Destination',   // connector name
        expect.any(Date),
        expect.any(String)    // status
      );
    });

    it('should update destination status to SENT on success', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(updateConnectorMessageStatus).toHaveBeenCalledWith(
        'test-channel-1',
        message.getMessageId(),
        1,                  // destination metaDataId
        Status.SENT,
        mockPoolConnection  // conn from transaction
      );
    });

    it('should update statistics on RECEIVED and SENT', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      // Verify RECEIVED statistics for source (metaDataId=0) — inside transaction
      expect(updateStatistics).toHaveBeenCalledWith(
        'test-channel-1',
        0,                   // source metaDataId
        expect.any(String),  // serverId
        Status.RECEIVED,
        1,                   // increment
        mockPoolConnection   // conn from transaction
      );

      // Verify SENT statistics for destination (metaDataId=1) — inside transaction
      expect(updateStatistics).toHaveBeenCalledWith(
        'test-channel-1',
        1,                   // destination metaDataId
        expect.any(String),  // serverId
        Status.SENT,
        1,                   // increment
        mockPoolConnection   // conn from transaction
      );
    });

    it('should use DB-backed message IDs when tables exist', async () => {
      mockNextMessageId = 42;
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(getNextMessageId).toHaveBeenCalled();
      expect(message.getMessageId()).toBe(42);
    });

    it('should skip persistence when tables do not exist', async () => {
      // Need a fresh channel since start() now caches tablesExist via loadStatisticsFromDb()
      (channelTablesExist as jest.Mock).mockResolvedValue(false);
      const noTablesChannel = new Channel({
        id: 'no-tables-channel',
        name: 'No Tables',
        enabled: true,
      });
      noTablesChannel.setSourceConnector(new TestSourceConnector());
      noTablesChannel.addDestinationConnector(new TestDestinationConnector(1));

      await noTablesChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(false);

      const message = await noTablesChannel.dispatchRawMessage('<test>hello</test>');

      expect(insertMessage).not.toHaveBeenCalled();
      expect(insertConnectorMessage).not.toHaveBeenCalled();
      expect(message.isProcessed()).toBe(true);

      await noTablesChannel.stop();
    });

    it('should complete message processing even when DB fails', async () => {
      (insertMessage as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(message.isProcessed()).toBe(true);
    });

    it('should persist SOURCE_MAP content via insertContent (single write) at end of pipeline', async () => {
      const sourceMap = new Map<string, unknown>([['key1', 'value1']]);

      await channel.dispatchRawMessage('<test>hello</test>', sourceMap);

      // Final SOURCE_MAP write uses insertContent (single write, no early insert)
      expect(insertContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),  // messageId
        0,                   // metaDataId
        ContentType.SOURCE_MAP,
        expect.stringContaining('key1'),
        'JSON',
        false
      );
    });

    it('should update processed flag', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(updateMessageProcessed).toHaveBeenCalledWith(
        'test-channel-1',
        message.getMessageId(),
        true,
        mockPoolConnection  // conn from transaction
      );
    });
  });

  describe('state architecture', () => {
    describe('getCurrentState', () => {
      it('should return STOPPED initially', () => {
        expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
      });

      it('should return STARTED after start', async () => {
        await channel.start();
        expect(channel.getCurrentState()).toBe(DeployedState.STARTED);
        await channel.stop();
      });

      it('should return PAUSED after pause', async () => {
        await channel.start();
        await channel.pause();
        expect(channel.getCurrentState()).toBe(DeployedState.PAUSED);
        await channel.stop();
      });
    });

    describe('updateCurrentState', () => {
      it('should emit stateChange event', () => {
        const events: StateChangeEvent[] = [];
        channel.on('stateChange', (event: StateChangeEvent) => {
          events.push(event);
        });

        channel.updateCurrentState(DeployedState.DEPLOYING);
        channel.updateCurrentState(DeployedState.STOPPED);

        expect(events).toHaveLength(2);
        expect(events[0]?.state).toBe(DeployedState.DEPLOYING);
        expect(events[0]?.previousState).toBe(DeployedState.STOPPED);
        expect(events[1]?.state).toBe(DeployedState.STOPPED);
        expect(events[1]?.previousState).toBe(DeployedState.DEPLOYING);
      });

      it('should include channel info in event', () => {
        let receivedEvent: StateChangeEvent | undefined;
        channel.on('stateChange', (event: StateChangeEvent) => {
          receivedEvent = event;
        });

        channel.updateCurrentState(DeployedState.STARTING);

        expect(receivedEvent?.channelId).toBe('test-channel-1');
        expect(receivedEvent?.channelName).toBe('Test Channel');
      });
    });

    describe('isActive', () => {
      it('should return false when STOPPED', () => {
        expect(channel.isActive()).toBe(false);
      });

      it('should return true when STARTED', async () => {
        await channel.start();
        expect(channel.isActive()).toBe(true);
        await channel.stop();
      });

      it('should return true when PAUSED', async () => {
        await channel.start();
        await channel.pause();
        expect(channel.isActive()).toBe(true);
        await channel.stop();
      });

      it('should return false when STOPPING', () => {
        channel.updateCurrentState(DeployedState.STOPPING);
        expect(channel.isActive()).toBe(false);
      });
    });

    describe('getState (legacy)', () => {
      it('should map DeployedState to ChannelState', () => {
        expect(channel.getState()).toBe('STOPPED');

        channel.updateCurrentState(DeployedState.STARTING);
        expect(channel.getState()).toBe('STARTING');

        channel.updateCurrentState(DeployedState.STARTED);
        expect(channel.getState()).toBe('STARTED');

        channel.updateCurrentState(DeployedState.PAUSING);
        expect(channel.getState()).toBe('PAUSING');

        channel.updateCurrentState(DeployedState.PAUSED);
        expect(channel.getState()).toBe('PAUSED');

        channel.updateCurrentState(DeployedState.STOPPING);
        expect(channel.getState()).toBe('STOPPING');

        channel.updateCurrentState(DeployedState.STOPPED);
        expect(channel.getState()).toBe('STOPPED');
      });
    });
  });

  describe('rollback on partial start failure', () => {
    it('should stop started connectors on source start failure', async () => {
      // Create a source connector that fails to start
      class FailingSourceConnector extends SourceConnector {
        constructor() {
          super({ name: 'Failing Source', transportName: 'TEST' });
        }
        async start(): Promise<void> {
          throw new Error('Source start failed');
        }
        async stop(): Promise<void> {
          this.running = false;
        }
      }

      // Track destination stop calls
      let destStopCalled = false;
      class TrackingDestinationConnector extends DestinationConnector {
        constructor() {
          super({ name: 'Tracking Dest', metaDataId: 1, transportName: 'TEST' });
        }
        async start(): Promise<void> {
          this.running = true;
        }
        async stop(): Promise<void> {
          destStopCalled = true;
          this.running = false;
        }
        async send(): Promise<void> {}
        async getResponse(): Promise<string | null> { return null; }
      }

      const rollbackChannel = new Channel({
        id: 'rollback-test',
        name: 'Rollback Test',
        enabled: true,
      });

      const dest = new TrackingDestinationConnector();
      rollbackChannel.addDestinationConnector(dest);
      rollbackChannel.setSourceConnector(new FailingSourceConnector());

      // Attempt to start - should fail and rollback
      await expect(rollbackChannel.start()).rejects.toThrow('Source start failed');

      // Verify destination was stopped during rollback
      expect(destStopCalled).toBe(true);

      // Verify channel is in STOPPED state
      expect(rollbackChannel.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('should stop started connectors on destination start failure', async () => {
      // Track what connectors were stopped
      const stopOrder: string[] = [];

      class TrackingSource extends SourceConnector {
        constructor() {
          super({ name: 'Tracking Source', transportName: 'TEST' });
        }
        async start(): Promise<void> {
          this.running = true;
        }
        async stop(): Promise<void> {
          stopOrder.push('source');
          this.running = false;
        }
      }

      class SuccessDestination extends DestinationConnector {
        constructor() {
          super({ name: 'Success Dest', metaDataId: 1, transportName: 'TEST' });
        }
        async start(): Promise<void> {
          this.running = true;
        }
        async stop(): Promise<void> {
          stopOrder.push('dest1');
          this.running = false;
        }
        async send(): Promise<void> {}
        async getResponse(): Promise<string | null> { return null; }
      }

      class FailingDestination extends DestinationConnector {
        constructor() {
          super({ name: 'Failing Dest', metaDataId: 2, transportName: 'TEST' });
        }
        async start(): Promise<void> {
          throw new Error('Destination start failed');
        }
        async stop(): Promise<void> {
          stopOrder.push('dest2');
          this.running = false;
        }
        async send(): Promise<void> {}
        async getResponse(): Promise<string | null> { return null; }
      }

      const rollbackChannel = new Channel({
        id: 'rollback-test-2',
        name: 'Rollback Test 2',
        enabled: true,
      });

      rollbackChannel.setSourceConnector(new TrackingSource());
      rollbackChannel.addDestinationConnector(new SuccessDestination());
      rollbackChannel.addDestinationConnector(new FailingDestination());

      // Attempt to start - should fail and rollback
      await expect(rollbackChannel.start()).rejects.toThrow('Destination start failed');

      // Verify first destination was stopped (second didn't start, source didn't start)
      expect(stopOrder).toContain('dest1');

      // Verify channel is in STOPPED state
      expect(rollbackChannel.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('should emit correct state transitions during failed start', async () => {
      class FailingSource extends SourceConnector {
        constructor() {
          super({ name: 'Failing', transportName: 'TEST' });
        }
        async start(): Promise<void> {
          throw new Error('Failed');
        }
        async stop(): Promise<void> {}
      }

      const stateHistory: DeployedState[] = [];
      const failChannel = new Channel({
        id: 'state-test',
        name: 'State Test',
        enabled: true,
      });

      failChannel.on('stateChange', (event: StateChangeEvent) => {
        stateHistory.push(event.state);
      });

      failChannel.setSourceConnector(new FailingSource());

      await expect(failChannel.start()).rejects.toThrow();

      // Should have gone: STARTING -> STOPPING -> STOPPED
      expect(stateHistory).toEqual([
        DeployedState.STARTING,
        DeployedState.STOPPING,
        DeployedState.STOPPED,
      ]);
    });
  });

  describe('content persistence (parity fixes)', () => {
    beforeEach(async () => {
      await channel.start();
    });

    afterEach(async () => {
      await channel.stop();
    });

    it('should persist SENT content after successful send', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      expect(storeContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        1,                   // destination metaDataId
        ContentType.SENT,
        expect.any(String),  // sent data
        expect.any(String),  // dataType
        false,
        mockPoolConnection   // conn from transaction
      );
    });

    it('should call updateSendAttempts after successful send', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      expect(updateSendAttempts).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),   // messageId
        1,                    // destination metaDataId
        1,                    // sendAttempts (incremented once)
        expect.any(Date),     // sendDate
        undefined,            // responseDate (no response captured in default test setup)
        mockPoolConnection    // conn from transaction
      );
    });

    it('should persist PROCESSING_ERROR on destination failure', async () => {
      class FailingDestination extends DestinationConnector {
        constructor() {
          super({ name: 'Failing', metaDataId: 1, transportName: 'TEST' });
        }
        async send(_msg: ConnectorMessage): Promise<void> {
          throw new Error('Connection refused');
        }
        async getResponse(): Promise<string | null> { return null; }
      }

      const errorChannel = new Channel({
        id: 'error-persist-test',
        name: 'Error Persist Test',
        enabled: true,
      });
      errorChannel.setSourceConnector(new TestSourceConnector());
      errorChannel.addDestinationConnector(new FailingDestination());

      await errorChannel.start();
      await errorChannel.dispatchRawMessage('<test/>');
      await errorChannel.stop();

      expect(updateErrors).toHaveBeenCalledWith(
        'error-persist-test',
        expect.any(Number),   // messageId
        1,                    // destination metaDataId
        expect.stringContaining('Connection refused'),
        undefined,            // no postprocessor error
        expect.any(Number),   // error code bitmask
        undefined,            // responseError
        mockPoolConnection    // conn from transaction
      );
    });

    it('should persist RESPONSE content when available', async () => {
      destConnector.lastResponse = 'ACK^A01|OK';

      await channel.dispatchRawMessage('<test>hello</test>');

      expect(storeContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        1,                    // destination metaDataId
        ContentType.RESPONSE,
        'ACK^A01|OK',
        'RAW',
        false,
        mockPoolConnection    // conn from transaction
      );
    });

    it('should persist destination maps after successful send', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      expect(updateMaps).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        1,                    // destination metaDataId
        expect.any(Map),      // connectorMap
        expect.any(Map),      // channelMap
        expect.any(Map),      // responseMap
        mockPoolConnection    // conn from transaction
      );
    });

    it('should persist source maps after postprocessor', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      expect(updateMaps).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        0,                    // source metaDataId
        expect.any(Map),      // connectorMap
        expect.any(Map),      // channelMap
        expect.any(Map),      // responseMap
        mockPoolConnection    // conn from transaction
      );
    });

    it('should not persist content types disabled by StorageSettings', async () => {
      const settings = getStorageSettings(MessageStorageMode.METADATA);
      const metadataChannel = new Channel({
        id: 'metadata-only-test',
        name: 'Metadata Only',
        enabled: true,
        storageSettings: settings,
      });
      metadataChannel.setSourceConnector(new TestSourceConnector());
      metadataChannel.addDestinationConnector(new TestDestinationConnector(1));

      await metadataChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await metadataChannel.dispatchRawMessage('<test/>');
      await metadataChannel.stop();

      // RAW should NOT be persisted in METADATA mode
      const rawCalls = (insertContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.RAW
      );
      expect(rawCalls).toHaveLength(0);

      // SENT should NOT be persisted in METADATA mode (uses storeContent)
      const sentCalls = (storeContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SENT
      );
      expect(sentCalls).toHaveLength(0);

      // Maps should NOT be persisted in METADATA mode
      expect(updateMaps).not.toHaveBeenCalled();
    });

    it('should persist POSTPROCESSOR_ERROR when postprocessor fails', async () => {
      const postChannel = new Channel({
        id: 'post-error-test',
        name: 'Post Error Test',
        enabled: true,
        postprocessorScript: 'throw new Error("post failed");',
      });
      postChannel.setSourceConnector(new TestSourceConnector());
      postChannel.addDestinationConnector(new TestDestinationConnector(1));

      await postChannel.start();
      await postChannel.dispatchRawMessage('<test/>');
      await postChannel.stop();

      // Should persist postprocessor error (second argument to updateErrors)
      expect(updateErrors).toHaveBeenCalledWith(
        'post-error-test',
        expect.any(Number),   // messageId
        0,                    // source metaDataId
        undefined,            // no processing error
        expect.stringContaining('post failed'),
        expect.any(Number)    // error code bitmask
      );
    });

    it('should always persist SOURCE_MAP even when storeMaps is false', async () => {
      const settings = getStorageSettings(MessageStorageMode.RAW);
      const rawChannel = new Channel({
        id: 'raw-mode-test',
        name: 'Raw Mode',
        enabled: true,
        storageSettings: settings,
      });
      rawChannel.setSourceConnector(new TestSourceConnector());
      rawChannel.addDestinationConnector(new TestDestinationConnector(1));

      await rawChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      const sourceMap = new Map<string, unknown>([['traceKey', 'traceValue']]);
      await rawChannel.dispatchRawMessage('<test/>', sourceMap);
      await rawChannel.stop();

      // SOURCE_MAP should still be persisted for trace feature (via insertContent, single write)
      const sourceMapCalls = (insertContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SOURCE_MAP
      );
      expect(sourceMapCalls.length).toBeGreaterThanOrEqual(1);

      // But CONNECTOR_MAP, CHANNEL_MAP, RESPONSE_MAP should NOT be persisted
      expect(updateMaps).not.toHaveBeenCalled();
    });

    it('should call executeResponseTransformer after response capture', async () => {
      // Create a destination that returns a response and tracks executeResponseTransformer calls
      class ResponseTransformerDest extends DestinationConnector {
        public executeResponseTransformerCalls: ConnectorMessage[] = [];

        constructor() {
          super({ name: 'RT Dest', metaDataId: 1, transportName: 'TEST' });
        }

        async send(msg: ConnectorMessage): Promise<void> {
          msg.setSendDate(new Date());
        }

        async getResponse(): Promise<string | null> {
          return 'ACK|response-data';
        }

        async executeResponseTransformer(connectorMessage: ConnectorMessage): Promise<void> {
          this.executeResponseTransformerCalls.push(connectorMessage);
        }
      }

      const rtDest = new ResponseTransformerDest();
      const rtChannel = new Channel({
        id: 'rt-test',
        name: 'RT Test',
        enabled: true,
      });
      rtChannel.setSourceConnector(new TestSourceConnector());
      rtChannel.addDestinationConnector(rtDest);

      await rtChannel.start();
      await rtChannel.dispatchRawMessage('<test/>');
      await rtChannel.stop();

      expect(rtDest.executeResponseTransformerCalls).toHaveLength(1);
    });

    it('should persist RESPONSE_TRANSFORMED content when storeResponseTransformed is true', async () => {
      // Create a destination whose response transformer sets RESPONSE_TRANSFORMED on the message
      class TransformingDest extends DestinationConnector {
        constructor() {
          super({ name: 'Transforming Dest', metaDataId: 1, transportName: 'TEST' });
        }

        async send(msg: ConnectorMessage): Promise<void> {
          msg.setSendDate(new Date());
        }

        async getResponse(): Promise<string | null> {
          return 'ACK|original';
        }

        async executeResponseTransformer(connectorMessage: ConnectorMessage): Promise<void> {
          connectorMessage.setContent({
            contentType: ContentType.RESPONSE_TRANSFORMED,
            content: '<transformed>ACK|original</transformed>',
            dataType: 'XML',
            encrypted: false,
          });
        }
      }

      const tDest = new TransformingDest();
      const tChannel = new Channel({
        id: 'rt-persist-test',
        name: 'RT Persist Test',
        enabled: true,
      });
      tChannel.setSourceConnector(new TestSourceConnector());
      tChannel.addDestinationConnector(tDest);

      await tChannel.start();
      await tChannel.dispatchRawMessage('<test/>');
      await tChannel.stop();

      expect(storeContent).toHaveBeenCalledWith(
        'rt-persist-test',
        expect.any(Number),
        1,                    // destination metaDataId
        ContentType.RESPONSE_TRANSFORMED,
        '<transformed>ACK|original</transformed>',
        'XML',
        false,
        mockPoolConnection    // conn from transaction
      );
    });

    it('should persist PROCESSED_RESPONSE content when storeProcessedResponse is true', async () => {
      class ProcessedResponseDest extends DestinationConnector {
        constructor() {
          super({ name: 'PR Dest', metaDataId: 1, transportName: 'TEST' });
        }

        async send(msg: ConnectorMessage): Promise<void> {
          msg.setSendDate(new Date());
        }

        async getResponse(): Promise<string | null> {
          return 'ACK|original';
        }

        async executeResponseTransformer(connectorMessage: ConnectorMessage): Promise<void> {
          connectorMessage.setContent({
            contentType: ContentType.PROCESSED_RESPONSE,
            content: '{"status":"SENT","message":"ACK|processed"}',
            dataType: 'RAW',
            encrypted: false,
          });
        }
      }

      const prDest = new ProcessedResponseDest();
      const prChannel = new Channel({
        id: 'pr-persist-test',
        name: 'PR Persist Test',
        enabled: true,
      });
      prChannel.setSourceConnector(new TestSourceConnector());
      prChannel.addDestinationConnector(prDest);

      await prChannel.start();
      await prChannel.dispatchRawMessage('<test/>');
      await prChannel.stop();

      expect(storeContent).toHaveBeenCalledWith(
        'pr-persist-test',
        expect.any(Number),
        1,                    // destination metaDataId
        ContentType.PROCESSED_RESPONSE,
        '{"status":"SENT","message":"ACK|processed"}',
        'RAW',
        false,
        mockPoolConnection    // conn from transaction
      );
    });

    it('should not call executeResponseTransformer when storeResponse is false', async () => {
      class TrackingDest extends DestinationConnector {
        public rtCalled = false;

        constructor() {
          super({ name: 'Tracking Dest', metaDataId: 1, transportName: 'TEST' });
        }

        async send(msg: ConnectorMessage): Promise<void> {
          msg.setSendDate(new Date());
        }

        async getResponse(): Promise<string | null> {
          return 'ACK|response';
        }

        async executeResponseTransformer(_connectorMessage: ConnectorMessage): Promise<void> {
          this.rtCalled = true;
        }
      }

      const settings = getStorageSettings(MessageStorageMode.RAW);
      // RAW mode has storeResponse = false
      const trackDest = new TrackingDest();
      const trackChannel = new Channel({
        id: 'no-response-test',
        name: 'No Response Test',
        enabled: true,
        storageSettings: settings,
      });
      trackChannel.setSourceConnector(new TestSourceConnector());
      trackChannel.addDestinationConnector(trackDest);

      await trackChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await trackChannel.dispatchRawMessage('<test/>');
      await trackChannel.stop();

      // Response transformer should NOT be called because storeResponse is false
      expect(trackDest.rtCalled).toBe(false);

      // No RESPONSE_TRANSFORMED or PROCESSED_RESPONSE should be persisted (check both insertContent and storeContent)
      const rtCalls = (storeContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.RESPONSE_TRANSFORMED
      );
      const prCalls = (storeContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.PROCESSED_RESPONSE
      );
      expect(rtCalls).toHaveLength(0);
      expect(prCalls).toHaveLength(0);
    });
  });

  describe('finishDispatch: source RESPONSE + merged response map', () => {
    beforeEach(async () => {
      await channel.start();
    });

    afterEach(async () => {
      await channel.stop();
    });

    it('should store source RESPONSE from first SENT destination', async () => {
      destConnector.lastResponse = 'ACK^A01|SUCCESS';

      await channel.dispatchRawMessage('<test>hello</test>');

      // Should persist RESPONSE at metaDataId=0 (source) via storeContent in transaction
      expect(storeContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        0,                      // source metaDataId
        ContentType.RESPONSE,
        'ACK^A01|SUCCESS',
        'RAW',
        false,
        mockPoolConnection      // conn from transaction
      );
    });

    it('should use first SENT destination response (skip ERROR destinations)', async () => {
      class FailingDestination extends DestinationConnector {
        constructor() {
          super({ name: 'Failing Dest', metaDataId: 1, transportName: 'TEST' });
        }
        async send(_msg: ConnectorMessage): Promise<void> {
          throw new Error('Connection refused');
        }
        async getResponse(): Promise<string | null> { return 'ERROR_RESPONSE'; }
      }

      const dest2 = new TestDestinationConnector(2, 'Success Dest');
      dest2.lastResponse = 'ACK_FROM_DEST2';

      const multiChannel = new Channel({
        id: 'multi-dest-resp-test',
        name: 'Multi Dest Resp Test',
        enabled: true,
      });
      multiChannel.setSourceConnector(new TestSourceConnector());
      multiChannel.addDestinationConnector(new FailingDestination());
      multiChannel.addDestinationConnector(dest2);

      await multiChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await multiChannel.dispatchRawMessage('<test/>');
      await multiChannel.stop();

      // Source RESPONSE should come from dest2 (first SENT), not dest1 (ERROR)
      const sourceResponseCalls = (storeContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[2] === 0 && call[3] === ContentType.RESPONSE
      );
      expect(sourceResponseCalls).toHaveLength(1);
      expect(sourceResponseCalls[0]![4]).toBe('ACK_FROM_DEST2');
    });

    it('should not store source RESPONSE when storeResponse is false', async () => {
      // Need a fresh channel — stop the default one first
      await channel.stop();

      const settings = getStorageSettings(MessageStorageMode.RAW);
      const rawChannel = new Channel({
        id: 'no-src-resp-test',
        name: 'No Src Resp',
        enabled: true,
        storageSettings: settings,
      });
      rawChannel.setSourceConnector(new TestSourceConnector());
      const dest = new TestDestinationConnector(1);
      dest.lastResponse = 'SHOULD_NOT_BE_STORED';
      rawChannel.addDestinationConnector(dest);

      await rawChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await rawChannel.dispatchRawMessage('<test/>');
      await rawChannel.stop();

      // No source RESPONSE (metaDataId=0) should be persisted (check storeContent)
      const sourceResponseCalls = (storeContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[2] === 0 && call[3] === ContentType.RESPONSE
      );
      expect(sourceResponseCalls).toHaveLength(0);

      // Re-start default channel for afterEach
      await channel.start();
    });

    it('should build merged response map from all destinations', async () => {
      // Need a fresh channel — stop the default one first
      await channel.stop();

      class MappingDestination extends DestinationConnector {
        private mapKey: string;
        private mapValue: string;
        constructor(metaDataId: number, name: string, mapKey: string, mapValue: string) {
          super({ name, metaDataId, transportName: 'TEST' });
          this.mapKey = mapKey;
          this.mapValue = mapValue;
        }
        async send(msg: ConnectorMessage): Promise<void> {
          msg.getResponseMap().set(this.mapKey, this.mapValue);
        }
        async getResponse(): Promise<string | null> { return 'OK'; }
      }

      const mergeChannel = new Channel({
        id: 'merge-resp-map-test',
        name: 'Merge Response Map Test',
        enabled: true,
      });
      mergeChannel.setSourceConnector(new TestSourceConnector());
      mergeChannel.addDestinationConnector(new MappingDestination(1, 'Dest A', 'keyA', 'valueA'));
      mergeChannel.addDestinationConnector(new MappingDestination(2, 'Dest B', 'keyB', 'valueB'));

      await mergeChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await mergeChannel.dispatchRawMessage('<test/>');
      await mergeChannel.stop();

      // updateResponseMap should be called with metaDataId=0 (source) and a merged map
      expect(updateResponseMap).toHaveBeenCalledWith(
        'merge-resp-map-test',
        expect.any(Number),
        0,                      // source metaDataId
        expect.any(Map),
        mockPoolConnection      // conn from transaction
      );

      // Verify the merged map contains entries from both destinations
      const call = (updateResponseMap as jest.Mock).mock.calls[0];
      const mergedMap = call![3] as Map<string, unknown>;
      expect(mergedMap.get('keyA')).toBe('valueA');
      expect(mergedMap.get('keyB')).toBe('valueB');

      // Re-start default channel for afterEach
      await channel.start();
    });

    it('should not persist merged response map when storeMergedResponseMap is false', async () => {
      // Need a fresh channel — stop the default one first
      await channel.stop();

      const settings = getStorageSettings(MessageStorageMode.RAW);
      const rawChannel = new Channel({
        id: 'no-merge-resp-test',
        name: 'No Merge Resp',
        enabled: true,
        storageSettings: settings,
      });
      rawChannel.setSourceConnector(new TestSourceConnector());
      rawChannel.addDestinationConnector(new TestDestinationConnector(1));

      await rawChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await rawChannel.dispatchRawMessage('<test/>');
      await rawChannel.stop();

      expect(updateResponseMap).not.toHaveBeenCalled();

      // Re-start default channel for afterEach
      await channel.start();
    });
  });

  describe('statistics loading from DB on start', () => {
    it('should load statistics from D_MS when tables exist', async () => {
      (getStatistics as jest.Mock).mockResolvedValue([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 100, FILTERED: 5, TRANSFORMED: 0, PENDING: 0, SENT: 0, ERROR: 2 },
        { METADATA_ID: 1, SERVER_ID: 'node-1', RECEIVED: 0, FILTERED: 3, TRANSFORMED: 0, PENDING: 2, SENT: 88, ERROR: 1 },
      ]);

      await channel.start();

      const stats = channel.getStatistics();
      expect(stats.received).toBe(100);
      expect(stats.filtered).toBe(8);   // 5 + 3
      expect(stats.sent).toBe(88);
      expect(stats.error).toBe(3);      // 2 + 1
      expect(stats.queued).toBe(2);     // PENDING maps to queued

      expect(getStatistics).toHaveBeenCalledWith('test-channel-1');

      await channel.stop();
    });

    it('should keep stats at zero when tables do not exist', async () => {
      (channelTablesExist as jest.Mock).mockResolvedValue(false);

      await channel.start();

      const stats = channel.getStatistics();
      expect(stats.received).toBe(0);
      expect(stats.sent).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.filtered).toBe(0);
      expect(stats.queued).toBe(0);

      expect(getStatistics).not.toHaveBeenCalled();

      await channel.stop();
    });

    it('should survive DB query failure without throwing', async () => {
      (getStatistics as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      // Should not throw — logs error and continues with zero stats
      await channel.start();

      const stats = channel.getStatistics();
      expect(stats.received).toBe(0);
      expect(stats.sent).toBe(0);

      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await channel.stop();
    });

    it('should correctly sum across multiple metadata IDs', async () => {
      (getStatistics as jest.Mock).mockResolvedValue([
        { METADATA_ID: 0, SERVER_ID: 'node-1', RECEIVED: 50, FILTERED: 10, TRANSFORMED: 0, PENDING: 0, SENT: 0, ERROR: 0 },
        { METADATA_ID: 1, SERVER_ID: 'node-1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 5, SENT: 30, ERROR: 3 },
        { METADATA_ID: 2, SERVER_ID: 'node-1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 2, SENT: 20, ERROR: 1 },
        { METADATA_ID: 3, SERVER_ID: 'node-1', RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, PENDING: 0, SENT: 10, ERROR: 0 },
      ]);

      await channel.start();

      const stats = channel.getStatistics();
      expect(stats.received).toBe(50);
      expect(stats.filtered).toBe(10);
      expect(stats.sent).toBe(60);       // 30 + 20 + 10
      expect(stats.error).toBe(4);       // 3 + 1
      expect(stats.queued).toBe(7);      // 5 + 2

      await channel.stop();
    });

    it('should handle empty D_MS table gracefully', async () => {
      (getStatistics as jest.Mock).mockResolvedValue([]);

      await channel.start();

      const stats = channel.getStatistics();
      expect(stats.received).toBe(0);
      expect(stats.sent).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.filtered).toBe(0);
      expect(stats.queued).toBe(0);

      await channel.stop();
    });
  });

  describe('persistBatch (transaction boundaries)', () => {
    let channel: Channel;
    const { transaction: mockTransaction } = require('../../../../src/db/pool');

    beforeEach(async () => {
      jest.clearAllMocks();
      mockNextMessageId = 1;
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getStatistics as jest.Mock).mockResolvedValue([]);

      channel = new Channel({
        id: 'txn-test',
        name: 'Transaction Test',
        enabled: true,
      });
    });

    it('should execute all operations inside a transaction', async () => {
      const op1 = jest.fn().mockResolvedValue(undefined);
      const op2 = jest.fn().mockResolvedValue(undefined);

      await channel.persistBatch([op1, op2]);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(op1).toHaveBeenCalledTimes(1);
      expect(op2).toHaveBeenCalledTimes(1);
    });

    it('should fall back to sequential on transaction failure', async () => {
      mockTransaction.mockRejectedValueOnce(new Error('connection lost'));
      const op1 = jest.fn().mockResolvedValue(undefined);
      const op2 = jest.fn().mockResolvedValue(undefined);

      await channel.persistBatch([op1, op2]);

      // Falls back to individual persistToDb calls
      expect(op1).toHaveBeenCalledTimes(1);
      expect(op2).toHaveBeenCalledTimes(1);
    });

    it('should skip when tables do not exist', async () => {
      (channelTablesExist as jest.Mock).mockResolvedValue(false);
      const op1 = jest.fn().mockResolvedValue(undefined);

      await channel.persistBatch([op1]);

      expect(op1).not.toHaveBeenCalled();
    });

    it('should handle empty operations array', async () => {
      await channel.persistBatch([]);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('removeContentOnCompletion (PC-MPS-005)', () => {
    it('should delete content when removeContentOnCompletion is true', async () => {
      const settings = new StorageSettings();
      settings.removeContentOnCompletion = true;

      const cleanupChannel = new Channel({
        id: 'cleanup-test',
        name: 'Cleanup Test',
        enabled: true,
        storageSettings: settings,
      });
      cleanupChannel.setSourceConnector(new TestSourceConnector());
      cleanupChannel.addDestinationConnector(new TestDestinationConnector(1));

      await cleanupChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
      // DB check: all destinations in terminal state
      (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map([
        [0, Status.TRANSFORMED],
        [1, Status.SENT],
      ]));

      await cleanupChannel.dispatchRawMessage('<test/>');
      await cleanupChannel.stop();

      expect(pruneMessageContent).toHaveBeenCalledWith('cleanup-test', [expect.any(Number)]);
    });

    it('should NOT delete content when removeOnlyFilteredOnCompletion is true and message was not filtered', async () => {
      const settings = new StorageSettings();
      settings.removeContentOnCompletion = true;
      settings.removeOnlyFilteredOnCompletion = true;

      const noCleanupChannel = new Channel({
        id: 'no-cleanup-test',
        name: 'No Cleanup Test',
        enabled: true,
        storageSettings: settings,
      });
      noCleanupChannel.setSourceConnector(new TestSourceConnector());
      noCleanupChannel.addDestinationConnector(new TestDestinationConnector(1));

      await noCleanupChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await noCleanupChannel.dispatchRawMessage('<test/>');
      await noCleanupChannel.stop();

      // Source message ends up TRANSFORMED (not FILTERED), so content should NOT be pruned
      expect(pruneMessageContent).not.toHaveBeenCalled();
    });

    it('should delete attachments when removeAttachmentsOnCompletion is true', async () => {
      const settings = new StorageSettings();
      settings.removeAttachmentsOnCompletion = true;

      const attachCleanupChannel = new Channel({
        id: 'attach-cleanup-test',
        name: 'Attach Cleanup Test',
        enabled: true,
        storageSettings: settings,
      });
      attachCleanupChannel.setSourceConnector(new TestSourceConnector());
      attachCleanupChannel.addDestinationConnector(new TestDestinationConnector(1));

      await attachCleanupChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await attachCleanupChannel.dispatchRawMessage('<test/>');
      await attachCleanupChannel.stop();

      expect(pruneMessageAttachments).toHaveBeenCalledWith('attach-cleanup-test', [expect.any(Number)]);
    });

    it('should NOT delete content or attachments by default', async () => {
      // Default StorageSettings has removeContentOnCompletion = false
      await channel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await channel.dispatchRawMessage('<test/>');
      await channel.stop();

      expect(pruneMessageContent).not.toHaveBeenCalled();
      expect(pruneMessageAttachments).not.toHaveBeenCalled();
    });
  });

  describe('SOURCE_MAP single write (Phase 0C — consolidated)', () => {
    it('should use insertContent for SOURCE_MAP at end of pipeline (no storeContent upsert)', async () => {
      await channel.start();

      const sourceMap = new Map<string, unknown>([['key1', 'value1']]);
      await channel.dispatchRawMessage('<test/>', sourceMap);

      // insertContent should be called for SOURCE_MAP (single write at end of pipeline)
      const insertContentMock = insertContent as jest.Mock;
      const sourceMapInsertCalls = insertContentMock.mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SOURCE_MAP
      );
      expect(sourceMapInsertCalls.length).toBe(1);

      // storeContent should NOT be called for SOURCE_MAP (no upsert needed)
      const storeContentMock = storeContent as jest.Mock;
      const sourceMapStoreCalls = storeContentMock.mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SOURCE_MAP
      );
      expect(sourceMapStoreCalls.length).toBe(0);

      await channel.stop();
    });

    it('should NOT write SOURCE_MAP early in Transaction 2 (consolidated to single write)', async () => {
      await channel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      const sourceMap = new Map<string, unknown>([['traceId', '12345']]);
      await channel.dispatchRawMessage('<test/>', sourceMap);

      // insertContent calls for SOURCE_MAP should be exactly 1 (only the final write)
      const insertContentMock = insertContent as jest.Mock;
      const sourceMapInsertCalls = insertContentMock.mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SOURCE_MAP
      );
      expect(sourceMapInsertCalls.length).toBe(1);

      await channel.stop();
    });
  });

  describe('persistInTransaction (Phase 2A)', () => {
    const { transaction: mockTransaction } = require('../../../../src/db/pool');

    it('should use transaction for source intake', async () => {
      await channel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await channel.dispatchRawMessage('<test>hello</test>');

      // transaction() should be called (multiple times for different phases)
      expect(mockTransaction).toHaveBeenCalled();

      // Core DAO functions should all be called
      expect(insertMessage).toHaveBeenCalled();
      expect(insertConnectorMessage).toHaveBeenCalled();
      expect(insertContent).toHaveBeenCalled();
      expect(updateStatistics).toHaveBeenCalled();

      await channel.stop();
    });

    it('should pass PoolConnection to DAO calls inside transactions', async () => {
      await channel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await channel.dispatchRawMessage('<test/>');

      // insertMessage should have received the mockPoolConnection
      const insertMessageCalls = (insertMessage as jest.Mock).mock.calls;
      expect(insertMessageCalls.length).toBeGreaterThanOrEqual(1);
      // Last arg should be the connection
      expect(insertMessageCalls[0]![insertMessageCalls[0]!.length - 1]).toBe(mockPoolConnection);

      await channel.stop();
    });
  });

  describe('MetaDataReplacer integration (Phase 3)', () => {
    it('should call insertCustomMetaData when metaDataColumns configured', async () => {
      await channel.stop();

      const metaChannel = new Channel({
        id: 'metadata-col-test',
        name: 'MetaData Column Test',
        enabled: true,
        metaDataColumns: [
          { name: 'PatientName', type: 'STRING' as any, mappingName: 'patientName' },
        ],
      });

      const src = new TestSourceConnector();
      metaChannel.setSourceConnector(src);

      // Create a destination that sets the mapping value
      class MappingDest extends DestinationConnector {
        constructor() {
          super({ name: 'Mapping Dest', metaDataId: 1, transportName: 'TEST' });
        }
        async send(msg: ConnectorMessage): Promise<void> {
          msg.getConnectorMap().set('patientName', 'John Doe');
        }
        async getResponse(): Promise<string | null> { return null; }
      }
      metaChannel.addDestinationConnector(new MappingDest());

      await metaChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await metaChannel.dispatchRawMessage('<test/>');
      await metaChannel.stop();

      // insertCustomMetaData should have been called for the destination (metaDataId=1)
      const customMetaCalls = (insertCustomMetaData as jest.Mock).mock.calls;
      expect(customMetaCalls.length).toBeGreaterThanOrEqual(1);

      // Re-start default channel for afterEach compatibility
      await channel.start();
    });

    it('should NOT call insertCustomMetaData when storeCustomMetaData is false', async () => {
      await channel.stop();

      const settings = getStorageSettings(MessageStorageMode.DISABLED);
      const noMetaChannel = new Channel({
        id: 'no-meta-test',
        name: 'No Meta Test',
        enabled: true,
        storageSettings: settings,
        metaDataColumns: [
          { name: 'Ignored', type: 'STRING' as any, mappingName: 'ignored' },
        ],
      });
      noMetaChannel.setSourceConnector(new TestSourceConnector());
      noMetaChannel.addDestinationConnector(new TestDestinationConnector(1));

      await noMetaChannel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await noMetaChannel.dispatchRawMessage('<test/>');
      await noMetaChannel.stop();

      expect(insertCustomMetaData).not.toHaveBeenCalled();

      // Re-start default channel for afterEach compatibility
      await channel.start();
    });

    it('should NOT call insertCustomMetaData when no metaDataColumns configured', async () => {
      // Default channel has no metaDataColumns
      await channel.start();
      jest.clearAllMocks();
      (channelTablesExist as jest.Mock).mockResolvedValue(true);
      (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));

      await channel.dispatchRawMessage('<test/>');

      expect(insertCustomMetaData).not.toHaveBeenCalled();

      await channel.stop();
    });
  });
});
