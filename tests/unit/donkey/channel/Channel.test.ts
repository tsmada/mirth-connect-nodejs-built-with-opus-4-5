import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message } from '../../../../src/model/Message';
import { Status } from '../../../../src/model/Status';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

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
});
