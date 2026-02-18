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
  getNextMessageId: jest.fn().mockImplementation(() => {
    return Promise.resolve(mockNextMessageId++);
  }),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
}));
let mockNextMessageId = 1;

import { Channel } from '../../../../src/donkey/channel/Channel';
import { SourceConnector, SourceConnectorConfig } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { Channel as ChannelModel } from '../../../../src/api/models/Channel';
import { Status } from '../../../../src/model/Status';
import { SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';
import {
  insertMessage, insertConnectorMessage, insertContent,
  channelTablesExist, getNextMessageId,
  updateConnectorMessageStatus,
} from '../../../../src/db/DonkeyDao';

// Concrete test source connector
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

// Concrete test destination connector
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public responseToReturn: string | null = null;

  constructor(metaDataId: number, name: string = 'Test Destination', opts?: { queueEnabled?: boolean }) {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
      queueEnabled: opts?.queueEnabled,
    });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return this.responseToReturn;
  }
}

// Destination connector that always throws on send (for error/queue tests)
class FailingDestinationConnector extends DestinationConnector {
  constructor(metaDataId: number, name: string = 'Failing Destination', opts?: { queueEnabled?: boolean }) {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
      queueEnabled: opts?.queueEnabled,
    });
  }

  async send(_connectorMessage: ConnectorMessage): Promise<void> {
    throw new Error('Send failed');
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

describe('Source Queue Processing', () => {
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

  describe('SourceConnector.respondAfterProcessing', () => {
    it('should default to true', () => {
      const connector = new TestSourceConnector();
      expect(connector.getRespondAfterProcessing()).toBe(true);
    });

    it('should accept false from config', () => {
      const connector = new TestSourceConnector({ respondAfterProcessing: false });
      expect(connector.getRespondAfterProcessing()).toBe(false);
    });

    it('should be settable via setter', () => {
      const connector = new TestSourceConnector();
      expect(connector.getRespondAfterProcessing()).toBe(true);
      connector.setRespondAfterProcessing(false);
      expect(connector.getRespondAfterProcessing()).toBe(false);
    });
  });

  describe('Channel with respondAfterProcessing=true (default)', () => {
    it('should process synchronously and return processed message', async () => {
      const channel = new Channel({
        id: 'sync-channel',
        name: 'Sync Channel',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const message = await channel.dispatchRawMessage('<test>sync</test>');
      expect(message).toBeDefined();
      expect(message.isProcessed()).toBe(true);
      expect(dest.sentMessages).toHaveLength(1);
    });
  });

  describe('Channel with respondAfterProcessing=false', () => {
    it('should return immediately from dispatchRawMessage with processed=false', async () => {
      const channel = new Channel({
        id: 'async-channel',
        name: 'Async Channel',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      // Start channel to initialize source queue
      await channel.start();

      const message = await channel.dispatchRawMessage('<test>async</test>');

      // Should return immediately with processed=false
      expect(message).toBeDefined();
      expect(message.isProcessed()).toBe(false);

      // Destination should NOT have been called yet (async processing)
      expect(dest.sentMessages).toHaveLength(0);

      // Wait for background processing to pick up the message
      await new Promise(resolve => setTimeout(resolve, 300));

      // Now the background loop should have processed it
      expect(dest.sentMessages).toHaveLength(1);

      await channel.stop();
    });

    it('should persist the raw message before returning', async () => {
      const channel = new Channel({
        id: 'async-persist',
        name: 'Async Persist',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      channel.setSourceConnector(source);

      await channel.start();

      await channel.dispatchRawMessage('<test>persist</test>');

      // Transaction 1 should have been called (source intake)
      expect(insertMessage).toHaveBeenCalledTimes(1);
      expect(insertConnectorMessage).toHaveBeenCalledTimes(1);
      expect(insertContent).toHaveBeenCalledTimes(1); // RAW content

      await channel.stop();
    });

    it('should process multiple queued messages in order', async () => {
      const channel = new Channel({
        id: 'async-order',
        name: 'Async Order',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.start();

      // Dispatch multiple messages
      await channel.dispatchRawMessage('<test>msg1</test>');
      await channel.dispatchRawMessage('<test>msg2</test>');
      await channel.dispatchRawMessage('<test>msg3</test>');

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(dest.sentMessages).toHaveLength(3);

      await channel.stop();
    });
  });

  describe('Source queue lifecycle', () => {
    it('should initialize source queue on start when respondAfterProcessing=false', async () => {
      const channel = new Channel({
        id: 'lifecycle-init',
        name: 'Lifecycle Init',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      channel.setSourceConnector(source);

      await channel.start();
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);

      await channel.stop();
      expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('should NOT initialize source queue when respondAfterProcessing=true', async () => {
      const channel = new Channel({
        id: 'lifecycle-sync',
        name: 'Lifecycle Sync',
        enabled: true,
      });

      const source = new TestSourceConnector(); // default: respondAfterProcessing=true
      channel.setSourceConnector(source);

      await channel.start();

      // Dispatch should process synchronously (no source queue involved)
      const dest = new TestDestinationConnector(1);
      channel.addDestinationConnector(dest);

      const msg = await channel.dispatchRawMessage('<test>data</test>');
      expect(msg.isProcessed()).toBe(true);

      await channel.stop();
    });

    it('should stop source queue processing cleanly on channel stop', async () => {
      const channel = new Channel({
        id: 'lifecycle-stop',
        name: 'Lifecycle Stop',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      channel.setSourceConnector(source);

      await channel.start();

      // Stop should complete without hanging
      await channel.stop();
      expect(channel.getCurrentState()).toBe(DeployedState.STOPPED);
    });
  });

  describe('PENDING checkpoint in source queue path', () => {
    it('should set PENDING status before response transformer when processing from queue', async () => {
      const channel = new Channel({
        id: 'pending-checkpoint',
        name: 'Pending Checkpoint',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new TestDestinationConnector(1);
      dest.responseToReturn = 'ACK';

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.start();
      await channel.dispatchRawMessage('<test>pending</test>');

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // updateConnectorMessageStatus should have been called with PENDING
      // for destination (metaDataId=1) before the final SENT status
      const statusCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls;

      // Find the PENDING call for metaDataId 1
      const pendingCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.PENDING
      );
      expect(pendingCall).toBeDefined();

      // The PENDING call should come before the final SENT transaction
      const pendingIdx = statusCalls.indexOf(pendingCall);
      const sentCall = statusCalls.find(
        (call: any[], idx: number) => idx > pendingIdx && call[2] === 1 && call[3] === Status.SENT
      );
      expect(sentCall).toBeDefined();

      await channel.stop();
    });

    it('should also set PENDING in the synchronous dispatchRawMessage path', async () => {
      const channel = new Channel({
        id: 'pending-sync',
        name: 'Pending Sync',
        enabled: true,
      });

      const source = new TestSourceConnector(); // respondAfterProcessing=true (default)
      const dest = new TestDestinationConnector(1);
      dest.responseToReturn = 'ACK';

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.dispatchRawMessage('<test>pending-sync</test>');

      const statusCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls;
      const pendingCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.PENDING
      );
      expect(pendingCall).toBeDefined();
    });
  });

  describe('Queue-on-error in source queue path', () => {
    it('should set QUEUED status when queue-enabled dest fails in source queue path', async () => {
      const channel = new Channel({
        id: 'queue-on-error',
        name: 'Queue On Error',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new FailingDestinationConnector(1, 'Queue Dest', { queueEnabled: true });

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.start();
      await channel.dispatchRawMessage('<test>queue-error</test>');

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should have called updateConnectorMessageStatus with QUEUED for metaDataId 1
      const statusCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls;
      const queuedCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.QUEUED
      );
      expect(queuedCall).toBeDefined();

      // Should NOT have an ERROR call for metaDataId 1
      const errorCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.ERROR
      );
      expect(errorCall).toBeUndefined();

      // Stats should show queued, not error
      const stats = channel.getStatistics();
      expect(stats.queued).toBeGreaterThanOrEqual(1);

      await channel.stop();
    });

    it('should set ERROR status when non-queue dest fails in source queue path', async () => {
      const channel = new Channel({
        id: 'error-no-queue',
        name: 'Error No Queue',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new FailingDestinationConnector(1, 'No Queue Dest', { queueEnabled: false });

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      await channel.start();
      await channel.dispatchRawMessage('<test>error-no-queue</test>');

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should have called updateConnectorMessageStatus with ERROR for metaDataId 1
      const statusCalls = (updateConnectorMessageStatus as jest.Mock).mock.calls;
      const errorCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.ERROR
      );
      expect(errorCall).toBeDefined();

      // Should NOT have a QUEUED call for metaDataId 1
      const queuedCall = statusCalls.find(
        (call: any[]) => call[2] === 1 && call[3] === Status.QUEUED
      );
      expect(queuedCall).toBeUndefined();

      // Stats should show error, not queued
      const stats = channel.getStatistics();
      expect(stats.error).toBeGreaterThanOrEqual(1);

      await channel.stop();
    });
  });

  describe('Response dataType from connector configuration', () => {
    it('should use connector response data type instead of hardcoded RAW', async () => {
      const channel = new Channel({
        id: 'resp-datatype',
        name: 'Response DataType',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      dest.responseToReturn = '<ACK>success</ACK>';

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      // Configure a response transformer with XML inbound data type
      // Must be set AFTER addDestinationConnector (which calls setChannel and creates executors)
      dest.setFilterTransformer({
        responseTransformerScripts: {
          inboundDataType: SerializationType.XML,
        },
      });

      const message = await channel.dispatchRawMessage('<test>datatype</test>');

      // The destination connector message should have RESPONSE content with XML dataType
      const destMsg = message.getConnectorMessage(1);
      expect(destMsg).toBeDefined();

      const responseContent = destMsg!.getResponseContent();
      expect(responseContent).toBeDefined();
      expect(responseContent!.dataType).toBe('XML');
    });

    it('should fall back to RAW when no response transformer is configured', async () => {
      const channel = new Channel({
        id: 'resp-fallback',
        name: 'Response Fallback',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      dest.responseToReturn = 'ACK';

      // No response transformer configured

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const message = await channel.dispatchRawMessage('<test>fallback</test>');

      const destMsg = message.getConnectorMessage(1);
      expect(destMsg).toBeDefined();

      const responseContent = destMsg!.getResponseContent();
      expect(responseContent).toBeDefined();
      expect(responseContent!.dataType).toBe('RAW');
    });

    it('should use connector response data type in source queue path too', async () => {
      const channel = new Channel({
        id: 'resp-datatype-queue',
        name: 'Response DataType Queue',
        enabled: true,
      });

      const source = new TestSourceConnector({ respondAfterProcessing: false });
      const dest = new TestDestinationConnector(1);
      dest.responseToReturn = '{"status":"ok"}';

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      // Configure response transformer with JSON inbound type
      // Must be set AFTER addDestinationConnector
      dest.setFilterTransformer({
        responseTransformerScripts: {
          inboundDataType: SerializationType.JSON,
        },
      });

      await channel.start();
      await channel.dispatchRawMessage('<test>queue-datatype</test>');

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify via storeContent calls that the response was persisted with JSON type
      // The dest getResponseDataType() should return 'JSON'
      expect(dest.getResponseDataType()).toBe('JSON');

      await channel.stop();
    });
  });

  describe('ChannelBuilder wiring', () => {
    it('should wire respondAfterProcessing=false from source connector properties', () => {
      const channelConfig: ChannelModel = {
        id: 'builder-test',
        name: 'Builder Test',
        revision: 1,
        enabled: true,
        properties: {},
        sourceConnector: {
          name: 'sourceConnector',
          transportName: 'Channel Reader',
          metaDataId: 0,
          enabled: true,
          waitForPrevious: false,
          properties: {
            respondAfterProcessing: false,
          },
        },
        destinationConnectors: [],
      };

      const channel = buildChannel(channelConfig);
      const source = channel.getSourceConnector();
      expect(source).toBeDefined();
      expect(source!.getRespondAfterProcessing()).toBe(false);
    });

    it('should wire respondAfterProcessing=false from string "false"', () => {
      const channelConfig: ChannelModel = {
        id: 'builder-string',
        name: 'Builder String',
        revision: 1,
        enabled: true,
        properties: {},
        sourceConnector: {
          name: 'sourceConnector',
          transportName: 'Channel Reader',
          metaDataId: 0,
          enabled: true,
          waitForPrevious: false,
          properties: {
            respondAfterProcessing: 'false',
          },
        },
        destinationConnectors: [],
      };

      const channel = buildChannel(channelConfig);
      const source = channel.getSourceConnector();
      expect(source).toBeDefined();
      expect(source!.getRespondAfterProcessing()).toBe(false);
    });

    it('should default to respondAfterProcessing=true when not specified', () => {
      const channelConfig: ChannelModel = {
        id: 'builder-default',
        name: 'Builder Default',
        revision: 1,
        enabled: true,
        properties: {},
        sourceConnector: {
          name: 'sourceConnector',
          transportName: 'Channel Reader',
          metaDataId: 0,
          enabled: true,
          waitForPrevious: false,
          properties: {},
        },
        destinationConnectors: [],
      };

      const channel = buildChannel(channelConfig);
      const source = channel.getSourceConnector();
      expect(source).toBeDefined();
      expect(source!.getRespondAfterProcessing()).toBe(true);
    });
  });
});
