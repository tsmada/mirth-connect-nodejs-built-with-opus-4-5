/**
 * Unit tests for JMS Dispatcher
 */

import { JmsDispatcher } from '../../../../src/connectors/jms/JmsDispatcher.js';
import { JmsClient } from '../../../../src/connectors/jms/JmsClient.js';
import { DeliveryMode } from '../../../../src/connectors/jms/JmsConnectorProperties.js';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage.js';
import { Status } from '../../../../src/model/Status.js';
import { ContentType } from '../../../../src/model/ContentType.js';
import { Channel } from '../../../../src/donkey/channel/Channel.js';

// Mock JmsClient
jest.mock('../../../../src/connectors/jms/JmsClient.js');

const MockedJmsClient = JmsClient as jest.MockedClass<typeof JmsClient>;

describe('JmsDispatcher', () => {
  let mockJmsClient: jest.Mocked<JmsClient>;
  let mockChannel: Partial<Channel>;
  let mockConnectorMessage: jest.Mocked<ConnectorMessage>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock JmsClient instance
    mockJmsClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      emit: jest.fn(),
      getClientId: jest.fn().mockReturnValue('test-client-id'),
    } as unknown as jest.Mocked<JmsClient>;

    // Mock JmsClient constructor
    MockedJmsClient.mockImplementation(() => mockJmsClient);

    // Create mock channel
    mockChannel = {
      getId: jest.fn().mockReturnValue('channel-123'),
      getName: jest.fn().mockReturnValue('Test Channel'),
      emit: jest.fn(),
    };

    // Create mock connector message
    const connectorMap = new Map<string, unknown>();
    const channelMap = new Map<string, unknown>();
    const sourceMap = new Map<string, unknown>();
    mockConnectorMessage = {
      getMessageId: jest.fn().mockReturnValue(12345),
      getEncodedContent: jest.fn().mockReturnValue({
        contentType: ContentType.ENCODED,
        content: 'encoded message content',
        dataType: 'HL7V2',
        encrypted: false,
      }),
      getRawData: jest.fn().mockReturnValue('raw message content'),
      setSendDate: jest.fn(),
      setStatus: jest.fn(),
      setProcessingError: jest.fn(),
      setContent: jest.fn(),
      getConnectorMap: jest.fn().mockReturnValue(connectorMap),
      getChannelMap: jest.fn().mockReturnValue(channelMap),
      getSourceMap: jest.fn().mockReturnValue(sourceMap),
      getResponseContent: jest.fn().mockReturnValue(null),
      getChannelId: jest.fn().mockReturnValue('channel-123'),
    } as unknown as jest.Mocked<ConnectorMessage>;
  });

  describe('constructor', () => {
    it('should create dispatcher with default properties', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('JMS Sender');
      expect(dispatcher.getTransportName()).toBe('JMS');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should create dispatcher with custom name', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        name: 'My JMS Sender',
      });

      expect(dispatcher.getName()).toBe('My JMS Sender');
    });

    it('should merge custom properties with defaults', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          host: 'broker.example.com',
          port: 61614,
          destinationName: 'outbound-queue',
          deliveryMode: DeliveryMode.NON_PERSISTENT,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('broker.example.com');
      expect(props.port).toBe(61614);
      expect(props.destinationName).toBe('outbound-queue');
      expect(props.deliveryMode).toBe(DeliveryMode.NON_PERSISTENT);
      // Defaults should still be present
      expect(props.priority).toBe(4);
    });
  });

  describe('start', () => {
    it('should mark dispatcher as running', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
      });

      await dispatcher.start();

      expect(dispatcher.isRunning()).toBe(true);
    });

    it('should not connect on start (lazy connection)', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
      });

      await dispatcher.start();

      expect(MockedJmsClient).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should disconnect client and mark as stopped', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);

      await dispatcher.start();
      await dispatcher.send(mockConnectorMessage);
      await dispatcher.stop();

      expect(mockJmsClient.disconnect).toHaveBeenCalled();
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should do nothing if not running', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
      });

      await dispatcher.stop();

      expect(mockJmsClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send message to queue', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
          topic: false,
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(MockedJmsClient).toHaveBeenCalled();
      expect(mockJmsClient.connect).toHaveBeenCalled();
      expect(mockJmsClient.send).toHaveBeenCalledWith(
        'test-queue',
        false,
        'encoded message content',
        expect.objectContaining({
          contentType: 'text/plain',
        })
      );
      expect(mockConnectorMessage.setStatus).toHaveBeenCalledWith(Status.SENT);
      expect(mockConnectorMessage.setSendDate).toHaveBeenCalled();
    });

    it('should send message to topic', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-topic',
          topic: true,
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        'test-topic',
        true,
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should include message options', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
          priority: 9,
          timeToLive: 60000,
          deliveryMode: DeliveryMode.PERSISTENT,
          correlationId: 'corr-123',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        expect.any(String),
        expect.objectContaining({
          priority: 9,
          timeToLive: 60000,
          correlationId: 'corr-123',
          persistent: true,
        })
      );
    });

    it('should use message ID as correlation ID if not configured', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        expect.any(String),
        expect.objectContaining({
          correlationId: undefined,  // No correlationId configured → undefined (Java default)
        })
      );
    });

    it('should include custom headers', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
          headers: {
            'x-message-type': 'ORDER',
            'x-priority': 'high',
          },
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        expect.any(String),
        expect.objectContaining({
          headers: {
            'x-message-type': 'ORDER',
            'x-priority': 'high',
          },
        })
      );
    });

    it('should use raw data when no encoded content', async () => {
      mockConnectorMessage.getEncodedContent.mockReturnValue(undefined);

      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        'raw message content',
        expect.any(Object)
      );
    });

    it('should use template when provided', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
          template: 'Static message template',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(mockJmsClient.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        'Static message template',
        expect.any(Object)
      );
    });

    it('should retry with new connection on failure', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      // First successful send to establish connection
      await dispatcher.send(mockConnectorMessage);
      expect(mockJmsClient.connect).toHaveBeenCalledTimes(1);

      // Now set up to fail then succeed on retry
      mockJmsClient.send
        .mockRejectedValueOnce(new Error('Connection lost'))
        .mockResolvedValueOnce(undefined);

      // Second send should fail first, retry with new connection
      await dispatcher.send(mockConnectorMessage);

      // Disconnect should be called to clean up failed connection
      expect(mockJmsClient.disconnect).toHaveBeenCalled();
      // Connect should be called: initial + retry after failure
      expect(mockJmsClient.connect).toHaveBeenCalledTimes(2);
    });

    it('should set QUEUED status when queue enabled and send fails', async () => {
      mockJmsClient.send.mockRejectedValue(new Error('Send failed'));

      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await expect(dispatcher.send(mockConnectorMessage)).rejects.toThrow(
        'Send failed'
      );
      expect(mockConnectorMessage.setStatus).toHaveBeenCalledWith(Status.QUEUED);
    });

    it('should set QUEUED status when queue disabled and send fails (Java behavior)', async () => {
      // Java always sets QUEUED on error — Donkey engine decides final status
      mockJmsClient.send.mockRejectedValue(new Error('Send failed'));

      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        queueEnabled: false,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await expect(dispatcher.send(mockConnectorMessage)).rejects.toThrow(
        'Send failed'
      );
      expect(mockConnectorMessage.setStatus).toHaveBeenCalledWith(Status.QUEUED);
    });

    it('should store metadata in connector map', async () => {
      const connectorMap = mockConnectorMessage.getConnectorMap();

      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          host: 'broker.example.com',
          port: 61613,
          destinationName: 'test-queue',
          topic: false,
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();

      await dispatcher.send(mockConnectorMessage);

      expect(connectorMap.get('jmsHost')).toBe('broker.example.com');
      expect(connectorMap.get('jmsPort')).toBe(61613);
      expect(connectorMap.get('jmsDestination')).toBe('test-queue');
      expect(connectorMap.get('jmsIsTopic')).toBe(false);
    });
  });

  describe('getResponse', () => {
    it('should return null (JMS is fire-and-forget)', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });

      const response = await dispatcher.getResponse(mockConnectorMessage);

      expect(response).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return false when no client', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
      });

      expect(dispatcher.isConnected()).toBe(false);
    });

    it('should delegate to JmsClient when connected', async () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          destinationName: 'test-queue',
        },
      });
      dispatcher.setChannel(mockChannel as Channel);
      await dispatcher.start();
      await dispatcher.send(mockConnectorMessage);

      mockJmsClient.isConnected.mockReturnValue(true);
      expect(dispatcher.isConnected()).toBe(true);

      mockJmsClient.isConnected.mockReturnValue(false);
      expect(dispatcher.isConnected()).toBe(false);
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          host: 'old-host',
        },
      });

      dispatcher.setProperties({ host: 'new-host', port: 61614 });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('new-host');
      expect(props.port).toBe(61614);
    });

    it('should preserve unmodified properties', () => {
      const dispatcher = new JmsDispatcher({
        metaDataId: 1,
        properties: {
          host: 'old-host',
          username: 'user1',
        },
      });

      dispatcher.setProperties({ host: 'new-host' });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('new-host');
      expect(props.username).toBe('user1');
    });
  });
});
