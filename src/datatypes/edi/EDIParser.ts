/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/edi/EDIReader.java
 *
 * Purpose: Parse EDI/X12 messages into XML format
 *
 * Key behaviors to replicate:
 * - Tokenize segments by segment delimiter
 * - Parse elements and subelements
 * - Generate proper element naming (SEG.01.1 format)
 * - Detect X12 vs generic EDI from ISA segment
 */

import {
  EDISerializationProperties,
  EDIDelimiters,
  getDefaultEDISerializationProperties,
  unescapeEDIDelimiter,
  detectX12Delimiters,
} from './EDIProperties.js';

/**
 * Parse EDI/X12 messages to XML
 */
export class EDIParser {
  private properties: EDISerializationProperties;

  constructor(properties?: Partial<EDISerializationProperties>) {
    this.properties = {
      ...getDefaultEDISerializationProperties(),
      ...properties,
    };
  }

  /**
   * Parse EDI message to XML
   */
  parse(source: string): string {
    const message = source.trim();

    if (!message || message.length < 3) {
      throw new Error(
        `Unable to parse, message is null or too short: ${message}`
      );
    }

    // Get delimiters
    const delimiters = this.getDelimiters(message);

    // Determine document type
    const isX12 = message.startsWith('ISA');
    const documentHead = isX12 ? 'X12Transaction' : 'EDIMessage';

    // Build XML
    let xml = '';
    xml += `<${documentHead} segmentDelimiter="${this.escapeXMLAttribute(delimiters.segmentDelimiter)}" `;
    xml += `elementDelimiter="${this.escapeXMLAttribute(delimiters.elementDelimiter)}" `;
    xml += `subelementDelimiter="${this.escapeXMLAttribute(delimiters.subelementDelimiter)}">`;

    // Tokenize segments
    const segments = this.tokenizeSegments(message, delimiters.segmentDelimiter);

    for (const segment of segments) {
      const trimmedSegment = segment.trim();
      if (!trimmedSegment) continue;

      xml += this.parseSegment(trimmedSegment, delimiters);
    }

    xml += `</${documentHead}>`;
    return xml;
  }

  /**
   * Get delimiters for the message
   */
  private getDelimiters(message: string): EDIDelimiters {
    const baseDelimiters: EDIDelimiters = {
      segmentDelimiter: unescapeEDIDelimiter(
        this.properties.segmentDelimiter
      ),
      elementDelimiter: unescapeEDIDelimiter(
        this.properties.elementDelimiter
      ),
      subelementDelimiter: unescapeEDIDelimiter(
        this.properties.subelementDelimiter
      ),
    };

    if (this.properties.inferX12Delimiters) {
      return detectX12Delimiters(message, baseDelimiters);
    }

    return baseDelimiters;
  }

  /**
   * Tokenize message into segments
   */
  private tokenizeSegments(message: string, delimiter: string): string[] {
    const segments: string[] = [];
    let start = 0;

    while (start < message.length) {
      const delimIndex = message.indexOf(delimiter, start);
      if (delimIndex === -1) {
        // Last segment (no trailing delimiter)
        const lastSegment = message.substring(start);
        if (lastSegment.trim()) {
          segments.push(lastSegment);
        }
        break;
      }
      segments.push(message.substring(start, delimIndex));
      start = delimIndex + delimiter.length;
    }

    return segments;
  }

  /**
   * Parse a single segment to XML
   */
  private parseSegment(segment: string, delimiters: EDIDelimiters): string {
    const elements = this.tokenize(segment, delimiters.elementDelimiter);

    if (elements.length === 0) {
      throw new Error(`Could not find elements in segment: ${segment}`);
    }

    const segmentId = (elements[0] ?? '').trim();
    let xml = `<${segmentId}>`;

    let fieldId = 0;
    let lastWasDelimiter = false;

    for (let i = 1; i < elements.length; i++) {
      const element = elements[i];

      if (element === delimiters.elementDelimiter) {
        if (lastWasDelimiter) {
          // Empty element
          const field = this.formatFieldNumber(fieldId);
          xml += `<${segmentId}.${field}></${segmentId}.${field}>`;
        }
        fieldId++;
        lastWasDelimiter = true;
      } else {
        lastWasDelimiter = false;

        const field = this.formatFieldNumber(fieldId);

        // Check for subelements
        if (
          element &&
          element.indexOf(delimiters.subelementDelimiter) !== -1
        ) {
          xml += `<${segmentId}.${field}>`;
          xml += this.parseSubelements(
            element,
            segmentId,
            field,
            delimiters.subelementDelimiter
          );
          xml += `</${segmentId}.${field}>`;
        } else {
          // Single element with subelement wrapper
          xml += `<${segmentId}.${field}>`;
          xml += `<${segmentId}.${field}.1>${this.escapeXMLEntities(element ?? '')}</${segmentId}.${field}.1>`;
          xml += `</${segmentId}.${field}>`;
        }
      }
    }

    // Handle trailing empty element
    if (lastWasDelimiter) {
      const field = this.formatFieldNumber(fieldId);
      xml += `<${segmentId}.${field}></${segmentId}.${field}>`;
    }

    xml += `</${segmentId}>`;
    return xml;
  }

  /**
   * Parse subelements
   */
  private parseSubelements(
    element: string,
    segmentId: string,
    field: string,
    subelementDelimiter: string
  ): string {
    const subelements = this.tokenize(element, subelementDelimiter);

    let xml = '';
    let subelementId = 1;
    let lastWasDelimiter = true;

    for (const subelement of subelements) {
      if (subelement === subelementDelimiter) {
        if (lastWasDelimiter) {
          // Empty subelement
          xml += `<${segmentId}.${field}.${subelementId}></${segmentId}.${field}.${subelementId}>`;
        }
        subelementId++;
        lastWasDelimiter = true;
      } else {
        lastWasDelimiter = false;
        xml += `<${segmentId}.${field}.${subelementId}>${this.escapeXMLEntities(subelement)}</${segmentId}.${field}.${subelementId}>`;
      }
    }

    // Handle trailing empty subelement
    if (lastWasDelimiter) {
      xml += `<${segmentId}.${field}.${subelementId}></${segmentId}.${field}.${subelementId}>`;
    }

    return xml;
  }

  /**
   * Tokenize string, keeping delimiters as separate tokens
   */
  private tokenize(str: string, delimiter: string): string[] {
    const tokens: string[] = [];
    let start = 0;

    while (start < str.length) {
      const delimIndex = str.indexOf(delimiter, start);
      if (delimIndex === -1) {
        tokens.push(str.substring(start));
        break;
      }
      if (delimIndex > start) {
        tokens.push(str.substring(start, delimIndex));
      }
      tokens.push(delimiter);
      start = delimIndex + delimiter.length;
    }

    return tokens;
  }

  /**
   * Format field number (01, 02, ... 10, 11, ...)
   */
  private formatFieldNumber(num: number): string {
    return num < 10 ? `0${num}` : `${num}`;
  }

  /**
   * Escape XML entities
   */
  private escapeXMLEntities(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Escape for XML attribute
   */
  private escapeXMLAttribute(value: string): string {
    return this.escapeXMLEntities(value)
      .replace(/\n/g, '&#10;')
      .replace(/\r/g, '&#13;')
      .replace(/\t/g, '&#9;');
  }
}

/**
 * Parse EDI to XML (convenience function)
 */
export function parseEDIToXML(
  source: string,
  properties?: Partial<EDISerializationProperties>
): string {
  const parser = new EDIParser(properties);
  return parser.parse(source);
}
