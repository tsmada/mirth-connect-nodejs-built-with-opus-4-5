/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/raw/RawSerializer.java
 *
 * Purpose: Raw data type - pass-through serialization with no parsing
 *
 * Key behaviors to replicate:
 * - No serialization required (isSerializationRequired returns false)
 * - toXML/fromXML return null (no transformation)
 * - getMetaData returns null (no metadata extraction)
 * - Pass-through without any modification
 */

import { RawDataTypeProperties, getDefaultRawDataTypeProperties } from './RawProperties.js';

/**
 * Raw metadata (minimal - raw type has no intrinsic metadata)
 */
export interface RawMetaData {
  /** Always 'raw' for raw data type */
  type: string;
  /** Data version (empty for raw) */
  version: string;
}

/**
 * Raw DataType - handles pass-through data with no transformation
 *
 * The Raw data type is a simple pass-through that performs no parsing or
 * serialization. It's used when the message format doesn't need transformation
 * or when custom handling is done via JavaScript.
 */
export class RawDataType {
  private properties: RawDataTypeProperties;

  constructor(properties?: Partial<RawDataTypeProperties>) {
    this.properties = {
      ...getDefaultRawDataTypeProperties(),
      ...properties,
    };
  }

  /**
   * Check if serialization is required
   *
   * Raw data type never requires serialization - it passes data through as-is.
   */
  isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  /**
   * Transform without serializing
   *
   * Raw data type cannot transform without serializing because it doesn't
   * understand the message format.
   */
  transformWithoutSerializing(_message: string): string | null {
    return null;
  }

  /**
   * Convert to XML representation
   *
   * Raw data type returns null - no XML conversion is performed.
   * The message is passed through unchanged.
   */
  toXML(_source: string): string | null {
    return null;
  }

  /**
   * Convert from XML representation
   *
   * Raw data type returns null - no conversion from XML is performed.
   * The message is passed through unchanged.
   */
  fromXML(_source: string): string | null {
    return null;
  }

  /**
   * Convert to JSON representation
   *
   * Raw data type returns null - no JSON conversion is performed.
   */
  toJSON(_message: string): string | null {
    return null;
  }

  /**
   * Convert from JSON representation
   *
   * Raw data type returns null - no conversion from JSON is performed.
   */
  fromJSON(_message: string): string | null {
    return null;
  }

  /**
   * Get metadata from message
   *
   * Raw data type returns null - no metadata can be extracted
   * because the format is unknown.
   */
  getMetaData(_message: string): RawMetaData | null {
    return null;
  }

  /**
   * Populate metadata map
   *
   * Raw data type does nothing - no metadata to populate.
   */
  populateMetaData(_message: string, _map: Record<string, unknown>): void {
    // No-op for raw data type
  }

  /**
   * Get the batch properties
   */
  getBatchProperties() {
    return this.properties.batchProperties;
  }

  /**
   * Get purged properties (for auditing/logging)
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      batchProperties: {
        splitType: this.properties.batchProperties.splitType,
        batchScriptLines: this.properties.batchProperties.batchScript
          .split('\n')
          .filter((line) => line.trim()).length,
      },
    };
  }
}

/**
 * Pass through a raw message unchanged
 *
 * This is a convenience function that emphasizes that raw data
 * passes through without modification.
 */
export function passThrough(message: string): string {
  return message;
}

/**
 * Extract metadata from raw message
 *
 * Returns null as raw messages have no intrinsic metadata.
 */
export function extractRawMetaData(_message: string): RawMetaData | null {
  return null;
}
