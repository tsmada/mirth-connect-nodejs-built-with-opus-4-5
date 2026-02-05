import { DestinationConnector, DestinationConnectorConfig } from '../../../../src/donkey/channel/DestinationConnector';
import { Channel } from '../../../../src/donkey/channel/Channel';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { FilterTransformerScripts } from '../../../../src/donkey/channel/FilterTransformerExecutor';
import { SerializationType } from '../../../../src/javascript/runtime/ScriptBuilder';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Concrete implementation for testing
class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public responseToReturn: string | null = null;

  constructor(config?: Partial<DestinationConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Destination',
      metaDataId: config?.metaDataId ?? 1,
      transportName: config?.transportName ?? 'TEST',
      enabled: config?.enabled,
      waitForPrevious: config?.waitForPrevious,
      queueEnabled: config?.queueEnabled,
      queueSendFirst: config?.queueSendFirst,
      retryCount: config?.retryCount,
      retryIntervalMillis: config?.retryIntervalMillis,
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

describe('DestinationConnector', () => {
  let connector: TestDestinationConnector;

  beforeEach(() => {
    // Reset singletons
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    connector = new TestDestinationConnector();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      expect(connector.getName()).toBe('Test Destination');
      expect(connector.getMetaDataId()).toBe(1);
      expect(connector.getTransportName()).toBe('TEST');
      expect(connector.isEnabled()).toBe(true);
      expect(connector.isRunning()).toBe(false);
      expect(connector.isQueueEnabled()).toBe(false);
    });

    it('should create with custom values', () => {
      const custom = new TestDestinationConnector({
        name: 'Custom Destination',
        metaDataId: 5,
        transportName: 'CUSTOM',
        enabled: false,
        queueEnabled: true,
        retryCount: 3,
        retryIntervalMillis: 5000,
      });

      expect(custom.getName()).toBe('Custom Destination');
      expect(custom.getMetaDataId()).toBe(5);
      expect(custom.isEnabled()).toBe(false);
      expect(custom.isQueueEnabled()).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('should start connector', async () => {
      await connector.start();
      expect(connector.isRunning()).toBe(true);
    });

    it('should stop connector', async () => {
      await connector.start();
      await connector.stop();
      expect(connector.isRunning()).toBe(false);
    });
  });

  describe('channel association', () => {
    it('should associate with channel', () => {
      const channel = new Channel({
        id: 'test-channel',
        name: 'Test Channel',
        enabled: true,
      });

      connector.setChannel(channel);
      expect(connector.getChannel()).toBe(channel);
    });

    it('should create filter/transformer executor when channel set', () => {
      const channel = new Channel({
        id: 'test-channel',
        name: 'Test Channel',
        enabled: true,
      });

      connector.setChannel(channel);
      expect(connector.getFilterTransformerExecutor()).toBeDefined();
    });
  });

  describe('send', () => {
    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Test Destination',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });

      connectorMessage.setContent({
        contentType: ContentType.ENCODED,
        content: '<test>data</test>',
        dataType: 'XML',
        encrypted: false,
      });
    });

    it('should send message', async () => {
      await connector.send(connectorMessage);

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]).toBe(connectorMessage);
      expect(connectorMessage.getSendDate()).toBeDefined();
    });

    it('should return response', async () => {
      connector.responseToReturn = '<ack>OK</ack>';

      const response = await connector.getResponse(connectorMessage);
      expect(response).toBe('<ack>OK</ack>');
    });

    it('should return null response when none set', async () => {
      const response = await connector.getResponse(connectorMessage);
      expect(response).toBeNull();
    });
  });

  describe('filter/transformer', () => {
    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      // Set up channel
      const channel = new Channel({
        id: 'test-channel',
        name: 'Test Channel',
        enabled: true,
      });
      connector.setChannel(channel);

      // Create test connector message
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Test Destination',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });

      // Set raw and transformed content (would come from source)
      connectorMessage.setContent({
        contentType: ContentType.RAW,
        content: '<root><value>original</value></root>',
        dataType: 'XML',
        encrypted: false,
      });

      connectorMessage.setContent({
        contentType: ContentType.TRANSFORMED,
        content: '<root><value>transformed</value></root>',
        dataType: 'XML',
        encrypted: false,
      });
    });

    it('should set filter/transformer scripts', () => {
      const scripts: FilterTransformerScripts = {
        filterRules: [
          { name: 'Rule1', script: 'return true;', operator: 'AND', enabled: true },
        ],
        transformerSteps: [
          { name: 'Step1', script: '$c("key", "value");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      };

      connector.setFilterTransformer(scripts);
      expect(connector.getFilterTransformerExecutor()).toBeDefined();
    });

    it('should execute filter and accept message', async () => {
      connector.setFilterTransformer({
        filterRules: [
          { name: 'Accept', script: 'return true;', operator: 'AND', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      });

      const filtered = await connector.executeFilter(connectorMessage);
      expect(filtered).toBe(false); // Not filtered = accepted
    });

    it('should execute filter and reject message', async () => {
      connector.setFilterTransformer({
        filterRules: [
          { name: 'Reject', script: 'return false;', operator: 'AND', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
      });

      const filtered = await connector.executeFilter(connectorMessage);
      expect(filtered).toBe(true); // Filtered = rejected
    });

    it('should execute transformer and set encoded content', async () => {
      connector.setFilterTransformer({
        transformerSteps: [
          { name: 'SetMap', script: '$c("destTransformed", "yes");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
        outboundDataType: SerializationType.XML,
      });

      await connector.executeTransformer(connectorMessage);

      // Check channel map was updated
      expect(connectorMessage.getChannelMap().get('destTransformed')).toBe('yes');

      // Check encoded content was set
      const encoded = connectorMessage.getEncodedContent();
      expect(encoded).toBeDefined();
    });

    it('should copy transformed to encoded when no transformer', async () => {
      // No filter/transformer set - should copy transformed to encoded
      await connector.executeTransformer(connectorMessage);

      const encoded = connectorMessage.getEncodedContent();
      expect(encoded).toBeDefined();
      expect(encoded?.content).toBe('<root><value>transformed</value></root>');
    });

    it('should pass with no filter/transformer', async () => {
      // No scripts set
      const filtered = await connector.executeFilter(connectorMessage);
      expect(filtered).toBe(false);
    });
  });

  describe('response transformer', () => {
    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      // Set up channel
      const channel = new Channel({
        id: 'test-channel',
        name: 'Test Channel',
        enabled: true,
      });
      connector.setChannel(channel);

      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Test Destination',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.SENT,
      });

      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: '<ack>OK</ack>',
        dataType: 'XML',
        encrypted: false,
      });
    });

    it('should execute response transformer', async () => {
      connector.setFilterTransformer({
        responseTransformerScripts: {
          transformerSteps: [
            { name: 'LogResponse', script: '$c("responseProcessed", "yes");', enabled: true },
          ],
          inboundDataType: SerializationType.XML,
        },
      });

      await connector.executeResponseTransformer(connectorMessage);

      expect(connectorMessage.getChannelMap().get('responseProcessed')).toBe('yes');
    });

    it('should do nothing without response transformer', async () => {
      // No response transformer set
      await connector.executeResponseTransformer(connectorMessage);
      // Should complete without error
    });
  });

  describe('state tracking', () => {
    it('should have STOPPED state initially', () => {
      expect(connector.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('should allow setting current state', () => {
      connector.setCurrentState(DeployedState.STARTING);
      expect(connector.getCurrentState()).toBe(DeployedState.STARTING);

      connector.setCurrentState(DeployedState.STARTED);
      expect(connector.getCurrentState()).toBe(DeployedState.STARTED);

      connector.setCurrentState(DeployedState.STOPPED);
      expect(connector.getCurrentState()).toBe(DeployedState.STOPPED);
    });

    it('should emit connectorStateChange event on updateCurrentState', () => {
      const channel = new Channel({
        id: 'test-channel',
        name: 'Test Channel',
        enabled: true,
      });

      connector.setChannel(channel);

      interface ConnectorStateChangeEvent {
        channelId: string;
        channelName: string;
        metaDataId: number;
        connectorName: string;
        state: DeployedState;
      }

      const events: ConnectorStateChangeEvent[] = [];
      channel.on('connectorStateChange', (event: ConnectorStateChangeEvent) => {
        events.push(event);
      });

      connector.updateCurrentState(DeployedState.STARTING);
      connector.updateCurrentState(DeployedState.STARTED);

      expect(events).toHaveLength(2);
      expect(events[0]?.state).toBe(DeployedState.STARTING);
      expect(events[0]?.metaDataId).toBe(1); // Destination connector metaDataId from config
      expect(events[0]?.connectorName).toBe('Test Destination');
      expect(events[1]?.state).toBe(DeployedState.STARTED);
    });

    it('should not emit event when no channel attached', () => {
      // Should not throw even without channel
      expect(() => {
        connector.updateCurrentState(DeployedState.STARTING);
      }).not.toThrow();

      expect(connector.getCurrentState()).toBe(DeployedState.STARTING);
    });
  });
});
