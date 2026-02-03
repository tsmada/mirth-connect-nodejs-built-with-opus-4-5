/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/edi/EDIXMLHandler.java
 *
 * Purpose: Serialize XML back to EDI/X12 format
 *
 * Key behaviors to replicate:
 * - Convert XML segments/elements back to delimited format
 * - Handle empty elements properly
 * - Preserve delimiter configuration from XML attributes
 */

import { XMLParser } from 'fast-xml-parser';
import {
  EDIDelimiters,
  getDefaultEDISerializationProperties,
} from './EDIProperties.js';


/**
 * Serialize XML to EDI/X12 format
 */
export class EDISerializer {
  private delimiters: EDIDelimiters;

  constructor(delimiters?: Partial<EDIDelimiters>) {
    const defaults = getDefaultEDISerializationProperties();
    this.delimiters = {
      segmentDelimiter: delimiters?.segmentDelimiter ?? defaults.segmentDelimiter,
      elementDelimiter: delimiters?.elementDelimiter ?? defaults.elementDelimiter,
      subelementDelimiter:
        delimiters?.subelementDelimiter ?? defaults.subelementDelimiter,
    };
  }

  /**
   * Serialize XML to EDI format
   */
  serialize(source: string): string {
    // Remove whitespace between elements
    const cleanedXml = this.removeXMLWhitespace(source);

    // Parse XML with attributes preserved
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: false,
      parseTagValue: false,
    });

    const parsed = parser.parse(cleanedXml);

    // Find root element (X12Transaction or EDIMessage)
    let root: Record<string, unknown> | null = null;
    let rootName = '';

    if (parsed.X12Transaction) {
      root = parsed.X12Transaction as Record<string, unknown>;
      rootName = 'X12Transaction';
    } else if (parsed.EDIMessage) {
      root = parsed.EDIMessage as Record<string, unknown>;
      rootName = 'EDIMessage';
    }

    if (!root) {
      throw new Error('Invalid EDI XML: missing X12Transaction or EDIMessage root element');
    }

    // Extract delimiters from attributes
    this.extractDelimitersFromAttributes(root);

    return this.serializeDocument(root, rootName);
  }

  /**
   * Remove whitespace between XML elements
   */
  private removeXMLWhitespace(xml: string): string {
    return xml.replace(/>\s+</g, '><');
  }

  /**
   * Extract delimiters from XML attributes
   */
  private extractDelimitersFromAttributes(root: Record<string, unknown>): void {
    if (root['@_segmentDelimiter']) {
      this.delimiters.segmentDelimiter = this.unescapeXMLAttribute(
        String(root['@_segmentDelimiter'])
      );
    }
    if (root['@_elementDelimiter']) {
      this.delimiters.elementDelimiter = this.unescapeXMLAttribute(
        String(root['@_elementDelimiter'])
      );
    }
    if (root['@_subelementDelimiter']) {
      this.delimiters.subelementDelimiter = this.unescapeXMLAttribute(
        String(root['@_subelementDelimiter'])
      );
    }
  }

  /**
   * Serialize document structure
   */
  private serializeDocument(
    root: Record<string, unknown>,
    _rootName: string
  ): string {
    let output = '';

    // Process each segment (non-attribute keys)
    for (const key of Object.keys(root)) {
      if (key.startsWith('@_')) continue;

      const segments = this.ensureArray(root[key]);
      for (const segment of segments) {
        output += this.serializeSegment(key, segment);
        output += this.delimiters.segmentDelimiter;
      }
    }

    return output;
  }

  /**
   * Serialize a single segment
   */
  private serializeSegment(
    segmentId: string,
    segment: unknown
  ): string {
    let output = segmentId;

    if (!segment || typeof segment !== 'object') {
      return output;
    }

    const segmentObj = segment as Record<string, unknown>;

    // Get element keys sorted by their numeric suffix
    const elementKeys = Object.keys(segmentObj)
      .filter((k) => !k.startsWith('@_') && k.startsWith(`${segmentId}.`))
      .sort((a, b) => {
        const numA = this.extractElementNumber(a);
        const numB = this.extractElementNumber(b);
        return numA - numB;
      });

    let prevElementNum = 0;

    for (const key of elementKeys) {
      const elementNum = this.extractElementNumber(key);

      // Add empty elements for gaps
      for (let i = prevElementNum + 1; i < elementNum; i++) {
        output += this.delimiters.elementDelimiter;
      }

      output += this.delimiters.elementDelimiter;
      output += this.serializeElement(key, segmentObj[key]);
      prevElementNum = elementNum;
    }

    return output;
  }

  /**
   * Serialize an element (which may contain subelements)
   */
  private serializeElement(_elementKey: string, element: unknown): string {
    if (element === null || element === undefined) {
      return '';
    }

    if (typeof element === 'string' || typeof element === 'number') {
      return String(element);
    }

    if (typeof element !== 'object') {
      return String(element);
    }

    const elementObj = element as Record<string, unknown>;

    // Check for subelements
    const subelementKeys = Object.keys(elementObj)
      .filter((k) => !k.startsWith('@_') && k.includes('.'))
      .sort((a, b) => {
        const numA = this.extractSubelementNumber(a);
        const numB = this.extractSubelementNumber(b);
        return numA - numB;
      });

    if (subelementKeys.length === 0) {
      // Check for text content
      if ('#text' in elementObj) {
        return String(elementObj['#text']);
      }
      return '';
    }

    let output = '';
    let prevSubelementNum = 0;

    for (const key of subelementKeys) {
      const subelementNum = this.extractSubelementNumber(key);

      // Add empty subelements for gaps
      for (let i = prevSubelementNum + 1; i < subelementNum; i++) {
        if (output) {
          output += this.delimiters.subelementDelimiter;
        }
      }

      if (prevSubelementNum > 0) {
        output += this.delimiters.subelementDelimiter;
      }

      const value = elementObj[key];
      if (typeof value === 'object' && value !== null && '#text' in value) {
        output += String((value as Record<string, unknown>)['#text']);
      } else if (value !== null && value !== undefined) {
        output += String(value);
      }

      prevSubelementNum = subelementNum;
    }

    return output;
  }

  /**
   * Extract element number from key (e.g., "ISA.01" -> 1)
   */
  private extractElementNumber(key: string): number {
    const parts = key.split('.');
    if (parts.length >= 2 && parts[1]) {
      return parseInt(parts[1], 10) || 0;
    }
    return 0;
  }

  /**
   * Extract subelement number from key (e.g., "ISA.01.2" -> 2)
   */
  private extractSubelementNumber(key: string): number {
    const parts = key.split('.');
    if (parts.length >= 3 && parts[2]) {
      return parseInt(parts[2], 10) || 0;
    }
    return 0;
  }

  /**
   * Ensure value is an array
   */
  private ensureArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [value];
  }

  /**
   * Unescape XML attribute value
   */
  private unescapeXMLAttribute(value: string): string {
    return value
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r')
      .replace(/&#9;/g, '\t')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  }
}

/**
 * Serialize XML to EDI (convenience function)
 */
export function serializeXMLToEDI(
  source: string,
  delimiters?: Partial<EDIDelimiters>
): string {
  const serializer = new EDISerializer(delimiters);
  return serializer.serialize(source);
}
