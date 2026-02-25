/**
 * Tests for EngineController.startDeployedChannels() semaphore-based concurrency
 * and deployChannel() with startAfterDeploy option.
 */

import { DeployedState } from '../../../src/api/models/DashboardStatus';

// --- Track mock calls ---
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockHalt = jest.fn().mockResolvedValue(undefined);
const mockLoadStatisticsFromDb = jest.fn().mockResolvedValue(undefined);
const mockGetCurrentState = jest.fn().mockReturnValue(DeployedState.STOPPED);
const mockUpdateCurrentState = jest.fn();
const mockGetId = jest.fn().mockReturnValue('ch-1');
const mockGetName = jest.fn().mockReturnValue('Channel One');
const mockGetSourceConnector = jest.fn().mockReturnValue(null);
const mockGetDestinationConnectors = jest.fn().mockReturnValue([]);
const mockGetStatistics = jest.fn().mockReturnValue({
  received: 0,
  sent: 0,
  error: 0,
  filtered: 0,
  queued: 0,
});
const mockOn = jest.fn();
const mockSetExecutor = jest.fn();

jest.mock('../../../src/donkey/channel/Channel', () => ({
  Channel: jest.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    halt: mockHalt,
    loadStatisticsFromDb: mockLoadStatisticsFromDb,
    getCurrentState: mockGetCurrentState,
    updateCurrentState: mockUpdateCurrentState,
    getId: mockGetId,
    getName: mockGetName,
    getSourceConnector: mockGetSourceConnector,
    getDestinationConnectors: mockGetDestinationConnectors,
    getStatistics: mockGetStatistics,
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

const mockGetChannel = jest.fn();
jest.mock('../../../src/controllers/ChannelController', () => ({
  ChannelController: {
    getChannel: (...args: unknown[]) => mockGetChannel(...args),
    getAllChannels: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../../src/controllers/ConfigurationController', () => ({
  ConfigurationController: {
    getGlobalScripts: jest.fn().mockResolvedValue({ Preprocessor: '', Postprocessor: '' }),
  },
}));

jest.mock('../../../src/db/SchemaManager', () => ({
  ensureChannelTables: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/cluster/ShadowMode', () => ({
  isShadowMode: jest.fn(() => false),
  isChannelActive: jest.fn(() => true),
  isChannelPromoted: jest.fn(() => false),
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

jest.mock('../../../src/cluster/ChannelRegistry', () => ({
  registerDeployment: jest.fn().mockResolvedValue(undefined),
  unregisterDeployment: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../../src/db/DonkeyDao', () => ({
  selectMaxMessageId: jest.fn().mockResolvedValue(0),
  insertChannelMapping: jest.fn().mockResolvedValue(undefined),
  deleteStatisticsForChannel: jest.fn().mockResolvedValue(undefined),
  batchInitializeStatistics: jest.fn().mockResolvedValue(undefined),
}));

import { EngineController } from '../../../src/controllers/EngineController';

// Helper to deploy a channel into EngineController's internal map
async function deployTestChannel(channelId: string, name: string): Promise<void> {
  mockGetChannel.mockResolvedValueOnce({
    id: channelId,
    name,
    enabled: true,
    revision: 1,
    properties: { initialState: 'STARTED' },
    sourceConnector: { transportName: 'HTTP Listener', properties: {} },
    destinationConnectors: [],
  });

  await EngineController.deployChannel(channelId, { startAfterDeploy: false });
}

describe('EngineController.startDeployedChannels', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStart.mockResolvedValue(undefined);
    mockGetCurrentState.mockReturnValue(DeployedState.STOPPED);
    await EngineController.undeployAllChannels();
  });

  afterEach(async () => {
    await EngineController.undeployAllChannels();
  });

  it('should start all deployed channels', async () => {
    await deployTestChannel('ch-001', 'Channel 1');
    await deployTestChannel('ch-002', 'Channel 2');
    await deployTestChannel('ch-003', 'Channel 3');

    await EngineController.startDeployedChannels(['ch-001', 'ch-002', 'ch-003']);

    expect(mockStart).toHaveBeenCalledTimes(3);
  });

  it('should skip non-deployed channel IDs gracefully', async () => {
    await deployTestChannel('ch-001', 'Channel 1');

    await EngineController.startDeployedChannels(['ch-001', 'ch-nonexistent']);

    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('should handle empty channelIds array', async () => {
    await EngineController.startDeployedChannels([]);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('should continue starting other channels if one fails', async () => {
    await deployTestChannel('ch-001', 'Channel 1');
    await deployTestChannel('ch-002', 'Channel 2');
    await deployTestChannel('ch-003', 'Channel 3');

    mockStart
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('EADDRINUSE'))
      .mockResolvedValueOnce(undefined);

    await EngineController.startDeployedChannels(['ch-001', 'ch-002', 'ch-003']);

    expect(mockStart).toHaveBeenCalledTimes(3);
  });

  it('should respect concurrency limit', async () => {
    for (let i = 1; i <= 6; i++) {
      await deployTestChannel(`ch-${String(i).padStart(3, '0')}`, `Channel ${i}`);
    }

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockStart.mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      currentConcurrent--;
    });

    await EngineController.startDeployedChannels(
      ['ch-001', 'ch-002', 'ch-003', 'ch-004', 'ch-005', 'ch-006'],
      { concurrency: 2 }
    );

    expect(mockStart).toHaveBeenCalledTimes(6);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should default concurrency to 10 when not specified', async () => {
    for (let i = 1; i <= 12; i++) {
      await deployTestChannel(`ch-${String(i).padStart(3, '0')}`, `Channel ${i}`);
    }

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockStart.mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      currentConcurrent--;
    });

    const ids = Array.from({ length: 12 }, (_, i) => `ch-${String(i + 1).padStart(3, '0')}`);
    await EngineController.startDeployedChannels(ids);

    expect(mockStart).toHaveBeenCalledTimes(12);
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it('should leave channel STOPPED when startAfterDeploy=false', async () => {
    mockGetChannel.mockResolvedValueOnce({
      id: 'ch-test',
      name: 'Test Channel',
      enabled: true,
      revision: 1,
      properties: { initialState: 'STARTED' },
      sourceConnector: { transportName: 'HTTP Listener', properties: {} },
      destinationConnectors: [],
    });

    await EngineController.deployChannel('ch-test', { startAfterDeploy: false });

    // start() should NOT have been called during deploy
    expect(mockStart).not.toHaveBeenCalled();
    // But stats should have been loaded (for dashboard display)
    expect(mockLoadStatisticsFromDb).toHaveBeenCalledTimes(1);
  });
});
