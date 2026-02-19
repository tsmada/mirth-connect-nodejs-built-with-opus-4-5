/**
 * Ported from:
 * - ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPSerializer.java
 * - ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPXMLHandler.java
 *
 * Purpose: Serialize NCPDP messages (convert between NCPDP and XML formats)
 *
 * Key behaviors to replicate:
 * - fromXML: Convert XML back to NCPDP format
 * - toXML: Convert NCPDP to XML (delegates to NCPDPReader)
 * - Handle version detection (D.0 vs 5.1)
 * - Transform delimiters without full serialization when possible
 */

import { XMLParser } from 'fast-xml-parser';
import { NCPDPReader } from './NCPDPReader.js';
import { NCPDPReference } from './NCPDPReference.js';
import {
  NCPDPDelimiters,
  NCPDPSerializationProperties,
  NCPDPDeserializationProperties,
  NCPDPVersion,
  unescapeNCPDPDelimiter,
} from './NCPDPProperties.js';

/**
 * NCPDP Message Serializer
 *
 * Handles conversion between NCPDP wire format and XML representation.
 */
export class NCPDPSerializer {
  private serializationSegmentDelimiter: string;
  private serializationGroupDelimiter: string;
  private serializationFieldDelimiter: string;
  private deserializationSegmentDelimiter: string;
  private deserializationGroupDelimiter: string;
  private deserializationFieldDelimiter: string;
  private useStrictValidation: boolean;
  private reference: NCPDPReference;

  constructor(
    serializationProps?: Partial<NCPDPSerializationProperties>,
    deserializationProps?: Partial<NCPDPDeserializationProperties>
  ) {
    // Default delimiters
    this.serializationSegmentDelimiter = unescapeNCPDPDelimiter(
      serializationProps?.segmentDelimiter ?? '0x1E'
    );
    this.serializationGroupDelimiter = unescapeNCPDPDelimiter(
      serializationProps?.groupDelimiter ?? '0x1D'
    );
    this.serializationFieldDelimiter = unescapeNCPDPDelimiter(
      serializationProps?.fieldDelimiter ?? '0x1C'
    );

    this.deserializationSegmentDelimiter = unescapeNCPDPDelimiter(
      deserializationProps?.segmentDelimiter ?? '0x1E'
    );
    this.deserializationGroupDelimiter = unescapeNCPDPDelimiter(
      deserializationProps?.groupDelimiter ?? '0x1D'
    );
    this.deserializationFieldDelimiter = unescapeNCPDPDelimiter(
      deserializationProps?.fieldDelimiter ?? '0x1C'
    );

    this.useStrictValidation = deserializationProps?.useStrictValidation ?? false;
    this.reference = NCPDPReference.getInstance();
  }

  /**
   * Get deserialization delimiters
   */
  getDeserializationDelimiters(): NCPDPDelimiters {
    return {
      segmentDelimiter: this.deserializationSegmentDelimiter,
      groupDelimiter: this.deserializationGroupDelimiter,
      fieldDelimiter: this.deserializationFieldDelimiter,
    };
  }

  /**
   * Check if serialization is required
   * If only transforming delimiters, we can skip full XML parsing
   */
  isSerializationRequired(toXml: boolean): boolean {
    if (toXml) {
      return false;
    }
    return this.useStrictValidation;
  }

  /**
   * Transform NCPDP message without full serialization
   * Just replaces delimiters if they differ
   */
  transformWithoutSerializing(message: string, outputDelimiters: NCPDPDelimiters): string | null {
    let transformed = false;

    if (this.serializationSegmentDelimiter !== outputDelimiters.segmentDelimiter) {
      message = message
        .split(this.serializationSegmentDelimiter)
        .join(outputDelimiters.segmentDelimiter);
      transformed = true;
    }

    if (this.serializationGroupDelimiter !== outputDelimiters.groupDelimiter) {
      message = message
        .split(this.serializationGroupDelimiter)
        .join(outputDelimiters.groupDelimiter);
      transformed = true;
    }

    if (this.serializationFieldDelimiter !== outputDelimiters.fieldDelimiter) {
      message = message
        .split(this.serializationFieldDelimiter)
        .join(outputDelimiters.fieldDelimiter);
      transformed = true;
    }

    return transformed ? message : null;
  }

  /**
   * Convert NCPDP message to XML
   */
  toXML(source: string): string {
    const reader = new NCPDPReader({
      segmentDelimiter: this.serializationSegmentDelimiter,
      groupDelimiter: this.serializationGroupDelimiter,
      fieldDelimiter: this.serializationFieldDelimiter,
    });
    return reader.parse(source);
  }

