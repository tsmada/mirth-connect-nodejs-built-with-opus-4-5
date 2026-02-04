/**
 * Unit tests for JMS Receiver
 */

import { JmsReceiver } from '../../../../src/connectors/jms/JmsReceiver.js';
import { JmsClient } from '../../../../src/connectors/jms/JmsClient.js';
import { AcknowledgeMode } from '../../../../src/connectors/jms/JmsConnectorProperties.js';
import { Channel } from '../../../../src/donkey/channel/Channel.js';

// Mock JmsClient
jest.mock('../../../../src/connectors/jms/JmsClient.js');

const MockedJmsClient = JmsClient as jest.MockedClass<typeof JmsClient>;

describe('JmsReceiver', () => {
  let mockJmsClient: jest.Mocked<JmsClient>;
  let mockChannel: Partial<Channel>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock JmsClient instance
    mockJmsClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue('sub-123'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      emit: jest.fn(),
      getClientId: jest.fn().mockReturnValue('test-client-id'),
    } as unknown as jest.Mocked<JmsClient>;

    // Mock static getClient method
    MockedJmsClient.getClient = jest.fn().mockReturnValue(mockJmsClient);

    // Create mock channel
    mockChannel = {
      getId: jest.fn().mockReturnValue('channel-123'),
      getName: jest.fn().mockReturnValue('Test Channel'),
      dispatchRawMessage: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('constructor', () => {
    it('should create receiver with default properties', () => {
      const receiver = new JmsReceiver({});

      expect(receiver.getName()).toBe('JMS Listener');
      expect(receiver.getTransportName()).toBe('JMS');
      expect(receiver.isRunning()).toBe(false);
    });

    it('should create receiver with custom name', () => {
      const receiver = new JmsReceiver({
        name: 'My JMS Receiver',
      });

      expect(receiver.getName()).toBe('My JMS Receiver');
    });

    it('should merge custom properties with defaults', () => {
      const receiver = new JmsReceiver({
        properties: {
          host: 'broker.example.com',
          port: 61614,
          destinationName: 'my-queue',
        },
      });

      const props = receiver.getProperties();
      expect(props.host).toBe('broker.example.com');
      expect(props.port).toBe(61614);
      expect(props.destinationName).toBe('my-queue');
      // Defaults should still be present
      expect(props.acknowledgeMode).toBe(AcknowledgeMode.CLIENT);
    });
  });

  describe('start', () => {
    it('should connect and subscribe to queue', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
          topic: false,
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      expect(MockedJmsClient.getClient).toHaveBeenCalled();
      expect(mockJmsClient.connect).toHaveBeenCalled();
      expect(mockJmsClient.subscribe).toHaveBeenCalledWith(
        'test-queue',
        false,
        expect.any(Function),
        expect.objectContaining({
          acknowledgeMode: AcknowledgeMode.CLIENT,
        })
      );
      expect(receiver.isRunning()).toBe(true);
    });

    it('should connect and subscribe to topic', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-topic',
          topic: true,
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      expect(mockJmsClient.subscribe).toHaveBeenCalledWith(
        'test-topic',
        true,
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('should pass selector to subscription', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
          selector: "priority = 'high'",
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      expect(mockJmsClient.subscribe).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Boolean),
        expect.any(Function),
        expect.objectContaining({
          selector: "priority = 'high'",
        })
      );
    });

    it('should pass durable subscription options for topics', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-topic',
          topic: true,
          durableTopic: true,
          subscriptionName: 'my-durable-sub',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      expect(mockJmsClient.subscribe).toHaveBeenCalledWith(
        expect.any(String),
        true,
        expect.any(Function),
        expect.objectContaining({
          durableSubscription: true,
          subscriptionName: 'my-durable-sub',
        })
      );
    });

    it('should throw if already running', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      await expect(receiver.start()).rejects.toThrow(
        'JMS Receiver is already running'
      );
    });

    it('should clean up on connection failure', async () => {
      mockJmsClient.connect.mockRejectedValueOnce(
        new Error('Connection refused')
      );

      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await expect(receiver.start()).rejects.toThrow('Connection refused');
      expect(receiver.isRunning()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should unsubscribe and disconnect', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();
      await receiver.stop();

      expect(mockJmsClient.unsubscribe).toHaveBeenCalledWith('sub-123');
      expect(mockJmsClient.disconnect).toHaveBeenCalled();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should do nothing if not running', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });

      await receiver.stop();

      expect(mockJmsClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return false when not started', () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });

      expect(receiver.isConnected()).toBe(false);
    });

    it('should delegate to JmsClient when started', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      mockJmsClient.isConnected.mockReturnValue(true);
      expect(receiver.isConnected()).toBe(true);

      mockJmsClient.isConnected.mockReturnValue(false);
      expect(receiver.isConnected()).toBe(false);
    });
  });

  describe('getSubscriptionId', () => {
    it('should return null when not subscribed', () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });

      expect(receiver.getSubscriptionId()).toBeNull();
    });

    it('should return subscription ID when subscribed', async () => {
      const receiver = new JmsReceiver({
        properties: {
          destinationName: 'test-queue',
        },
      });
      receiver.setChannel(mockChannel as Channel);

      await receiver.start();

      expect(receiver.getSubscriptionId()).toBe('sub-123');
    });
  });

  describe('setProperties', () => {
    it('should update properties', () => {
      const receiver = new JmsReceiver({
        properties: {
          host: 'old-host',
        },
      });

      receiver.setProperties({ host: 'new-host', port: 61614 });

      const props = receiver.getProperties();
      expect(props.host).toBe('new-host');
      expect(props.port).toBe(61614);
    });

    it('should preserve unmodified properties', () => {
      const receiver = new JmsReceiver({
        properties: {
          host: 'old-host',
          username: 'user1',
        },
      });

      receiver.setProperties({ host: 'new-host' });

      const props = receiver.getProperties();
      expect(props.host).toBe('new-host');
      expect(props.username).toBe('user1');
    });
  });
});
