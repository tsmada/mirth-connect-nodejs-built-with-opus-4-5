import { SourceConnector, SourceConnectorConfig } from '../../../../src/donkey/channel/SourceConnector';
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
class TestSourceConnector extends SourceConnector {
  public started = false;
  public stopped = false;

  constructor(config?: Partial<SourceConnectorConfig>) {
    super({
      name: config?.name ?? 'Test Source',
      transportName: config?.transportName ?? 'TEST',
      waitForDestinations: config?.waitForDestinations,
      queueSendFirst: config?.queueSendFirst,
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

  // Expose protected method for testing
  async testDispatch(rawData: string, sourceMap?: Map<string, unknown>): Promise<void> {
    return this.dispatchRawMessage(rawData, sourceMap);
  }
}

describe('SourceConnector', () => {
  let connector: TestSourceConnector;

  beforeEach(() => {
    // Reset singletons
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    connector = new TestSourceConnector();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      expect(connector.getName()).toBe('Test Source');
      expect(connector.getTransportName()).toBe('TEST');
      expect(connector.isRunning()).toBe(false);
    });

    it('should create with custom values', () => {
      const custom = new TestSourceConnector({
        name: 'Custom Source',
        transportName: 'CUSTOM',
        waitForDestinations: true,
        queueSendFirst: true,
      });

      expect(custom.getName()).toBe('Custom Source');
      expect(custom.getTransportName()).toBe('CUSTOM');
    });
  });

  describe('lifecycle', () => {
    it('should start connector', async () => {
      await connector.start();
      expect(connector.isRunning()).toBe(true);
      expect(connector.started).toBe(true);
    });

    it('should stop connector', async () => {
      await connector.start();
      await connector.stop();
      expect(connector.isRunning()).toBe(false);
      expect(connector.stopped).toBe(true);
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

    it('should throw when dispatching without channel', async () => {
      await expect(connector.testDispatch('<test/>')).rejects.toThrow(
        'Source connector is not attached to a channel'
      );
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
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Test Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });

      connectorMessage.setContent({
        contentType: ContentType.RAW,
        content: '<root><value>test</value></root>',
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

    it('should execute transformer', async () => {
      connector.setFilterTransformer({
        transformerSteps: [
          { name: 'SetMap', script: '$c("transformed", "yes");', enabled: true },
        ],
        inboundDataType: SerializationType.XML,
        outboundDataType: SerializationType.XML,
      });

      await connector.executeTransformer(connectorMessage);

      // Check channel map was updated
      expect(connectorMessage.getChannelMap().get('transformed')).toBe('yes');

      // Check transformed content was set
      const transformed = connectorMessage.getTransformedContent();
      expect(transformed).toBeDefined();
    });

    it('should pass with no filter/transformer', async () => {
      // No scripts set
      const filtered = await connector.executeFilter(connectorMessage);
      expect(filtered).toBe(false);

      await connector.executeTransformer(connectorMessage);
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
      expect(events[0]?.metaDataId).toBe(0); // Source connector is metaDataId 0
      expect(events[0]?.connectorName).toBe('Test Source');
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
