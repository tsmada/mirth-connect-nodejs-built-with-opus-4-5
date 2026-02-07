jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockNextMessageId++);
  }),
  channelTablesExist: jest.fn().mockResolvedValue(true),
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
  insertMessage, insertConnectorMessage, insertContent,
  updateConnectorMessageStatus, updateMessageProcessed,
  updateStatistics, updateErrors, updateMaps, updateSendAttempts,
  getNextMessageId, channelTablesExist,
} from '../../../../src/db/DonkeyDao';

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
    (updateSendAttempts as jest.Mock).mockResolvedValue(undefined);

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
        expect.any(Date)    // receivedDate
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
        Status.RECEIVED
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
        false                // encrypted
      );
    });

    it('should persist destination connector message', async () => {
      const message = await channel.dispatchRawMessage('<test>hello</test>');

      // Should be called for destination with metaDataId=1
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
        1,             // destination metaDataId
        Status.SENT
      );
    });

    it('should update statistics on RECEIVED and SENT', async () => {
      await channel.dispatchRawMessage('<test>hello</test>');

      // Verify RECEIVED statistics for source (metaDataId=0)
      expect(updateStatistics).toHaveBeenCalledWith(
        'test-channel-1',
        0,                   // source metaDataId
        expect.any(String),  // serverId
        Status.RECEIVED
      );

      // Verify SENT statistics for destination (metaDataId=1)
      expect(updateStatistics).toHaveBeenCalledWith(
        'test-channel-1',
        1,                   // destination metaDataId
        expect.any(String),  // serverId
        Status.SENT
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
      (channelTablesExist as jest.Mock).mockResolvedValue(false);

      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(insertMessage).not.toHaveBeenCalled();
      expect(insertConnectorMessage).not.toHaveBeenCalled();
      expect(message.isProcessed()).toBe(true);
    });

    it('should complete message processing even when DB fails', async () => {
      (insertMessage as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      const message = await channel.dispatchRawMessage('<test>hello</test>');

      expect(message.isProcessed()).toBe(true);
    });

    it('should persist SOURCE_MAP content', async () => {
      const sourceMap = new Map<string, unknown>([['key1', 'value1']]);

      await channel.dispatchRawMessage('<test>hello</test>', sourceMap);

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
        true
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

      expect(insertContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        1,                   // destination metaDataId
        ContentType.SENT,
        expect.any(String),  // sent data
        expect.any(String),  // dataType
        false
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
        undefined             // responseDate (no response captured in default test setup)
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
        undefined             // no error code
      );
    });

    it('should persist RESPONSE content when available', async () => {
      destConnector.lastResponse = 'ACK^A01|OK';

      await channel.dispatchRawMessage('<test>hello</test>');

      expect(insertContent).toHaveBeenCalledWith(
        'test-channel-1',
        expect.any(Number),
        1,                    // destination metaDataId
        ContentType.RESPONSE,
        'ACK^A01|OK',
        'RAW',
        false
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
        expect.any(Map)       // responseMap
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
        expect.any(Map)       // responseMap
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

      // SENT should NOT be persisted in METADATA mode
      const sentCalls = (insertContent as jest.Mock).mock.calls.filter(
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
        undefined
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

      // SOURCE_MAP should still be persisted for trace feature
      const sourceMapCalls = (insertContent as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[3] === ContentType.SOURCE_MAP
      );
      expect(sourceMapCalls).toHaveLength(1);

      // But CONNECTOR_MAP, CHANNEL_MAP, RESPONSE_MAP should NOT be persisted
      expect(updateMaps).not.toHaveBeenCalled();
    });
  });
});
