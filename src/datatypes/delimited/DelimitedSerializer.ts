/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedXMLHandler.java
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedSerializer.java
 *
 * Purpose: Serialize XML back to delimited text format
 *
 * Key behaviors to replicate:
 * - Convert XML rows/columns back to delimited text
 * - Proper handling of delimiters and quoting
 * - Support for missing elements
 */

import { XMLParser } from 'fast-xml-parser';
import {
  DelimitedDeserializationProperties,
  getDefaultDelimitedDeserializationProperties,
  unescapeDelimiter,
} from './DelimitedProperties.js';

/**
 * Serialize XML to delimited text
 */
export class DelimitedSerializer {
  private properties: DelimitedDeserializationProperties;
  private columnDelimiter: string;
  private recordDelimiter: string;
  private quoteToken: string;
  private quoteEscapeToken: string;

  constructor(properties?: Partial<DelimitedDeserializationProperties>) {
    this.properties = {
      ...getDefaultDelimitedDeserializationProperties(),
      ...properties,
    };

    // Unescape delimiters
    this.columnDelimiter = unescapeDelimiter(this.properties.columnDelimiter);
    this.recordDelimiter = unescapeDelimiter(this.properties.recordDelimiter);
    this.quoteToken = unescapeDelimiter(this.properties.quoteToken);
    this.quoteEscapeToken = unescapeDelimiter(this.properties.quoteEscapeToken);
  }

  /**
   * Serialize XML to delimited text
   */
  serialize(source: string): string {
    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: true,
      trimValues: false,
      parseTagValue: false,
    });

    // Remove whitespace between elements for parsing
    const cleanedXml = this.removeXMLWhitespace(source);
    const parsed = parser.parse(cleanedXml);

    // Find the delimited root element
    const root = parsed.delimited;
    if (!root) {
      throw new Error('Invalid delimited XML: missing root element');
    }

    return this.serializeRows(root);
  }

  /**
   * Remove whitespace between XML elements
   */
  private removeXMLWhitespace(xml: string): string {
    // Remove whitespace after opening tags
    let result = xml.replace(/>\s+</g, '><');
    // Remove whitespace after closing tags
    result = result.replace(/>\s+/g, '>');
    // Remove whitespace before opening tags
    result = result.replace(/\s+</g, '<');
    return result;
  }

  /**
   * Serialize row elements to delimited text
   */
  private serializeRows(root: unknown): string {
    const output: string[] = [];

    // Handle different row structures
    const rows = this.extractRows(root);

    for (const row of rows) {
      const columns = this.extractColumns(row);
      output.push(columns.join(this.columnDelimiter));
    }

    return output.join(this.recordDelimiter);
  }

  /**
   * Extract rows from parsed root element
   */
  private extractRows(root: unknown): unknown[] {
    if (!root || typeof root !== 'object') {
      return [];
    }

    const rows: unknown[] = [];
    const rootObj = root as Record<string, unknown>;

    // Look for row elements (row, row1, row2, etc.)
    for (const key of Object.keys(rootObj)) {
      if (key === 'row' || /^row\d+$/.test(key)) {
        const value = rootObj[key];
        if (Array.isArray(value)) {
          rows.push(...value);
        } else {
          rows.push(value);
        }
      }
    }

    return rows;
  }

  /**
   * Extract column values from a row element
   */
  private extractColumns(row: unknown): string[] {
    if (!row || typeof row !== 'object') {
      return [];
    }

    const rowObj = row as Record<string, unknown>;
    const columns: Array<{ index: number; value: string }> = [];

    // Find all column elements and their indices
    for (const key of Object.keys(rowObj)) {
      const match = key.match(/^column(\d+)$/);
      if (match && match[1]) {
        const index = parseInt(match[1], 10) - 1;
        const value = this.extractValue(rowObj[key]);
        columns.push({ index, value });
      } else if (key !== '#text') {
        // Custom column name - preserve order
        const value = this.extractValue(rowObj[key]);
        columns.push({ index: columns.length, value });
      }
    }

    // Sort by index and fill gaps
    columns.sort((a, b) => a.index - b.index);

    const result: string[] = [];
    let currentIndex = 0;
    for (const col of columns) {
      // Fill gaps with empty values
      while (currentIndex < col.index) {
        result.push('');
        currentIndex++;
      }
      result.push(col.value);
      currentIndex++;
    }

    return result;
  }

  /**
   * Extract string value from column element
   */
  private extractValue(columnElement: unknown): string {
    if (columnElement === null || columnElement === undefined) {
      return '';
    }

    if (typeof columnElement === 'string') {
      return columnElement;
    }

    if (typeof columnElement === 'number') {
      return String(columnElement);
    }

    if (typeof columnElement === 'object') {
      const obj = columnElement as Record<string, unknown>;
      // Check for text content
      if ('#text' in obj) {
        return String(obj['#text']);
      }
      // Check for nested element structure (common in parsed XML)
      const keys = Object.keys(obj);
      if (keys.length === 1 && keys[0]) {
        return this.extractValue(obj[keys[0]]);
      }
    }

    return String(columnElement);
  }

  /**
   * Quote a value if it contains special characters
   */
  quoteValue(value: string): string {
    const needsQuoting =
      value.includes(this.columnDelimiter) ||
      value.includes(this.recordDelimiter) ||
      value.includes(this.quoteToken);

    if (!needsQuoting) {
      return value;
    }

    // Escape quotes within the value
    let escapedValue: string;
    if (this.properties.escapeWithDoubleQuote) {
      escapedValue = value.replace(
        new RegExp(this.escapeRegExp(this.quoteToken), 'g'),
        this.quoteToken + this.quoteToken
      );
    } else {
      escapedValue = value.replace(
        new RegExp(this.escapeRegExp(this.quoteToken), 'g'),
        this.quoteEscapeToken + this.quoteToken
      );
    }

    return this.quoteToken + escapedValue + this.quoteToken;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Serialize XML to delimited text (convenience function)
 */
export function serializeXMLToDelimited(
  source: string,
  properties?: Partial<DelimitedDeserializationProperties>
): string {
  const serializer = new DelimitedSerializer(properties);
  return serializer.serialize(source);
}
