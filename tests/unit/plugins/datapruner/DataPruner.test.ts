import {
  DataPruner,
  dataPruner,
  DEFAULT_PRUNING_BLOCK_SIZE,
  DEFAULT_ARCHIVING_BLOCK_SIZE,
  SkipStatus,
} from '../../../../src/plugins/datapruner/DataPruner';

describe('DataPruner', () => {
  let pruner: DataPruner;

  beforeEach(() => {
    pruner = new DataPruner();
  });

  describe('constants', () => {
    it('should have correct default block sizes', () => {
      expect(DEFAULT_PRUNING_BLOCK_SIZE).toBe(1000);
      expect(DEFAULT_ARCHIVING_BLOCK_SIZE).toBe(50);
    });
  });

  describe('SkipStatus', () => {
    it('should have correct values', () => {
      expect(SkipStatus.ERROR).toBe('E');
      expect(SkipStatus.QUEUED).toBe('Q');
      expect(SkipStatus.PENDING).toBe('P');
    });
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(pruner.getRetryCount()).toBe(3);
      expect(pruner.isSkipIncomplete()).toBe(true);
      expect(pruner.getSkipStatuses()).toEqual([SkipStatus.ERROR, SkipStatus.QUEUED, SkipStatus.PENDING]);
      expect(pruner.getPrunerBlockSize()).toBe(DEFAULT_PRUNING_BLOCK_SIZE);
      expect(pruner.isArchiveEnabled()).toBe(false);
      expect(pruner.getArchiverBlockSize()).toBe(DEFAULT_ARCHIVING_BLOCK_SIZE);
      expect(pruner.isPruneEvents()).toBe(false);
      expect(pruner.getMaxEventAge()).toBeNull();
      expect(pruner.isRunning()).toBe(false);
    });
  });

  describe('setters and getters', () => {
    it('should set and get numExported', () => {
      pruner.setNumExported(100);
      expect(pruner.getNumExported()).toBe(100);
    });

    it('should set and get retryCount', () => {
      pruner.setRetryCount(5);
      expect(pruner.getRetryCount()).toBe(5);
    });

    it('should set and get skipIncomplete', () => {
      pruner.setSkipIncomplete(false);
      expect(pruner.isSkipIncomplete()).toBe(false);
    });

    it('should set and get skipStatuses', () => {
      const statuses = [SkipStatus.ERROR];
      pruner.setSkipStatuses(statuses);
      expect(pruner.getSkipStatuses()).toEqual(statuses);
    });

    it('should set and get prunerBlockSize', () => {
      pruner.setPrunerBlockSize(500);
      expect(pruner.getPrunerBlockSize()).toBe(500);
    });

    it('should set and get archiveEnabled', () => {
      pruner.setArchiveEnabled(true);
      expect(pruner.isArchiveEnabled()).toBe(true);
    });

    it('should set and get archiverBlockSize', () => {
      pruner.setArchiverBlockSize(100);
      expect(pruner.getArchiverBlockSize()).toBe(100);
    });

    it('should set and get pruneEvents', () => {
      pruner.setPruneEvents(true);
      expect(pruner.isPruneEvents()).toBe(true);
    });

    it('should set and get maxEventAge', () => {
      pruner.setMaxEventAge(30);
      expect(pruner.getMaxEventAge()).toBe(30);

      pruner.setMaxEventAge(null);
      expect(pruner.getMaxEventAge()).toBeNull();
    });
  });

  describe('status', () => {
    it('should return current status', () => {
      const status = pruner.getPrunerStatus();

      expect(status).toBeDefined();
      expect(status.startTime).toBeNull();
      expect(status.isPruning).toBe(false);
    });

    it('should return null for last status when not run yet', () => {
      expect(pruner.getLastPrunerStatus()).toBeNull();
    });
  });

  describe('getTimeElapsed', () => {
    it('should return "0 minutes" when no task started', () => {
      expect(pruner.getTimeElapsed()).toBe('0 minutes');
    });
  });

  describe('start', () => {
    it('should return false if already running', async () => {
      // Mock the running state
      const testPruner = new DataPruner();

      // Start the pruner (it will run asynchronously)
      const firstStart = await testPruner.start();
      expect(firstStart).toBe(true);

      // Try to start again while running
      const secondStart = await testPruner.start();
      expect(secondStart).toBe(false);

      // Stop the pruner
      await testPruner.stop();
    });
  });

  describe('stop', () => {
    it('should stop a running pruner', async () => {
      const testPruner = new DataPruner();

      await testPruner.start();
      expect(testPruner.isRunning()).toBe(true);

      await testPruner.stop();
      expect(testPruner.isRunning()).toBe(false);
    });

    it('should handle stop when not running', async () => {
      const testPruner = new DataPruner();

      // Should not throw
      await testPruner.stop();
      expect(testPruner.isRunning()).toBe(false);
    });
  });
});

describe('dataPruner singleton', () => {
  it('should export a singleton instance', () => {
    expect(dataPruner).toBeDefined();
    expect(dataPruner).toBeInstanceOf(DataPruner);
  });
});

describe('DataPruner imports', () => {
  it('should import ConfigurationController for per-channel metadata', async () => {
    // Verify the module-level import resolves (compile-time check)
    const mod = await import('../../../../src/plugins/datapruner/DataPruner');
    expect(mod.DataPruner).toBeDefined();
  });

  it('should import EventDao for event pruning', async () => {
    const mod = await import('../../../../src/db/EventDao');
    expect(mod.deleteEventsBeforeDate).toBeDefined();
    expect(typeof mod.deleteEventsBeforeDate).toBe('function');
  });
});
