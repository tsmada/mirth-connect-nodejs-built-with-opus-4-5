/**
 * Tests for "implemented but not wired" bug fixes in EngineController.
 *
 * Bug 1 (SBF-DUAL-001): undeployChannel() must call donkey.undeployChannel()
 * Bug 2 (SBF-REG-002): deploy/undeploy must call ChannelRegistry register/unregister
 * Bug 3 (SBF-REG-001): ChannelUtil singletons must be wired at startup (tested via Mirth.ts)
 *
 * These tests verify the wiring between EngineController and:
 * - Donkey engine (channel lifecycle)
 * - ChannelRegistry (cluster deployment tracking)
 */

import { DeployedState } from '../../../src/api/models/DashboardStatus';

// --- Mocks ---

// Track calls to Channel methods
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockLoadStatisticsFromDb = jest.fn().mockResolvedValue(undefined);
const mockGetCurrentState = jest.fn().mockReturnValue(DeployedState.STOPPED);
const mockUpdateCurrentState = jest.fn();
const mockGetId = jest.fn().mockReturnValue('test-channel-id');
const mockGetName = jest.fn().mockReturnValue('Test Channel');
const mockGetSourceConnector = jest.fn().mockReturnValue(null);
const mockGetDestinationConnectors = jest.fn().mockReturnValue([]);
const mockGetStatistics = jest.fn().mockReturnValue({
  received: 0, sent: 0, error: 0, filtered: 0, queued: 0,
});
const mockOn = jest.fn();

jest.mock('../../../src/donkey/channel/Channel', () => ({
  Channel: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    loadStatisticsFromDb: mockLoadStatisticsFromDb,
    getCurrentState: mockGetCurrentState,
    updateCurrentState: mockUpdateCurrentState,
    getId: mockGetId,
    getName: mockGetName,
    getSourceConnector: mockGetSourceConnector,
    getDestinationConnectors: mockGetDestinationConnectors,
    getStatistics: mockGetStatistics,
    on: mockOn,
    setExecutor: jest.fn(),
  })),
}));

// Mock ChannelBuilder
jest.mock('../../../src/donkey/channel/ChannelBuilder', () => ({
  buildChannel: jest.fn().mockImplementation(() => {
    const { Channel } = require('../../../src/donkey/channel/Channel');
    return new Channel();
  }),
}));

// Mock ChannelController
jest.mock('../../../src/controllers/ChannelController', () => ({
  ChannelController: {
    getChannel: jest.fn().mockResolvedValue({
      id: 'test-channel-id',
      name: 'Test Channel',
      enabled: true,
      revision: 1,
      properties: { initialState: 'STARTED' },
    }),
    getAllChannels: jest.fn().mockResolvedValue([]),
  },
}));

// Mock SchemaManager
jest.mock('../../../src/db/SchemaManager', () => ({
  ensureChannelTables: jest.fn().mockResolvedValue(undefined),
}));

// Mock Donkey instance — injected via setDonkeyInstance after import
const mockDonkeyDeployChannel = jest.fn().mockResolvedValue(undefined);
const mockDonkeyUndeployChannel = jest.fn().mockResolvedValue(undefined);
const mockDonkeyGetChannel = jest.fn();

// Mock ShadowMode
jest.mock('../../../src/cluster/ShadowMode', () => ({
  isShadowMode: jest.fn().mockReturnValue(false),
  isChannelActive: jest.fn().mockReturnValue(true),
  isChannelPromoted: jest.fn().mockReturnValue(false),
}));

// Mock DashboardStatusController
jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
    resetChannelState: jest.fn(),
  },
}));

// Mock CodeTemplateController
jest.mock('../../../src/plugins/codetemplates/CodeTemplateController', () => ({
  getAllCodeTemplateScriptsForChannel: jest.fn().mockResolvedValue([]),
}));

// Mock JavaScriptExecutor
jest.mock('../../../src/javascript/runtime/JavaScriptExecutor', () => ({
  createJavaScriptExecutor: jest.fn(),
  getDefaultExecutor: jest.fn().mockReturnValue({}),
  initializeExecutor: jest.fn(),
}));

// Mock ChannelRegistry
const mockRegisterDeployment = jest.fn().mockResolvedValue(undefined);
const mockUnregisterDeployment = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../src/cluster/ChannelRegistry', () => ({
  registerDeployment: (...args: unknown[]) => mockRegisterDeployment(...args),
  unregisterDeployment: (...args: unknown[]) => mockUnregisterDeployment(...args),
}));

