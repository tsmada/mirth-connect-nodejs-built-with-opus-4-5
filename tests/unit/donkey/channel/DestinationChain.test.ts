import { DestinationChain, DestinationChainProvider } from '../../../../src/donkey/channel/DestinationChain';
import { DestinationConnector, DestinationConnectorConfig } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';

// Test destination connector implementation
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public shouldFail = false;
  public shouldFilter = false;

  constructor(config: DestinationConnectorConfig) {
    super(config);
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Send failed');
    }
    this.sentMessages.push(connectorMessage);
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return 'OK';
  }

  async executeFilter(_connectorMessage: ConnectorMessage): Promise<boolean> {
    return this.shouldFilter;
  }

  async executeTransformer(connectorMessage: ConnectorMessage): Promise<void> {
    // Set encoded content
    const raw = connectorMessage.getRawContent();
    if (raw) {
      connectorMessage.setContent({
        contentType: ContentType.ENCODED,
        content: raw.content,
        dataType: raw.dataType,
        encrypted: false,
      });
    }
  }
}

// Mock chain provider
class MockChainProvider implements DestinationChainProvider {
  private channelId: string;
  private channelName: string;
  private metaDataIds: number[];
  private destinationConnectors: Map<number, DestinationConnector>;
  private chainId: number;
  private serverId: string;

  constructor(connectors: Map<number, DestinationConnector>) {
    this.channelId = 'test-channel';
    this.channelName = 'Test Channel';
    this.metaDataIds = Array.from(connectors.keys());
    this.destinationConnectors = connectors;
    this.chainId = 1;
    this.serverId = 'server-1';
  }

  getChannelId(): string {
    return this.channelId;
  }

  getChannelName(): string {
    return this.channelName;
  }

  getMetaDataIds(): number[] {
    return this.metaDataIds;
  }

  getDestinationConnectors(): Map<number, DestinationConnector> {
    return this.destinationConnectors;
  }

  getChainId(): number {
    return this.chainId;
  }

  getServerId(): string {
    return this.serverId;
  }
}

