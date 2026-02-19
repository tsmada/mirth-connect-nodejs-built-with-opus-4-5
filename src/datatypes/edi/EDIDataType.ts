/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/edi/EDISerializer.java
 *
 * Purpose: EDI/X12 data type - handles healthcare EDI X12 transactions
 *
 * Key behaviors to replicate:
 * - Serialize EDI to XML for processing
 * - Deserialize XML back to EDI
 * - Extract metadata (source, type, version)
 * - Support X12 delimiter inference
 */

import {
  EDISerializationProperties,
  EDIDelimiters,
  getDefaultEDISerializationProperties,
  unescapeEDIDelimiter,
  detectX12Delimiters,
} from './EDIProperties.js';
import { EDIParser } from './EDIParser.js';
import { EDISerializer } from './EDISerializer.js';

/**
 * Metadata for EDI messages
 */
export interface EDIMetaData {
  /** Message source (from ISA.06 or GS.02) */
  source?: string;
  /** Transaction type (from ST.01) */
  type?: string;
  /** Version (from GS.08) */
  version?: string;
}

/**
 * Input type for EDIDataType constructor
 */
export interface EDIDataTypeInput {
  serializationProperties?: Partial<EDISerializationProperties>;
}

/**
 * EDI DataType - handles EDI/X12 healthcare transactions
 */
export class EDIDataType {
  private serializationProperties: EDISerializationProperties;
  private parser: EDIParser;

  constructor(input?: EDIDataTypeInput) {
    this.serializationProperties = {
      ...getDefaultEDISerializationProperties(),
      ...input?.serializationProperties,
    };

    this.parser = new EDIParser(this.serializationProperties);
  }

  /**
   * Check if serialization is required
   *
   * EDI always returns false as per Java implementation.
   */
  isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  /**
   * Transform without full serialization
   *
   * Not supported for EDI - always returns null.
   */
  transformWithoutSerializing(_message: string): string | null {
    return null;
  }

  /**
   * Convert EDI to XML
   */
  toXML(source: string): string {
    return this.parser.parse(source);
  }

  /**
   * Convert XML back to EDI
   */
  fromXML(source: string): string {
    const serializer = new EDISerializer();
    return serializer.serialize(source);
  }

  /**
   * Get metadata from EDI message
   */
  getMetaData(message: string): EDIMetaData {
    const metadata: Record<string, unknown> = {};
    this.populateMetaData(message, metadata);
    return {
      source: metadata['source'] as string | undefined,
      type: metadata['type'] as string | undefined,
      version: metadata['version'] as string | undefined,
    };
  }

  /**
   * Populate metadata map from EDI message
   *
   * Extracts:
   * - source: from ISA.06 or GS.02
   * - type: from ST.01
   * - version: from GS.08
   */
  populateMetaData(message: string, map: Record<string, unknown>): void {
    try {
      const delimiters = this.getDelimiters(message);
      let source: string | null = null;
      let type: string | null = null;
      let version: string | null = null;

      let index = 0;

      while (index < message.length) {
        // Look for ISA segment (source)
        if (source === null && message.startsWith('ISA', index)) {
          source = this.getElement(message, delimiters, index, 6);
        }
        // Look for GS segment (source if not found, version)
        else if ((source === null || version === null) && message.startsWith('GS', index)) {
          if (source === null) {
            source = this.getElement(message, delimiters, index, 2);
          }
          version = this.getElement(message, delimiters, index, 8);
        }
        // Look for ST segment (type)
        else if (type === null && message.startsWith('ST', index)) {
          type = this.getElement(message, delimiters, index, 1);
        }

        // Move to next segment
        const nextIndex = this.getDelimiterIndex(message, delimiters.segmentDelimiter, index);
        if (nextIndex === -1) break;
        index = nextIndex + 1;

        // Stop if we have all metadata
        if (source !== null && type !== null && version !== null) break;
      }

      if (source !== null) {
        map['source'] = source;
      }
      if (type !== null) {
        map['type'] = type;
      }
      if (version !== null) {
        map['version'] = version;
      }
    } catch (_e) {
      // Silently ignore metadata extraction errors
    }
  }

  /**
   * Get delimiters for the message
   */
  private getDelimiters(message: string): EDIDelimiters {
    const baseDelimiters: EDIDelimiters = {
      segmentDelimiter: unescapeEDIDelimiter(this.serializationProperties.segmentDelimiter),
      elementDelimiter: unescapeEDIDelimiter(this.serializationProperties.elementDelimiter),
      subelementDelimiter: unescapeEDIDelimiter(this.serializationProperties.subelementDelimiter),
    };

    if (this.serializationProperties.inferX12Delimiters) {
      return detectX12Delimiters(message, baseDelimiters);
    }

    return baseDelimiters;
  }

  /**
   * Find delimiter index starting from position
   */
  private getDelimiterIndex(message: string, delimiter: string, startIndex: number): number {
    for (let i = startIndex; i < message.length; i++) {
      if (delimiter.includes(message.charAt(i))) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Check if character at position is a delimiter
   */
  private startsWithDelimiter(message: string, delimiter: string, index: number): boolean {
    return delimiter.includes(message.charAt(index));
  }

  /**
   * Get element value from segment
   */
  private getElement(
    message: string,
    delimiters: EDIDelimiters,
    startIndex: number,
    elementNumber: number
  ): string | null {
    let index = startIndex;
    let elementCount = 0;
    let found = false;
    let value = '';

    while (index < message.length) {
      // Check for segment delimiter (end of segment)
      if (this.startsWithDelimiter(message, delimiters.segmentDelimiter, index)) {
        break;
      }

      // Check for element delimiter
      if (this.startsWithDelimiter(message, delimiters.elementDelimiter, index)) {
        elementCount++;

        if (found) {
          // We've captured the element
          return value.trim();
        } else if (elementCount === elementNumber) {
          found = true;
        }

        index++;
        continue;
      }

      // Check for subelement delimiter
      if (this.startsWithDelimiter(message, delimiters.subelementDelimiter, index)) {
        if (found) {
          // End of first subelement
          return value.trim();
        }
        index++;
        continue;
      }

      // Capture character if we're in the right element
      if (found) {
        value += message.charAt(index);
      }

      index++;
    }

    return found ? value.trim() : null;
  }

  /**
   * Convert to JSON (not supported)
   */
  toJSON(_message: string): string | null {
    return null;
  }

  /**
   * Convert from JSON (not supported)
   */
  fromJSON(_message: string): string | null {
    return null;
  }

  /**
   * Get serialization properties
   */
  getSerializationProperties(): EDISerializationProperties {
    return { ...this.serializationProperties };
  }

  /**
   * Get purged properties (for auditing)
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      inferX12Delimiters: this.serializationProperties.inferX12Delimiters,
    };
  }
}

/**
 * Extract metadata from EDI message (convenience function)
 */
export function extractEDIMetaData(message: string): EDIMetaData {
  const dataType = new EDIDataType();
  return dataType.getMetaData(message);
}
