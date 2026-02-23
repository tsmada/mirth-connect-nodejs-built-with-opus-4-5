/**
 * Additional coverage tests for EngineController.
 *
 * Targets uncovered statements: getChannelStatus, getChannelStatuses,
 * getDashboardChannelInfo, deployAllChannels, stopChannel, haltChannel,
 * pauseChannel, resumeChannel, redeployAllChannels, getDeployedChannel,
 * getDeployedChannelByName, getDeployedCount, dispatchMessage,
 * dispatchRawMessage, matchesFilter, createStatusFromDeployment,
 * engineControllerAdapter, and error paths.
 */

import { DeployedState } from '../../../src/api/models/DashboardStatus';

// --- Track mock calls ---
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockHalt = jest.fn().mockResolvedValue(undefined);
const mockPause = jest.fn().mockResolvedValue(undefined);
const mockResume = jest.fn().mockResolvedValue(undefined);
const mockLoadStatisticsFromDb = jest.fn().mockResolvedValue(undefined);
const mockGetCurrentState = jest.fn().mockReturnValue(DeployedState.STOPPED);
const mockUpdateCurrentState = jest.fn();
const mockGetId = jest.fn().mockReturnValue('ch-1');
const mockGetName = jest.fn().mockReturnValue('Channel One');
const mockGetSourceConnector = jest.fn().mockReturnValue(null);
const mockGetDestinationConnectors = jest.fn().mockReturnValue([]);
const mockGetStatistics = jest.fn().mockReturnValue({
  received: 10,
  sent: 8,
  error: 1,
  filtered: 1,
  queued: 0,
});
const mockDispatchRawMessage = jest.fn().mockResolvedValue({
  getMessageId: () => 42,
  isProcessed: () => true,
  getConnectorMessages: () => new Map(),
});
const mockOn = jest.fn();
const mockSetExecutor = jest.fn();

jest.mock('../../../src/donkey/channel/Channel', () => ({
  Channel: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    halt: mockHalt,
    pause: mockPause,
    resume: mockResume,
    loadStatisticsFromDb: mockLoadStatisticsFromDb,
    getCurrentState: mockGetCurrentState,
    updateCurrentState: mockUpdateCurrentState,
    getId: mockGetId,
    getName: mockGetName,
    getSourceConnector: mockGetSourceConnector,
    getDestinationConnectors: mockGetDestinationConnectors,
    getStatistics: mockGetStatistics,
    dispatchRawMessage: mockDispatchRawMessage,
    on: mockOn,
    setExecutor: mockSetExecutor,
  })),
}));

jest.mock('../../../src/donkey/channel/ChannelBuilder', () => ({
  buildChannel: jest.fn().mockImplementation(() => {
    const { Channel } = require('../../../src/donkey/channel/Channel');
    return new Channel();
  }),
}));

// Mock ChannelController with configurable return values
const mockGetChannel = jest.fn();
const mockGetAllChannels = jest.fn();
jest.mock('../../../src/controllers/ChannelController', () => ({
  ChannelController: {
    getChannel: (...args: unknown[]) => mockGetChannel(...args),
    getAllChannels: (...args: unknown[]) => mockGetAllChannels(...args),
  },
}));

// Mock ConfigurationController
jest.mock('../../../src/controllers/ConfigurationController', () => ({
  ConfigurationController: {
    getGlobalScripts: jest.fn().mockResolvedValue({ Preprocessor: '', Postprocessor: '' }),
  },
}));

jest.mock('../../../src/db/SchemaManager', () => ({
  ensureChannelTables: jest.fn().mockResolvedValue(undefined),
}));

// Mock Donkey
const mockDonkeyDeployChannel = jest.fn().mockResolvedValue(undefined);
const mockDonkeyUndeployChannel = jest.fn().mockResolvedValue(undefined);
const mockDonkeyGetChannel = jest.fn().mockReturnValue(undefined);

// Mock ShadowMode
const mockIsShadowMode = jest.fn().mockReturnValue(false);
const mockIsChannelActive = jest.fn().mockReturnValue(true);
const mockIsChannelPromoted = jest.fn().mockReturnValue(false);
jest.mock('../../../src/cluster/ShadowMode', () => ({
  isShadowMode: (...args: unknown[]) => mockIsShadowMode(...args),
  isChannelActive: (...args: unknown[]) => mockIsChannelActive(...args),
  isChannelPromoted: (...args: unknown[]) => mockIsChannelPromoted(...args),
}));

jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
    resetChannelState: jest.fn(),
  },
}));

jest.mock('../../../src/plugins/dashboardstatus/ConnectionLogItem', () => ({
  ConnectionStatusEventType: {
    CONNECTED: 'CONNECTED',
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    WAITING: 'WAITING',
    IDLE: 'IDLE',
  },
}));

