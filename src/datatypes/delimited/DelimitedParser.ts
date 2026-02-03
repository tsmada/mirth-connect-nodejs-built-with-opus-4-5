/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedReader.java
 *
 * Purpose: Parse delimited text (CSV, pipe, tab) into XML format
 *
 * Key behaviors to replicate:
 * - Support for column delimiters and record delimiters
 * - Fixed-width column parsing
 * - Quote handling with escape sequences
 * - XML output with configurable column names
 */

import {
  DelimitedSerializationProperties,
  getDefaultDelimitedSerializationProperties,
  unescapeDelimiter,
} from './DelimitedProperties.js';

/**
 * Parse delimited text to XML
 */
export class DelimitedParser {
  private properties: DelimitedSerializationProperties;
  private columnDelimiter: string;
  private recordDelimiter: string;
  private quoteToken: string;
  private quoteEscapeToken: string;

  constructor(properties?: Partial<DelimitedSerializationProperties>) {
    this.properties = {
      ...getDefaultDelimitedSerializationProperties(),
      ...properties,
    };

    // Unescape delimiters
    this.columnDelimiter = unescapeDelimiter(this.properties.columnDelimiter);
    this.recordDelimiter = unescapeDelimiter(this.properties.recordDelimiter);
    this.quoteToken = unescapeDelimiter(this.properties.quoteToken);
    this.quoteEscapeToken = unescapeDelimiter(this.properties.quoteEscapeToken);
  }

  /**
   * Parse delimited text to XML
   */
  parse(source: string): string {
    // Preprocess: optionally ignore CR
    let input = source;
    if (this.properties.ignoreCR) {
      input = input.replace(/\r/g, '');
    }

    const records = this.parseRecords(input);
    return this.toXML(records);
  }

  /**
   * Parse input into array of records (each record is array of column values)
   */
  private parseRecords(input: string): string[][] {
    const records: string[][] = [];
    let position = 0;

    while (position < input.length) {
      const { record, newPosition } = this.parseRecord(input, position);
      if (record.length > 0 || position < input.length) {
        records.push(record);
      }
      position = newPosition;
    }

    return records;
  }

  /**
   * Parse a single record starting at given position
   */
  private parseRecord(
    input: string,
    startPosition: number
  ): { record: string[]; newPosition: number } {
    const record: string[] = [];
    let position = startPosition;

    if (this.properties.columnWidths) {
      // Fixed-width parsing
      for (const width of this.properties.columnWidths) {
        if (this.startsWithDelimiter(input, position, this.recordDelimiter)) {
          break;
        }

        let columnValue = '';
        for (let i = 0; i < width && position < input.length; i++) {
          if (this.startsWithDelimiter(input, position, this.recordDelimiter)) {
            break;
          }
          columnValue += input[position];
          position++;
        }
        record.push(columnValue.trimEnd());
      }

      // Consume any remaining characters until record delimiter
      while (
        position < input.length &&
        !this.startsWithDelimiter(input, position, this.recordDelimiter)
      ) {
        position++;
      }

      // Consume record delimiter
      if (this.startsWithDelimiter(input, position, this.recordDelimiter)) {
        position += this.recordDelimiter.length;
      }
    } else {
      // Delimited parsing
      while (true) {
        const { value, newPosition } = this.parseColumnValue(input, position);
        record.push(value);
        position = newPosition;

        if (position >= input.length) {
          break;
        }

        // Check for record delimiter
        if (this.startsWithDelimiter(input, position, this.recordDelimiter)) {
          position += this.recordDelimiter.length;
          break;
        }

        // Consume column delimiter
        if (this.startsWithDelimiter(input, position, this.columnDelimiter)) {
          position += this.columnDelimiter.length;
        }
      }
    }

    return { record, newPosition: position };
  }

