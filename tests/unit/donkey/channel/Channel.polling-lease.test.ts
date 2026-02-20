/**
 * Tests for polling lease coordination in Channel.
 *
 * Covers:
 * - shouldStartPollingSource() logic (non-polling, takeover guard, cluster lease)
 * - start() behavior with and without polling source connectors
 * - stop() lease release and timer cleanup
 * - Lease retry timer acquiring lease and starting source connector
 * - Channel state reaching STARTED even when polling source is on standby
 */

// ── Mocks must be declared before imports ────────────────────────────

const mockPoolConnection = {} as any;
jest.mock('../../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (callback: Function) => {
    return callback(mockPoolConnection);
  }),
  getPool: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../../src/donkey/channel/RecoveryTask.js', () => ({
  runRecoveryTask: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockResolvedValue(1),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(0),
  pruneMessageAttachments: jest.fn().mockResolvedValue(0),
  deleteMessageContentByMetaDataIds: jest.fn().mockResolvedValue(0),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

// Mock PollingLeaseManager
const mockAcquireLease = jest.fn();
const mockStartLeaseRenewal = jest.fn();
const mockReleaseLease = jest.fn();
const mockStopLeaseRenewal = jest.fn();
const mockReleaseAllLeases = jest.fn();
const mockStopAllLeaseRenewals = jest.fn();

jest.mock('../../../../src/cluster/PollingLeaseManager.js', () => ({
  acquireLease: (...args: any[]) => mockAcquireLease(...args),
  startLeaseRenewal: (...args: any[]) => mockStartLeaseRenewal(...args),
  releaseLease: (...args: any[]) => mockReleaseLease(...args),
  stopLeaseRenewal: (...args: any[]) => mockStopLeaseRenewal(...args),
  releaseAllLeases: (...args: any[]) => mockReleaseAllLeases(...args),
  stopAllLeaseRenewals: (...args: any[]) => mockStopAllLeaseRenewals(...args),
}));

// Mock TakeoverPollingGuard
const mockIsPollingAllowedInTakeover = jest.fn().mockReturnValue(true);

jest.mock('../../../../src/cluster/TakeoverPollingGuard.js', () => ({
  isPollingAllowedInTakeover: (...args: any[]) => mockIsPollingAllowedInTakeover(...args),
  initTakeoverPollingGuard: jest.fn(),
}));

// Mock ClusterConfig — provide a mutable config reference
let mockClusterConfig = {
  serverId: 'test-server-1',
  clusterEnabled: false,
  pollingMode: 'all' as 'exclusive' | 'all',
  leaseTtl: 30000,
  heartbeatInterval: 10000,
  heartbeatTimeout: 30000,
  sequenceBlockSize: 100,
};

jest.mock('../../../../src/cluster/ClusterConfig.js', () => ({
  getClusterConfig: () => mockClusterConfig,
}));

jest.mock('../../../../src/cluster/ClusterIdentity.js', () => ({
  getServerId: () => 'test-server-1',
}));

jest.mock('../../../../src/cluster/SequenceAllocator.js', () => ({
  SequenceAllocator: jest.fn().mockImplementation(() => ({
    allocateId: jest.fn().mockResolvedValue(1),
  })),
}));

// ── Imports ──────────────────────────────────────────────────────────

import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { DeployedState } from '../../../../src/api/models/DashboardStatus';

// ── Test helpers ─────────────────────────────────────────────────────

class TestSourceConnector extends SourceConnector {
  public started = false;

  constructor(private polling = false) {
    super({ name: 'Test Source', transportName: 'TEST' });
  }

  override isPollingConnector(): boolean {
    return this.polling;
  }

  async start(): Promise<void> {
    this.running = true;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.started = false;
  }
}

class TestDestinationConnector extends DestinationConnector {
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
  async send(): Promise<void> {}
  async getResponse(): Promise<string | null> { return null; }
}

function createTestChannel(config?: Partial<ChannelConfig>): Channel {
  return new Channel({
    id: 'ch-001',
    name: 'Test Channel',
    enabled: true,
    ...config,
  });
}