jest.mock('../../../src/plugins/codetemplates/CodeTemplateController', () => ({
  getAllCodeTemplateScriptsForChannel: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../src/javascript/runtime/JavaScriptExecutor', () => ({
  createJavaScriptExecutor: jest.fn().mockReturnValue({
    executeDeploy: jest.fn(),
    executeFilter: jest.fn(),
  }),
  getDefaultExecutor: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/connectors/vm/VmDispatcher', () => ({
  VmDispatcher: class {},
}));

jest.mock('../../../src/model/RawMessage', () => ({
  RawMessage: class {
    private rawData: string;
    private sourceMap: Map<string, unknown>;
    constructor(data: { rawData: string; sourceMap?: Map<string, unknown> }) {
      this.rawData = data.rawData;
      this.sourceMap = data.sourceMap ?? new Map();
    }
    getRawData() {
      return this.rawData;
    }
    getSourceMap() {
      return this.sourceMap;
    }
  },
}));

const mockRegisterDeployment = jest.fn().mockResolvedValue(undefined);
const mockUnregisterDeployment = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/cluster/ChannelRegistry', () => ({
  registerDeployment: (...args: unknown[]) => mockRegisterDeployment(...args),
  unregisterDeployment: (...args: unknown[]) => mockUnregisterDeployment(...args),
}));

jest.mock('../../../src/cluster/ClusterIdentity', () => ({
  getServerId: jest.fn().mockReturnValue('test-server-id'),
}));

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

