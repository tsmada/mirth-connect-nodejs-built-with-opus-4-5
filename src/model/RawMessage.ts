/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/RawMessage.java
 *
 * Purpose: Represents a raw message before processing
 *
 * Key behaviors to replicate:
 * - Carries raw data into the channel
 * - Can include source map data
 * - Can include destination metadata IDs for routing
 * - Can be binary or text
 */

export interface RawMessageData {
  rawData: string;
  rawBytes?: Buffer;
  destinationMetaDataIds?: number[];
  sourceMap?: Map<string, unknown>;
  binary?: boolean;
  overwrite?: boolean;
  imported?: boolean;
  originalMessageId?: number;
}

export class RawMessage {
  private rawData: string;
  private rawBytes?: Buffer;
  private destinationMetaDataIds?: number[];
  private sourceMap: Map<string, unknown>;
  private binary: boolean;
  private overwrite: boolean;
  private imported: boolean;
  private originalMessageId?: number;

  constructor(data: RawMessageData) {
    this.rawData = data.rawData;
    this.rawBytes = data.rawBytes;
    this.destinationMetaDataIds = data.destinationMetaDataIds;
    this.sourceMap = data.sourceMap ?? new Map<string, unknown>();
    this.binary = data.binary ?? false;
    this.overwrite = data.overwrite ?? false;
    this.imported = data.imported ?? false;
    this.originalMessageId = data.originalMessageId;
  }

  /**
   * Create a RawMessage from string data
   */
  static fromString(rawData: string): RawMessage {
    return new RawMessage({ rawData });
  }

  /**
   * Create a RawMessage from binary data
   */
  static fromBytes(rawBytes: Buffer): RawMessage {
    return new RawMessage({
      rawData: rawBytes.toString('utf-8'),
      rawBytes,
      binary: true,
    });
  }

  getRawData(): string {
    return this.rawData;
  }

  setRawData(rawData: string): void {
    this.rawData = rawData;
  }

  getRawBytes(): Buffer | undefined {
    return this.rawBytes;
  }

  setRawBytes(rawBytes: Buffer): void {
    this.rawBytes = rawBytes;
  }

  getDestinationMetaDataIds(): number[] | undefined {
    return this.destinationMetaDataIds;
  }

  setDestinationMetaDataIds(ids: number[]): void {
    this.destinationMetaDataIds = ids;
  }

  getSourceMap(): Map<string, unknown> {
    return this.sourceMap;
  }

  isBinary(): boolean {
    return this.binary;
  }

  setBinary(binary: boolean): void {
    this.binary = binary;
  }

  isOverwrite(): boolean {
    return this.overwrite;
  }

  setOverwrite(overwrite: boolean): void {
    this.overwrite = overwrite;
  }

  isImported(): boolean {
    return this.imported;
  }

  setImported(imported: boolean): void {
    this.imported = imported;
  }

  getOriginalMessageId(): number | undefined {
    return this.originalMessageId;
  }

  setOriginalMessageId(id: number): void {
    this.originalMessageId = id;
  }

  /**
   * Clear the raw data after processing to free memory
   */
  clearMessage(): void {
    this.rawData = '';
    this.rawBytes = undefined;
  }
}
