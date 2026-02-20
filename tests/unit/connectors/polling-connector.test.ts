/**
 * Tests for polling connector identification and JMS durable subscription naming.
 *
 * Covers:
 * - FileReceiver.isPollingConnector() returns true
 * - DatabaseReceiver.isPollingConnector() returns true
 * - Non-polling connectors return false (inherited default)
 * - JmsReceiver uses unique durable subscription name with server ID
 */

// ── Mocks ────────────────────────────────────────────────────────────

// Mock database pool for DatabaseReceiver
jest.mock('../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
  transaction: jest.fn(),
}));

// Mock ClusterIdentity for JMS test
jest.mock('../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: () => 'node-instance-42',
}));

// Mock ClusterConfig
jest.mock('../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: () => ({
    serverId: 'node-instance-42',
    clusterEnabled: false,
    pollingMode: 'all',
    leaseTtl: 30000,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    sequenceBlockSize: 100,
  }),
}));

// Mock JmsClient for JmsReceiver
const mockSubscribe = jest.fn().mockResolvedValue('sub-123');
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();
const mockIsConnected = jest.fn().mockReturnValue(true);

jest.mock('../../../src/connectors/jms/JmsClient.js', () => ({
  JmsClient: {
    getClient: jest.fn().mockImplementation(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      on: mockOn,
      isConnected: mockIsConnected,
    })),
  },
}));

// Mock DashboardStatusController
jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController.js', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
    setServerId: jest.fn(),
  },
}));

// ── Imports ──────────────────────────────────────────────────────────

import { FileReceiver } from '../../../src/connectors/file/FileReceiver';
import { DatabaseReceiver } from '../../../src/connectors/jdbc/DatabaseReceiver';
import { JmsReceiver } from '../../../src/connectors/jms/JmsReceiver';
import { SourceConnector } from '../../../src/donkey/channel/SourceConnector';

// Non-polling connectors to verify default behavior
class TestHttpReceiver extends SourceConnector {
  constructor() {
    super({ name: 'HTTP Listener', transportName: 'HTTP' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

class TestTcpReceiver extends SourceConnector {
  constructor() {
    super({ name: 'TCP Listener', transportName: 'TCP' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Polling connector identification', () => {
  it('FileReceiver.isPollingConnector() returns true', () => {
    const receiver = new FileReceiver({
      properties: { directory: '/tmp/test' },
    });
    expect(receiver.isPollingConnector()).toBe(true);
  });

  it('DatabaseReceiver.isPollingConnector() returns true', () => {
    const receiver = new DatabaseReceiver({
      properties: {
        url: 'jdbc:mysql://localhost:3306/test',
        select: 'SELECT * FROM test',
      },
    });
    expect(receiver.isPollingConnector()).toBe(true);
  });

  it('HTTP receiver (base class default) returns false', () => {
    const receiver = new TestHttpReceiver();
    expect(receiver.isPollingConnector()).toBe(false);
  });

  it('TCP receiver (base class default) returns false', () => {
    const receiver = new TestTcpReceiver();
    expect(receiver.isPollingConnector()).toBe(false);
  });
});

describe('JMS durable subscription unique naming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('appends server ID to durable subscription name', async () => {
    const receiver = new JmsReceiver({
      properties: {
        destinationName: 'test.queue',
        topic: true,
        durableTopic: true,
        subscriptionName: 'my-sub',
      },
    });

    // Simulate onDeploy + start
    await receiver.onDeploy();
    await receiver.start();

    // Verify subscribe was called with the modified subscription name
    expect(mockSubscribe).toHaveBeenCalledWith(
      'test.queue',
      true,
      expect.any(Function),
      expect.objectContaining({
        subscriptionName: 'my-sub-node-instance-42',
        durableSubscription: true,
      })
    );
  });

  it('does not modify subscription name for non-durable topics', async () => {
    const receiver = new JmsReceiver({
      properties: {
        destinationName: 'test.queue',
        topic: true,
        durableTopic: false,
        subscriptionName: 'my-sub',
      },
    });

    await receiver.onDeploy();
    await receiver.start();

    // subscriptionName should remain unchanged
    expect(mockSubscribe).toHaveBeenCalledWith(
      'test.queue',
      true,
      expect.any(Function),
      expect.objectContaining({
        subscriptionName: 'my-sub',
        durableSubscription: false,
      })
    );
  });
});