  /**
   * Convert XML to NCPDP message
   */
  fromXML(source: string): string {
    // Detect version from XML content
    const version = this.detectVersionFromXML(source);

    // Remove whitespace between tags (handle pretty-printed XML)
    const cleanedXml = source.replace(/>\s+</g, '><');

    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      trimValues: false,
      parseTagValue: false,
    });

    const parsed = parser.parse(cleanedXml);

    // Find root element
    const rootKey = Object.keys(parsed).find(
      (key) => key.startsWith('NCPDP_') || key === 'NCPDPMessage' || key === '?xml'
    );

    if (!rootKey || rootKey === '?xml') {
      // Try to find the actual root after ?xml
      const keys = Object.keys(parsed).filter((k) => k !== '?xml');
      if (keys.length === 0 || !keys[0]) {
        throw new Error('Invalid NCPDP XML: missing root element');
      }
      return this.serializeDocument(parsed[keys[0]] as Record<string, unknown>, version);
    }

    return this.serializeDocument(parsed[rootKey] as Record<string, unknown>, version);
  }

  /**
   * Serialize XML document back to NCPDP format
   */
  private serializeDocument(root: Record<string, unknown>, version: NCPDPVersion): string {
    const output: string[] = [];
    let inTransactionHeader = false;

    // Process all child elements
    for (const [key, value] of Object.entries(root)) {
      if (key.startsWith('@_')) continue; // Skip attributes

      if (key.startsWith('TransactionHeader')) {
        inTransactionHeader = true;
        this.serializeTransactionHeader(value as Record<string, unknown>, output, key);
        inTransactionHeader = false;
      } else if (key === 'TRANSACTIONS') {
        // Handle transactions container
        const transactions = value as Record<string, unknown>;
        if (transactions.TRANSACTION) {
          const txnArray = Array.isArray(transactions.TRANSACTION)
            ? transactions.TRANSACTION
            : [transactions.TRANSACTION];

          for (const txn of txnArray) {
            output.push(this.deserializationGroupDelimiter);
            this.serializeTransaction(txn as Record<string, unknown>, version, output);
          }
        }
      } else if (!inTransactionHeader) {
        // Regular segment
        output.push(this.deserializationSegmentDelimiter);
        this.serializeSegment(key, value as Record<string, unknown>, version, output);
      }
    }

    return output.join('');
  }

  /**
   * Serialize transaction header
   */
  private serializeTransactionHeader(
    header: Record<string, unknown>,
    output: string[],
    headerType: string
  ): void {
    if (headerType === 'TransactionHeaderRequest') {
      // Request header: BIN(6) + Version(2) + TransCode(2) + PCN(10) + Count(1) + SPIdQual(2) + SPId(15) + DOS(8) + VendorId(10)
      output.push(this.getTextContent(header.BinNumber, 6));
      output.push(this.getTextContent(header.VersionReleaseNumber, 2));
      output.push(this.getTextContent(header.TransactionCode, 2));
      output.push(this.getTextContent(header.ProcessorControlNumber, 10));
      output.push(this.getTextContent(header.TransactionCount, 1));
      output.push(this.getTextContent(header.ServiceProviderIdQualifier, 2));
      output.push(this.getTextContent(header.ServiceProviderId, 15));
      output.push(this.getTextContent(header.DateOfService, 8));
      if (header.SoftwareVendorCertificationId) {
        output.push(this.getTextContent(header.SoftwareVendorCertificationId, 10));
      }
    } else if (headerType === 'TransactionHeaderResponse') {
      // Response header: Version(2) + TransCode(2) + Count(1) + Status(1) + SPIdQual(2) + SPId(15) + DOS(8)
      output.push(this.getTextContent(header.VersionReleaseNumber, 2));
      output.push(this.getTextContent(header.TransactionCode, 2));
      output.push(this.getTextContent(header.TransactionCount, 1));
      output.push(this.getTextContent(header.HeaderResponseStatus, 1));
      output.push(this.getTextContent(header.ServiceProviderIdQualifier, 2));
      output.push(this.getTextContent(header.ServiceProviderId, 15));
      output.push(this.getTextContent(header.DateOfService, 8));
    }
  }

  /**
   * Serialize a transaction group
   */
  private serializeTransaction(
    transaction: Record<string, unknown>,
    version: NCPDPVersion,
    output: string[]
  ): void {
    for (const [key, value] of Object.entries(transaction)) {
      if (key.startsWith('@_')) continue;

      output.push(this.deserializationSegmentDelimiter);
      this.serializeSegment(key, value as Record<string, unknown>, version, output);
    }
  }

  /**
   * Serialize a segment
   */
  private serializeSegment(
    segmentName: string,
    segment: Record<string, unknown>,
    version: NCPDPVersion,
    output: string[]
  ): void {
    // Get segment ID from name
    const segmentId = this.reference.getSegmentIdByName(segmentName, version);

    output.push(this.deserializationFieldDelimiter);
    output.push(segmentId);

    // Process segment fields
    for (const [fieldName, fieldValue] of Object.entries(segment)) {
      if (fieldName.startsWith('@_')) {
        // Attribute - might be a count attribute
        continue;
      }

      if (this.isCounterOrCountField(fieldName)) {
        // Counter or Count field - value is in attribute
        const fieldCode = this.reference.getCodeByName(fieldName, version);
        output.push(this.deserializationFieldDelimiter);
        output.push(fieldCode);

        // Get counter/count value from attribute
        if (typeof fieldValue === 'object' && fieldValue !== null) {
          const attr =
            (fieldValue as Record<string, unknown>)[`@_${fieldName}`] ??
            (fieldValue as Record<string, unknown>)['@_counter'];
          if (attr) {
            output.push(String(attr));
          }

          // Process nested fields
          this.serializeNestedFields(fieldValue as Record<string, unknown>, version, output);
        }
      } else {
        // Regular field
        const fieldCode = this.reference.getCodeByName(fieldName, version);
        output.push(this.deserializationFieldDelimiter);
        output.push(fieldCode);
        output.push(this.getFieldValue(fieldValue));
      }
    }
  }

  /**
   * Serialize nested fields within a counter/count element
   */
  private serializeNestedFields(
    parent: Record<string, unknown>,
    version: NCPDPVersion,
    output: string[]
  ): void {
    for (const [fieldName, fieldValue] of Object.entries(parent)) {
      if (fieldName.startsWith('@_') || fieldName === '#text') {
        continue;
      }

      const fieldCode = this.reference.getCodeByName(fieldName, version);
      output.push(this.deserializationFieldDelimiter);
      output.push(fieldCode);
      output.push(this.getFieldValue(fieldValue));
    }
  }

  /**
   * Check if field is a Counter or Count field
   */
  private isCounterOrCountField(fieldName: string): boolean {
    return fieldName.endsWith('Counter') || fieldName.endsWith('Count');
  }

  /**
   * Get field value as string
   */
  private getFieldValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if ('#text' in obj) {
        return String(obj['#text']);
      }
      return '';
    }
    return String(value);
  }

  /**
   * Get text content from XML node, padded/truncated to specified length
   */
  private getTextContent(value: unknown, maxLength?: number): string {
    let text = this.getFieldValue(value);

    if (maxLength !== undefined) {
      if (text.length < maxLength) {
        text = text.padEnd(maxLength, ' ');
      } else if (text.length > maxLength) {
        text = text.substring(0, maxLength);
      }
    }

    return text;
  }

  /**
   * Detect NCPDP version from XML content
   */
  private detectVersionFromXML(xml: string): NCPDPVersion {
    // Look for version in root element name or VersionReleaseNumber
    if (xml.includes('_D0_') || xml.includes('>D0<')) {
      return NCPDPVersion.D0;
    }
    if (xml.includes('_51_') || xml.includes('>51<')) {
      return NCPDPVersion.V51;
    }
    return NCPDPVersion.D0; // Default
  }

  /**
   * Extract metadata from NCPDP message
   */
  getMetaDataFromMessage(message: string): Record<string, string> {
    const map: Record<string, string> = {};
    this.populateMetaData(message, map);

    if (!map.version) {
      map.version = '5.1'; // Default version
    }

    return map;
  }

  /**
   * Populate metadata from message
   */
  populateMetaData(message: string, map: Record<string, string>): void {
    try {
      const segmentDelimiterIndex = message.indexOf(this.serializationSegmentDelimiter);
      if (segmentDelimiterIndex === -1) {
        return;
      }

      let versionPos = 6;
      let typePos = 8;
      let sourcePos = 23;

      // Handle response (shorter header)
      if (segmentDelimiterIndex <= 40) {
        versionPos = 0;
        typePos = 2;
        sourcePos = 8;
      }

      if (versionPos + 2 <= message.length) {
        map.version = message.substring(versionPos, versionPos + 2);
      }

      if (typePos + 2 <= message.length) {
        map.type = this.reference.getTransactionName(message.substring(typePos, typePos + 2));
      }

      if (sourcePos + 15 <= message.length) {
        map.source = message.substring(sourcePos, sourcePos + 15).trim();
      }
    } catch (e) {
      // Silently fail metadata extraction
    }
  }
}

/**
 * Convert NCPDP to XML (convenience function)
 */
export function convertNCPDPToXML(message: string, delimiters?: Partial<NCPDPDelimiters>): string {
  const serializer = new NCPDPSerializer(delimiters);
  return serializer.toXML(message);
}

/**
 * Convert XML to NCPDP (convenience function)
 */
export function convertXMLToNCPDP(xml: string, delimiters?: Partial<NCPDPDelimiters>): string {
  const serializer = new NCPDPSerializer(undefined, delimiters);
  return serializer.fromXML(xml);
}
