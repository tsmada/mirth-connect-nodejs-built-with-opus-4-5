/**
 * Tests for shadow mode integration in EngineController.
 *
 * Verifies:
 * - deployChannel() skips start() in shadow mode for non-promoted channels
 * - deployChannel() starts promoted channels even in shadow mode
 * - deployChannel() loads stats for dashboard display in shadow mode
 * - dispatchMessage() blocks non-promoted channels in shadow mode
 * - dispatchRawMessage() blocks non-promoted channels in shadow mode
 * - dispatch methods allow promoted channels in shadow mode
 * - dispatch methods work normally when shadow mode is off
 */

import { DeployedState } from '../../../src/api/models/DashboardStatus';
import {
  setShadowMode,
  promoteChannel,
  resetShadowMode,
  isShadowMode,
} from '../../../src/cluster/ShadowMode';

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
const mockDispatchRawMessage = jest.fn().mockResolvedValue({
  getMessageId: () => 1,
  isProcessed: () => true,
  getConnectorMessages: () => new Map(),
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
    dispatchRawMessage: mockDispatchRawMessage,
    on: mockOn,
    emit: jest.fn(),
  })),
}));

jest.mock('../../../src/donkey/channel/ChannelBuilder', () => ({
  buildChannel: jest.fn().mockImplementation(() => {
    const { Channel } = require('../../../src/donkey/channel/Channel');
    return new Channel();
  }),
}));

jest.mock('../../../src/controllers/ChannelController', () => ({
  ChannelController: {
    getChannel: jest.fn().mockResolvedValue({
      id: 'test-channel-id',
      name: 'Test Channel',
      enabled: true,
      properties: { initialState: DeployedState.STARTED },
      revision: 1,
    }),
    getAllChannels: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../../src/db/SchemaManager', () => ({
  ensureChannelTables: jest.fn().mockResolvedValue(undefined),
}));

// Note: EngineController no longer imports from Mirth.ts (circular import broken).
// donkeyInstanceRef defaults to null, which is the desired state for shadow tests.

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
    getRawData() { return this.rawData; }
    getSourceMap() { return this.sourceMap; }
  },
}));

import { EngineController } from '../../../src/controllers/EngineController';
import { RawMessage } from '../../../src/model/RawMessage';

describe('EngineController shadow mode integration', () => {
  beforeEach(async () => {
    resetShadowMode();
    mockStart.mockClear();
    mockStop.mockClear();
    mockLoadStatisticsFromDb.mockClear();
    mockGetCurrentState.mockReturnValue(DeployedState.STOPPED);
    mockUpdateCurrentState.mockClear();
    mockDispatchRawMessage.mockClear();
    mockOn.mockClear();

    // Undeploy any channels left from previous tests
    try {
      await EngineController.undeployChannel('test-channel-id');
    } catch {
      // Ignore if not deployed
    }
  });

  describe('deployChannel() in shadow mode', () => {
    it('should NOT call start() when shadow mode is active and channel is not promoted', async () => {
      setShadowMode(true);

      await EngineController.deployChannel('test-channel-id');

      expect(mockStart).not.toHaveBeenCalled();
    });

    it('should call loadStatisticsFromDb() when shadow mode is active for dashboard display', async () => {
      setShadowMode(true);

      await EngineController.deployChannel('test-channel-id');

      expect(mockLoadStatisticsFromDb).toHaveBeenCalled();
    });

    it('should call start() when shadow mode is active but channel IS promoted', async () => {
      setShadowMode(true);
      promoteChannel('test-channel-id');

      await EngineController.deployChannel('test-channel-id');

      expect(mockStart).toHaveBeenCalled();
      expect(mockLoadStatisticsFromDb).not.toHaveBeenCalled();
    });

    it('should call start() normally when shadow mode is OFF', async () => {
      // Shadow mode is off by default after resetShadowMode()
      expect(isShadowMode()).toBe(false);

      await EngineController.deployChannel('test-channel-id');

      expect(mockStart).toHaveBeenCalled();
      expect(mockLoadStatisticsFromDb).not.toHaveBeenCalled();
    });

    it('should still register the channel as deployed in shadow mode', async () => {
      setShadowMode(true);

      await EngineController.deployChannel('test-channel-id');

      expect(EngineController.isDeployed('test-channel-id')).toBe(true);
    });
  });

  describe('dispatchMessage() shadow guard', () => {
    beforeEach(async () => {
      // Deploy the channel first (with shadow mode off so it is actually deployed)
      await EngineController.deployChannel('test-channel-id');
      mockStart.mockClear();
    });

    it('should throw when shadow mode is active and channel is not promoted', async () => {
      setShadowMode(true);

      await expect(
        EngineController.dispatchMessage('test-channel-id', '<msg/>')
      ).rejects.toThrow('shadow mode');
    });

    it('should allow dispatch when shadow mode is active and channel IS promoted', async () => {
      setShadowMode(true);
      promoteChannel('test-channel-id');

      await expect(
        EngineController.dispatchMessage('test-channel-id', '<msg/>')
      ).resolves.toBeDefined();
    });

    it('should allow dispatch normally when shadow mode is OFF', async () => {
      await expect(
        EngineController.dispatchMessage('test-channel-id', '<msg/>')
      ).resolves.toBeDefined();
    });
  });

  describe('dispatchRawMessage() shadow guard', () => {
    beforeEach(async () => {
      // Deploy the channel first
      await EngineController.deployChannel('test-channel-id');
      mockStart.mockClear();
    });

    it('should throw when shadow mode is active and channel is not promoted', async () => {
      setShadowMode(true);
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      await expect(
        EngineController.dispatchRawMessage('test-channel-id', rawMsg)
      ).rejects.toThrow('shadow mode');
    });

    it('should allow dispatch when shadow mode is active and channel IS promoted', async () => {
      setShadowMode(true);
      promoteChannel('test-channel-id');
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      await expect(
        EngineController.dispatchRawMessage('test-channel-id', rawMsg)
      ).resolves.toBeDefined();
    });

    it('should allow dispatch normally when shadow mode is OFF', async () => {
      const rawMsg = new RawMessage({ rawData: '<msg/>' });

      await expect(
        EngineController.dispatchRawMessage('test-channel-id', rawMsg)
      ).resolves.toBeDefined();
    });
  });
});
