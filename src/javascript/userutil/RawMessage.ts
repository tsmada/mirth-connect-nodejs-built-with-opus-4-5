/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/RawMessage.java
 *
 * Purpose: This class represents a raw message as it is received by a channel, and is used to
 * retrieve details such as the raw data or source map. Also used to create raw messages in scripts
 * for routing to other channels via VMRouter.
 *
 * Key behaviors to replicate:
 * - Can be instantiated with text or binary data
 * - Supports destination metadata IDs for selective routing
 * - Supports source map for passing data to destination channel
 * - Converts JavaScript numbers (doubles) to integers for metadata IDs
 */

import { RawMessage as ModelRawMessage } from '../../model/RawMessage.js';

/**
 * RawMessage for use in user scripts.
 * This class wraps the internal RawMessage model and provides the Java-compatible API
 * that Mirth scripts expect.
 */
export class RawMessage {
  private rawData: string = '';
  private rawBytes: Uint8Array | null = null;
  private destinationMetaDataIds: Set<number> | null = null;
  private sourceMap: Map<string, unknown> = new Map();
  private binary: boolean = false;

  /**
   * Instantiates a RawMessage object with textual data.
   *
   * @param rawData The textual data to dispatch to the channel.
   */
  constructor(rawData: string);

  /**
   * Instantiates a RawMessage object with textual data and destination metadata IDs.
   *
   * @param rawData The textual data to dispatch to the channel.
   * @param destinationMetaDataIds A collection of integers (metadata IDs) representing which
   *        destinations to dispatch the message to.
   */
  constructor(rawData: string, destinationMetaDataIds: Iterable<number>);

  /**
   * Instantiates a RawMessage object with textual data, destination metadata IDs, and source map.
   *
   * @param rawData The textual data to dispatch to the channel.
   * @param destinationMetaDataIds A collection of integers (metadata IDs) representing which
   *        destinations to dispatch the message to.
   * @param sourceMap Any values placed in this map will be populated in the source map at the
   *        beginning of the message's lifecycle.
   */
  constructor(
    rawData: string,
    destinationMetaDataIds: Iterable<number> | null,
    sourceMap: Map<string, unknown>
  );

  /**
   * Instantiates a RawMessage object with binary data.
   *
   * @param rawBytes The binary data (byte array) to dispatch to the channel.
   */
  constructor(rawBytes: Uint8Array);

  /**
   * Instantiates a RawMessage object with binary data and destination metadata IDs.
   *
   * @param rawBytes The binary data (byte array) to dispatch to the channel.
   * @param destinationMetaDataIds A collection of integers (metadata IDs) representing which
   *        destinations to dispatch the message to.
   */
  constructor(rawBytes: Uint8Array, destinationMetaDataIds: Iterable<number>);

  /**
   * Instantiates a RawMessage object with binary data, destination metadata IDs, and source map.
   *
   * @param rawBytes The binary data (byte array) to dispatch to the channel.
   * @param destinationMetaDataIds A collection of integers (metadata IDs) representing which
   *        destinations to dispatch the message to.
   * @param sourceMap Any values placed in this map will be populated in the source map at the
   *        beginning of the message's lifecycle.
   */
  constructor(
    rawBytes: Uint8Array,
    destinationMetaDataIds: Iterable<number> | null,
    sourceMap: Map<string, unknown>
  );

  // Implementation
  constructor(
    rawDataOrBytes: string | Uint8Array,
    destinationMetaDataIds?: Iterable<number> | null,
    sourceMap?: Map<string, unknown>
  ) {
    if (typeof rawDataOrBytes === 'string') {
      this.rawData = rawDataOrBytes;
      this.binary = false;
    } else {
      this.rawBytes = rawDataOrBytes;
      this.rawData = new TextDecoder().decode(rawDataOrBytes);
      this.binary = true;
    }

    if (destinationMetaDataIds) {
      this.destinationMetaDataIds = this.convertCollection(destinationMetaDataIds);
    }

    if (sourceMap) {
      this.sourceMap = new Map(sourceMap);
    }
  }

