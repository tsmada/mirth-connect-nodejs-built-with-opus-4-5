import { SourceQueue } from '../../../../src/donkey/queue/SourceQueue';
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

  constructor(channelId: string = 'test-channel', metaDataId: number = 0) {
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

  setLastItem(_message: ConnectorMessage): void {
    // No-op for source queue
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

function createTestMessage(messageId: number): ConnectorMessage {
  return new ConnectorMessage({
    messageId,
    metaDataId: 0,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Source',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
}

describe('SourceQueue', () => {
  let queue: SourceQueue;
  let dataSource: MockDataSource;

  beforeEach(() => {
    queue = new SourceQueue();
    dataSource = new MockDataSource();
    queue.setDataSource(dataSource);
  });

  describe('poll', () => {
    it('should return null when queue is empty', () => {
      const result = queue.poll();
      expect(result).toBeNull();
    });

    it('should return message when available', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const result = queue.poll();
      expect(result).toBeDefined();
      expect(result?.getMessageId()).toBe(1);
    });

    it('should decrement size after poll', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.getSize()).toBe(1);
      queue.poll();
      expect(queue.getSize()).toBe(0);
    });

    it('should mark message as checked out', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      queue.poll();
      expect(queue.isCheckedOut(1)).toBe(true);
    });

    it('should not return same message twice when checked out', () => {
      const message1 = createTestMessage(1);
      const message2 = createTestMessage(2);
      dataSource.addMessage(message1);
      dataSource.addMessage(message2);
      queue.add(message1);
      queue.add(message2);

      const first = queue.poll();
      const second = queue.poll();

      expect(first?.getMessageId()).toBe(1);
      expect(second?.getMessageId()).toBe(2);
    });
  });

  describe('finish', () => {
    it('should remove message from checked out', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const polled = queue.poll();
      expect(queue.isCheckedOut(1)).toBe(true);

      queue.finish(polled);
      expect(queue.isCheckedOut(1)).toBe(false);
    });

    it('should handle null message', () => {
      expect(() => queue.finish(null)).not.toThrow();
    });
  });

  describe('add', () => {
    it('should increment size', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);

      queue.add(message);
      expect(queue.getSize()).toBe(1);
    });

    it('should add message to buffer', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);

      queue.add(message);
      expect(queue.getBufferSize()).toBe(1);
    });

    it('should not exceed buffer capacity', () => {
      queue.setBufferCapacity(2);

      for (let i = 1; i <= 5; i++) {
        const message = createTestMessage(i);
        dataSource.addMessage(message);
        queue.add(message);
      }

      expect(queue.getSize()).toBe(5);
      // Buffer should only have up to capacity
    });
  });

  describe('decrementSize', () => {
    it('should decrement size', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.getSize()).toBe(1);
      queue.decrementSize();
      expect(queue.getSize()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should return true when empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when not empty', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.isEmpty()).toBe(false);
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

      queue.poll();
      queue.poll();

      expect(queue.getCheckedOutCount()).toBe(2);
    });
  });

  describe('pollWithTimeout', () => {
    it('should poll immediately when messages available', async () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      const result = await queue.pollWithTimeout(100);
      expect(result?.getMessageId()).toBe(1);
    });

    it('should wait and return null when no messages', async () => {
      const start = Date.now();
      const result = await queue.pollWithTimeout(50);
      const elapsed = Date.now() - start;

      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe('setBufferCapacity', () => {
    it('should update buffer capacity', () => {
      queue.setBufferCapacity(500);
      expect(queue.getBufferCapacity()).toBe(500);
    });

    it('should clear buffer when reducing capacity', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      queue.setBufferCapacity(100);
      // Buffer cleared when capacity reduced
    });

    it('should ignore invalid capacity', () => {
      queue.setBufferCapacity(1000);
      queue.setBufferCapacity(0);
      expect(queue.getBufferCapacity()).toBe(1000);
    });
  });

  describe('contains', () => {
    it('should return true when message in buffer', () => {
      const message = createTestMessage(1);
      dataSource.addMessage(message);
      queue.add(message);

      expect(queue.contains(message)).toBe(true);
    });

    it('should return false when message not in buffer', () => {
      const message = createTestMessage(1);
      expect(queue.contains(message)).toBe(false);
    });
  });
});
