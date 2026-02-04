/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPReader.java
 *
 * Purpose: Parse NCPDP messages into XML format
 *
 * Key behaviors to replicate:
 * - Parse transaction header (request vs response format)
 * - Parse segments with field IDs
 * - Handle groups/transactions within messages
 * - Convert field codes to descriptive names
 * - Handle counter and count fields specially
 */

import { NCPDPReference } from './NCPDPReference.js';
import {
  NCPDPDelimiters,
  NCPDPVersion,
  unescapeNCPDPDelimiter,
} from './NCPDPProperties.js';

/**
 * Parse NCPDP messages to XML
 */
export class NCPDPReader {
  private segmentDelimiter: string;
  private groupDelimiter: string;
  private fieldDelimiter: string;
  private version: NCPDPVersion = NCPDPVersion.D0;
  private reference: NCPDPReference;

  constructor(delimiters?: Partial<NCPDPDelimiters>) {
    this.segmentDelimiter = unescapeNCPDPDelimiter(
      delimiters?.segmentDelimiter ?? '0x1E'
    );
    this.groupDelimiter = unescapeNCPDPDelimiter(
      delimiters?.groupDelimiter ?? '0x1D'
    );
    this.fieldDelimiter = unescapeNCPDPDelimiter(
      delimiters?.fieldDelimiter ?? '0x1C'
    );
    this.reference = NCPDPReference.getInstance();
  }

  /**
   * Parse NCPDP message to XML string
   */
  parse(message: string): string {
    message = message.trim();

    if (!message || message.length < 3) {
      throw new Error(`Unable to parse, message is null or too short: ${message}`);
    }

    const output: string[] = [];

    // Add XML declaration
    output.push('<?xml version="1.0" encoding="UTF-8"?>');

    // Parse header to determine root element name
    const headerResult = this.parseHeader(message, output);

    // Process body (everything after the first segment delimiter)
    const segmentDelimiterIndex = message.indexOf(this.segmentDelimiter);
    if (segmentDelimiterIndex !== -1) {
      const body = message.substring(segmentDelimiterIndex + this.segmentDelimiter.length);
      this.parseBody(body, output);
    }

    // Close root element
    output.push(`</${headerResult.rootElementName}>`);

    return output.join('\n');
  }

  /**
   * Parse the transaction header
   * Returns the root element name for the XML
   */
  private parseHeader(
    message: string,
    output: string[]
  ): { rootElementName: string } {
    const segmentDelimiterIndex = message.indexOf(this.segmentDelimiter);

    if (segmentDelimiterIndex === -1) {
      throw new Error('Unable to parse NCPDP message: no segment delimiter found');
    }

    const header = message.substring(0, segmentDelimiterIndex);
    let rootElementName: string;

    // Determine if this is a request or response based on header length
    // Requests have a longer header (56 chars) than responses (~31 chars)
    if (header.length > 40) {
      // Request format
      this.version = header.substring(6, 8) as NCPDPVersion;
      const transactionCode = header.substring(8, 10);
      const transactionName = this.reference.getTransactionName(transactionCode);
      rootElementName = `NCPDP_${this.version}_${transactionName}_Request`;

      output.push(`<${rootElementName}>`);
      output.push('  <TransactionHeaderRequest>');
      output.push(`    <BinNumber>${this.escapeXml(header.substring(0, 6))}</BinNumber>`);
      output.push(`    <VersionReleaseNumber>${this.escapeXml(header.substring(6, 8))}</VersionReleaseNumber>`);
      output.push(`    <TransactionCode>${this.escapeXml(header.substring(8, 10))}</TransactionCode>`);
      output.push(`    <ProcessorControlNumber>${this.escapeXml(header.substring(10, 20))}</ProcessorControlNumber>`);
      output.push(`    <TransactionCount>${this.escapeXml(header.substring(20, 21))}</TransactionCount>`);
      output.push(`    <ServiceProviderIdQualifier>${this.escapeXml(header.substring(21, 23))}</ServiceProviderIdQualifier>`);
      output.push(`    <ServiceProviderId>${this.escapeXml(header.substring(23, 38))}</ServiceProviderId>`);
      output.push(`    <DateOfService>${this.escapeXml(header.substring(38, 46))}</DateOfService>`);

      // Some requests have additional fields (SoftwareVendorCertificationId at position 46-56)
      if (header.length >= 56) {
        output.push(`    <SoftwareVendorCertificationId>${this.escapeXml(header.substring(46, 56))}</SoftwareVendorCertificationId>`);
      }

      output.push('  </TransactionHeaderRequest>');
    } else {
      // Response format
      this.version = header.substring(0, 2) as NCPDPVersion;
      const transactionCode = header.substring(2, 4);
      const transactionName = this.reference.getTransactionName(transactionCode);
      rootElementName = `NCPDP_${this.version}_${transactionName}_Response`;

      output.push(`<${rootElementName}>`);
      output.push('  <TransactionHeaderResponse>');
      output.push(`    <VersionReleaseNumber>${this.escapeXml(header.substring(0, 2))}</VersionReleaseNumber>`);
      output.push(`    <TransactionCode>${this.escapeXml(header.substring(2, 4))}</TransactionCode>`);
      output.push(`    <TransactionCount>${this.escapeXml(header.substring(4, 5))}</TransactionCount>`);
      output.push(`    <HeaderResponseStatus>${this.escapeXml(header.substring(5, 6))}</HeaderResponseStatus>`);
      output.push(`    <ServiceProviderIdQualifier>${this.escapeXml(header.substring(6, 8))}</ServiceProviderIdQualifier>`);
      output.push(`    <ServiceProviderId>${this.escapeXml(header.substring(8, 23))}</ServiceProviderId>`);
      output.push(`    <DateOfService>${this.escapeXml(header.substring(23, 31))}</DateOfService>`);
      output.push('  </TransactionHeaderResponse>');
    }

    return { rootElementName };
  }

