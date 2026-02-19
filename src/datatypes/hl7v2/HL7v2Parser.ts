/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/ER7Reader.java
 *
 * Purpose: Parse HL7v2 ER7 (pipe-delimited) format to XML
 *
 * Key behaviors to replicate:
 * - Extract encoding characters from MSH/FHS/BHS segments
 * - Parse segments, fields, components, subcomponents
 * - Generate XML with element names like MSH.1, MSH.2, PID.3.1
 * - Handle repetitions with ~ separator
 * - Handle special MSH-1 and MSH-2 fields
 */

import {
  HL7v2SerializationProperties,
  getDefaultSerializationProperties,
  extractEncodingCharacters,
  unescapeSegmentDelimiter,
} from './HL7v2Properties.js';

export const MESSAGE_ROOT_ID = 'HL7Message';

/**
 * HL7v2 Parser - converts ER7 format to XML
 */
export class HL7v2Parser {
  private properties: HL7v2SerializationProperties;

  constructor(properties?: Partial<HL7v2SerializationProperties>) {
    this.properties = {
      ...getDefaultSerializationProperties(),
      ...properties,
    };
  }

  /**
   * Parse ER7 message to XML
   */
  parse(message: string): string {
    if (!message || message.length < 6) {
      throw new Error(`Unable to parse message. It is NULL or too short: ${message}`);
    }

    // Convert line breaks if configured
    if (this.properties.convertLineBreaks) {
      message = this.convertLineBreaks(
        message,
        unescapeSegmentDelimiter(this.properties.segmentDelimiter)
      );
    }

    // Extract encoding characters
    const encoding = extractEncodingCharacters(message);

    // Tokenize segments
    const segmentDelimiter = unescapeSegmentDelimiter(this.properties.segmentDelimiter);
    const segments = message.split(segmentDelimiter).filter((s) => s.length > 0);

    if (segments.length === 0) {
      throw new Error('No segments found in message');
    }

    // Build XML
    const xmlParts: string[] = [];
    xmlParts.push(`<${MESSAGE_ROOT_ID}>`);

    for (const segment of segments) {
      const segmentXml = this.parseSegment(segment, encoding);
      if (segmentXml) {
        xmlParts.push(segmentXml);
      }
    }

    xmlParts.push(`</${MESSAGE_ROOT_ID}>`);

    return xmlParts.join('');
  }

  /**
   * Parse a single segment to XML
   */
  private parseSegment(
    segment: string,
    encoding: {
      fieldSeparator: string;
      componentSeparator: string;
      repetitionSeparator: string;
      escapeCharacter: string;
      subcomponentSeparator: string;
    }
  ): string {
    segment = segment.trim();
    if (!segment) {
      return '';
    }

    const { fieldSeparator, componentSeparator, repetitionSeparator, subcomponentSeparator } =
      encoding;

    // Split by field separator while preserving empty fields
    const fields = this.splitPreservingEmpty(segment, fieldSeparator);
    if (fields.length === 0) {
      return '';
    }

    const firstField = fields[0];
    if (!firstField) {
      return '';
    }
    const segmentId = firstField.trim();
    if (!segmentId) {
      return '';
    }

    const xmlParts: string[] = [];
    xmlParts.push(`<${segmentId}>`);

    const isHeaderSegment = segmentId === 'MSH' || segmentId === 'FHS' || segmentId === 'BHS';

    // Handle header segments specially (MSH-1 is the field separator itself)
    if (isHeaderSegment && fields.length > 1) {
      // MSH.1 - Field separator
      xmlParts.push(`<${segmentId}.1>${this.escapeXml(fieldSeparator)}</${segmentId}.1>`);

      // MSH.2 - Encoding characters (components, repetition, escape, subcomponent)
      const encodingChars =
        componentSeparator + repetitionSeparator + encoding.escapeCharacter + subcomponentSeparator;
      xmlParts.push(`<${segmentId}.2>${this.escapeXml(encodingChars)}</${segmentId}.2>`);

      // Process remaining fields (starting at index 2, which is MSH.3)
      // fields[0] = segment name, fields[1] = encoding chars
      for (let i = 2; i < fields.length; i++) {
        const field = fields[i] ?? '';
        const currentFieldIndex = i + 1; // MSH.3 starts at index 2, so add 1

        const fieldXml = this.parseField(
          field,
          segmentId,
          currentFieldIndex,
          componentSeparator,
          repetitionSeparator,
          subcomponentSeparator
        );
        xmlParts.push(fieldXml);
      }
    } else {
      // Non-header segments: process all fields normally
      for (let i = 1; i < fields.length; i++) {
        const field = fields[i] ?? '';

        const fieldXml = this.parseField(
          field,
          segmentId,
          i,
          componentSeparator,
          repetitionSeparator,
          subcomponentSeparator
        );
        xmlParts.push(fieldXml);
      }
    }

    xmlParts.push(`</${segmentId}>`);
    return xmlParts.join('');
  }