function createDestination(name = 'Dest 1'): TestDestinationConnector {
  return new TestDestinationConnector({ name, transportName: 'TEST', metaDataId: 1 });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Channel polling lease coordination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockClusterConfig = {
      serverId: 'test-server-1',
      clusterEnabled: false,
      pollingMode: 'all',
      leaseTtl: 30000,
      heartbeatInterval: 10000,
      heartbeatTimeout: 30000,
      sequenceBlockSize: 100,
    };
    mockIsPollingAllowedInTakeover.mockReturnValue(true);
    mockAcquireLease.mockResolvedValue(true);
    mockReleaseLease.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('shouldStartPollingSource (via start())', () => {
    it('returns true for non-polling connectors (HTTP, TCP, VM)', async () => {
      const channel = createTestChannel();
      const source = new TestSourceConnector(false); // not polling
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(true);
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it('returns true for polling connector when cluster not enabled', async () => {
      const channel = createTestChannel();
      const source = new TestSourceConnector(true); // polling
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(true);
      // Not in cluster mode, so no lease logic invoked
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it('returns true when pollingMode is "all"', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'all';

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(true);
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it('acquires lease and starts when pollingMode is "exclusive"', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(true);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(mockAcquireLease).toHaveBeenCalledWith('ch-001', 'test-server-1', 30000);
      expect(mockStartLeaseRenewal).toHaveBeenCalledWith('ch-001', 'test-server-1', 30000);
      expect(source.started).toBe(true);
    });

    it('does not start source when lease is held by another instance', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(false);
      expect(mockStartLeaseRenewal).not.toHaveBeenCalled();
    });
  });

  describe('Takeover guard', () => {
    it('blocks polling when in takeover mode and channel not enabled', async () => {
      mockIsPollingAllowedInTakeover.mockReturnValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(false);
      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it('allows polling when in takeover mode and channel IS enabled', async () => {
      mockIsPollingAllowedInTakeover.mockReturnValue(true);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();

      expect(source.started).toBe(true);
    });
  });

  describe('Channel state', () => {
    it('reaches STARTED even when polling source is on standby', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);

      const dest = createDestination();
      channel.addDestinationConnector(dest);

      await channel.start();

      // Channel is STARTED even though source connector is not running
      expect(channel.getCurrentState()).toBe(DeployedState.STARTED);
      expect(source.started).toBe(false);
    });

    it('destinations are started even when source is on standby', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);

      const dest = createDestination();
      jest.spyOn(dest, 'start');
      channel.addDestinationConnector(dest);

      await channel.start();

      expect(dest.start).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('releases lease and stops renewal when lease is held', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(true);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();
      expect(source.started).toBe(true);

      await channel.stop();

      expect(mockStopLeaseRenewal).toHaveBeenCalledWith('ch-001');
      expect(mockReleaseLease).toHaveBeenCalledWith('ch-001', 'test-server-1');
    });

    it('clears retry timer on stop', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockAcquireLease.mockResolvedValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();
      // At this point a lease retry timer was started

      // Clear the timer by stopping
      await channel.stop();

      // Verify: advance timers — should not call acquireLease again
      mockAcquireLease.mockClear();
      jest.advanceTimersByTime(60000);

      // Allow any pending microtasks
      await Promise.resolve();

      expect(mockAcquireLease).not.toHaveBeenCalled();
    });

    it('does not call releaseLease when no lease was held', async () => {
      const channel = createTestChannel();
      const source = new TestSourceConnector(false); // non-polling
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();
      await channel.stop();

      expect(mockReleaseLease).not.toHaveBeenCalled();
    });
  });

  describe('Lease retry timer', () => {
    it('acquires lease on retry and starts source connector', async () => {
      mockClusterConfig.clusterEnabled = true;
      mockClusterConfig.pollingMode = 'exclusive';
      mockClusterConfig.leaseTtl = 5000;
      mockAcquireLease.mockResolvedValue(false);

      const channel = createTestChannel();
      const source = new TestSourceConnector(true);
      channel.setSourceConnector(source);
      channel.addDestinationConnector(createDestination());

      await channel.start();
      expect(source.started).toBe(false);

      // Now the lease becomes available
      mockAcquireLease.mockResolvedValue(true);

      // Advance past the retry interval (leaseTtl = 5000)
      jest.advanceTimersByTime(5000);

      // Allow async callback to execute
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(source.started).toBe(true);
      expect(mockStartLeaseRenewal).toHaveBeenCalledWith('ch-001', 'test-server-1', 5000);
    });
  });
});
