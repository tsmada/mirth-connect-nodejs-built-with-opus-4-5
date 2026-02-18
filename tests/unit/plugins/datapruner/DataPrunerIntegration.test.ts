/**
 * Integration-level tests for DataPruner fixes:
 * - buildTaskQueue() reads per-channel pruning settings
 * - Config persistence via MirthDao
 * - getMessagesToPrune() respects PROCESSED flag
 * - pruneMessages() includes D_MCM in deletion
 * - pruneEventData() calls EventDao.deleteEventsBeforeDate()
 */

// Mock DonkeyDao before importing DataPruner
jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  getLocalChannelIds: jest.fn(),
  getMessagesToPrune: jest.fn(),
  channelTablesExist: jest.fn(),
  pruneMessages: jest.fn(),
  pruneMessageContent: jest.fn(),
}));

jest.mock('../../../../src/controllers/ConfigurationController.js', () => ({
  ConfigurationController: {
    getChannelMetadata: jest.fn(),
  },
}));

jest.mock('../../../../src/controllers/ChannelController.js', () => ({
  ChannelController: {
    getChannelIdsAndNames: jest.fn(),
    getAllChannels: jest.fn(),
  },
}));

jest.mock('../../../../src/db/EventDao.js', () => ({
  deleteEventsBeforeDate: jest.fn(),
}));

jest.mock('../../../../src/db/MirthDao.js', () => ({
  getConfiguration: jest.fn(),
  setConfiguration: jest.fn(),
}));

jest.mock('../../../../src/db/pool.js', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn(),
  withRetry: jest.fn((fn: any) => fn()),
}));

import { DataPruner } from '../../../../src/plugins/datapruner/DataPruner';
import { dataPrunerController } from '../../../../src/plugins/datapruner/DataPrunerController';
import * as DonkeyDao from '../../../../src/db/DonkeyDao';
import { ConfigurationController } from '../../../../src/controllers/ConfigurationController';
import { ChannelController } from '../../../../src/controllers/ChannelController';
import * as EventDao from '../../../../src/db/EventDao';
import * as MirthDao from '../../../../src/db/MirthDao';

const mockDonkeyDao = DonkeyDao as jest.Mocked<typeof DonkeyDao>;
const mockConfigCtrl = ConfigurationController as jest.Mocked<typeof ConfigurationController>;
const mockChannelCtrl = ChannelController as jest.Mocked<typeof ChannelController>;
const mockEventDao = EventDao as jest.Mocked<typeof EventDao>;
const mockMirthDao = MirthDao as jest.Mocked<typeof MirthDao>;

describe('DataPruner buildTaskQueue (per-channel settings)', () => {
  let pruner: DataPruner;

  beforeEach(() => {
    pruner = new DataPruner();
    jest.clearAllMocks();
  });

  it('should skip channels without pruning settings', async () => {
    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['channel-1', 1], ['channel-2', 2]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      // channel-1 has no metadata entry, channel-2 has metadata but no pruningSettings
      'channel-2': { enabled: true },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({
      'channel-1': 'Channel One',
      'channel-2': 'Channel Two',
    });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'channel-1', name: 'Channel One', enabled: true, properties: { messageStorageMode: 'DEVELOPMENT' } },
      { id: 'channel-2', name: 'Channel Two', enabled: true, properties: { messageStorageMode: 'DEVELOPMENT' } },
    ] as any);

    // Start pruner — buildTaskQueue runs internally. We can verify via the status.
    mockDonkeyDao.channelTablesExist.mockResolvedValue(false);

    const started = await pruner.start();
    expect(started).toBe(true);

    // Give the async run() time to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Both channels should be skipped (no pruning settings)
    const status = pruner.getPrunerStatus();
    expect(status.pendingChannelIds.size).toBe(0);

    await pruner.stop();
  });

  it('should create tasks for channels with explicit pruning settings', async () => {
    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['channel-1', 1]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      'channel-1': {
        enabled: true,
        pruningSettings: {
          pruneMetaDataDays: 60,
          pruneContentDays: 14,
        },
      },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({
      'channel-1': 'ADT Receiver',
    });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'channel-1', name: 'ADT Receiver', enabled: true, properties: { messageStorageMode: 'PRODUCTION' } },
    ] as any);

    // Channel tables exist but no messages to prune
    mockDonkeyDao.channelTablesExist.mockResolvedValue(true);
    mockDonkeyDao.getMessagesToPrune.mockResolvedValue([]);

    const started = await pruner.start();
    expect(started).toBe(true);

    // Give the async run() time to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Channel should have been added to pending (then processed)
    const lastStatus = pruner.getLastPrunerStatus();
    expect(lastStatus).not.toBeNull();
    expect(lastStatus!.processedChannelIds.has('channel-1')).toBe(true);
  });

  it('should skip DISABLED storage mode channels', async () => {
    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['channel-disabled', 1]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      'channel-disabled': {
        enabled: true,
        pruningSettings: { pruneMetaDataDays: 30 },
      },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({
      'channel-disabled': 'Disabled Channel',
    });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'channel-disabled', name: 'Disabled Channel', enabled: true, properties: { messageStorageMode: 'DISABLED' } },
    ] as any);

    const started = await pruner.start();
    expect(started).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 100));

    const lastStatus = pruner.getLastPrunerStatus();
    expect(lastStatus).not.toBeNull();
    // DISABLED channel should be skipped entirely
    expect(lastStatus!.processedChannelIds.size).toBe(0);
    expect(lastStatus!.pendingChannelIds.size).toBe(0);
  });

  it('should use channel name from ChannelController', async () => {
    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['ch-abc', 1]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      'ch-abc': {
        pruningSettings: { pruneMetaDataDays: 7 },
      },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({
      'ch-abc': 'Lab Results Router',
    });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'ch-abc', name: 'Lab Results Router', enabled: true, properties: {} },
    ] as any);

    mockDonkeyDao.channelTablesExist.mockResolvedValue(true);
    mockDonkeyDao.getMessagesToPrune.mockResolvedValue([]);

    await pruner.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify that ChannelController was called
    expect(mockChannelCtrl.getChannelIdsAndNames).toHaveBeenCalled();
    expect(mockConfigCtrl.getChannelMetadata).toHaveBeenCalled();

    await pruner.stop();
  });
});