  /**
   * Returns the textual data to be dispatched to a channel.
   *
   * @return The textual data to be dispatched to a channel.
   */
  getRawData(): string {
    return this.rawData;
  }

  /**
   * Returns the binary data (byte array) to be dispatched to a channel.
   *
   * @return The binary data (byte array) to be dispatched to a channel.
   */
  getRawBytes(): Uint8Array | null {
    return this.rawBytes;
  }

  /**
   * Returns the collection of integers (metadata IDs) representing which destinations to dispatch
   * the message to.
   *
   * @return The collection of integers (metadata IDs) representing which destinations to dispatch
   *         the message to.
   */
  getDestinationMetaDataIds(): Set<number> | null {
    return this.destinationMetaDataIds;
  }

  /**
   * Sets which destinations to dispatch the message to.
   *
   * @param destinationMetaDataIds A list of integers (metadata IDs) representing which
   *        destinations to dispatch the message to.
   */
  setDestinationMetaDataIds(destinationMetaDataIds: Iterable<number> | null): void {
    if (destinationMetaDataIds) {
      this.destinationMetaDataIds = this.convertCollection(destinationMetaDataIds);
    } else {
      this.destinationMetaDataIds = null;
    }
  }

  /**
   * Returns the source map to be used at the beginning of the channel dispatch.
   *
   * @return The source map to be used at the beginning of the channel dispatch.
   */
  getSourceMap(): Map<string, unknown> {
    return this.sourceMap;
  }

  /**
   * Sets the source map to be used at the beginning of the channel dispatch.
   *
   * @param sourceMap Any values placed in this map will be populated in the source map at the
   *        beginning of the message's lifecycle.
   */
  setSourceMap(sourceMap: Map<string, unknown>): void {
    this.sourceMap = sourceMap;
  }

  /**
   * Returns a Boolean representing whether this object contains textual or binary data.
   *
   * @return A Boolean representing whether this object contains textual or binary data.
   */
  isBinary(): boolean {
    return this.binary;
  }

  /**
   * Removes references to any data (textual or binary) currently stored by the raw message.
   */
  clearMessage(): void {
    this.rawData = '';
    this.rawBytes = null;
  }

  /**
   * Convert the values in the collection to Integer. This is needed since JavaScript
   * numbers may be doubles, and we need integers for metadata IDs.
   */
  private convertCollection(numbers: Iterable<number>): Set<number> {
    const set = new Set<number>();
    for (const num of numbers) {
      // Convert to integer (handles JavaScript doubles)
      set.add(Math.floor(num));
    }
    return set;
  }

  /**
   * Convert this userutil RawMessage to the model RawMessage
   */
  toModelRawMessage(): ModelRawMessage {
    return new ModelRawMessage({
      rawData: this.rawData,
      rawBytes: this.rawBytes ? Buffer.from(this.rawBytes) : undefined,
      destinationMetaDataIds: this.destinationMetaDataIds
        ? Array.from(this.destinationMetaDataIds)
        : undefined,
      sourceMap: this.sourceMap,
      binary: this.binary,
    });
  }

  /**
   * Create a userutil RawMessage from a model RawMessage
   */
  static fromModelRawMessage(model: ModelRawMessage): RawMessage {
    const ids = model.getDestinationMetaDataIds();
    const sourceMap = model.getSourceMap();

    if (model.isBinary()) {
      const rawBytes = model.getRawBytes();
      if (rawBytes) {
        // Convert Buffer to Uint8Array
        const uint8Array = new Uint8Array(
          rawBytes.buffer,
          rawBytes.byteOffset,
          rawBytes.byteLength
        );
        return new RawMessage(uint8Array, ids ?? null, sourceMap);
      }
    }

    return new RawMessage(model.getRawData(), ids ?? null, sourceMap);
  }
}