// Mock ClusterIdentity
jest.mock('../../../src/cluster/ClusterIdentity', () => ({
  getServerId: jest.fn().mockReturnValue('test-server-id'),
}));

// Mock logging
jest.mock('../../../src/logging/index', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: jest.fn(),
}));

// Import AFTER mocks are set up
import { EngineController, setDonkeyInstance } from '../../../src/controllers/EngineController';

describe('EngineController wiring fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Inject mock Donkey via setter (replaces circular import)
    setDonkeyInstance({
      deployChannel: mockDonkeyDeployChannel,
      undeployChannel: mockDonkeyUndeployChannel,
      getChannel: mockDonkeyGetChannel,
    } as any);
    // Reset the deployed channels by undeploying everything
    // (The module maintains internal state across tests)
    mockGetCurrentState.mockReturnValue(DeployedState.STOPPED);
    mockDonkeyGetChannel.mockReturnValue(undefined);
  });

  describe('Bug 1: SBF-DUAL-001 — Donkey undeploy state drift', () => {
    it('should call donkey.undeployChannel() during undeployChannel()', async () => {
      // Deploy a channel first
      await EngineController.deployChannel('test-channel-id');
      expect(EngineController.isDeployed('test-channel-id')).toBe(true);

      // Now the Donkey has the channel
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });

      // Undeploy
      await EngineController.undeployChannel('test-channel-id');

      // Verify Donkey's undeployChannel was called
      expect(mockDonkeyUndeployChannel).toHaveBeenCalledWith('test-channel-id');
      expect(EngineController.isDeployed('test-channel-id')).toBe(false);
    });

    it('should not throw if donkey.undeployChannel() throws', async () => {
      // Deploy a channel first
      await EngineController.deployChannel('test-channel-id');

      // Donkey has the channel but undeployChannel throws
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      mockDonkeyUndeployChannel.mockRejectedValueOnce(new Error('already removed'));

      // Undeploy should not throw
      await expect(EngineController.undeployChannel('test-channel-id')).resolves.toBeUndefined();

      // Channel should still be unregistered from EngineController
      expect(EngineController.isDeployed('test-channel-id')).toBe(false);
    });

    it('should skip donkey.undeployChannel() if channel not in donkey', async () => {
      // Deploy a channel first
      await EngineController.deployChannel('test-channel-id');

      // Donkey does NOT have the channel (e.g. already cleaned up)
      mockDonkeyGetChannel.mockReturnValue(undefined);

      // Undeploy
      await EngineController.undeployChannel('test-channel-id');

      // Should not have been called
      expect(mockDonkeyUndeployChannel).not.toHaveBeenCalled();
      expect(EngineController.isDeployed('test-channel-id')).toBe(false);
    });

    it('should handle deploy → undeploy → deploy cycle cleanly', async () => {
      // First deploy
      mockDonkeyGetChannel.mockReturnValue(undefined);
      await EngineController.deployChannel('test-channel-id');
      expect(mockDonkeyDeployChannel).toHaveBeenCalledTimes(1);

      // Undeploy (donkey has it now)
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
      expect(mockDonkeyUndeployChannel).toHaveBeenCalledTimes(1);

      // Second deploy should work because donkey's channels Map was cleaned
      mockDonkeyGetChannel.mockReturnValue(undefined);
      await EngineController.deployChannel('test-channel-id');
      expect(mockDonkeyDeployChannel).toHaveBeenCalledTimes(2);
      expect(EngineController.isDeployed('test-channel-id')).toBe(true);

      // Cleanup
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
    });
  });

  describe('Bug 2: SBF-REG-002 — ChannelRegistry never populated', () => {
    it('should call registerDeployment() during deployChannel()', async () => {
      await EngineController.deployChannel('test-channel-id');

      expect(mockRegisterDeployment).toHaveBeenCalledWith('test-server-id', 'test-channel-id');

      // Cleanup
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
    });

    it('should call unregisterDeployment() during undeployChannel()', async () => {
      await EngineController.deployChannel('test-channel-id');
      mockUnregisterDeployment.mockClear();

      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');

      expect(mockUnregisterDeployment).toHaveBeenCalledWith('test-server-id', 'test-channel-id');
    });

    it('should not fail deploy if registerDeployment throws', async () => {
      mockRegisterDeployment.mockRejectedValueOnce(new Error('DB unavailable'));

      // Deploy should still succeed
      await expect(EngineController.deployChannel('test-channel-id')).resolves.toBeUndefined();
      expect(EngineController.isDeployed('test-channel-id')).toBe(true);

      // Cleanup
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
    });

    it('should not fail undeploy if unregisterDeployment throws', async () => {
      await EngineController.deployChannel('test-channel-id');
      mockUnregisterDeployment.mockRejectedValueOnce(new Error('DB unavailable'));

      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await expect(EngineController.undeployChannel('test-channel-id')).resolves.toBeUndefined();
      expect(EngineController.isDeployed('test-channel-id')).toBe(false);
    });
  });

  describe('getDeployedChannelIds()', () => {
    it('should return a Set of deployed channel IDs', async () => {
      mockDonkeyGetChannel.mockReturnValue(undefined);
      await EngineController.deployChannel('test-channel-id');

      const ids = EngineController.getDeployedChannelIds();
      expect(ids).toBeInstanceOf(Set);
      expect(ids.has('test-channel-id')).toBe(true);

      // Cleanup
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
    });

    it('should return an empty Set when no channels deployed', () => {
      const ids = EngineController.getDeployedChannelIds();
      expect(ids.size).toBe(0);
    });
  });

  describe('SBF-STUB-001: startConnector/stopConnector', () => {
    const mockSourceStart = jest.fn().mockResolvedValue(undefined);
    const mockSourceStop = jest.fn().mockResolvedValue(undefined);
    const mockDestStart = jest.fn().mockResolvedValue(undefined);
    const mockDestStop = jest.fn().mockResolvedValue(undefined);
    const mockStartQueueProcessing = jest.fn();

    beforeEach(async () => {
      // Configure mock source connector
      mockGetSourceConnector.mockReturnValue({
        start: mockSourceStart,
        stop: mockSourceStop,
      });

      // Configure mock destination connector with metaDataId 1
      mockGetDestinationConnectors.mockReturnValue([
        {
          getMetaDataId: () => 1,
          start: mockDestStart,
          stop: mockDestStop,
          isQueueEnabled: () => false,
          startQueueProcessing: mockStartQueueProcessing,
        },
      ]);

      // Deploy a channel
      await EngineController.deployChannel('test-channel-id');
    });

    afterEach(async () => {
      mockDonkeyGetChannel.mockReturnValue({ getId: () => 'test-channel-id' });
      await EngineController.undeployChannel('test-channel-id');
      mockSourceStart.mockClear();
      mockSourceStop.mockClear();
      mockDestStart.mockClear();
      mockDestStop.mockClear();
      mockStartQueueProcessing.mockClear();
    });

    it('should start the source connector (metaDataId 0)', async () => {
      await EngineController.startConnector('test-channel-id', 0);
      expect(mockSourceStart).toHaveBeenCalled();
    });

    it('should stop the source connector (metaDataId 0)', async () => {
      await EngineController.stopConnector('test-channel-id', 0);
      expect(mockSourceStop).toHaveBeenCalled();
    });

    it('should start a destination connector by metaDataId', async () => {
      await EngineController.startConnector('test-channel-id', 1);
      expect(mockDestStart).toHaveBeenCalled();
    });

    it('should stop a destination connector by metaDataId', async () => {
      await EngineController.stopConnector('test-channel-id', 1);
      expect(mockDestStop).toHaveBeenCalled();
    });

    it('should start queue processing for queue-enabled destinations', async () => {
      mockGetDestinationConnectors.mockReturnValue([
        {
          getMetaDataId: () => 1,
          start: mockDestStart,
          stop: mockDestStop,
          isQueueEnabled: () => true,
          startQueueProcessing: mockStartQueueProcessing,
        },
      ]);

      await EngineController.startConnector('test-channel-id', 1);
      expect(mockDestStart).toHaveBeenCalled();
      expect(mockStartQueueProcessing).toHaveBeenCalled();
    });

    it('should throw for non-deployed channel', async () => {
      await expect(
        EngineController.startConnector('non-existent', 0)
      ).rejects.toThrow('Channel not deployed');
    });

    it('should throw for non-existent destination metaDataId', async () => {
      await expect(
        EngineController.startConnector('test-channel-id', 99)
      ).rejects.toThrow('Destination connector 99 not found');
    });
  });
});