  /**
   * Parse a single column value
   */
  private parseColumnValue(
    input: string,
    startPosition: number
  ): { value: string; newPosition: number } {
    let position = startPosition;

    if (position >= input.length) {
      return { value: '', newPosition: position };
    }

    // Check if value is quoted
    if (this.startsWithDelimiter(input, position, this.quoteToken)) {
      return this.parseQuotedValue(input, position);
    }

    // Unquoted value - read until delimiter
    let value = '';
    while (position < input.length) {
      if (
        this.startsWithDelimiter(input, position, this.recordDelimiter) ||
        this.startsWithDelimiter(input, position, this.columnDelimiter)
      ) {
        break;
      }
      value += input[position];
      position++;
    }

    return { value, newPosition: position };
  }

  /**
   * Parse a quoted column value
   */
  private parseQuotedValue(
    input: string,
    startPosition: number
  ): { value: string; newPosition: number } {
    let position = startPosition + this.quoteToken.length; // Skip opening quote
    let value = '';
    let inQuote = true;

    while (position < input.length) {
      if (inQuote) {
        // Handle escape sequences
        if (this.properties.escapeWithDoubleQuote) {
          // Double quote escaping: "" -> "
          if (
            this.startsWithDelimiter(
              input,
              position,
              this.quoteToken + this.quoteToken
            )
          ) {
            value += this.quoteToken;
            position += this.quoteToken.length * 2;
            continue;
          }
        } else {
          // Escape token: \" -> "
          if (
            this.startsWithDelimiter(
              input,
              position,
              this.quoteEscapeToken + this.quoteToken
            )
          ) {
            value += this.quoteToken;
            position += this.quoteEscapeToken.length + this.quoteToken.length;
            continue;
          }
          // Escaped escape: \\ -> \
          if (
            this.startsWithDelimiter(
              input,
              position,
              this.quoteEscapeToken + this.quoteEscapeToken
            )
          ) {
            value += this.quoteEscapeToken;
            position += this.quoteEscapeToken.length * 2;
            continue;
          }
        }

        // Check for closing quote
        if (this.startsWithDelimiter(input, position, this.quoteToken)) {
          position += this.quoteToken.length;
          inQuote = false;
          continue;
        }
      } else {
        // Outside quotes - check for delimiters
        if (
          this.startsWithDelimiter(input, position, this.recordDelimiter) ||
          this.startsWithDelimiter(input, position, this.columnDelimiter)
        ) {
          break;
        }
      }

      value += input[position];
      position++;
    }

    return { value, newPosition: position };
  }

  /**
   * Check if input starts with delimiter at given position
   */
  private startsWithDelimiter(
    input: string,
    position: number,
    delimiter: string
  ): boolean {
    if (position + delimiter.length > input.length) {
      return false;
    }
    return input.substring(position, position + delimiter.length) === delimiter;
  }

  /**
   * Convert parsed records to XML
   */
  private toXML(records: string[][]): string {
    let xml = '<delimited>';

    for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
      const record = records[rowIndex];
      if (!record) continue;

      const rowElement = this.properties.numberedRows
        ? `row${rowIndex + 1}`
        : 'row';
      xml += `<${rowElement}>`;

      for (let colIndex = 0; colIndex < record.length; colIndex++) {
        const columnName = this.getColumnName(colIndex);
        const value = this.escapeXMLEntities(record[colIndex] ?? '');
        xml += `<${columnName}>${value}</${columnName}>`;
      }

      xml += `</${rowElement}>`;
    }

    xml += '</delimited>';
    return xml;
  }

  /**
   * Get column name for given index
   */
  private getColumnName(index: number): string {
    if (
      this.properties.columnNames &&
      index < this.properties.columnNames.length
    ) {
      return this.properties.columnNames[index]!;
    }
    return `column${index + 1}`;
  }

  /**
   * Escape XML entities in value
   */
  private escapeXMLEntities(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

/**
 * Parse delimited text to XML (convenience function)
 */
export function parseDelimitedToXML(
  source: string,
  properties?: Partial<DelimitedSerializationProperties>
): string {
  const parser = new DelimitedParser(properties);
  return parser.parse(source);
}