  /**
   * Parse the message body (segments and groups)
   */
  private parseBody(body: string, output: string[]): void {
    let remaining = body;
    let inGroup = false;
    let firstTransaction = true;
    let groupCounter = 0;
    let indentLevel = 1;

    while (remaining.length > 0) {
      const groupDelimiterIndex = remaining.indexOf(this.groupDelimiter);
      const segmentDelimiterIndex = remaining.indexOf(this.segmentDelimiter);

      // Case: next delimiter is a group separator
      if (
        groupDelimiterIndex !== -1 &&
        (segmentDelimiterIndex === -1 || groupDelimiterIndex < segmentDelimiterIndex)
      ) {
        // Parse segment before group delimiter
        const segment = remaining.substring(0, groupDelimiterIndex);
        if (segment.length > 0) {
          this.parseSegment(segment, output, indentLevel);
        }

        // End previous transaction if in group
        if (inGroup) {
          indentLevel--;
          output.push(`${'  '.repeat(indentLevel)}</TRANSACTION>`);
        }

        // Start TRANSACTIONS container on first transaction
        if (firstTransaction) {
          firstTransaction = false;
          output.push(`${'  '.repeat(indentLevel)}<TRANSACTIONS>`);
          indentLevel++;
        }

        // Start new transaction
        groupCounter++;
        output.push(`${'  '.repeat(indentLevel)}<TRANSACTION counter="${groupCounter}">`);
        indentLevel++;
        inGroup = true;

        // Move past group delimiter
        remaining = remaining.substring(groupDelimiterIndex + this.groupDelimiter.length);
      }
      // Case: no more delimiters (last segment)
      else if (groupDelimiterIndex === -1 && segmentDelimiterIndex === -1) {
        if (remaining.length > 0) {
          this.parseSegment(remaining, output, indentLevel);
        }
        break;
      }
      // Case: next delimiter is a segment separator
      else {
        const segment = remaining.substring(0, segmentDelimiterIndex);
        if (segment.length > 0) {
          this.parseSegment(segment, output, indentLevel);
        }

        // Move past segment delimiter
        remaining = remaining.substring(segmentDelimiterIndex + this.segmentDelimiter.length);
      }
    }

    // Close any open group/transaction
    if (inGroup) {
      indentLevel--;
      output.push(`${'  '.repeat(indentLevel)}</TRANSACTION>`);
      indentLevel--;
      output.push(`${'  '.repeat(indentLevel)}</TRANSACTIONS>`);
    }
  }

