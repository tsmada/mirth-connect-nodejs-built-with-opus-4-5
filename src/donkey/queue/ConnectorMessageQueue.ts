/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/queue/ConnectorMessageQueue.java
 *
 * Purpose: Base class for message queues used by source and destination connectors
 *
 * Key behaviors to replicate:
 * - Buffer management for in-memory message cache
 * - Size tracking with database synchronization
 * - Event dispatching for queue changes
 * - Thread-safe operations
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import {
  EventDispatcher,
  MessageEvent,
  MessageEventType,
  NoOpEventDispatcher,
} from '../channel/Statistics.js';
import { queueDepth } from '../../telemetry/metrics.js';

/**
 * Data source interface for loading queue messages from database
 */
export interface ConnectorMessageQueueDataSource {
  getChannelId(): string;
  getMetaDataId(): number;
  getSize(): number;
  getItems(offset: number, limit: number): Map<number, ConnectorMessage>;
  isQueueRotated(): boolean;
  setLastItem(message: ConnectorMessage): void;
  rotateQueue(): void;
  getRotateThreadMap(): Map<number, boolean>;
}

/**
 * Abstract base class for connector message queues
 */
export abstract class ConnectorMessageQueue {
  protected buffer: Map<number, ConnectorMessage> = new Map();
  protected size: number | null = null;
  protected dataSource: ConnectorMessageQueueDataSource | null = null;
  protected eventDispatcher: EventDispatcher = new NoOpEventDispatcher();
  protected channelId: string = '';
  protected metaDataId: number = 0;

  private bufferCapacity: number = 1000;
  private reachedCapacity: boolean = false;
  private invalidated: boolean = false;

  /**
   * Poll the first value from the buffer
   */
  protected abstract pollFirstValue(): ConnectorMessage | null;

  /**
   * Reset queue-specific state (overridden by subclasses)
   */
  protected reset(): void {
    // Base implementation does nothing
  }

  /**
   * Get the current buffer size
   */
  getBufferSize(): number {
    return this.buffer.size;
  }

  /**
   * Get the buffer capacity
   */
  getBufferCapacity(): number {
    return this.bufferCapacity;
  }

  /**
   * Set the buffer capacity
   */
  setBufferCapacity(capacity: number): void {
    if (capacity > 0) {
      if (capacity < this.bufferCapacity) {
        this.buffer.clear();
      }
      this.bufferCapacity = capacity;
    }
  }

  /**
   * Get the data source
   */
  getDataSource(): ConnectorMessageQueueDataSource | null {
    return this.dataSource;
  }

  /**
   * Set the data source
   */
  setDataSource(dataSource: ConnectorMessageQueueDataSource): void {
    this.channelId = dataSource.getChannelId();
    this.metaDataId = dataSource.getMetaDataId();
    this.dataSource = dataSource;
    this.invalidate(false, true);
  }

  /**
   * Set the event dispatcher
   */
  setEventDispatcher(dispatcher: EventDispatcher): void {
    this.eventDispatcher = dispatcher;
  }

  /**
   * Update size from data source
   */
  updateSize(): void {
    if (this.dataSource) {
      this.size = this.dataSource.getSize();
    }
  }

  /**
   * Update size only if currently empty or null
   */
  updateSizeIfEmpty(): void {
    if (this.size === null || this.size === 0) {
      this.updateSize();
    }
  }

  /**
   * Invalidate the queue, clearing buffer and optionally resetting
   */
  invalidate(updateSize: boolean, resetQueue: boolean): void {
    this.buffer.clear();

    if (resetQueue) {
      this.reset();
    }

    this.size = null;
    this.invalidated = true;

    if (updateSize) {
      this.dispatchQueueEvent();
    }
  }

  /**
   * Check if buffer contains a message
   */
  contains(connectorMessage: ConnectorMessage): boolean {
    return this.buffer.has(connectorMessage.getMessageId());
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    if (this.size === null) {
      this.updateSize();
    }
    return this.size === 0;
  }

  /**
   * Get queue size
   */
  getSize(): number {
    if (this.size === null) {
      if (!this.dataSource) {
        return 0;
      }
      this.updateSize();
    }
    return this.size ?? 0;
  }

  /**
   * Increment the actual size
   */
  protected incrementActualSize(): void {
    if (this.size !== null) {
      this.size++;
    }
    queueDepth.add(1, { 'channel.id': this.channelId, 'queue.type': this.metaDataId === 0 ? 'source' : 'destination' });
  }

  /**
   * Decrement the actual size
   */
  protected decrementActualSize(): void {
    if (this.size !== null) {
      this.size--;
    }
    queueDepth.add(-1, { 'channel.id': this.channelId, 'queue.type': this.metaDataId === 0 ? 'source' : 'destination' });
  }

  /**
   * Add a message to the queue
   */
  add(connectorMessage: ConnectorMessage): void {
    if (this.invalidated) {
      // If the buffer's size was already updated after an invalidate,
      // increment to account for the new message
      if (this.size !== null) {
        this.incrementActualSize();
      }

      // Fill buffer to resync with database
      this.fillBuffer();
    } else {
      if (this.size === null) {
        this.updateSize();
      }

      if (!this.reachedCapacity) {
        if (
          this.size !== null &&
          this.size < this.bufferCapacity &&
          this.dataSource &&
          !this.dataSource.isQueueRotated()
        ) {
          if (this.canAddNewMessageToBuffer(connectorMessage)) {
            this.buffer.set(connectorMessage.getMessageId(), connectorMessage);
          }
        } else {
          this.reachedCapacity = true;
        }
      }

      this.incrementActualSize();
    }

    this.dispatchQueueEvent(false);
  }

  /**
   * Check if a new message can be added to the buffer (overridden by subclasses)
   */
  protected canAddNewMessageToBuffer(_connectorMessage: ConnectorMessage): boolean {
    return true;
  }

  /**
   * Fill buffer from data source
   */
  fillBuffer(): void {
    if (this.size === null) {
      this.updateSize();
    }

    this.invalidated = false;

    if (this.dataSource && this.size !== null) {
      this.buffer = this.dataSource.getItems(
        0,
        Math.min(this.bufferCapacity, this.size)
      );

      if (this.buffer.size === this.size) {
        this.reachedCapacity = false;
      }
    }
  }

  /**
   * Dispatch a queue event
   */
  protected dispatchQueueEvent(decrement: boolean = true): void {
    const event: MessageEvent = {
      channelId: this.channelId,
      metaDataId: this.metaDataId,
      type: MessageEventType.QUEUED,
      count: this.getSize(),
      decrement,
    };
    this.eventDispatcher.dispatchEvent(event);
  }
}
