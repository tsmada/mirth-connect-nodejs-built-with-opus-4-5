/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/queue/DestinationQueue.java
 *
 * Purpose: Queue messages for destination connector with bucketing support
 *
 * Key behaviors to replicate:
 * - Acquire/release pattern for message processing
 * - Thread bucketing for parallel processing
 * - Queue rotation support
 * - Status update locking for safe invalidation
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ConnectorMessageQueue } from './ConnectorMessageQueue.js';

/**
 * Destination queue for managing messages to be sent by destination connectors.
 * Supports thread bucketing for parallel processing and queue rotation.
 */
export class DestinationQueue extends ConnectorMessageQueue {
  /**
   * Variable name to use for thread bucketing
   */
  private groupBy: string;

  /**
   * Set of message IDs currently checked out
   */
  private checkedOut: Set<number> = new Set();

  /**
   * Set of message IDs marked for deletion
   */
  private deleted: Set<number> = new Set();

  /**
   * Whether queue rotation is enabled
   */
  private rotate: boolean = false;

  /**
   * Number of queue buckets (for thread assignment)
   */
  private queueBuckets: number = 1;

  /**
   * Thread IDs registered for bucketing
   */
  private queueThreadIds: number[] = [];

  /**
   * Map of values to initial bucket assignments
   */
  private initialThreadAssignmentMap: Map<string, number> = new Map();

  /**
   * Current thread ID (simulated for async)
   */
  private currentThreadId: number = 0;

  constructor(groupBy: string = '', threadCount: number = 1, regenerateTemplate: boolean = false) {
    super();
    this.groupBy = groupBy || '';
    // regenerateTemplate is stored for future use in advanced bucketing scenarios
    void regenerateTemplate;

    if (groupBy && groupBy.length > 0) {
      this.queueBuckets = threadCount;
    }
  }

  /**
   * Poll the first value from the buffer
   */
  protected pollFirstValue(): ConnectorMessage | null {
    for (const [messageId, connectorMessage] of this.buffer) {
      // If there are multiple buckets, find the first matching this thread
      if (this.queueBuckets > 1) {
        const bucket = this.getBucket(connectorMessage);

        if (
          bucket < this.queueThreadIds.length &&
          this.queueThreadIds[bucket] === this.currentThreadId
        ) {
          this.buffer.delete(messageId);
          return connectorMessage;
        }
      } else {
        this.buffer.delete(messageId);
        return connectorMessage;
      }
    }

    return null;
  }

  /**
   * Reset queue state
   */
  protected override reset(): void {
    this.checkedOut.clear();
    this.deleted.clear();
    if (this.queueBuckets > 1) {
      this.queueThreadIds = [];
    }
    if (this.rotate && this.dataSource) {
      this.dataSource.getRotateThreadMap().clear();
    }
  }

  /**
   * Check if rotation is enabled
   */
  isRotate(): boolean {
    return this.rotate;
  }

  /**
   * Set rotation enabled
   */
  setRotate(rotate: boolean): void {
    this.rotate = rotate;
  }

  /**
   * Register a thread ID for bucket assignment
   */
  registerThreadId(threadId: number): void {
    this.currentThreadId = threadId;

    if (this.queueBuckets > 1) {
      this.queueThreadIds.push(threadId);
    }

    if (this.rotate && this.dataSource) {
      this.dataSource.getRotateThreadMap().set(threadId, false);
    }
  }

  /**
   * Check if the queue has been rotated for current thread
   */
  hasBeenRotated(): boolean {
    if (this.rotate && this.dataSource) {
      const rotated = this.dataSource.getRotateThreadMap().get(this.currentThreadId);
      if (rotated === undefined || rotated) {
        // Update the map, clearing the flag
        this.dataSource.getRotateThreadMap().set(this.currentThreadId, false);
        return rotated ?? false;
      }
    }
    return false;
  }