  /**
   * Parse a single segment
   */
  private parseSegment(segment: string, output: string[], baseIndent: number): void {
    if (!segment || segment.trim().length === 0) {
      return;
    }

    const indent = '  '.repeat(baseIndent);
    const fieldIndent = '  '.repeat(baseIndent + 1);

    // Split by field delimiter
    let fieldDelimiterIndex = segment.indexOf(this.fieldDelimiter);

    // Handle leading field delimiter
    if (fieldDelimiterIndex === 0) {
      segment = segment.substring(this.fieldDelimiter.length);
      fieldDelimiterIndex = segment.indexOf(this.fieldDelimiter);
    }

    // Get segment ID
    let segmentId: string;
    let subSegment: string;

    if (fieldDelimiterIndex === -1) {
      segmentId = segment;
      subSegment = '';
    } else {
      segmentId = segment.substring(0, fieldDelimiterIndex);
      subSegment = segment.substring(fieldDelimiterIndex + this.fieldDelimiter.length);
    }

    const segmentName = this.reference.getSegment(segmentId, this.version);
    output.push(`${indent}<${segmentName}>`);

    // Parse fields
    const fieldStack: string[] = [];
    let inCounter = false;
    let inCount = false;

    while (subSegment.length > 0) {
      fieldDelimiterIndex = subSegment.indexOf(this.fieldDelimiter);

      let field: string;
      if (fieldDelimiterIndex !== -1) {
        field = subSegment.substring(0, fieldDelimiterIndex);
        subSegment = subSegment.substring(fieldDelimiterIndex + this.fieldDelimiter.length);
      } else {
        field = subSegment;
        subSegment = '';
      }

      if (field.length < 2) {
        continue;
      }

      const fieldId = field.substring(0, 2);
      const fieldMessage = field.substring(2);
      const fieldDescription = this.reference.getDescription(fieldId, this.version);

      if (!fieldDescription) {
        // Unknown field ID, output with raw code
        output.push(`${fieldIndent}<Field_${fieldId}>${this.escapeXml(fieldMessage)}</Field_${fieldId}>`);
        continue;
      }

      // Handle closing count elements when we encounter non-repeating fields
      if (inCount && !this.isRepeatingField(fieldDescription) && !fieldDescription.endsWith('Count')) {
        while (fieldStack.length > 0) {
          const closingField = fieldStack.pop()!;
          output.push(`${fieldIndent}</${closingField}>`);
        }
        inCount = false;
      }

      // Handle Counter fields (like CompoundIngredientComponentCount)
      if (fieldDescription.endsWith('Counter')) {
        if (inCounter) {
          const closingField = fieldStack.pop()!;
          output.push(`${fieldIndent}</${closingField}>`);
        }

        inCounter = true;
        output.push(`${fieldIndent}<${fieldDescription} counter="${this.escapeXml(fieldMessage)}">`);
        fieldStack.push(fieldDescription);
      }
      // Handle Count fields (like RejectCount)
      else if (fieldDescription.endsWith('Count')) {
        inCount = true;
        output.push(`${fieldIndent}<${fieldDescription} ${fieldDescription}="${this.escapeXml(fieldMessage)}">`);
        fieldStack.push(fieldDescription);
      }
      // Regular field
      else {
        output.push(`${fieldIndent}<${fieldDescription}>${this.escapeXml(fieldMessage)}</${fieldDescription}>`);
      }
    }

    // Close any remaining open elements
    while (fieldStack.length > 0) {
      const closingField = fieldStack.pop()!;
      output.push(`${fieldIndent}</${closingField}>`);
    }

    output.push(`${indent}</${segmentName}>`);
  }

  /**
   * Check if a field is a repeating field
   */
  private isRepeatingField(fieldDescription: string): boolean {
    return this.reference.isRepeatingField(fieldDescription, this.version);
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

/**
 * Parse NCPDP message to XML (convenience function)
 */
export function parseNCPDPToXML(
  message: string,
  delimiters?: Partial<NCPDPDelimiters>
): string {
  const reader = new NCPDPReader(delimiters);
  return reader.parse(message);
}
