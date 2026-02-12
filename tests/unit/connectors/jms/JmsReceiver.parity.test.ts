/**
 * JmsReceiver Event Dispatch Parity Tests (Wave 17)
 *
 * Verifies that JmsReceiver dispatches connection status events
 * matching Java JmsReceiver.java lifecycle:
 *   - onDeploy(): IDLE
 *   - onStart(): CONNECTED
 *   - onMessage(): RECEIVING -> IDLE (in finally)
 *   - onStop(): DISCONNECTED
 */

import { JmsReceiver } from '../../../../src/connectors/jms/JmsReceiver';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';

// Mock the DashboardStatusController to capture events
const mockProcessEvent = jest.fn();
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
  },
}));

// Mock JmsClient to avoid real broker connections
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockSubscribe = jest.fn().mockResolvedValue('sub-123');
const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);
const mockIsConnected = jest.fn().mockReturnValue(true);
const mockOn = jest.fn();

jest.mock('../../../../src/connectors/jms/JmsClient', () => ({
  JmsClient: {
    getClient: jest.fn().mockReturnValue({
      connect: () => mockConnect(),
      disconnect: () => mockDisconnect(),
      subscribe: (...args: unknown[]) => mockSubscribe(...args),
      unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
      isConnected: () => mockIsConnected(),
      on: (...args: unknown[]) => mockOn(...args),
    }),
  },
}));

describe('JmsReceiver Event Dispatch Parity', () => {
  let receiver: JmsReceiver;

  beforeEach(() => {
    mockProcessEvent.mockClear();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSubscribe.mockClear();
    mockUnsubscribe.mockClear();
    mockOn.mockClear();
  });

  afterEach(async () => {
    if (receiver?.isRunning()) {
      await receiver.stop();
    }
  });

  it('should dispatch IDLE on deploy', () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    receiver.onDeploy();

    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.IDLE,
        channelId: 'test-channel-id',
      })
    );
  });

  it('should dispatch CONNECTED after successful start', async () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.CONNECTED);
  });

  it('should dispatch DISCONNECTED on stop', async () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    await receiver.stop();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.DISCONNECTED);
  });

  it('should dispatch RECEIVING when message arrives', async () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
      emit: jest.fn(),
    };

    // Capture the message handler from the subscribe call
    let messageHandler: ((msg: any) => Promise<void>) | undefined;
    mockSubscribe.mockImplementation((_dest: any, _topic: any, handler: any) => {
      messageHandler = handler;
      return Promise.resolve('sub-123');
    });

    // Mock dispatchRawMessage to prevent actual message processing
    (receiver as any).dispatchRawMessage = jest.fn().mockResolvedValue(undefined);

    await receiver.start();
    mockProcessEvent.mockClear();

    // Simulate message arrival
    expect(messageHandler).toBeDefined();
    await messageHandler!({
      messageId: 'msg-1',
      destination: 'test.queue',
      timestamp: Date.now(),
      correlationId: null,
      replyTo: null,
      contentType: 'text/plain',
      headers: {},
      body: 'test message',
      isBinary: false,
      ack: jest.fn(),
      nack: jest.fn(),
    });

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events[0]).toBe(ConnectionStatusEventType.RECEIVING);
  });

  it('should dispatch IDLE after message processing completes (finally)', async () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
      emit: jest.fn(),
    };

    let messageHandler: ((msg: any) => Promise<void>) | undefined;
    mockSubscribe.mockImplementation((_dest: any, _topic: any, handler: any) => {
      messageHandler = handler;
      return Promise.resolve('sub-123');
    });

    (receiver as any).dispatchRawMessage = jest.fn().mockResolvedValue(undefined);

    await receiver.start();
    mockProcessEvent.mockClear();

    await messageHandler!({
      messageId: 'msg-1',
      destination: 'test.queue',
      timestamp: Date.now(),
      correlationId: null,
      replyTo: null,
      contentType: 'text/plain',
      headers: {},
      body: 'test message',
      isBinary: false,
      ack: jest.fn(),
      nack: jest.fn(),
    });

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    // Last event should be IDLE (from finally block)
    expect(events[events.length - 1]).toBe(ConnectionStatusEventType.IDLE);
  });

  it('should follow RECEIVING -> IDLE lifecycle for message handling', async () => {
    receiver = new JmsReceiver({
      name: 'Test JMS Receiver',
      properties: {
        destinationName: 'test.queue',
        topic: false,
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
      emit: jest.fn(),
    };

    let messageHandler: ((msg: any) => Promise<void>) | undefined;
    mockSubscribe.mockImplementation((_dest: any, _topic: any, handler: any) => {
      messageHandler = handler;
      return Promise.resolve('sub-123');
    });

    (receiver as any).dispatchRawMessage = jest.fn().mockResolvedValue(undefined);

    await receiver.start();
    mockProcessEvent.mockClear();

    await messageHandler!({
      messageId: 'msg-1',
      destination: 'test.queue',
      timestamp: Date.now(),
      correlationId: null,
      replyTo: null,
      contentType: 'text/plain',
      headers: {},
      body: 'test message',
      isBinary: false,
      ack: jest.fn(),
      nack: jest.fn(),
    });

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toEqual([ConnectionStatusEventType.RECEIVING, ConnectionStatusEventType.IDLE]);
  });
});
