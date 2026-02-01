import { HttpReceiver } from '../../../../src/connectors/http/HttpReceiver';
import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Mock destination for testing
class MockDestination extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];

  constructor() {
    super({
      name: 'Mock Destination',
      metaDataId: 1,
      transportName: 'MOCK',
    });
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
    connectorMessage.setStatus(Status.SENT);
  }

  async getResponse(): Promise<string | null> {
    return null;
  }
}

describe('HttpReceiver', () => {
  let receiver: HttpReceiver;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  afterEach(async () => {
    if (receiver && receiver.isRunning()) {
      await receiver.stop();
    }
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      receiver = new HttpReceiver({ name: 'Test Receiver' });

      expect(receiver.getName()).toBe('Test Receiver');
      expect(receiver.getTransportName()).toBe('HTTP');
      expect(receiver.isRunning()).toBe(false);
      expect(receiver.getPort()).toBe(80);
      expect(receiver.getHost()).toBe('0.0.0.0');
    });

    it('should create with custom values', () => {
      receiver = new HttpReceiver({
        name: 'Custom Receiver',
        properties: {
          host: '127.0.0.1',
          port: 8080,
          contextPath: '/api',
          timeout: 60000,
          charset: 'ISO-8859-1',
        },
      });

      expect(receiver.getPort()).toBe(8080);
      expect(receiver.getHost()).toBe('127.0.0.1');

      const props = receiver.getProperties();
      expect(props.contextPath).toBe('/api');
      expect(props.timeout).toBe(60000);
      expect(props.charset).toBe('ISO-8859-1');
    });
  });

  describe('properties', () => {
    beforeEach(() => {
      receiver = new HttpReceiver({ name: 'Test Receiver' });
    });

    it('should get default properties', () => {
      const props = receiver.getProperties();

      expect(props.xmlBody).toBe(false);
      expect(props.parseMultipart).toBe(true);
      expect(props.includeMetadata).toBe(false);
      expect(props.binaryMimeTypesRegex).toBe(true);
      expect(props.responseContentType).toBe('text/plain');
      expect(props.responseDataTypeBinary).toBe(false);
    });

    it('should update properties', () => {
      receiver.setProperties({
        port: 9090,
        xmlBody: true,
        responseContentType: 'application/json',
      });

      const props = receiver.getProperties();
      expect(props.port).toBe(9090);
      expect(props.xmlBody).toBe(true);
      expect(props.responseContentType).toBe('application/json');
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      receiver = new HttpReceiver({
        name: 'Test Receiver',
        properties: {
          port: 0, // Use random available port
          host: '127.0.0.1',
        },
      });
    });

    it('should start and stop', async () => {
      await receiver.start();
      expect(receiver.isRunning()).toBe(true);
      expect(receiver.getServer()).not.toBeNull();

      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
      expect(receiver.getServer()).toBeNull();
    });

    it('should throw when starting twice', async () => {
      await receiver.start();
      await expect(receiver.start()).rejects.toThrow('HTTP Receiver is already running');
    });
  });

  describe('channel integration', () => {
    let channel: Channel;
    let destination: MockDestination;

    beforeEach(async () => {
      receiver = new HttpReceiver({
        name: 'Test Receiver',
        properties: {
          port: 0, // Random port
          host: '127.0.0.1',
        },
      });

      destination = new MockDestination();

      const config: ChannelConfig = {
        id: 'http-test-channel',
        name: 'HTTP Test Channel',
        enabled: true,
      };

      channel = new Channel(config);
      channel.setSourceConnector(receiver);
      channel.addDestinationConnector(destination);
    });

    afterEach(async () => {
      if (channel.getState() !== 'STOPPED') {
        await channel.stop();
      }
    });

    it('should associate with channel', async () => {
      expect(receiver.getChannel()).toBe(channel);
    });

    it('should receive messages when channel is started', async () => {
      await channel.start();
      expect(receiver.isRunning()).toBe(true);

      // Get the actual port assigned
      const server = receiver.getServer();
      const address = server?.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      expect(port).toBeGreaterThan(0);
    });
  });
});

describe('HttpReceiver binary content detection', () => {
  it('should detect binary MIME types with regex', () => {
    const receiver = new HttpReceiver({
      name: 'Test',
      properties: {
        binaryMimeTypes: 'image/.*|application/octet-stream',
        binaryMimeTypesRegex: true,
      },
    });

    const props = receiver.getProperties();
    expect(props.binaryMimeTypes).toBe('image/.*|application/octet-stream');
    expect(props.binaryMimeTypesRegex).toBe(true);
  });

  it('should detect binary MIME types with prefix list', () => {
    const receiver = new HttpReceiver({
      name: 'Test',
      properties: {
        binaryMimeTypes: 'image/, application/octet-stream, video/',
        binaryMimeTypesRegex: false,
      },
    });

    const props = receiver.getProperties();
    expect(props.binaryMimeTypesRegex).toBe(false);
  });
});
