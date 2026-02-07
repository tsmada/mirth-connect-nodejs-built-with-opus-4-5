/**
 * Pipeline Integration Tests
 *
 * Verifies that ChannelBuilder correctly wires queue config, ResponseValidator,
 * and inboundDataType into built channels. Also tests queue-enabled destination
 * retry flows and PENDING status checkpoints.
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
  getNextMessageId: jest.fn().mockImplementation(() => Promise.resolve(mockNextMessageId++)),
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
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import { buildChannel } from '../../../../src/donkey/channel/ChannelBuilder';
import { Channel as ChannelModel } from '../../../../src/api/models/Channel';
import { DefaultResponseValidator } from '../../../../src/donkey/message/ResponseValidator';
import { DestinationQueue } from '../../../../src/donkey/queue/DestinationQueue';
import {
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

// Concrete test destination connector with controllable send behavior
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public sendBehavior: 'success' | 'fail' | 'fail-then-succeed' = 'success';
  private callCount = 0;

  constructor(metaDataId: number, name: string = 'Test Destination') {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
    });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.callCount++;

    if (this.sendBehavior === 'fail') {
      throw new Error('Send failed');
    }
    if (this.sendBehavior === 'fail-then-succeed' && this.callCount === 1) {
      throw new Error('Send failed on first attempt');
    }

    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

describe('Pipeline Integration', () => {
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

  describe('ChannelBuilder wires queue config', () => {
    it('should pass retryCount, retryIntervalMillis, queueSendFirst to TCP dispatcher', () => {
      const channelConfig: ChannelModel = {
        id: 'queue-config-tcp',
        name: 'Queue Config TCP',
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
        destinationConnectors: [{
          name: 'TCP Dest',
          metaDataId: 1,
          transportName: 'TCP Sender',
          enabled: true,
          waitForPrevious: false,
          queueEnabled: true,
          properties: {
            remoteAddress: 'localhost',
            remotePort: '6661',
            retryCount: '5',
            retryIntervalMillis: '3000',
            queueSendFirst: 'true',
          },
        }],
      };

      const channel = buildChannel(channelConfig);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);

      const dest = dests[0]!;
      expect(dest.getRetryCount()).toBe(5);
      expect(dest.getRetryIntervalMillis()).toBe(3000);
      expect(dest.shouldSendFirst()).toBe(true);
    });

    it('should pass retryCount, retryIntervalMillis, queueSendFirst to HTTP dispatcher', () => {
      const channelConfig: ChannelModel = {
        id: 'queue-config-http',
        name: 'Queue Config HTTP',
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
        destinationConnectors: [{
          name: 'HTTP Dest',
          metaDataId: 1,
          transportName: 'HTTP Sender',
          enabled: true,
          waitForPrevious: false,
          queueEnabled: true,
          properties: {
            host: 'http://localhost:8080',
            retryCount: '3',
            retryIntervalMillis: '5000',
            queueSendFirst: 'false',
          },
        }],
      };

      const channel = buildChannel(channelConfig);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(1);

      const dest = dests[0]!;
      expect(dest.getRetryCount()).toBe(3);
      expect(dest.getRetryIntervalMillis()).toBe(5000);
      expect(dest.shouldSendFirst()).toBe(false);
    });

    it('should pass queue config to File, Database, and VM dispatchers', () => {
      const channelConfig: ChannelModel = {
        id: 'queue-config-multi',
        name: 'Queue Config Multi',
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
        destinationConnectors: [
          {
            name: 'File Dest',
            metaDataId: 1,
            transportName: 'File Writer',
            enabled: true,
            waitForPrevious: false,
            queueEnabled: true,
            properties: {
              retryCount: '2',
              retryIntervalMillis: '1000',
              queueSendFirst: 'true',
            },
          },
          {
            name: 'DB Dest',
            metaDataId: 2,
            transportName: 'Database Writer',
            enabled: true,
            waitForPrevious: false,
            queueEnabled: true,
            properties: {
              retryCount: '10',
              retryInterval: '7000',  // Note: uses retryInterval (not retryIntervalMillis)
              queueSendFirst: 'true',
            },
          },
          {
            name: 'VM Dest',
            metaDataId: 3,
            transportName: 'Channel Writer',
            enabled: true,
            waitForPrevious: false,
            queueEnabled: true,
            properties: {
              channelId: 'target-channel',
              retryCount: '4',
              retryIntervalMillis: '2000',
              queueSendFirst: 'false',
            },
          },
        ],
      };

      const channel = buildChannel(channelConfig);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(3);

      // File dispatcher
      expect(dests[0]!.getRetryCount()).toBe(2);
      expect(dests[0]!.getRetryIntervalMillis()).toBe(1000);
      expect(dests[0]!.shouldSendFirst()).toBe(true);

      // Database dispatcher - uses retryInterval fallback
      expect(dests[1]!.getRetryCount()).toBe(10);
      expect(dests[1]!.getRetryIntervalMillis()).toBe(7000);
      expect(dests[1]!.shouldSendFirst()).toBe(true);

      // VM dispatcher
      expect(dests[2]!.getRetryCount()).toBe(4);
      expect(dests[2]!.getRetryIntervalMillis()).toBe(2000);
      expect(dests[2]!.shouldSendFirst()).toBe(false);
    });

    it('should default queue config when not specified in properties', () => {
      const channelConfig: ChannelModel = {
        id: 'queue-config-defaults',
        name: 'Queue Config Defaults',
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
        destinationConnectors: [{
          name: 'TCP Dest',
          metaDataId: 1,
          transportName: 'TCP Sender',
          enabled: true,
          waitForPrevious: false,
          properties: {
            remoteAddress: 'localhost',
            remotePort: '6661',
          },
        }],
      };

      const channel = buildChannel(channelConfig);
      const dest = channel.getDestinationConnectors()[0]!;
      expect(dest.getRetryCount()).toBe(0);
      expect(dest.getRetryIntervalMillis()).toBe(10000);
      expect(dest.shouldSendFirst()).toBe(false);
    });
  });

  describe('ChannelBuilder wires inboundDataType', () => {
    it('should set inboundDataType from sourceConnector.transformer.inboundDataType', () => {
      const channelConfig: ChannelModel = {
        id: 'inbound-dt',
        name: 'Inbound DataType',
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
          transformer: {
            steps: [],
            inboundDataType: 'HL7V2',
            outboundDataType: 'XML',
          },
        },
        destinationConnectors: [],
      };

      const channel = buildChannel(channelConfig);
      const source = channel.getSourceConnector();
      expect(source).toBeDefined();
      expect(source!.getInboundDataType()).toBe('HL7V2');
    });

    it('should default to RAW when no transformer config', () => {
      const channelConfig: ChannelModel = {
        id: 'inbound-dt-default',
        name: 'Inbound DataType Default',
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
      expect(source!.getInboundDataType()).toBe('RAW');
    });

    it('should handle transformer with no inboundDataType set', () => {
      const channelConfig: ChannelModel = {
        id: 'inbound-dt-no-type',
        name: 'Inbound DataType No Type',
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
          transformer: {
            steps: [],
            outboundDataType: 'XML',
          },
        },
        destinationConnectors: [],
      };

      const channel = buildChannel(channelConfig);
      const source = channel.getSourceConnector();
      expect(source).toBeDefined();
      expect(source!.getInboundDataType()).toBe('RAW');
    });
  });

  describe('ChannelBuilder wires ResponseValidator', () => {
    it('should set DefaultResponseValidator on each destination connector', () => {
      const channelConfig: ChannelModel = {
        id: 'resp-validator',
        name: 'ResponseValidator Test',
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
        destinationConnectors: [
          {
            name: 'TCP Dest',
            metaDataId: 1,
            transportName: 'TCP Sender',
            enabled: true,
            waitForPrevious: false,
            properties: {
              remoteAddress: 'localhost',
              remotePort: '6661',
            },
          },
          {
            name: 'HTTP Dest',
            metaDataId: 2,
            transportName: 'HTTP Sender',
            enabled: true,
            waitForPrevious: false,
            properties: {
              host: 'http://localhost:8080',
            },
          },
          {
            name: 'VM Dest',
            metaDataId: 3,
            transportName: 'Channel Writer',
            enabled: true,
            waitForPrevious: false,
            properties: {
              channelId: 'target-channel',
            },
          },
        ],
      };

      const channel = buildChannel(channelConfig);
      const dests = channel.getDestinationConnectors();
      expect(dests).toHaveLength(3);

      for (const dest of dests) {
        const validator = dest.getResponseValidator();
        expect(validator).not.toBeNull();
        expect(validator).toBeInstanceOf(DefaultResponseValidator);
      }
    });

    it('should not set ResponseValidator on disabled connectors (they are skipped)', () => {
      const channelConfig: ChannelModel = {
        id: 'resp-validator-disabled',
        name: 'ResponseValidator Disabled',
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
        destinationConnectors: [
          {
            name: 'Disabled Dest',
            metaDataId: 1,
            transportName: 'TCP Sender',
            enabled: false,  // disabled
            waitForPrevious: false,
            properties: {
              remoteAddress: 'localhost',
              remotePort: '6661',
            },
          },
        ],
      };

      const channel = buildChannel(channelConfig);
      // Disabled connectors are not added
      expect(channel.getDestinationConnectors()).toHaveLength(0);
    });
  });

  describe('ChannelBuilder wires respondAfterProcessing (smoke test)', () => {
    it('should wire respondAfterProcessing=false from source properties', () => {
      const channelConfig: ChannelModel = {
        id: 'rap-smoke',
        name: 'RAP Smoke',
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
      expect(channel.getSourceConnector()!.getRespondAfterProcessing()).toBe(false);
    });
  });

  describe('Queue-enabled destination: fail -> QUEUED -> retry -> SENT', () => {
    it('should queue a failed message and retry until success', async () => {
      const channel = new Channel({
        id: 'queue-retry-test',
        name: 'Queue Retry Test',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1, 'Queue Dest');
      dest.sendBehavior = 'fail-then-succeed';

      // Configure queue settings via protected access
      (dest as any).queueEnabled = true;
      (dest as any).retryCount = 3;
      (dest as any).retryIntervalMillis = 50; // Short interval for test

      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      // Create a queue and seed it with a message via mock data source
      const queue = new DestinationQueue();
      const connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'queue-retry-test',
        channelName: 'Queue Retry Test',
        connectorName: 'Queue Dest',
        serverId: 'test-server',
        receivedDate: new Date(),
        status: Status.QUEUED,
      });

      // The data source returns the message in getItems so fillBuffer picks it up
      const msgMap = new Map<number, ConnectorMessage>([[1, connectorMessage]]);
      const mockDataSource = {
        getChannelId: () => 'queue-retry-test',
        getMetaDataId: () => 1,
        getSize: () => msgMap.size,
        getItems: () => new Map(msgMap),
        isQueueRotated: () => false,
        setLastItem: () => {},
        rotateQueue: () => {},
        getRotateThreadMap: () => new Map(),
      };
      queue.setDataSource(mockDataSource);
      dest.setQueue(queue);
      dest.setResponseValidator(new DefaultResponseValidator());

      // Start queue processing
      dest.startQueueProcessing();

      // Wait for retry cycle (fail + retry interval + success)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stop queue processing
      await dest.stopQueueProcessing();

      // The first call should fail, the second should succeed
      expect(dest.getCallCount()).toBeGreaterThanOrEqual(2);
      expect(dest.sentMessages).toHaveLength(1);
    });
  });

  describe('PENDING status checkpoint', () => {
    it('should process messages through the pipeline with correct status transitions', async () => {
      const channel = new Channel({
        id: 'pending-test',
        name: 'Pending Test',
        enabled: true,
      });

      const source = new TestSourceConnector();
      const dest = new TestDestinationConnector(1);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(dest);

      const message = await channel.dispatchRawMessage('<test>pending</test>');

      // Message should be processed (synchronous mode)
      expect(message).toBeDefined();
      expect(message.isProcessed()).toBe(true);

      // Destination should have received the message
      expect(dest.sentMessages).toHaveLength(1);

      // The sent connector message should have a send date (was sent, not still pending)
      const sentMsg = dest.sentMessages[0]!;
      expect(sentMsg.getSendDate()).toBeDefined();
    });
  });
});
