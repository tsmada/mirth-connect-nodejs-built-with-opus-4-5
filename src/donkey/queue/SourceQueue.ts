/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/queue/SourceQueue.java
 *
 * Purpose: Queue incoming messages at source connector
 *
 * Key behaviors to replicate:
 * - FIFO ordering for source messages
 * - Check-out mechanism to prevent duplicate processing
 * - Poll with timeout support
 * - Thread-safe operations
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ConnectorMessageQueue } from './ConnectorMessageQueue.js';

/**
 * Source queue for managing incoming messages at the source connector.
 * Implements FIFO ordering with check-out tracking.
 */
export class SourceQueue extends ConnectorMessageQueue {
  /**
   * Set of message IDs currently checked out for processing
   */
  private checkedOut: Set<number> = new Set();

  /**
   * Promise resolver for poll timeout waiting
   */
  private timeoutResolver: (() => void) | null = null;

  /**
   * Poll the first value from the buffer
   */
  protected pollFirstValue(): ConnectorMessage | null {
    const iterator = this.buffer.entries();
    const first = iterator.next();

    if (!first.done) {
      const [messageId, connectorMessage] = first.value;
      this.buffer.delete(messageId);
      return connectorMessage;
    }

    return null;
  }

  /**
   * Poll a message from the queue
   * Returns null if no message is available
   */
  poll(): ConnectorMessage | null {
    if (this.size === null) {
      this.updateSize();
    }

    let connectorMessage: ConnectorMessage | null = null;

    if (this.size !== null && this.size > 0) {
      connectorMessage = this.pollFirstValue();

      // If no element was received and there are elements in the database,
      // fill the buffer from the database and get the next element
      if (connectorMessage === null) {
        this.fillBuffer();
        connectorMessage = this.pollFirstValue();
      }

      // Ensure no message gets polled at the same time from multiple threads
      while (connectorMessage !== null && this.checkedOut.has(connectorMessage.getMessageId())) {
        connectorMessage = this.pollFirstValue();
      }
    }

    // If an element was found, decrement the count and mark as checked out
    if (connectorMessage !== null) {
      this.decrementActualSize();
      this.checkedOut.add(connectorMessage.getMessageId());
      this.dispatchQueueEvent(true);
    }

    return connectorMessage;
  }

  /**
   * Mark a message as finished processing
   */
  finish(connectorMessage: ConnectorMessage | null): void {
    if (connectorMessage !== null) {
      const messageId = connectorMessage.getMessageId();

      if (this.buffer.has(messageId)) {
        this.buffer.delete(messageId);
      }

      this.checkedOut.delete(messageId);
    }
  }

  /**
   * Reset the queue state
   */
  protected override reset(): void {
    this.checkedOut.clear();
  }

  /**
   * Decrement the size and dispatch event
   */
  decrementSize(): void {
    if (this.size !== null) {
      this.decrementActualSize();
    }
    this.dispatchQueueEvent(true);
  }

  /**
   * Poll with timeout
   * @param timeout Timeout in milliseconds
   * @returns Message or null if timeout
   */
  async pollWithTimeout(timeout: number): Promise<ConnectorMessage | null> {
    await this.waitTimeout(timeout);
    return this.poll();
  }

  /**
   * Wait for timeout or until notified
   */
  private async waitTimeout(timeout: number): Promise<void> {
    // If there are no queued messages or all are checked out, wait
    if (
      (this.size === null ||
        this.size === 0 ||
        this.checkedOut.size === this.getBufferCapacity()) &&
      timeout > 0
    ) {
      await new Promise<void>((resolve) => {
        this.timeoutResolver = resolve;

        const timeoutId = setTimeout(() => {
          this.timeoutResolver = null;
          resolve();
        }, timeout);

        // Store cleanup for early resolution
        const originalResolver = this.timeoutResolver;
        this.timeoutResolver = () => {
          clearTimeout(timeoutId);
          originalResolver?.();
        };
      });
    }
  }

  /**
   * Notify waiting poll operations
   */
  private notifyWaiters(): void {
    if (this.timeoutResolver) {
      this.timeoutResolver();
      this.timeoutResolver = null;
    }
  }

  /**
   * Override add to notify waiters
   */
  override add(connectorMessage: ConnectorMessage): void {
    super.add(connectorMessage);
    this.notifyWaiters();
  }

  /**
   * Override fillBuffer to notify waiters
   */
  override fillBuffer(): void {
    super.fillBuffer();
    if (this.buffer.size > 0) {
      this.notifyWaiters();
    }
  }

  /**
   * Get the number of checked out messages
   */
  getCheckedOutCount(): number {
    return this.checkedOut.size;
  }

  /**
   * Check if a message is checked out
   */
  isCheckedOut(messageId: number): boolean {
    return this.checkedOut.has(messageId);
  }
}
