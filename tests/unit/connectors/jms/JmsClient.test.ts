/**
 * Unit tests for JMS Client
 */

import {
  JmsClient,
} from '../../../../src/connectors/jms/JmsClient.js';
import {
  JmsConnectionProperties,
  getDefaultJmsReceiverProperties,
} from '../../../../src/connectors/jms/JmsConnectorProperties.js';

// Mock stompit module
jest.mock('stompit', () => {
  const mockClient = {
    on: jest.fn(),
    subscribe: jest.fn(),
    send: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
    disconnect: jest.fn((cb: () => void) => cb()),
  };

  return {
    connect: jest.fn((_options: unknown, callback: (error: Error | null, client: unknown) => void) => {
      callback(null, mockClient);
    }),
    __mockClient: mockClient,
  };
});

// Get reference to mocked stompit
const stompit = jest.requireMock('stompit');

describe('JmsClient', () => {
  let connectionProps: JmsConnectionProperties;

  beforeEach(() => {
    jest.clearAllMocks();

    connectionProps = {
      ...getDefaultJmsReceiverProperties(),
      host: 'localhost',
      port: 61613,
      username: 'admin',
      password: 'admin',
      destinationName: 'test-queue',
    };
  });

  describe('buildConnectionKey', () => {
    it('should build unique key from connection properties', () => {
      const key = JmsClient.buildConnectionKey(connectionProps);

      expect(key).toContain('false'); // useJndi
      expect(key).toContain('localhost');
      expect(key).toContain('61613');
      expect(key).toContain('admin');
    });

    it('should include JNDI properties when useJndi is true', () => {
      connectionProps.useJndi = true;
      connectionProps.jndiProviderUrl = 'tcp://localhost:61616';
      connectionProps.jndiInitialContextFactory =
        'org.apache.activemq.jndi.ActiveMQInitialContextFactory';
      connectionProps.jndiConnectionFactoryName = 'ConnectionFactory';

      const key = JmsClient.buildConnectionKey(connectionProps);

      expect(key).toContain('true');
      expect(key).toContain('tcp://localhost:61616');
      expect(key).toContain('ActiveMQInitialContextFactory');
    });

    it('should include connection properties in key', () => {
      connectionProps.connectionProperties = {
        brokerURL: 'failover://tcp://host1:61616,tcp://host2:61616',
      };

      const key = JmsClient.buildConnectionKey(connectionProps);
      expect(key).toContain('failover://tcp://host1:61616,tcp://host2:61616');
    });
  });

  describe('connect', () => {
    it('should connect to STOMP broker', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await client.connect();

      expect(stompit.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 61613,
        }),
        expect.any(Function)
      );

      expect(client.isConnected()).toBe(true);

      await client.disconnect();
    });

    it('should include credentials in connect headers', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await client.connect();

      expect(stompit.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          connectHeaders: expect.objectContaining({
            login: 'admin',
            passcode: 'admin',
          }),
        }),
        expect.any(Function)
      );

      await client.disconnect();
    });

    it('should use configured client ID', async () => {
      connectionProps.clientId = 'my-client-id';
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      // Client ID should be stored in the client instance
      expect(client.getClientId()).toBe('my-client-id');
    });

    it('should emit connected event', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      const connectedHandler = jest.fn();
      client.on('connected', connectedHandler);

      await client.connect();

      expect(connectedHandler).toHaveBeenCalled();

      await client.disconnect();
    });

    it('should not reconnect if already connected', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await client.connect();
      await client.connect(); // Second call should be no-op

      expect(stompit.connect).toHaveBeenCalledTimes(1);

      await client.disconnect();
    });

    it('should handle connection error', async () => {
      const connectionError = new Error('Connection refused');
      stompit.connect.mockImplementationOnce(
        (_opts: unknown, cb: (err: Error) => void) => cb(connectionError)
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      const errorHandler = jest.fn();
      client.on('error', errorHandler);

      await expect(client.connect()).rejects.toThrow('Connection refused');
      expect(errorHandler).toHaveBeenCalledWith(connectionError);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from broker', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await client.connect();
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(stompit.__mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      // Should not throw
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should subscribe to queue', async () => {
      const mockSubscription = {
        unsubscribe: jest.fn(),
      };
      stompit.__mockClient.subscribe.mockImplementation(
        (_headers: unknown, _callback: (err: Error | null, msg: unknown) => void) => {
          return mockSubscription;
        }
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      const listener = jest.fn();
      const subId = await client.subscribe('my-queue', false, listener);

      expect(subId).toBeDefined();
      expect(stompit.__mockClient.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '/queue/my-queue',
          ack: 'client',
        }),
        expect.any(Function)
      );

      await client.disconnect();
    });

    it('should subscribe to topic', async () => {
      const mockSubscription = {
        unsubscribe: jest.fn(),
      };
      stompit.__mockClient.subscribe.mockImplementation(
        (_headers: unknown, _callback: (err: Error | null, msg: unknown) => void) => {
          return mockSubscription;
        }
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      const listener = jest.fn();
      await client.subscribe('my-topic', true, listener);

      expect(stompit.__mockClient.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '/topic/my-topic',
        }),
        expect.any(Function)
      );

      await client.disconnect();
    });

    it('should include selector in subscription headers', async () => {
      const mockSubscription = {
        unsubscribe: jest.fn(),
      };
      stompit.__mockClient.subscribe.mockImplementation(
        (_headers: unknown, _callback: (err: Error | null, msg: unknown) => void) => {
          return mockSubscription;
        }
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      const listener = jest.fn();
      await client.subscribe('my-queue', false, listener, {
        selector: "type = 'urgent'",
      });

      expect(stompit.__mockClient.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: "type = 'urgent'",
        }),
        expect.any(Function)
      );

      await client.disconnect();
    });

    it('should include durable subscription headers for topics', async () => {
      const mockSubscription = {
        unsubscribe: jest.fn(),
      };
      stompit.__mockClient.subscribe.mockImplementation(
        (_headers: unknown, _callback: (err: Error | null, msg: unknown) => void) => {
          return mockSubscription;
        }
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      const listener = jest.fn();
      await client.subscribe('my-topic', true, listener, {
        durableSubscription: true,
        subscriptionName: 'my-durable-sub',
      });

      expect(stompit.__mockClient.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          'activemq.subscriptionName': 'my-durable-sub',
          durable: 'true',
        }),
        expect.any(Function)
      );

      await client.disconnect();
    });

    it('should throw if not connected', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await expect(
        client.subscribe('my-queue', false, jest.fn())
      ).rejects.toThrow('Not connected to JMS broker');
    });
  });

  describe('send', () => {
    let mockFrame: {
      on: jest.Mock;
      write: jest.Mock;
      end: jest.Mock;
    };

    beforeEach(() => {
      mockFrame = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      stompit.__mockClient.send.mockReturnValue(mockFrame);
    });

    it('should send message to queue', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      await client.send('my-queue', false, 'Hello, World!');

      expect(stompit.__mockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '/queue/my-queue',
          'content-type': 'text/plain',
        })
      );
      expect(mockFrame.write).toHaveBeenCalledWith('Hello, World!');
      expect(mockFrame.end).toHaveBeenCalled();

      await client.disconnect();
    });

    it('should send message to topic', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      await client.send('my-topic', true, 'Hello, Topic!');

      expect(stompit.__mockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: '/topic/my-topic',
        })
      );

      await client.disconnect();
    });

    it('should include optional headers', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      await client.send('my-queue', false, 'Hello!', {
        correlationId: 'corr-123',
        replyTo: 'reply-queue',
        priority: 9,
        persistent: true,
      });

      expect(stompit.__mockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          'correlation-id': 'corr-123',
          'reply-to': 'reply-queue',
          priority: '9',
          persistent: 'true',
        })
      );

      await client.disconnect();
    });

    it('should include custom headers', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      await client.send('my-queue', false, 'Hello!', {
        headers: {
          'x-custom-header': 'custom-value',
          messageType: 'ORDER',
        },
      });

      expect(stompit.__mockClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          'x-custom-header': 'custom-value',
          messageType: 'ORDER',
        })
      );

      await client.disconnect();
    });

    it('should throw if not connected', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      await expect(client.send('my-queue', false, 'Hello!')).rejects.toThrow(
        'Not connected to JMS broker'
      );
    });
  });

  describe('getClientId', () => {
    it('should return configured client ID', () => {
      connectionProps.clientId = 'my-custom-client-id';
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');

      expect(client.getClientId()).toBe('my-custom-client-id');
    });

    it('should generate client ID if not configured', () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      const clientId = client.getClientId();

      expect(clientId).toContain('mirth-');
      expect(clientId).toContain('TestConnector');
    });
  });

  describe('getSubscriptionCount', () => {
    it('should return 0 when no subscriptions', async () => {
      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      expect(client.getSubscriptionCount()).toBe(0);

      await client.disconnect();
    });

    it('should return correct subscription count', async () => {
      const mockSubscription = {
        unsubscribe: jest.fn(),
      };
      stompit.__mockClient.subscribe.mockImplementation(
        (_headers: unknown, _callback: (err: Error | null, msg: unknown) => void) => {
          return mockSubscription;
        }
      );

      const client = new JmsClient(connectionProps, 'channel-1', 'TestConnector');
      await client.connect();

      await client.subscribe('queue-1', false, jest.fn());
      await client.subscribe('queue-2', false, jest.fn());

      expect(client.getSubscriptionCount()).toBe(2);

      await client.disconnect();
    });
  });
});