function createTestMessage(messageId: number, metaDataId: number): ConnectorMessage {
  const message = new ConnectorMessage({
    messageId,
    metaDataId,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: `Destination ${metaDataId}`,
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  message.setContent({
    contentType: ContentType.RAW,
    content: '<test>data</test>',
    dataType: 'XML',
    encrypted: false,
  });

  return message;
}

describe('DestinationChain', () => {
  let chain: DestinationChain;
  let dest1: TestDestinationConnector;
  let dest2: TestDestinationConnector;
  let provider: MockChainProvider;

  beforeEach(() => {
    dest1 = new TestDestinationConnector({
      name: 'Destination 1',
      metaDataId: 1,
      transportName: 'TEST',
    });

    dest2 = new TestDestinationConnector({
      name: 'Destination 2',
      metaDataId: 2,
      transportName: 'TEST',
    });

    const connectors = new Map<number, DestinationConnector>();
    connectors.set(1, dest1);
    connectors.set(2, dest2);

    provider = new MockChainProvider(connectors);
    chain = new DestinationChain(provider);
  });

  describe('constructor', () => {
    it('should create chain with provider', () => {
      expect(chain.getEnabledMetaDataIds()).toEqual([1, 2]);
      expect(chain.getName()).toContain('test-channel');
    });
  });

  describe('setMessage', () => {
    it('should set the message to process', () => {
      const message = createTestMessage(1, 1);
      chain.setMessage(message);
      expect(chain.getMessage()).toBe(message);
    });
  });

  describe('setEnabledMetaDataIds', () => {
    it('should update enabled metadata IDs', () => {
      chain.setEnabledMetaDataIds([1]);
      expect(chain.getEnabledMetaDataIds()).toEqual([1]);
    });
  });

  describe('call', () => {
    it('should process message through single destination', async () => {
      chain.setEnabledMetaDataIds([1]);
      const message = createTestMessage(1, 1);
      chain.setMessage(message);

      const results = await chain.call();

      expect(results.length).toBe(1);
      expect(results[0]?.getStatus()).toBe(Status.SENT);
      expect(dest1.sentMessages.length).toBe(1);
    });

    it('should process message through chain of destinations', async () => {
      const message = createTestMessage(1, 1);
      chain.setMessage(message);

      const results = await chain.call();

      expect(results.length).toBe(2);
      expect(results[0]?.getStatus()).toBe(Status.SENT);
      expect(results[1]?.getStatus()).toBe(Status.SENT);
      expect(dest1.sentMessages.length).toBe(1);
      expect(dest2.sentMessages.length).toBe(1);
    });

    it('should create next message in chain', async () => {
      const message = createTestMessage(1, 1);
      message.getChannelMap().set('key1', 'value1');
      message.getSourceMap().set('sourceKey', 'sourceValue');
      chain.setMessage(message);

      const results = await chain.call();

      // Second message should have copied maps
      const secondMessage = results[1];
      expect(secondMessage?.getChannelMap().get('key1')).toBe('value1');
      expect(secondMessage?.getSourceMap().get('sourceKey')).toBe('sourceValue');
      expect(secondMessage?.getMetaDataId()).toBe(2);
    });

    it('should handle filtered message', async () => {
      dest1.shouldFilter = true;
      const message = createTestMessage(1, 1);
      chain.setMessage(message);

      const results = await chain.call();

      expect(results[0]?.getStatus()).toBe(Status.FILTERED);
      // Should still continue to next destination
      expect(results.length).toBe(2);
    });

    it('should handle send failure', async () => {
      dest1.shouldFail = true;
      const message = createTestMessage(1, 1);
      chain.setMessage(message);

      const results = await chain.call();

      expect(results[0]?.getStatus()).toBe(Status.ERROR);
      // Chain should stop after error
      expect(results.length).toBe(1);
    });

    it('should throw error when no message set', async () => {
      await expect(chain.call()).rejects.toThrow('No message set');
    });

    it('should throw error when message metadata ID not in chain', async () => {
      const message = createTestMessage(1, 99); // Invalid metadata ID
      chain.setMessage(message);

      await expect(chain.call()).rejects.toThrow('not in the destination chain');
    });

    it('should start from correct position in chain', async () => {
      const message = createTestMessage(1, 2); // Start from destination 2
      chain.setMessage(message);

      const results = await chain.call();

      expect(results.length).toBe(1); // Only destination 2
      expect(dest1.sentMessages.length).toBe(0);
      expect(dest2.sentMessages.length).toBe(1);
    });

    it('should handle queue enabled destination', async () => {
      const queuedDest = new TestDestinationConnector({
        name: 'Queued Destination',
        metaDataId: 1,
        transportName: 'TEST',
        queueEnabled: true,
        queueSendFirst: false,
      });
      queuedDest.shouldFail = true;

      const connectors = new Map<number, DestinationConnector>();
      connectors.set(1, queuedDest);

      const queuedProvider = new MockChainProvider(connectors);
      const queuedChain = new DestinationChain(queuedProvider);
      queuedChain.setEnabledMetaDataIds([1]);

      const message = createTestMessage(1, 1);
      queuedChain.setMessage(message);

      const results = await queuedChain.call();

      // With queue enabled and send first false, should be queued
      expect(results[0]?.getStatus()).toBe(Status.QUEUED);
    });

    it('should handle PENDING status', async () => {
      const message = createTestMessage(1, 1);
      message.setStatus(Status.PENDING);
      chain.setMessage(message);
      chain.setEnabledMetaDataIds([1]);

      const results = await chain.call();

      expect(results[0]?.getStatus()).toBe(Status.SENT);
    });

    it('should handle SENT status (no-op)', async () => {
      const message = createTestMessage(1, 1);
      message.setStatus(Status.SENT);
      chain.setMessage(message);
      chain.setEnabledMetaDataIds([1]);

      const results = await chain.call();

      expect(results[0]?.getStatus()).toBe(Status.SENT);
      expect(dest1.sentMessages.length).toBe(0); // Not sent again
    });
  });

  describe('getChainId', () => {
    it('should return chain ID from provider', () => {
      expect(chain.getChainId()).toBe(1);
    });
  });
});
