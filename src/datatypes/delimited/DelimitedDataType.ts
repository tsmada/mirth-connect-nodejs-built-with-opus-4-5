/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedSerializer.java
 *
 * Purpose: Delimited data type - handles CSV, pipe-delimited, tab-delimited files
 *
 * Key behaviors to replicate:
 * - Serialize delimited text to XML for processing
 * - Deserialize XML back to delimited text
 * - Extract minimal metadata (type = "delimited")
 */

import {
  DelimitedSerializationProperties,
  DelimitedDeserializationProperties,
  getDefaultDelimitedDataTypeProperties,
  getDefaultDelimitedSerializationProperties,
  getDefaultDelimitedDeserializationProperties,
} from './DelimitedProperties.js';

/**
 * Partial input for DelimitedDataType constructor
 */
export interface DelimitedDataTypeInput {
  serializationProperties?: Partial<DelimitedSerializationProperties>;
  deserializationProperties?: Partial<DelimitedDeserializationProperties>;
}
import { DelimitedParser } from './DelimitedParser.js';
import { DelimitedSerializer } from './DelimitedSerializer.js';

/**
 * Metadata for delimited messages
 */
export interface DelimitedMetaData {
  /** Always "delimited" */
  type: string;
  /** Version (empty for delimited) */
  version: string;
}

/**
 * Delimited DataType - handles CSV, pipe-delimited, and other delimited formats
 */
export class DelimitedDataType {
  private serializationProperties: DelimitedSerializationProperties;
  private deserializationProperties: DelimitedDeserializationProperties;
  private parser: DelimitedParser;
  private serializer: DelimitedSerializer;

  constructor(properties?: DelimitedDataTypeInput) {
    const defaults = getDefaultDelimitedDataTypeProperties();

    this.serializationProperties = {
      ...defaults.serializationProperties,
      ...properties?.serializationProperties,
    };

    this.deserializationProperties = {
      ...defaults.deserializationProperties,
      ...properties?.deserializationProperties,
    };

    this.parser = new DelimitedParser(this.serializationProperties);
    this.serializer = new DelimitedSerializer(this.deserializationProperties);
  }

  /**
   * Check if serialization is required
   *
   * Returns true if properties differ from defaults, requiring actual parsing.
   */
  isSerializationRequired(toXml: boolean): boolean {
    if (toXml) {
      const defaults = getDefaultDelimitedSerializationProperties();
      return (
        this.serializationProperties.columnDelimiter !==
          defaults.columnDelimiter ||
        this.serializationProperties.recordDelimiter !==
          defaults.recordDelimiter ||
        this.serializationProperties.columnWidths !== null ||
        this.serializationProperties.quoteToken !== defaults.quoteToken ||
        !this.serializationProperties.escapeWithDoubleQuote ||
        this.serializationProperties.quoteEscapeToken !==
          defaults.quoteEscapeToken ||
        this.serializationProperties.columnNames !== null ||
        this.serializationProperties.numberedRows ||
        !this.serializationProperties.ignoreCR
      );
    } else {
      const defaults = getDefaultDelimitedDeserializationProperties();
      return (
        this.deserializationProperties.columnDelimiter !==
          defaults.columnDelimiter ||
        this.deserializationProperties.recordDelimiter !==
          defaults.recordDelimiter ||
        this.deserializationProperties.columnWidths !== null ||
        this.deserializationProperties.quoteToken !== defaults.quoteToken ||
        !this.deserializationProperties.escapeWithDoubleQuote ||
        this.deserializationProperties.quoteEscapeToken !==
          defaults.quoteEscapeToken
      );
    }
  }

  /**
   * Transform without full serialization
   *
   * Not supported for delimited - always returns null.
   */
  transformWithoutSerializing(_message: string): string | null {
    return null;
  }

  /**
   * Convert delimited text to XML
   */
  toXML(source: string): string {
    return this.parser.parse(source);
  }

  /**
   * Convert XML back to delimited text
   */
  fromXML(source: string): string {
    return this.serializer.serialize(source);
  }

  /**
   * Get metadata from delimited message
   */
  getMetaData(_message: string): DelimitedMetaData {
    return {
      type: 'delimited',
      version: '',
    };
  }

  /**
   * Populate metadata map
   */
  populateMetaData(_message: string, map: Record<string, unknown>): void {
    map['type'] = 'delimited';
    map['version'] = '';
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
  getSerializationProperties(): DelimitedSerializationProperties {
    return { ...this.serializationProperties };
  }

  /**
   * Get deserialization properties
   */
  getDeserializationProperties(): DelimitedDeserializationProperties {
    return { ...this.deserializationProperties };
  }

  /**
   * Get purged properties (for auditing)
   */
  getPurgedProperties(): Record<string, unknown> {
    return {
      serializationProperties: {
        columnWidths: this.serializationProperties.columnWidths,
        escapeWithDoubleQuote:
          this.serializationProperties.escapeWithDoubleQuote,
        columnNameCount: this.serializationProperties.columnNames?.length ?? 0,
        numberedRows: this.serializationProperties.numberedRows,
        ignoreCR: this.serializationProperties.ignoreCR,
      },
      deserializationProperties: {
        columnWidths: this.deserializationProperties.columnWidths,
        escapeWithDoubleQuote:
          this.deserializationProperties.escapeWithDoubleQuote,
      },
    };
  }
}

/**
 * Extract metadata from delimited message (convenience function)
 */
export function extractDelimitedMetaData(_message: string): DelimitedMetaData {
  return {
    type: 'delimited',
    version: '',
  };
}