  /**
   * Acquire a message from the queue for processing
   */
  acquire(): ConnectorMessage | null {
    let connectorMessage: ConnectorMessage | null = null;

    if (this.getSize() - this.checkedOut.size > 0) {
      let bufferFilled = false;

      do {
        if (this.size === null) {
          this.updateSize();
        }

        if (this.size !== null && this.size > 0) {
          connectorMessage = this.pollFirstValue();

          // If no message and buffer is actually empty, fill from database
          if (connectorMessage === null && this.buffer.size === 0) {
            if (bufferFilled) {
              return null;
            }

            this.fillBuffer();
            bufferFilled = true;

            connectorMessage = this.pollFirstValue();
          }

          // Set last item for rotation
          if (connectorMessage !== null && this.rotate && this.dataSource) {
            this.dataSource.setLastItem(connectorMessage);
          }
        }
      } while (connectorMessage !== null && this.checkedOut.has(connectorMessage.getMessageId()));
    }

    if (connectorMessage !== null) {
      this.checkedOut.add(connectorMessage.getMessageId());
    }

    return connectorMessage;
  }

  /**
   * Release a message back to the queue
   * @param connectorMessage The message to release
   * @param finished Whether processing is complete (true) or should be retried (false)
   */
  release(connectorMessage: ConnectorMessage | null, finished: boolean): void {
    if (connectorMessage !== null) {
      if (this.size !== null) {
        const messageId = connectorMessage.getMessageId();

        if (finished) {
          this.decrementActualSize();

          if (this.buffer.has(messageId)) {
            this.buffer.delete(messageId);
          }
        } else {
          // Put back in buffer for retry
          if (this.buffer.has(messageId)) {
            this.buffer.set(messageId, connectorMessage);
          }

          // Trigger queue rotation
          if (this.dataSource) {
            this.dataSource.rotateQueue();
          }
        }
      }

      this.checkedOut.delete(connectorMessage.getMessageId());

      if (finished) {
        this.dispatchQueueEvent(true);
      }
    }
  }

  /**
   * Check if a message is checked out
   */
  isCheckedOut(messageId: number): boolean {
    const isCheckedOut = this.checkedOut.has(messageId);

    // If no longer checked out and marked deleted, clean up
    if (!isCheckedOut && this.deleted.has(messageId)) {
      this.deleted.delete(messageId);
      this.buffer.delete(messageId);
      this.updateSize();
    }

    return isCheckedOut;
  }

  /**
   * Mark a message as deleted
   */
  markAsDeleted(messageId: number): void {
    this.deleted.add(messageId);
  }

  /**
   * Release if the message was marked as deleted
   */
  releaseIfDeleted(connectorMessage: ConnectorMessage): boolean {
    if (this.deleted.has(connectorMessage.getMessageId())) {
      this.release(connectorMessage, true);
      return true;
    }
    return false;
  }

  /**
   * Get the bucket for a message based on groupBy variable
   */
  private getBucket(connectorMessage: ConnectorMessage): number {
    // Get the group by value from connector message maps
    let groupByValue: string;

    // Try to get the value from channel map, source map, or connector map
    const channelMap = connectorMessage.getChannelMap();
    const sourceMap = connectorMessage.getSourceMap();
    const connectorMap = connectorMessage.getConnectorMap();

    const value =
      channelMap.get(this.groupBy) ?? sourceMap.get(this.groupBy) ?? connectorMap.get(this.groupBy);

    groupByValue = String(value ?? '');

    // Check initial assignment map
    let bucket = this.initialThreadAssignmentMap.get(groupByValue);

    if (bucket === undefined) {
      // If initial assignment map isn't full, assign directly
      if (this.initialThreadAssignmentMap.size < this.queueBuckets) {
        bucket = this.initialThreadAssignmentMap.size;
        this.initialThreadAssignmentMap.set(groupByValue, bucket);
      } else {
        // Calculate bucket using hash
        bucket = Math.abs(this.hashCode(groupByValue) % this.queueBuckets);
      }
    }

    return bucket;
  }

  /**
   * Simple hash code for string (similar to Java's hashCode)
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Get the number of checked out messages
   */
  getCheckedOutCount(): number {
    return this.checkedOut.size;
  }

  /**
   * Get queue buckets count
   */
  getQueueBuckets(): number {
    return this.queueBuckets;
  }

  /**
   * Set current thread ID (for bucketing)
   */
  setCurrentThreadId(threadId: number): void {
    this.currentThreadId = threadId;
  }
}
