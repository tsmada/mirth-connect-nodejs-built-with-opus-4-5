/**
 * ChannelUtil Unit Tests
 *
 * Tests for the ChannelUtil class and static wrapper functions including:
 * - Constructor (singleton, custom controllers, missing controllers)
 * - Channel name/ID query methods
 * - Channel control methods (start, stop, pause, resume, halt, deploy, undeploy)
 * - Connector control methods (startConnector, stopConnector, getConnectorState)
 * - Statistics methods (received, filtered, queued, sent, error counts)
 * - resetStatistics (all overloads)
 * - Private helpers: convertId, getDashboardStatus, getStatisticByStatus, clearStatistics
 * - Static wrapper functions (all 20+)
 * - Singleton lifecycle (getInstance, resetChannelUtilInstance)
 */

import {
  ChannelUtil,
  IChannelUtilChannelController,
  IChannelUtilEngineController,
  IDashboardStatus,
  IDeployedChannel,
  IErrorTaskHandler,
  setChannelUtilChannelController,
  setChannelUtilEngineController,
  getChannelUtilChannelController,
  getChannelUtilEngineController,
  resetChannelUtilInstance,
  // Static wrappers
  getChannelNames,
  getChannelIds,
  getDeployedChannelNames,
  getDeployedChannelIds,
  getChannelName,
  getDeployedChannelName,
  getDeployedChannelId,
  startChannel,
  stopChannel,
  pauseChannel,
  resumeChannel,
  haltChannel,
  deployChannel,
  undeployChannel,
  isChannelDeployed,
  getChannelState,
  startConnector,
  stopConnector,
  getConnectorState,
  getReceivedCount,
  getFilteredCount,
  getQueuedCount,
  getSentCount,
  getErrorCount,
  resetStatistics,
} from '../../../../src/javascript/userutil/ChannelUtil.js';
import { DeployedState } from '../../../../src/javascript/userutil/DeployedState.js';
import { Status } from '../../../../src/model/Status.js';

// ====================================================
// Mock factory helpers
// ====================================================