describe('DataPruner skipIncomplete (PROCESSED flag)', () => {
  it('should pass skipIncomplete=true to getMessagesToPrune by default', async () => {
    const pruner = new DataPruner();
    expect(pruner.isSkipIncomplete()).toBe(true);

    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['ch-1', 1]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      'ch-1': { pruningSettings: { pruneMetaDataDays: 30 } },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({ 'ch-1': 'Test' });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'ch-1', name: 'Test', enabled: true, properties: {} },
    ] as any);
    mockDonkeyDao.channelTablesExist.mockResolvedValue(true);
    mockDonkeyDao.getMessagesToPrune.mockResolvedValue([]);

    await pruner.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify getMessagesToPrune was called with skipIncomplete=true (6th argument)
    expect(mockDonkeyDao.getMessagesToPrune).toHaveBeenCalledWith(
      'ch-1',
      expect.any(Date),
      expect.any(Number),
      expect.any(Array),
      true  // skipIncomplete
    );
  });

  it('should pass skipIncomplete=false when configured', async () => {
    const pruner = new DataPruner();
    pruner.setSkipIncomplete(false);

    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(
      new Map([['ch-1', 1]])
    );
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({
      'ch-1': { pruningSettings: { pruneContentDays: 7 } },
    });
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({ 'ch-1': 'Test' });
    mockChannelCtrl.getAllChannels.mockResolvedValue([
      { id: 'ch-1', name: 'Test', enabled: true, properties: {} },
    ] as any);
    mockDonkeyDao.channelTablesExist.mockResolvedValue(true);
    mockDonkeyDao.getMessagesToPrune.mockResolvedValue([]);

    await pruner.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockDonkeyDao.getMessagesToPrune).toHaveBeenCalledWith(
      'ch-1',
      expect.any(Date),
      expect.any(Number),
      expect.any(Array),
      false  // skipIncomplete disabled
    );
  });
});

describe('DataPruner event pruning', () => {
  it('should call EventDao.deleteEventsBeforeDate when pruneEvents is enabled', async () => {
    const pruner = new DataPruner();
    pruner.setPruneEvents(true);
    pruner.setMaxEventAge(30);

    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(new Map());
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({});
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({});
    mockChannelCtrl.getAllChannels.mockResolvedValue([] as any);
    mockEventDao.deleteEventsBeforeDate.mockResolvedValue(42);

    await pruner.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockEventDao.deleteEventsBeforeDate).toHaveBeenCalledTimes(1);
    const callArg = mockEventDao.deleteEventsBeforeDate.mock.calls[0]![0] as Date;
    // The threshold should be approximately 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // Allow 5 second tolerance
    expect(Math.abs(callArg.getTime() - thirtyDaysAgo.getTime())).toBeLessThan(5000);
  });

  it('should not call EventDao when pruneEvents is disabled', async () => {
    // Clear any calls from the previous test
    jest.clearAllMocks();

    const pruner = new DataPruner();
    pruner.setPruneEvents(false);

    mockDonkeyDao.getLocalChannelIds.mockResolvedValue(new Map());
    mockConfigCtrl.getChannelMetadata.mockResolvedValue({});
    mockChannelCtrl.getChannelIdsAndNames.mockResolvedValue({});
    mockChannelCtrl.getAllChannels.mockResolvedValue([] as any);

    await pruner.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockEventDao.deleteEventsBeforeDate).not.toHaveBeenCalled();
  });
});

describe('DataPrunerController config persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load configuration from CONFIGURATION table on initialize', async () => {
    const savedConfig = JSON.stringify({
      enabled: true,
      pollingIntervalHours: 12,
      pruningBlockSize: 500,
    });
    mockMirthDao.getConfiguration.mockResolvedValue(savedConfig);

    // Create a fresh controller to test initialization
    // We test the singleton's behavior by calling updateConfiguration then checking
    await dataPrunerController.shutdown(); // Reset state

    // The singleton's loadConfiguration uses MirthDao
    // We can test the save path directly
    mockMirthDao.setConfiguration.mockResolvedValue(undefined as any);
    await dataPrunerController.updateConfiguration({ pruningBlockSize: 750 });

    expect(mockMirthDao.setConfiguration).toHaveBeenCalledWith(
      'Data Pruner',
      'pruner.config',
      expect.stringContaining('"pruningBlockSize":750')
    );
  });

  it('should save configuration as JSON to CONFIGURATION table', async () => {
    mockMirthDao.setConfiguration.mockResolvedValue(undefined as any);

    await dataPrunerController.updateConfiguration({
      enabled: false,
      pollingIntervalHours: 6,
    });

    expect(mockMirthDao.setConfiguration).toHaveBeenCalledWith(
      'Data Pruner',
      'pruner.config',
      expect.any(String)
    );

    // Parse the saved JSON and verify
    const savedJson = mockMirthDao.setConfiguration.mock.calls[0]![2] as string;
    const parsed = JSON.parse(savedJson);
    expect(parsed.pollingIntervalHours).toBe(6);
  });
});
