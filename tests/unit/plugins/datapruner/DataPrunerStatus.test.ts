import {
  createDataPrunerStatus,
  cloneDataPrunerStatus,
  createPruneResult,
  createPrunerTask,
} from '../../../../src/plugins/datapruner/DataPrunerStatus';

describe('DataPrunerStatus', () => {
  describe('createDataPrunerStatus', () => {
    it('should create status with default values', () => {
      const status = createDataPrunerStatus();

      expect(status.startTime).toBeNull();
      expect(status.endTime).toBeNull();
      expect(status.taskStartTime).toBeNull();
      expect(status.currentChannelId).toBeNull();
      expect(status.currentChannelName).toBeNull();
      expect(status.isArchiving).toBe(false);
      expect(status.isPruning).toBe(false);
      expect(status.isPruningEvents).toBe(false);
      expect(status.pendingChannelIds).toBeInstanceOf(Set);
      expect(status.pendingChannelIds.size).toBe(0);
      expect(status.processedChannelIds).toBeInstanceOf(Set);
      expect(status.processedChannelIds.size).toBe(0);
      expect(status.failedChannelIds).toBeInstanceOf(Set);
      expect(status.failedChannelIds.size).toBe(0);
    });
  });

  describe('cloneDataPrunerStatus', () => {
    it('should create a deep copy of status', () => {
      const original = createDataPrunerStatus();
      original.startTime = new Date('2024-01-01');
      original.currentChannelId = 'channel-1';
      original.isPruning = true;
      original.pendingChannelIds.add('pending-1');
      original.processedChannelIds.add('processed-1');
      original.failedChannelIds.add('failed-1');

      const clone = cloneDataPrunerStatus(original);

      // Verify values are copied
      expect(clone.startTime).toEqual(original.startTime);
      expect(clone.currentChannelId).toBe('channel-1');
      expect(clone.isPruning).toBe(true);
      expect(clone.pendingChannelIds.has('pending-1')).toBe(true);
      expect(clone.processedChannelIds.has('processed-1')).toBe(true);
      expect(clone.failedChannelIds.has('failed-1')).toBe(true);

      // Verify sets are independent
      original.pendingChannelIds.add('pending-2');
      expect(clone.pendingChannelIds.has('pending-2')).toBe(false);

      clone.processedChannelIds.add('processed-2');
      expect(original.processedChannelIds.has('processed-2')).toBe(false);
    });

    it('should handle null date values', () => {
      const original = createDataPrunerStatus();
      const clone = cloneDataPrunerStatus(original);

      expect(clone.startTime).toBeNull();
      expect(clone.endTime).toBeNull();
      expect(clone.taskStartTime).toBeNull();
    });
  });
});

describe('PruneResult', () => {
  describe('createPruneResult', () => {
    it('should create result with zero counts', () => {
      const result = createPruneResult();

      expect(result.numMessagesArchived).toBe(0);
      expect(result.numMessagesPruned).toBe(0);
      expect(result.numContentPruned).toBe(0);
    });
  });

  it('should allow incrementing counts', () => {
    const result = createPruneResult();

    result.numMessagesArchived = 10;
    result.numMessagesPruned = 100;
    result.numContentPruned = 500;

    expect(result.numMessagesArchived).toBe(10);
    expect(result.numMessagesPruned).toBe(100);
    expect(result.numContentPruned).toBe(500);
  });
});

describe('PrunerTask', () => {
  describe('createPrunerTask', () => {
    it('should create task with provided values', () => {
      const messageDate = new Date('2024-01-01');
      const contentDate = new Date('2024-01-07');

      const task = createPrunerTask(
        'channel-123',
        'Test Channel',
        messageDate,
        contentDate,
        true
      );

      expect(task.channelId).toBe('channel-123');
      expect(task.channelName).toBe('Test Channel');
      expect(task.messageDateThreshold).toEqual(messageDate);
      expect(task.contentDateThreshold).toEqual(contentDate);
      expect(task.archiveEnabled).toBe(true);
    });

    it('should allow null date thresholds', () => {
      const task = createPrunerTask(
        'channel-456',
        'Another Channel',
        null,
        null,
        false
      );

      expect(task.channelId).toBe('channel-456');
      expect(task.messageDateThreshold).toBeNull();
      expect(task.contentDateThreshold).toBeNull();
      expect(task.archiveEnabled).toBe(false);
    });

    it('should allow only message threshold', () => {
      const messageDate = new Date('2024-01-01');

      const task = createPrunerTask(
        'channel-789',
        'Channel',
        messageDate,
        null,
        false
      );

      expect(task.messageDateThreshold).toEqual(messageDate);
      expect(task.contentDateThreshold).toBeNull();
    });

    it('should allow only content threshold', () => {
      const contentDate = new Date('2024-01-07');

      const task = createPrunerTask(
        'channel-abc',
        'Channel',
        null,
        contentDate,
        false
      );

      expect(task.messageDateThreshold).toBeNull();
      expect(task.contentDateThreshold).toEqual(contentDate);
    });
  });
});