function createMockChannelController(): IChannelUtilChannelController {
  return {
    getChannelNames: jest.fn().mockReturnValue(['ADT Receiver', 'Lab Orders', 'Pharmacy']),
    getChannelIds: jest.fn().mockReturnValue(['ch-1', 'ch-2', 'ch-3']),
    getChannelById: jest.fn().mockImplementation((id: string) => {
      const map: Record<string, { id: string; name: string } | null> = {
        'ch-1': { id: 'ch-1', name: 'ADT Receiver' },
        'ch-2': { id: 'ch-2', name: 'Lab Orders' },
        'ch-3': { id: 'ch-3', name: 'Pharmacy' },
      };
      return map[id] ?? null;
    }),
    getChannelByName: jest.fn().mockImplementation((name: string) => {
      const map: Record<string, { id: string; name: string } | null> = {
        'ADT Receiver': { id: 'ch-1', name: 'ADT Receiver' },
        'Lab Orders': { id: 'ch-2', name: 'Lab Orders' },
        'Pharmacy': { id: 'ch-3', name: 'Pharmacy' },
      };
      return map[name] ?? null;
    }),
    getDeployedChannels: jest.fn().mockReturnValue([
      { id: 'ch-1', name: 'ADT Receiver' },
      { id: 'ch-2', name: 'Lab Orders' },
    ]),
    getDeployedChannelById: jest.fn().mockImplementation((id: string) => {
      if (id === 'ch-1') return { id: 'ch-1', name: 'ADT Receiver' };
      if (id === 'ch-2') return { id: 'ch-2', name: 'Lab Orders' };
      return null;
    }),
    getDeployedChannelByName: jest.fn().mockImplementation((name: string) => {
      if (name === 'ADT Receiver') return { id: 'ch-1', name: 'ADT Receiver' };
      if (name === 'Lab Orders') return { id: 'ch-2', name: 'Lab Orders' };
      return null;
    }),
    resetStatistics: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockErrorHandler(errored: boolean, error: Error | null = null): IErrorTaskHandler {
  return {
    isErrored: () => errored,
    getError: () => error,
  };
}

function createMockEngineController(): IChannelUtilEngineController {
  const successHandler = createMockErrorHandler(false);
  return {
    getDeployedIds: jest.fn().mockReturnValue(new Set(['ch-1', 'ch-2'])),
    getDeployedChannel: jest.fn().mockImplementation((id: string) => {
      if (id === 'ch-1') return { getMetaDataIds: () => [0, 1, 2] } as IDeployedChannel;
      if (id === 'ch-2') return { getMetaDataIds: () => [0, 1] } as IDeployedChannel;
      return null;
    }),
    getChannelStatus: jest.fn().mockImplementation((id: string) => {
      if (id === 'ch-1') {
        const stats = new Map<Status, number>([
          [Status.RECEIVED, 100],
          [Status.FILTERED, 5],
          [Status.SENT, 90],
          [Status.ERROR, 3],
        ]);
        return {
          channelId: 'ch-1',
          name: 'ADT Receiver',
          state: DeployedState.STARTED,
          queued: 2,
          statistics: stats,
          childStatuses: [
            {
              channelId: 'ch-1',
              name: 'Source',
              state: DeployedState.STARTED,
              metaDataId: 0,
              queued: 0,
              statistics: new Map<Status, number>([
                [Status.RECEIVED, 100],
                [Status.FILTERED, 5],
              ]),
            },
            {
              channelId: 'ch-1',
              name: 'HTTP Sender',
              state: DeployedState.STARTED,
              metaDataId: 1,
              queued: 2,
              statistics: new Map<Status, number>([
                [Status.SENT, 90],
                [Status.ERROR, 3],
              ]),
            },
          ],
        } as IDashboardStatus;
      }
      return null;
    }),
    startChannels: jest.fn().mockResolvedValue(successHandler),
    stopChannels: jest.fn().mockResolvedValue(successHandler),
    pauseChannels: jest.fn().mockResolvedValue(successHandler),
    resumeChannels: jest.fn().mockResolvedValue(successHandler),
    haltChannels: jest.fn().mockResolvedValue(successHandler),
    deployChannels: jest.fn().mockResolvedValue(successHandler),
    undeployChannels: jest.fn().mockResolvedValue(successHandler),
    startConnector: jest.fn().mockResolvedValue(successHandler),
    stopConnector: jest.fn().mockResolvedValue(successHandler),
  };
}

describe('ChannelUtil', () => {
  let mockChannelCtrl: IChannelUtilChannelController;
  let mockEngineCtrl: IChannelUtilEngineController;

  beforeEach(() => {
    mockChannelCtrl = createMockChannelController();
    mockEngineCtrl = createMockEngineController();

    // Set global singletons
    setChannelUtilChannelController(mockChannelCtrl);
    setChannelUtilEngineController(mockEngineCtrl);

    // Reset singleton instance
    resetChannelUtilInstance();
  });

  afterEach(() => {
    setChannelUtilChannelController(null as unknown as IChannelUtilChannelController);
    setChannelUtilEngineController(null as unknown as IChannelUtilEngineController);
    resetChannelUtilInstance();
  });

  // ===========================================
  // Controller setters/getters
  // ===========================================
  describe('controller setters and getters', () => {
    it('setChannelUtilChannelController / getChannelUtilChannelController', () => {
      expect(getChannelUtilChannelController()).toBe(mockChannelCtrl);
    });

    it('setChannelUtilEngineController / getChannelUtilEngineController', () => {
      expect(getChannelUtilEngineController()).toBe(mockEngineCtrl);
    });
  });

  // ===========================================
  // Constructor
  // ===========================================
  describe('constructor', () => {
    it('should create with global singleton controllers', () => {
      const util = new ChannelUtil();
      expect(util).toBeInstanceOf(ChannelUtil);
    });

    it('should create with custom controllers', () => {
      const customCh = createMockChannelController();
      const customEng = createMockEngineController();
      const util = new ChannelUtil(customCh, customEng);
      expect(util).toBeInstanceOf(ChannelUtil);
      // Verify it uses custom controllers, not global ones
      util.getChannelNames();
      expect(customCh.getChannelNames).toHaveBeenCalled();
      expect(mockChannelCtrl.getChannelNames).not.toHaveBeenCalled();
    });

    it('should throw when no channel controller is available', () => {
      setChannelUtilChannelController(null as unknown as IChannelUtilChannelController);
      expect(() => new ChannelUtil()).toThrow('No channel controller available');
    });

    it('should throw when no engine controller is available', () => {
      setChannelUtilEngineController(null as unknown as IChannelUtilEngineController);
      expect(() => new ChannelUtil()).toThrow('No engine controller available');
    });

    it('should use global channel controller when custom not provided', () => {
      const util = new ChannelUtil(undefined, mockEngineCtrl);
      util.getChannelNames();
      expect(mockChannelCtrl.getChannelNames).toHaveBeenCalled();
    });

    it('should use global engine controller when custom not provided', () => {
      const util = new ChannelUtil(mockChannelCtrl);
      util.isChannelDeployed('ch-1');
      expect(mockEngineCtrl.getDeployedIds).toHaveBeenCalled();
    });
  });

  // ===========================================
  // Channel Name/ID Query Methods
  // ===========================================
  describe('channel name/ID queries', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    it('getChannelNames returns all channel names', () => {
      const names = util.getChannelNames();
      expect(names).toEqual(['ADT Receiver', 'Lab Orders', 'Pharmacy']);
    });

    it('getChannelIds returns all channel IDs', () => {
      const ids = util.getChannelIds();
      expect(ids).toEqual(['ch-1', 'ch-2', 'ch-3']);
    });

    it('getDeployedChannelNames returns deployed channel names', () => {
      const names = util.getDeployedChannelNames();
      expect(names).toEqual(['ADT Receiver', 'Lab Orders']);
    });

    it('getDeployedChannelIds returns deployed channel IDs', () => {
      const ids = util.getDeployedChannelIds();
      expect(ids).toEqual(['ch-1', 'ch-2']);
    });

    it('getChannelName returns name for known ID', () => {
      expect(util.getChannelName('ch-1')).toBe('ADT Receiver');
    });

    it('getChannelName returns null for unknown ID', () => {
      expect(util.getChannelName('ch-999')).toBeNull();
    });

    it('getDeployedChannelName returns name for deployed channel', () => {
      expect(util.getDeployedChannelName('ch-1')).toBe('ADT Receiver');
    });

    it('getDeployedChannelName returns null for non-deployed channel', () => {
      expect(util.getDeployedChannelName('ch-3')).toBeNull();
    });

    it('getDeployedChannelId returns ID for deployed channel name', () => {
      expect(util.getDeployedChannelId('ADT Receiver')).toBe('ch-1');
    });

    it('getDeployedChannelId returns null for unknown name', () => {
      expect(util.getDeployedChannelId('Unknown Channel')).toBeNull();
    });
  });

  // ===========================================
  // convertId (tested through public methods)
  // ===========================================
  describe('convertId (ID-or-name resolution)', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    it('should pass through a known channel ID', () => {
      expect(util.isChannelDeployed('ch-1')).toBe(true);
      // ch-1 is in getChannelIds(), so it should be used directly
    });

    it('should resolve channel name to ID via deployed cache first', () => {
      // 'ADT Receiver' is not a channel ID, so convertId looks it up by name
      expect(util.isChannelDeployed('ADT Receiver')).toBe(true);
      expect(mockChannelCtrl.getDeployedChannelByName).toHaveBeenCalledWith('ADT Receiver');
    });

    it('should fall back to regular cache when not found in deployed cache', () => {
      // 'Pharmacy' is not deployed, so getDeployedChannelByName returns null,
      // then getChannelByName is checked
      expect(util.isChannelDeployed('Pharmacy')).toBe(false);
      expect(mockChannelCtrl.getDeployedChannelByName).toHaveBeenCalledWith('Pharmacy');
      expect(mockChannelCtrl.getChannelByName).toHaveBeenCalledWith('Pharmacy');
    });

    it('should return the original string when not found anywhere', () => {
      // Pass a string that is neither a channel ID nor a channel name
      const result = util.isChannelDeployed('totally-unknown');
      expect(result).toBe(false);
      // It should have tried deployed and regular name lookups
      expect(mockChannelCtrl.getDeployedChannelByName).toHaveBeenCalledWith('totally-unknown');
      expect(mockChannelCtrl.getChannelByName).toHaveBeenCalledWith('totally-unknown');
    });
  });

  // ===========================================
  // Channel Control Methods
  // ===========================================
  describe('channel control methods', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    describe('startChannel', () => {
      it('should start a channel by ID and return a Future', async () => {
        const future = util.startChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.startChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should start a channel by name', async () => {
        const future = util.startChannel('ADT Receiver');
        await future.get();
        expect(mockEngineCtrl.startChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Start failed'));
        (mockEngineCtrl.startChannels as jest.Mock).mockResolvedValue(errorHandler);

        const future = util.startChannel('ch-1');
        await expect(future.get()).rejects.toThrow('Start failed');
      });

      it('should throw when handler errored but getError returns null', async () => {
        const errorHandler = createMockErrorHandler(true, null);
        (mockEngineCtrl.startChannels as jest.Mock).mockResolvedValue(errorHandler);

        const future = util.startChannel('ch-1');
        // throw null → Future.get() wraps non-Error rejections via new Error(String(null))
        await expect(future.get()).rejects.toThrow('null');
      });
    });

    describe('stopChannel', () => {
      it('should stop a channel and return a Future', async () => {
        const future = util.stopChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.stopChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Stop failed'));
        (mockEngineCtrl.stopChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.stopChannel('ch-1').get()).rejects.toThrow('Stop failed');
      });
    });

    describe('pauseChannel', () => {
      it('should pause a channel and return a Future', async () => {
        const future = util.pauseChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.pauseChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Pause failed'));
        (mockEngineCtrl.pauseChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.pauseChannel('ch-1').get()).rejects.toThrow('Pause failed');
      });
    });

    describe('resumeChannel', () => {
      it('should resume a channel and return a Future', async () => {
        const future = util.resumeChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.resumeChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Resume failed'));
        (mockEngineCtrl.resumeChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.resumeChannel('ch-1').get()).rejects.toThrow('Resume failed');
      });
    });

    describe('haltChannel', () => {
      it('should halt a channel and return a Future', async () => {
        const future = util.haltChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.haltChannels).toHaveBeenCalledWith(new Set(['ch-1']));
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Halt failed'));
        (mockEngineCtrl.haltChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.haltChannel('ch-1').get()).rejects.toThrow('Halt failed');
      });
    });

    describe('deployChannel', () => {
      it('should deploy a channel and return a Future', async () => {
        const future = util.deployChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.deployChannels).toHaveBeenCalledWith(new Set(['ch-1']), null);
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Deploy failed'));
        (mockEngineCtrl.deployChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.deployChannel('ch-1').get()).rejects.toThrow('Deploy failed');
      });
    });

    describe('undeployChannel', () => {
      it('should undeploy a channel and return a Future', async () => {
        const future = util.undeployChannel('ch-1');
        await future.get();
        expect(mockEngineCtrl.undeployChannels).toHaveBeenCalledWith(new Set(['ch-1']), null);
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Undeploy failed'));
        (mockEngineCtrl.undeployChannels as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.undeployChannel('ch-1').get()).rejects.toThrow('Undeploy failed');
      });
    });
  });

  // ===========================================
  // isChannelDeployed / getChannelState
  // ===========================================
  describe('deployment state queries', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    it('isChannelDeployed returns true for deployed channel', () => {
      expect(util.isChannelDeployed('ch-1')).toBe(true);
    });

    it('isChannelDeployed returns false for non-deployed channel', () => {
      expect(util.isChannelDeployed('ch-3')).toBe(false);
    });

    it('isChannelDeployed works with channel name', () => {
      expect(util.isChannelDeployed('ADT Receiver')).toBe(true);
    });

    it('getChannelState returns state for deployed channel', () => {
      expect(util.getChannelState('ch-1')).toBe(DeployedState.STARTED);
    });

    it('getChannelState returns null for non-deployed channel', () => {
      expect(util.getChannelState('ch-3')).toBeNull();
    });
  });

  // ===========================================
  // Connector Control Methods
  // ===========================================
  describe('connector control methods', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    describe('startConnector', () => {
      it('should start a connector and return a Future', async () => {
        const future = util.startConnector('ch-1', 1);
        await future.get();
        const expectedMap = new Map<string, number[]>();
        expectedMap.set('ch-1', [1]);
        expect(mockEngineCtrl.startConnector).toHaveBeenCalledWith(expectedMap);
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Connector start failed'));
        (mockEngineCtrl.startConnector as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.startConnector('ch-1', 1).get()).rejects.toThrow('Connector start failed');
      });
    });

    describe('stopConnector', () => {
      it('should stop a connector and return a Future', async () => {
        const future = util.stopConnector('ch-1', 1);
        await future.get();
        const expectedMap = new Map<string, number[]>();
        expectedMap.set('ch-1', [1]);
        expect(mockEngineCtrl.stopConnector).toHaveBeenCalledWith(expectedMap);
      });

      it('should throw when handler reports error', async () => {
        const errorHandler = createMockErrorHandler(true, new Error('Connector stop failed'));
        (mockEngineCtrl.stopConnector as jest.Mock).mockResolvedValue(errorHandler);

        await expect(util.stopConnector('ch-1', 1).get()).rejects.toThrow('Connector stop failed');
      });
    });

    describe('getConnectorState', () => {
      it('should return connector state for valid metaDataId', () => {
        // metaDataId 1 maps to 'HTTP Sender' child status
        expect(util.getConnectorState('ch-1', 1)).toBe(DeployedState.STARTED);
      });

      it('should return null for unknown metaDataId', () => {
        // metaDataId 99 does not exist in child statuses
        expect(util.getConnectorState('ch-1', 99)).toBeNull();
      });

      it('should return null for non-deployed channel', () => {
        expect(util.getConnectorState('ch-3', 0)).toBeNull();
      });

      it('should handle float metaDataId by flooring', () => {
        // Math.floor(1.7) === 1, which should match metaDataId 1
        expect(util.getConnectorState('ch-1', 1.7)).toBe(DeployedState.STARTED);
      });
    });
  });

  // ===========================================
  // getDashboardStatus (tested indirectly)
  // ===========================================
  describe('getDashboardStatus edge cases', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    it('should return channel-level status when metaDataId is null (via getChannelState)', () => {
      // getChannelState passes metaDataId=null internally
      expect(util.getChannelState('ch-1')).toBe(DeployedState.STARTED);
    });

    it('should return null when channel has no childStatuses and metaDataId requested', () => {
      // Override to return status without childStatuses
      (mockEngineCtrl.getChannelStatus as jest.Mock).mockReturnValue({
        channelId: 'ch-1',
        name: 'ADT Receiver',
        state: DeployedState.STARTED,
        statistics: new Map(),
        // No childStatuses field
      } as IDashboardStatus);

      expect(util.getConnectorState('ch-1', 1)).toBeNull();
    });
  });

  // ===========================================
  // Statistics Methods
  // ===========================================
  describe('statistics methods', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    describe('getReceivedCount', () => {
      it('returns channel-level received count', () => {
        expect(util.getReceivedCount('ch-1')).toBe(100);
      });

      it('returns connector-level received count', () => {
        expect(util.getReceivedCount('ch-1', 0)).toBe(100);
      });

      it('returns null for non-deployed channel', () => {
        expect(util.getReceivedCount('ch-3')).toBeNull();
      });
    });

    describe('getFilteredCount', () => {
      it('returns channel-level filtered count', () => {
        expect(util.getFilteredCount('ch-1')).toBe(5);
      });

      it('returns connector-level filtered count', () => {
        expect(util.getFilteredCount('ch-1', 0)).toBe(5);
      });

      it('returns null for non-deployed channel', () => {
        expect(util.getFilteredCount('ch-3')).toBeNull();
      });
    });

    describe('getQueuedCount', () => {
      it('returns channel-level queued count', () => {
        expect(util.getQueuedCount('ch-1')).toBe(2);
      });

      it('returns connector-level queued count', () => {
        // Source connector has queued=0
        expect(util.getQueuedCount('ch-1', 0)).toBe(0);
      });

      it('returns connector-level queued count for destination', () => {
        // HTTP Sender has queued=2
        expect(util.getQueuedCount('ch-1', 1)).toBe(2);
      });

      it('returns null for non-deployed channel', () => {
        expect(util.getQueuedCount('ch-3')).toBeNull();
      });

      it('returns null when queued is undefined', () => {
        // Override to return status without queued field
        (mockEngineCtrl.getChannelStatus as jest.Mock).mockReturnValue({
          channelId: 'ch-1',
          name: 'ADT Receiver',
          state: DeployedState.STARTED,
          statistics: new Map(),
          // queued not set
        } as IDashboardStatus);

        expect(util.getQueuedCount('ch-1')).toBeNull();
      });
    });

    describe('getSentCount', () => {
      it('returns channel-level sent count', () => {
        expect(util.getSentCount('ch-1')).toBe(90);
      });

      it('returns connector-level sent count', () => {
        // HTTP Sender has sent=90
        expect(util.getSentCount('ch-1', 1)).toBe(90);
      });

      it('returns null when status not in statistics map', () => {
        // Source connector (metaDataId=0) has no SENT in its stats
        expect(util.getSentCount('ch-1', 0)).toBeNull();
      });
    });

    describe('getErrorCount', () => {
      it('returns channel-level error count', () => {
        expect(util.getErrorCount('ch-1')).toBe(3);
      });

      it('returns connector-level error count', () => {
        expect(util.getErrorCount('ch-1', 1)).toBe(3);
      });

      it('returns null for non-deployed channel', () => {
        expect(util.getErrorCount('ch-3')).toBeNull();
      });
    });
  });

  // ===========================================
  // resetStatistics
  // ===========================================
  describe('resetStatistics', () => {
    let util: ChannelUtil;

    beforeEach(() => {
      util = new ChannelUtil();
    });

    it('should reset all statistics for a channel (no metaDataId)', async () => {
      const future = util.resetStatistics('ch-1');
      await future.get();

      expect(mockChannelCtrl.resetStatistics).toHaveBeenCalledWith(
        expect.any(Map),
        expect.any(Set)
      );

      const [channelMap, statuses] = (mockChannelCtrl.resetStatistics as jest.Mock).mock.calls[0]!;
      expect(channelMap.get('ch-1')).toEqual([0, 1, 2, null]); // all metadata IDs + null for aggregate
      expect(statuses).toEqual(new Set([Status.RECEIVED, Status.FILTERED, Status.ERROR, Status.SENT]));
    });

    it('should reset statistics for a specific connector', async () => {
      const future = util.resetStatistics('ch-1', 1);
      await future.get();

      const [channelMap] = (mockChannelCtrl.resetStatistics as jest.Mock).mock.calls[0]!;
      expect(channelMap.get('ch-1')).toEqual([1]); // only metaDataId 1
    });

    it('should reset specific statuses only', async () => {
      const future = util.resetStatistics('ch-1', null, [Status.ERROR]);
      await future.get();

      const [, statuses] = (mockChannelCtrl.resetStatistics as jest.Mock).mock.calls[0]!;
      expect(statuses).toEqual(new Set([Status.ERROR]));
    });

    it('should filter out non-resetable statuses', async () => {
      const future = util.resetStatistics('ch-1', null, [Status.ERROR, Status.QUEUED, Status.TRANSFORMED]);
      await future.get();

      const [, statuses] = (mockChannelCtrl.resetStatistics as jest.Mock).mock.calls[0]!;
      // Only ERROR is resetable; QUEUED and TRANSFORMED are not in RESETABLE_STATUSES
      expect(statuses).toEqual(new Set([Status.ERROR]));
    });

    it('should skip non-deployed channel', async () => {
      const future = util.resetStatistics('ch-3');
      await future.get();

      expect(mockChannelCtrl.resetStatistics).not.toHaveBeenCalled();
    });

    it('should skip connector if metaDataId not found in deployed channel', async () => {
      const future = util.resetStatistics('ch-1', 99); // metaDataId 99 doesn't exist
      await future.get();

      // connectorList becomes empty, so resetStatistics should not be called
      expect(mockChannelCtrl.resetStatistics).not.toHaveBeenCalled();
    });

    it('should handle null metaDataId for aggregate stats', async () => {
      const future = util.resetStatistics('ch-1', null);
      await future.get();

      const [channelMap] = (mockChannelCtrl.resetStatistics as jest.Mock).mock.calls[0]!;
      const connectorList = channelMap.get('ch-1');
      // metaDataId=null => all IDs + null appended
      expect(connectorList).toContain(null);
      expect(connectorList).toContain(0);
      expect(connectorList).toContain(1);
      expect(connectorList).toContain(2);
    });
  });

  // ===========================================
  // Static wrapper functions
  // ===========================================
  describe('static wrapper functions', () => {
    it('getChannelNames delegates to singleton', () => {
      expect(getChannelNames()).toEqual(['ADT Receiver', 'Lab Orders', 'Pharmacy']);
    });

    it('getChannelIds delegates to singleton', () => {
      expect(getChannelIds()).toEqual(['ch-1', 'ch-2', 'ch-3']);
    });

    it('getDeployedChannelNames delegates to singleton', () => {
      expect(getDeployedChannelNames()).toEqual(['ADT Receiver', 'Lab Orders']);
    });

    it('getDeployedChannelIds delegates to singleton', () => {
      expect(getDeployedChannelIds()).toEqual(['ch-1', 'ch-2']);
    });

    it('getChannelName delegates to singleton', () => {
      expect(getChannelName('ch-1')).toBe('ADT Receiver');
    });

    it('getDeployedChannelName delegates to singleton', () => {
      expect(getDeployedChannelName('ch-1')).toBe('ADT Receiver');
    });

    it('getDeployedChannelId delegates to singleton', () => {
      expect(getDeployedChannelId('ADT Receiver')).toBe('ch-1');
    });

    it('startChannel delegates to singleton', async () => {
      await startChannel('ch-1').get();
      expect(mockEngineCtrl.startChannels).toHaveBeenCalled();
    });

    it('stopChannel delegates to singleton', async () => {
      await stopChannel('ch-1').get();
      expect(mockEngineCtrl.stopChannels).toHaveBeenCalled();
    });

    it('pauseChannel delegates to singleton', async () => {
      await pauseChannel('ch-1').get();
      expect(mockEngineCtrl.pauseChannels).toHaveBeenCalled();
    });

    it('resumeChannel delegates to singleton', async () => {
      await resumeChannel('ch-1').get();
      expect(mockEngineCtrl.resumeChannels).toHaveBeenCalled();
    });

    it('haltChannel delegates to singleton', async () => {
      await haltChannel('ch-1').get();
      expect(mockEngineCtrl.haltChannels).toHaveBeenCalled();
    });

    it('deployChannel delegates to singleton', async () => {
      await deployChannel('ch-1').get();
      expect(mockEngineCtrl.deployChannels).toHaveBeenCalled();
    });

    it('undeployChannel delegates to singleton', async () => {
      await undeployChannel('ch-1').get();
      expect(mockEngineCtrl.undeployChannels).toHaveBeenCalled();
    });

    it('isChannelDeployed delegates to singleton', () => {
      expect(isChannelDeployed('ch-1')).toBe(true);
      expect(isChannelDeployed('ch-3')).toBe(false);
    });

    it('getChannelState delegates to singleton', () => {
      expect(getChannelState('ch-1')).toBe(DeployedState.STARTED);
    });

    it('startConnector delegates to singleton', async () => {
      await startConnector('ch-1', 1).get();
      expect(mockEngineCtrl.startConnector).toHaveBeenCalled();
    });

    it('stopConnector delegates to singleton', async () => {
      await stopConnector('ch-1', 1).get();
      expect(mockEngineCtrl.stopConnector).toHaveBeenCalled();
    });

    it('getConnectorState delegates to singleton', () => {
      expect(getConnectorState('ch-1', 1)).toBe(DeployedState.STARTED);
    });

    it('getReceivedCount without metaDataId', () => {
      expect(getReceivedCount('ch-1')).toBe(100);
    });

    it('getReceivedCount with metaDataId', () => {
      expect(getReceivedCount('ch-1', 0)).toBe(100);
    });

    it('getFilteredCount without metaDataId', () => {
      expect(getFilteredCount('ch-1')).toBe(5);
    });

    it('getFilteredCount with metaDataId', () => {
      expect(getFilteredCount('ch-1', 0)).toBe(5);
    });

    it('getQueuedCount without metaDataId', () => {
      expect(getQueuedCount('ch-1')).toBe(2);
    });

    it('getQueuedCount with metaDataId', () => {
      expect(getQueuedCount('ch-1', 1)).toBe(2);
    });

    it('getSentCount without metaDataId', () => {
      expect(getSentCount('ch-1')).toBe(90);
    });

    it('getSentCount with metaDataId', () => {
      expect(getSentCount('ch-1', 1)).toBe(90);
    });

    it('getErrorCount without metaDataId', () => {
      expect(getErrorCount('ch-1')).toBe(3);
    });

    it('getErrorCount with metaDataId', () => {
      expect(getErrorCount('ch-1', 1)).toBe(3);
    });

    describe('resetStatistics static', () => {
      it('resetStatistics with no metaDataId', async () => {
        const future = resetStatistics('ch-1');
        await future.get();
        expect(mockChannelCtrl.resetStatistics).toHaveBeenCalled();
      });

      it('resetStatistics with metaDataId', async () => {
        const future = resetStatistics('ch-1', 1);
        await future.get();
        expect(mockChannelCtrl.resetStatistics).toHaveBeenCalled();
      });

      it('resetStatistics with metaDataId and statuses', async () => {
        const future = resetStatistics('ch-1', null, [Status.ERROR]);
        await future.get();
        expect(mockChannelCtrl.resetStatistics).toHaveBeenCalled();
      });

      it('resetStatistics with undefined metaDataId and statuses', async () => {
        const future = resetStatistics('ch-1', undefined, [Status.ERROR, Status.SENT]);
        await future.get();
        expect(mockChannelCtrl.resetStatistics).toHaveBeenCalled();
      });
    });
  });

  // ===========================================
  // Singleton lifecycle
  // ===========================================
  describe('singleton lifecycle', () => {
    it('getInstance creates singleton on first call', () => {
      const names1 = getChannelNames();
      const names2 = getChannelNames();
      // Both calls should use the same singleton instance
      expect(names1).toEqual(names2);
      // Only one singleton should have been created
      expect(mockChannelCtrl.getChannelNames).toHaveBeenCalledTimes(2);
    });

    it('resetChannelUtilInstance forces new instance on next call', () => {
      getChannelNames(); // Creates singleton
      resetChannelUtilInstance();

      // Replace controllers with different data
      const newCtrl = createMockChannelController();
      (newCtrl.getChannelNames as jest.Mock).mockReturnValue(['New Channel']);
      setChannelUtilChannelController(newCtrl);

      // Should create new singleton with new controller
      expect(getChannelNames()).toEqual(['New Channel']);
    });
  });
});
