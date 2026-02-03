import { DestinationQueue } from '../../../../src/donkey/queue/DestinationQueue';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ConnectorMessageQueueDataSource } from '../../../../src/donkey/queue/ConnectorMessageQueue';

// Mock data source
class MockDataSource implements ConnectorMessageQueueDataSource {
  private channelId: string;
  private metaDataId: number;
  private messages: Map<number, ConnectorMessage> = new Map();
  private rotated = false;
  private rotateThreadMap = new Map<number, boolean>();
  private lastItem: ConnectorMessage | null = null;

  constructor(channelId: string = 'test-channel', metaDataId: number = 1) {
    this.channelId = channelId;
    this.metaDataId = metaDataId;
  }

  getChannelId(): string {
    return this.channelId;
  }

  getMetaDataId(): number {
    return this.metaDataId;
  }

  getSize(): number {
    return this.messages.size;
  }

  getItems(offset: number, limit: number): Map<number, ConnectorMessage> {
    const result = new Map<number, ConnectorMessage>();
    let count = 0;
    let skipped = 0;

    for (const [id, msg] of this.messages) {
      if (skipped < offset) {
        skipped++;
        continue;
      }
      if (count >= limit) break;
      result.set(id, msg);
      count++;
    }

    return result;
  }

  isQueueRotated(): boolean {
    return this.rotated;
  }

  setLastItem(message: ConnectorMessage): void {
    this.lastItem = message;
  }

  getLastItem(): ConnectorMessage | null {
    return this.lastItem;
  }

  rotateQueue(): void {
    this.rotated = true;
  }

  getRotateThreadMap(): Map<number, boolean> {
    return this.rotateThreadMap;
  }

  // Test helpers
  addMessage(message: ConnectorMessage): void {
    this.messages.set(message.getMessageId(), message);
  }

  clearMessages(): void {
    this.messages.clear();
  }
}

function createTestMessage(messageId: number, metaDataId: number = 1): ConnectorMessage {
  return new ConnectorMessage({
    messageId,
    metaDataId,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Destination',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.QUEUED,
  });
}