jest.mock('../../../src/javascript/userutil/MirthMap', () => ({
  GlobalChannelMapStore: {
    getInstance: () => ({
      loadChannelFromBackend: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Import after all mocks
import {
  EngineController,
  setDonkeyInstance,
  engineControllerAdapter,
} from '../../../src/controllers/EngineController';
import { RawMessage } from '../../../src/model/RawMessage';

// Helper: deploy a channel with specific config
function makeChannelConfig(id: string, name: string, options: Record<string, unknown> = {}) {
  return {
    id,
    name,
    enabled: true,
    revision: 1,
    properties: { initialState: DeployedState.STARTED },
    ...options,
  };
}

describe('EngineController coverage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsShadowMode.mockReturnValue(false);
    mockIsChannelActive.mockReturnValue(true);
    mockIsChannelPromoted.mockReturnValue(false);
    mockGetCurrentState.mockReturnValue(DeployedState.STOPPED);
    mockDonkeyGetChannel.mockReturnValue(undefined);
    mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));
    mockGetAllChannels.mockResolvedValue([]);
    mockGetSourceConnector.mockReturnValue(null);
    mockGetDestinationConnectors.mockReturnValue([]);

    setDonkeyInstance({
      deployChannel: mockDonkeyDeployChannel,
      undeployChannel: mockDonkeyUndeployChannel,
      getChannel: mockDonkeyGetChannel,
    } as any);

    // Clean up deployed channels
    for (const id of EngineController.getDeployedChannelIds()) {
      try {
        await EngineController.undeployChannel(id);
      } catch {
        /* ignore */
      }
    }
  });

  // -----------------------------------------------------------------------
  // getChannelStatus
  // -----------------------------------------------------------------------
  describe('getChannelStatus()', () => {
    it('should return status for a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');

      const status = await EngineController.getChannelStatus('ch-1');
      expect(status).not.toBeNull();
      expect(status!.channelId).toBe('ch-1');
      expect(status!.name).toBe('Channel One');
      expect(status!.statistics).toBeDefined();
    });

    it('should return STOPPED status for an undeployed channel that exists in DB', async () => {
      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-2', 'Channel Two'));

      const status = await EngineController.getChannelStatus('ch-2');
      expect(status).not.toBeNull();
      expect(status!.channelId).toBe('ch-2');
      expect(status!.state).toBe(DeployedState.STOPPED);
    });

    it('should return null for a channel that does not exist', async () => {
      mockGetChannel.mockResolvedValue(null);

      const status = await EngineController.getChannelStatus('nonexistent');
      expect(status).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getChannelStatuses
  // -----------------------------------------------------------------------
  describe('getChannelStatuses()', () => {
    it('should return statuses for specific channel IDs', async () => {
      // Deploy ch-1
      await EngineController.deployChannel('ch-1');

      const statuses = await EngineController.getChannelStatuses(['ch-1']);
      expect(statuses.length).toBe(1);
      expect(statuses[0]!.channelId).toBe('ch-1');
    });

    it('should filter statuses by name', async () => {
      await EngineController.deployChannel('ch-1');

      const matching = await EngineController.getChannelStatuses(['ch-1'], 'channel');
      expect(matching.length).toBe(1);

      const nonMatching = await EngineController.getChannelStatuses(['ch-1'], 'nonexistent');
      expect(nonMatching.length).toBe(0);
    });

    it('should return all deployed channels when no IDs provided', async () => {
      await EngineController.deployChannel('ch-1');
      mockGetAllChannels.mockResolvedValue([{ id: 'ch-1', name: 'Channel One', enabled: true }]);

      const statuses = await EngineController.getChannelStatuses();
      expect(statuses.length).toBe(1);
    });

    it('should include undeployed channels when includeUndeployed is true', async () => {
      mockGetAllChannels.mockResolvedValue([
        { id: 'ch-undeployed', name: 'Undeployed Channel', enabled: true },
      ]);

      const statuses = await EngineController.getChannelStatuses(undefined, undefined, true);
      expect(statuses.length).toBe(1);
      expect(statuses[0]!.channelId).toBe('ch-undeployed');
      expect(statuses[0]!.state).toBe(DeployedState.STOPPED);
    });

    it('should filter undeployed channels by name', async () => {
      mockGetAllChannels.mockResolvedValue([
        { id: 'ch-undeployed', name: 'Undeployed Channel', enabled: true },
      ]);

      const matching = await EngineController.getChannelStatuses(undefined, 'undep', true);
      expect(matching.length).toBe(1);

      const nonMatching = await EngineController.getChannelStatuses(undefined, 'zzz', true);
      expect(nonMatching.length).toBe(0);
    });

    it('should skip null statuses for specific IDs', async () => {
      mockGetChannel.mockResolvedValue(null);

      const statuses = await EngineController.getChannelStatuses(['nonexistent']);
      expect(statuses.length).toBe(0);
    });

    it('should filter deployed channels in all-channel mode', async () => {
      await EngineController.deployChannel('ch-1');
      mockGetAllChannels.mockResolvedValue([{ id: 'ch-1', name: 'Channel One', enabled: true }]);

      const matching = await EngineController.getChannelStatuses(undefined, 'one');
      expect(matching.length).toBe(1);

      const nonMatching = await EngineController.getChannelStatuses(undefined, 'zzz');
      expect(nonMatching.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getDashboardChannelInfo
  // -----------------------------------------------------------------------
  describe('getDashboardChannelInfo()', () => {
    it('should return paginated results with remaining IDs', async () => {
      mockGetAllChannels.mockResolvedValue([
        { id: 'ch-a', name: 'A', enabled: true },
        { id: 'ch-b', name: 'B', enabled: true },
        { id: 'ch-c', name: 'C', enabled: true },
      ]);

      const info = await EngineController.getDashboardChannelInfo(2);
      expect(info.dashboardStatuses.length).toBe(2);
      expect(info.remainingChannelIds.length).toBe(1);
      expect(info.remainingChannelIds[0]).toBe('ch-c');
    });

    it('should apply filter to dashboard channel info', async () => {
      mockGetAllChannels.mockResolvedValue([
        { id: 'ch-a', name: 'ADT Receiver', enabled: true },
        { id: 'ch-b', name: 'Lab Router', enabled: true },
      ]);

      const info = await EngineController.getDashboardChannelInfo(10, 'ADT');
      expect(info.dashboardStatuses.length).toBe(1);
      expect(info.dashboardStatuses[0]!.name).toBe('ADT Receiver');
    });

    it('should use createStatusFromDeployment for deployed channels', async () => {
      await EngineController.deployChannel('ch-1');
      mockGetAllChannels.mockResolvedValue([{ id: 'ch-1', name: 'Channel One', enabled: true }]);

      const info = await EngineController.getDashboardChannelInfo(10);
      expect(info.dashboardStatuses.length).toBe(1);
      expect(info.dashboardStatuses[0]!.statistics.received).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // deployAllChannels
  // -----------------------------------------------------------------------
  describe('deployAllChannels()', () => {
    it('should deploy all enabled channels', async () => {
      const configs = [makeChannelConfig('ch-a', 'A'), makeChannelConfig('ch-b', 'B')];
      mockGetAllChannels.mockResolvedValue(configs);
      mockGetChannel.mockImplementation(
        async (id: string) => configs.find((c) => c.id === id) ?? null
      );

      await EngineController.deployAllChannels();

      expect(EngineController.isDeployed('ch-a')).toBe(true);
      expect(EngineController.isDeployed('ch-b')).toBe(true);
    });

    it('should skip disabled channels', async () => {
      mockGetAllChannels.mockResolvedValue([
        makeChannelConfig('ch-a', 'A', { enabled: false }),
        makeChannelConfig('ch-b', 'B'),
      ]);
      mockGetChannel.mockImplementation(async (id: string) => {
        if (id === 'ch-b') return makeChannelConfig('ch-b', 'B');
        return makeChannelConfig('ch-a', 'A', { enabled: false });
      });

      await EngineController.deployAllChannels();

      expect(EngineController.isDeployed('ch-a')).toBe(false);
      expect(EngineController.isDeployed('ch-b')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // stopChannel
  // -----------------------------------------------------------------------
  describe('stopChannel()', () => {
    it('should stop a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');
      mockStop.mockClear();

      await EngineController.stopChannel('ch-1');
      expect(mockStop).toHaveBeenCalled();
    });

    it('should throw if channel is not deployed', async () => {
      await expect(EngineController.stopChannel('nonexistent')).rejects.toThrow(
        'Channel not deployed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // haltChannel
  // -----------------------------------------------------------------------
  describe('haltChannel()', () => {
    it('should halt a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');
      mockHalt.mockClear();

      await EngineController.haltChannel('ch-1');
      expect(mockHalt).toHaveBeenCalled();
    });

    it('should throw if channel is not deployed', async () => {
      await expect(EngineController.haltChannel('nonexistent')).rejects.toThrow(
        'Channel not deployed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // pauseChannel
  // -----------------------------------------------------------------------
  describe('pauseChannel()', () => {
    it('should pause a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');

      await EngineController.pauseChannel('ch-1');
      expect(mockPause).toHaveBeenCalled();
    });

    it('should throw if channel is not deployed', async () => {
      await expect(EngineController.pauseChannel('nonexistent')).rejects.toThrow(
        'Channel not deployed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // resumeChannel
  // -----------------------------------------------------------------------
  describe('resumeChannel()', () => {
    it('should resume a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');

      await EngineController.resumeChannel('ch-1');
      expect(mockResume).toHaveBeenCalled();
    });

    it('should throw if channel is not deployed', async () => {
      await expect(EngineController.resumeChannel('nonexistent')).rejects.toThrow(
        'Channel not deployed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // startChannel (auto-deploy branch)
  // -----------------------------------------------------------------------
  describe('startChannel()', () => {
    it('should start a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');
      mockStart.mockClear();

      await EngineController.startChannel('ch-1');
      expect(mockStart).toHaveBeenCalled();
    });

    it('should auto-deploy if channel is not deployed', async () => {
      // Not deployed yet, but getChannel will return config
      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));
      mockStart.mockClear();

      await EngineController.startChannel('ch-1');

      // Should be deployed now
      expect(EngineController.isDeployed('ch-1')).toBe(true);
      // start() called during deploy + explicit start
      expect(mockStart).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // redeployAllChannels
  // -----------------------------------------------------------------------
  describe('redeployAllChannels()', () => {
    it('should undeploy all then deploy all', async () => {
      const configs = [makeChannelConfig('ch-a', 'A')];
      mockGetAllChannels.mockResolvedValue(configs);
      mockGetChannel.mockResolvedValue(configs[0]);

      await EngineController.deployChannel('ch-a');

      mockGetAllChannels.mockResolvedValue(configs);
      await EngineController.redeployAllChannels();

      expect(EngineController.isDeployed('ch-a')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getDeployedChannel
  // -----------------------------------------------------------------------
  describe('getDeployedChannel()', () => {
    it('should return the runtime channel for a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');

      const channel = EngineController.getDeployedChannel('ch-1');
      expect(channel).not.toBeNull();
      expect(channel!.getId()).toBe('ch-1');
    });

    it('should return null for a non-deployed channel', () => {
      const channel = EngineController.getDeployedChannel('nonexistent');
      expect(channel).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getDeployedChannelByName
  // -----------------------------------------------------------------------
  describe('getDeployedChannelByName()', () => {
    it('should find a deployed channel by name', async () => {
      await EngineController.deployChannel('ch-1');

      const result = EngineController.getDeployedChannelByName('Channel One');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ch-1');
      expect(result!.name).toBe('Channel One');
    });

    it('should return null for a non-existent name', () => {
      const result = EngineController.getDeployedChannelByName('Nonexistent');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getDeployedCount
  // -----------------------------------------------------------------------
  describe('getDeployedCount()', () => {
    it('should return 0 when no channels deployed', () => {
      expect(EngineController.getDeployedCount()).toBe(0);
    });

    it('should return the count of deployed channels', async () => {
      await EngineController.deployChannel('ch-1');
      expect(EngineController.getDeployedCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // dispatchMessage
  // -----------------------------------------------------------------------
  describe('dispatchMessage()', () => {
    it('should dispatch a raw message to a deployed channel', async () => {
      await EngineController.deployChannel('ch-1');

      const result = await EngineController.dispatchMessage('ch-1', '<msg/>');
      expect(result.messageId).toBe(42);
      expect(result.processed).toBe(true);
    });

    it('should throw if channel is not deployed', async () => {
      await expect(EngineController.dispatchMessage('nonexistent', '<msg/>')).rejects.toThrow(
        'Channel not deployed'
      );
    });

    it('should pass sourceMapData to channel', async () => {
      await EngineController.deployChannel('ch-1');
      const sourceMap = new Map([['key', 'value']]);

      await EngineController.dispatchMessage('ch-1', '<msg/>', sourceMap);
      expect(mockDispatchRawMessage).toHaveBeenCalledWith('<msg/>', sourceMap);
    });
  });

  // -----------------------------------------------------------------------
  // dispatchRawMessage
  // -----------------------------------------------------------------------
  describe('dispatchRawMessage()', () => {
    it('should dispatch a RawMessage and extract response', async () => {
      // Set up a mock with connector messages that have a response
      const mockResponseContent = { content: '<ACK/>' };
      const connectorMessages = new Map();
      connectorMessages.set(0, {
        getResponseContent: () => null,
        getStatus: () => 'RECEIVED',
      });
      connectorMessages.set(1, {
        getResponseContent: () => mockResponseContent,
        getStatus: () => 'SENT',
      });

      mockDispatchRawMessage.mockResolvedValueOnce({
        getMessageId: () => 99,
        isProcessed: () => true,
        getConnectorMessages: () => connectorMessages,
      });

      await EngineController.deployChannel('ch-1');
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      const result = await EngineController.dispatchRawMessage('ch-1', rawMsg);
      expect(result).not.toBeNull();
      expect(result!.messageId).toBe(99);
      expect(result!.selectedResponse).toBeDefined();
      expect(result!.selectedResponse!.message).toBe('<ACK/>');
      expect(result!.selectedResponse!.status).toBe('SENT');
    });

    it('should return null selectedResponse when no destination has response', async () => {
      const connectorMessages = new Map();
      connectorMessages.set(0, {
        getResponseContent: () => null,
        getStatus: () => 'RECEIVED',
      });
      connectorMessages.set(1, {
        getResponseContent: () => null,
        getStatus: () => 'SENT',
      });

      mockDispatchRawMessage.mockResolvedValueOnce({
        getMessageId: () => 100,
        isProcessed: () => true,
        getConnectorMessages: () => connectorMessages,
      });

      await EngineController.deployChannel('ch-1');
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      const result = await EngineController.dispatchRawMessage('ch-1', rawMsg);
      expect(result!.selectedResponse).toBeUndefined();
    });

    it('should skip source connector (metaDataId 0) when extracting response', async () => {
      const connectorMessages = new Map();
      connectorMessages.set(0, {
        getResponseContent: () => ({ content: 'source-response' }),
        getStatus: () => 'RECEIVED',
      });

      mockDispatchRawMessage.mockResolvedValueOnce({
        getMessageId: () => 101,
        isProcessed: () => true,
        getConnectorMessages: () => connectorMessages,
      });

      await EngineController.deployChannel('ch-1');
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      const result = await EngineController.dispatchRawMessage('ch-1', rawMsg);
      // Should not use source connector's response (metaDataId 0)
      expect(result!.selectedResponse).toBeUndefined();
    });

    it('should throw if channel is not deployed', async () => {
      const rawMsg = new RawMessage({ rawData: '<msg/>' });
      await expect(EngineController.dispatchRawMessage('nonexistent', rawMsg)).rejects.toThrow(
        'Channel not deployed'
      );
    });

    it('should throw in shadow mode for non-active channels', async () => {
      await EngineController.deployChannel('ch-1');
      mockIsShadowMode.mockReturnValue(true);
      mockIsChannelActive.mockReturnValue(false);

      const rawMsg = new RawMessage({ rawData: '<msg/>' });
      await expect(EngineController.dispatchRawMessage('ch-1', rawMsg)).rejects.toThrow(
        'shadow mode'
      );
    });
  });

  // -----------------------------------------------------------------------
  // engineControllerAdapter
  // -----------------------------------------------------------------------
  describe('engineControllerAdapter', () => {
    it('should delegate dispatchRawMessage to EngineController', async () => {
      await EngineController.deployChannel('ch-1');
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      const result = await engineControllerAdapter.dispatchRawMessage('ch-1', rawMsg, false, true);
      expect(result).not.toBeNull();
      expect(result!.messageId).toBe(42);
    });
  });

  // -----------------------------------------------------------------------
  // createStatusFromDeployment with listenerInfo
  // -----------------------------------------------------------------------
  describe('createStatusFromDeployment() with listenerInfo', () => {
    it('should include listenerInfo when source connector provides it', async () => {
      const mockListenerInfo = {
        port: 6661,
        host: '0.0.0.0',
        connectionCount: 3,
        maxConnections: 100,
        transportType: 'TCP',
        listening: true,
      };

      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'TCP Listener',
        getCurrentState: () => DeployedState.STARTED,
        getListenerInfo: () => mockListenerInfo,
      });

      await EngineController.deployChannel('ch-1');

      const status = await EngineController.getChannelStatus('ch-1');
      expect(status).not.toBeNull();
      expect(status!.listenerInfo).toEqual(mockListenerInfo);
    });

    it('should handle source connector without getListenerInfo', async () => {
      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'Channel Reader',
        getCurrentState: () => DeployedState.STARTED,
        // No getListenerInfo method
      });

      await EngineController.deployChannel('ch-1');

      const status = await EngineController.getChannelStatus('ch-1');
      expect(status).not.toBeNull();
      expect(status!.listenerInfo).toBeUndefined();
    });

    it('should handle getListenerInfo returning null', async () => {
      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'TCP Listener',
        getCurrentState: () => DeployedState.STOPPED,
        getListenerInfo: () => null,
      });

      await EngineController.deployChannel('ch-1');

      const status = await EngineController.getChannelStatus('ch-1');
      expect(status).not.toBeNull();
      expect(status!.listenerInfo).toBeUndefined();
    });

    it('should handle no source connector', async () => {
      mockGetSourceConnector.mockReturnValue(null);

      await EngineController.deployChannel('ch-1');

      const status = await EngineController.getChannelStatus('ch-1');
      expect(status).not.toBeNull();
      expect(status!.listenerInfo).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // childStatuses (per-connector status)
  // -----------------------------------------------------------------------
  describe('createStatusFromDeployment() childStatuses', () => {
    it('should populate childStatuses with source + destinations', async () => {
      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'TCP Listener',
        getCurrentState: () => DeployedState.STARTED,
      });
      mockGetDestinationConnectors.mockReturnValue([
        {
          getName: () => 'HTTP Sender',
          getTransportName: () => 'HTTP Dispatcher',
          getCurrentState: () => DeployedState.STARTED,
          getMetaDataId: () => 1,
          isQueueEnabled: () => true,
          isEnabled: () => true,
        },
        {
          getName: () => 'File Writer',
          getTransportName: () => 'File Dispatcher',
          getCurrentState: () => DeployedState.STOPPED,
          getMetaDataId: () => 2,
          isQueueEnabled: () => false,
          isEnabled: () => false,
        },
      ]);

      await EngineController.deployChannel('ch-1');
      const status = await EngineController.getChannelStatus('ch-1');

      expect(status).not.toBeNull();
      expect(status!.childStatuses).toBeDefined();
      expect(status!.childStatuses).toHaveLength(3);

      // Source connector
      const src = status!.childStatuses![0]!;
      expect(src.metaDataId).toBe(0);
      expect(src.name).toBe('Source');
      expect(src.transportName).toBe('TCP Listener');
      expect(src.state).toBe(DeployedState.STARTED);

      // Destination 1
      const d1 = status!.childStatuses![1]!;
      expect(d1.metaDataId).toBe(1);
      expect(d1.name).toBe('HTTP Sender');
      expect(d1.transportName).toBe('HTTP Dispatcher');
      expect(d1.state).toBe(DeployedState.STARTED);
      expect(d1.queueEnabled).toBe(true);
      expect(d1.enabled).toBe(true);

      // Destination 2 (disabled)
      const d2 = status!.childStatuses![2]!;
      expect(d2.metaDataId).toBe(2);
      expect(d2.name).toBe('File Writer');
      expect(d2.transportName).toBe('File Dispatcher');
      expect(d2.state).toBe(DeployedState.STOPPED);
      expect(d2.queueEnabled).toBe(false);
      expect(d2.enabled).toBe(false);
    });

    it('should have no childStatuses when no connectors exist', async () => {
      mockGetSourceConnector.mockReturnValue(null);
      mockGetDestinationConnectors.mockReturnValue([]);

      await EngineController.deployChannel('ch-1');
      const status = await EngineController.getChannelStatus('ch-1');

      expect(status).not.toBeNull();
      expect(status!.childStatuses).toBeUndefined();
    });

    it('should include listenerInfo on source child status', async () => {
      const mockListenerInfo = {
        port: 6661,
        host: '0.0.0.0',
        connectionCount: 2,
        maxConnections: 50,
        transportType: 'TCP',
        listening: true,
      };

      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'TCP Listener',
        getCurrentState: () => DeployedState.STARTED,
        getListenerInfo: () => mockListenerInfo,
      });
      mockGetDestinationConnectors.mockReturnValue([]);

      await EngineController.deployChannel('ch-1');
      const status = await EngineController.getChannelStatus('ch-1');

      expect(status!.childStatuses).toHaveLength(1);
      const src = status!.childStatuses![0]!;
      expect(src.listenerInfo).toEqual(mockListenerInfo);
    });
  });

  // -----------------------------------------------------------------------
  // deployChannel error handling
  // -----------------------------------------------------------------------
  describe('deployChannel() error handling', () => {
    it('should throw if channel config is not found', async () => {
      mockGetChannel.mockResolvedValue(null);

      await expect(EngineController.deployChannel('nonexistent')).rejects.toThrow(
        'Channel not found'
      );
    });

    it('should clean up deployedChannels on deploy failure', async () => {
      // Make buildChannel throw
      const { buildChannel } = require('../../../src/donkey/channel/ChannelBuilder');
      (buildChannel as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Build failed');
      });
      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-fail', 'Failing Channel'));

      await expect(EngineController.deployChannel('ch-fail')).rejects.toThrow('Build failed');
      expect(EngineController.isDeployed('ch-fail')).toBe(false);
    });

    it('should handle GlobalChannelMapStore load failure gracefully', async () => {
      // Override the GlobalChannelMapStore mock for this test
      const mirthMapModule = require('../../../src/javascript/userutil/MirthMap');
      const originalGetInstance = mirthMapModule.GlobalChannelMapStore.getInstance;
      mirthMapModule.GlobalChannelMapStore.getInstance = () => ({
        loadChannelFromBackend: jest.fn().mockRejectedValue(new Error('DB down')),
      });

      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));

      // Should not throw despite GlobalChannelMap failure
      await expect(EngineController.deployChannel('ch-1')).resolves.toBeUndefined();

      mirthMapModule.GlobalChannelMapStore.getInstance = originalGetInstance;
    });

    it('should handle global scripts load failure gracefully', async () => {
      const configCtrl = require('../../../src/controllers/ConfigurationController');
      configCtrl.ConfigurationController.getGlobalScripts.mockRejectedValueOnce(
        new Error('DB unavailable')
      );

      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));
      // Should not throw despite global scripts failure
      await expect(EngineController.deployChannel('ch-1')).resolves.toBeUndefined();
    });

    it('should handle code template load failure gracefully', async () => {
      const ctController = require('../../../src/plugins/codetemplates/CodeTemplateController');
      ctController.getAllCodeTemplateScriptsForChannel.mockRejectedValueOnce(
        new Error('DB unavailable')
      );

      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));
      await expect(EngineController.deployChannel('ch-1')).resolves.toBeUndefined();
    });

    it('should inject code template executor when templates exist', async () => {
      const ctController = require('../../../src/plugins/codetemplates/CodeTemplateController');
      ctController.getAllCodeTemplateScriptsForChannel.mockResolvedValueOnce([
        'function helper() { return true; }',
      ]);

      mockGetChannel.mockResolvedValue(makeChannelConfig('ch-1', 'Channel One'));
      await EngineController.deployChannel('ch-1');

      expect(mockSetExecutor).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // deployChannel with initialState STOPPED
  // -----------------------------------------------------------------------
  describe('deployChannel() initialState handling', () => {
    it('should not start channel when initialState is STOPPED', async () => {
      mockGetChannel.mockResolvedValue(
        makeChannelConfig('ch-1', 'Channel One', {
          properties: { initialState: DeployedState.STOPPED },
        })
      );
      mockStart.mockClear();

      await EngineController.deployChannel('ch-1');
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('should start channel when initialState is STARTED', async () => {
      mockGetChannel.mockResolvedValue(
        makeChannelConfig('ch-1', 'Channel One', {
          properties: { initialState: DeployedState.STARTED },
        })
      );
      mockStart.mockClear();

      await EngineController.deployChannel('ch-1');
      expect(mockStart).toHaveBeenCalled();
    });

    it('should default to STARTED when no initialState set', async () => {
      mockGetChannel.mockResolvedValue(
        makeChannelConfig('ch-1', 'Channel One', { properties: {} })
      );
      mockStart.mockClear();

      await EngineController.deployChannel('ch-1');
      expect(mockStart).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // undeployChannel
  // -----------------------------------------------------------------------
  describe('undeployChannel()', () => {
    it('should no-op if channel is not deployed', async () => {
      // Should not throw
      await EngineController.undeployChannel('nonexistent');
    });

    it('should handle stop() failure during undeploy', async () => {
      await EngineController.deployChannel('ch-1');
      mockStop.mockRejectedValueOnce(new Error('Port already released'));

      // Should not throw
      await EngineController.undeployChannel('ch-1');
      expect(EngineController.isDeployed('ch-1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // stopConnector error paths
  // -----------------------------------------------------------------------
  describe('stopConnector() error paths', () => {
    it('should throw for non-deployed channel', async () => {
      await expect(EngineController.stopConnector('nonexistent', 0)).rejects.toThrow(
        'Channel not deployed'
      );
    });

    it('should throw when no source connector exists', async () => {
      mockGetSourceConnector.mockReturnValue(null);
      await EngineController.deployChannel('ch-1');

      await expect(EngineController.stopConnector('ch-1', 0)).rejects.toThrow(
        'No source connector'
      );
    });

    it('should throw for non-existent destination metaDataId', async () => {
      mockGetDestinationConnectors.mockReturnValue([]);
      await EngineController.deployChannel('ch-1');

      await expect(EngineController.stopConnector('ch-1', 99)).rejects.toThrow(
        'Destination connector 99 not found'
      );
    });

    it('should stop a destination connector by metaDataId', async () => {
      const mockDestStop = jest.fn().mockResolvedValue(undefined);
      mockGetDestinationConnectors.mockReturnValue([
        {
          getMetaDataId: () => 2,
          getName: () => 'Dest 1',
          getTransportName: () => 'HTTP Dispatcher',
          getCurrentState: () => DeployedState.STARTED,
          isQueueEnabled: () => false,
          isEnabled: () => true,
          stop: mockDestStop,
        },
      ]);
      await EngineController.deployChannel('ch-1');

      await EngineController.stopConnector('ch-1', 2);
      expect(mockDestStop).toHaveBeenCalled();
    });

    it('should stop the source connector (metaDataId 0)', async () => {
      const mockSourceStop = jest.fn().mockResolvedValue(undefined);
      mockGetSourceConnector.mockReturnValue({
        getName: () => 'Source',
        getTransportName: () => 'TCP Listener',
        getCurrentState: () => DeployedState.STARTED,
        stop: mockSourceStop,
      });
      await EngineController.deployChannel('ch-1');

      await EngineController.stopConnector('ch-1', 0);
      expect(mockSourceStop).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // startConnector error paths
  // -----------------------------------------------------------------------
  describe('startConnector() error paths', () => {
    it('should throw when no source connector exists', async () => {
      mockGetSourceConnector.mockReturnValue(null);
      await EngineController.deployChannel('ch-1');

      await expect(EngineController.startConnector('ch-1', 0)).rejects.toThrow(
        'No source connector'
      );
    });
  });

  // -----------------------------------------------------------------------
  // matchesFilter via getChannelStatuses
  // -----------------------------------------------------------------------
  describe('matchesFilter()', () => {
    it('should match by channel ID (case-insensitive)', async () => {
      await EngineController.deployChannel('ch-1');

      const statuses = await EngineController.getChannelStatuses(['ch-1'], 'CH-1');
      expect(statuses.length).toBe(1);
    });

    it('should return all when filter is empty', async () => {
      await EngineController.deployChannel('ch-1');

      const statuses = await EngineController.getChannelStatuses(['ch-1'], '');
      expect(statuses.length).toBe(1);
    });

    it('should return all when filter is undefined', async () => {
      await EngineController.deployChannel('ch-1');

      const statuses = await EngineController.getChannelStatuses(['ch-1']);
      expect(statuses.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // deployChannel — already deployed (undeploy-before-redeploy)
  // -----------------------------------------------------------------------
  describe('deployChannel() undeploy-before-redeploy', () => {
    it('should undeploy existing channel before redeploying', async () => {
      await EngineController.deployChannel('ch-1');
      expect(EngineController.isDeployed('ch-1')).toBe(true);

      // Deploy again — should undeploy first
      mockStop.mockClear();
      await EngineController.deployChannel('ch-1');

      // stop should have been called during the undeploy phase
      expect(mockStop).toHaveBeenCalled();
      expect(EngineController.isDeployed('ch-1')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // setDonkeyInstance
  // -----------------------------------------------------------------------
  describe('setDonkeyInstance()', () => {
    it('should allow setting Donkey instance to null-like', () => {
      setDonkeyInstance(null as any);
      // After setting to null, deployChannel should skip donkey registration
      // (tested via deploy without donkey instance — no error)
    });
  });

  // -----------------------------------------------------------------------
  // VmDispatcher wiring
  // -----------------------------------------------------------------------
  describe('deployChannel() VmDispatcher wiring', () => {
    it('should wire VmDispatcher instances to engineControllerAdapter', async () => {
      const { VmDispatcher } = require('../../../src/connectors/vm/VmDispatcher');
      const mockSetEngineController = jest.fn();

      // Create a VmDispatcher-like instance
      const vmDest = Object.create(VmDispatcher.prototype);
      vmDest.getMetaDataId = () => 1;
      vmDest.getName = () => 'Channel Writer';
      vmDest.getTransportName = () => 'Channel Writer';
      vmDest.getCurrentState = () => DeployedState.STOPPED;
      vmDest.isQueueEnabled = () => false;
      vmDest.isEnabled = () => true;
      vmDest.getFilterTransformerExecutor = () => null;
      vmDest.setEngineController = mockSetEngineController;

      mockGetDestinationConnectors.mockReturnValue([vmDest]);

      await EngineController.deployChannel('ch-1');

      expect(mockSetEngineController).toHaveBeenCalled();
    });
  });
});