  /**
   * Parse a field, handling repetitions
   */
  private parseField(
    field: string,
    segmentId: string,
    fieldIndex: number,
    componentSeparator: string,
    repetitionSeparator: string,
    subcomponentSeparator: string
  ): string {
    const fieldName = `${segmentId}.${fieldIndex}`;

    if (this.properties.handleRepetitions && field.includes(repetitionSeparator)) {
      // Handle repetitions
      const repetitions = this.splitPreservingEmpty(field, repetitionSeparator);
      const xmlParts: string[] = [];

      for (const rep of repetitions) {
        xmlParts.push(
          this.parseFieldContent(rep, fieldName, componentSeparator, subcomponentSeparator)
        );
      }

      return xmlParts.join('');
    } else {
      return this.parseFieldContent(field, fieldName, componentSeparator, subcomponentSeparator);
    }
  }

  /**
   * Parse field content (components)
   */
  private parseFieldContent(
    content: string,
    fieldName: string,
    componentSeparator: string,
    subcomponentSeparator: string
  ): string {
    const hasComponents = content.includes(componentSeparator);
    const hasSubcomponents =
      this.properties.handleSubcomponents && content.includes(subcomponentSeparator);

    if (!hasComponents && !hasSubcomponents) {
      // Simple field with no components
      return `<${fieldName}><${fieldName}.1>${this.escapeXml(content)}</${fieldName}.1></${fieldName}>`;
    }

    // Parse components
    const components = this.splitPreservingEmpty(content, componentSeparator);
    const xmlParts: string[] = [];
    xmlParts.push(`<${fieldName}>`);

    for (let i = 0; i < components.length; i++) {
      const component = components[i] ?? '';
      const componentName = `${fieldName}.${i + 1}`;

      if (this.properties.handleSubcomponents && component.includes(subcomponentSeparator)) {
        // Parse subcomponents
        const subcomponents = this.splitPreservingEmpty(component, subcomponentSeparator);
        xmlParts.push(`<${componentName}>`);

        for (let j = 0; j < subcomponents.length; j++) {
          const subcomponent = subcomponents[j] ?? '';
          const subcomponentName = `${componentName}.${j + 1}`;
          xmlParts.push(
            `<${subcomponentName}>${this.escapeXml(subcomponent)}</${subcomponentName}>`
          );
        }

        xmlParts.push(`</${componentName}>`);
      } else {
        xmlParts.push(`<${componentName}>${this.escapeXml(component)}</${componentName}>`);
      }
    }

    xmlParts.push(`</${fieldName}>`);
    return xmlParts.join('');
  }

  /**
   * Split string by delimiter, preserving empty strings
   */
  private splitPreservingEmpty(str: string, delimiter: string): string[] {
    if (!str) {
      return [''];
    }
    const result: string[] = [];
    let current = '';
    let i = 0;

    while (i < str.length) {
      if (str.substring(i, i + delimiter.length) === delimiter) {
        result.push(current);
        current = '';
        i += delimiter.length;
      } else {
        current += str[i];
        i++;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert various line break formats to the target segment delimiter
   */
  private convertLineBreaks(message: string, targetDelimiter: string): string {
    // Replace \r\n first, then \r, then \n
    return message
      .replace(/\r\n/g, targetDelimiter)
      .replace(/\r/g, targetDelimiter)
      .replace(/\n/g, targetDelimiter);
  }
}

/**
 * Parse ER7 message to XML (convenience function)
 */
export function parseER7ToXML(
  message: string,
  properties?: Partial<HL7v2SerializationProperties>
): string {
  const parser = new HL7v2Parser(properties);
  return parser.parse(message);
}