describe('DestinationQueue', () => {
  let queue: DestinationQueue;
  let dataSource: MockDataSource;

  beforeEach(() => {
    queue = new DestinationQueue();
    dataSource = new MockDataSource();
    queue.setDataSource(dataSource);
  });

  describe('constructor', () => {
    it('should create queue with default settings', () => {
      expect(queue.getQueueBuckets()).toBe(1);
      expect(queue.isRotate()).toBe(false);
    });

    it('should create queue with thread bucketing', () => {
      const bucketedQueue = new DestinationQueue('patientId', 4, false);
      expect(bucketedQueue.getQueueBuckets()).toBe(4);
    });
  });

  describe('acquire', () => {
    it('should return null when queue is empty', () => {
      const result = queue.acquire();
      expect(result).toBeNull();
    });

    it('should return message when available', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const result = queue.acquire();
      expect(result).toBeDefined();
      expect(result?.getMessageId()).toBe(1);
    });

    it('should mark message as checked out', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      queue.acquire();
      expect(queue.isCheckedOut(1)).toBe(true);
    });

    it('should not return same message twice when checked out', () => {
      const message1 = createTestMessage(1);
      const message2 = createTestMessage(2);
      dataSource.addMessage(message1);
      dataSource.addMessage(message2);
      queue.add(message1);
      queue.add(message2);

      const first = queue.acquire();
      const second = queue.acquire();

      expect(first?.getMessageId()).toBe(1);
      expect(second?.getMessageId()).toBe(2);
    });
  });

  describe('release', () => {
    it('should remove message from checked out when finished', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const acquired = queue.acquire();
      expect(queue.isCheckedOut(1)).toBe(true);

      queue.release(acquired, true);
      expect(queue.isCheckedOut(1)).toBe(false);
    });

    it('should decrement size when finished', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.getSize()).toBe(1);

      const acquired = queue.acquire();
      queue.release(acquired, true);

      expect(queue.getSize()).toBe(0);
    });

    it('should keep message for retry when not finished', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const acquired = queue.acquire();
      queue.release(acquired, false);

      expect(queue.isCheckedOut(1)).toBe(false);
      expect(queue.getSize()).toBe(1);
    });

    it('should handle null message', () => {
      expect(() => queue.release(null, true)).not.toThrow();
    });
  });

  describe('markAsDeleted', () => {
    it('should mark message for deletion', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      queue.markAsDeleted(1);
      // Message is marked but still in queue until released
    });
  });

  describe('releaseIfDeleted', () => {
    it('should release and return true if message was marked deleted', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const acquired = queue.acquire();
      queue.markAsDeleted(1);

      const result = queue.releaseIfDeleted(acquired!);
      expect(result).toBe(true);
      expect(queue.isCheckedOut(1)).toBe(false);
    });

    it('should return false if message was not marked deleted', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const acquired = queue.acquire();
      const result = queue.releaseIfDeleted(acquired!);
      expect(result).toBe(false);
      expect(queue.isCheckedOut(1)).toBe(true);
    });
  });

  describe('rotation', () => {
    it('should set rotation enabled', () => {
      queue.setRotate(true);
      expect(queue.isRotate()).toBe(true);
    });

    it('should set last item when rotation enabled', () => {
      queue.setRotate(true);
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      queue.acquire();
      expect(dataSource.getLastItem()?.getMessageId()).toBe(1);
    });
  });

  describe('thread bucketing', () => {
    let bucketedQueue: DestinationQueue;

    beforeEach(() => {
      bucketedQueue = new DestinationQueue('groupKey', 2, false);
      bucketedQueue.setDataSource(dataSource);
    });

    it('should register thread IDs', () => {
      bucketedQueue.registerThreadId(100);
      bucketedQueue.registerThreadId(200);
      // Thread IDs registered for bucketing
    });

    it('should assign messages to buckets based on groupBy value', () => {
      bucketedQueue.registerThreadId(100);
      bucketedQueue.registerThreadId(200);
      bucketedQueue.setCurrentThreadId(100);

      const message1 = createTestMessage(1);
      message1.getChannelMap().set('groupKey', 'A');

      const message2 = createTestMessage(2);
      message2.getChannelMap().set('groupKey', 'B');

      dataSource.addMessage(message1);
      dataSource.addMessage(message2);
      bucketedQueue.add(message1);
      bucketedQueue.add(message2);

      // First thread should get messages assigned to bucket 0
      const acquired = bucketedQueue.acquire();
      expect(acquired).toBeDefined();
    });
  });

  describe('hasBeenRotated', () => {
    it('should return false when rotation not enabled', () => {
      expect(queue.hasBeenRotated()).toBe(false);
    });

    it('should return rotation status from data source when enabled', () => {
      queue.setRotate(true);
      queue.registerThreadId(100);
      queue.setCurrentThreadId(100);

      dataSource.getRotateThreadMap().set(100, true);

      const rotated = queue.hasBeenRotated();
      expect(rotated).toBe(true);

      // Should clear the flag
      const rotatedAgain = queue.hasBeenRotated();
      expect(rotatedAgain).toBe(false);
    });
  });

  describe('getCheckedOutCount', () => {
    it('should return number of checked out messages', () => {
      const message1 = createTestMessage(1);
      const message2 = createTestMessage(2);
      dataSource.addMessage(message1);
      dataSource.addMessage(message2);
      queue.add(message1);
      queue.add(message2);

      queue.acquire();
      queue.acquire();

      expect(queue.getCheckedOutCount()).toBe(2);
    });
  });

  describe('invalidation', () => {
    it('should clear buffer on invalidation', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.getBufferSize()).toBe(1);
      queue.invalidate(false, false);
      expect(queue.getBufferSize()).toBe(0);
    });

    it('should reset checked out on invalidation with reset', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);
      queue.acquire();

      expect(queue.getCheckedOutCount()).toBe(1);
      queue.invalidate(false, true);
      expect(queue.getCheckedOutCount()).toBe(0);
    });
  });
});
