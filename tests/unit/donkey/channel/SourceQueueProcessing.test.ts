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
import {
  insertMessage, insertConnectorMessage, insertContent,
  channelTablesExist, getNextMessageId,
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
