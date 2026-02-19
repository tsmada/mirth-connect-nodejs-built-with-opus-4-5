/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/ER7Serializer.java
 *              ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/XMLEncodedHL7Handler.java
 *
 * Purpose: Serialize HL7v2 XML format back to ER7 (pipe-delimited)
 *
 * Key behaviors to replicate:
 * - Parse XML and extract field values
 * - Reconstruct ER7 format with proper delimiters
 * - Handle MSH-1 and MSH-2 encoding characters
 * - Handle components, subcomponents, and repetitions
 */

import {
  HL7v2DeserializationProperties,
  getDefaultDeserializationProperties,
  unescapeSegmentDelimiter,
  HL7V2_DEFAULTS,
} from './HL7v2Properties.js';
import { MESSAGE_ROOT_ID } from './HL7v2Parser.js';

/**
 * HL7v2 Serializer - converts XML to ER7 format
 */
export class HL7v2Serializer {
  private properties: HL7v2DeserializationProperties;

  constructor(properties?: Partial<HL7v2DeserializationProperties>) {
    this.properties = {
      ...getDefaultDeserializationProperties(),
      ...properties,
    };
  }

  /**
   * Serialize XML to ER7 format
   */
  serialize(xml: string): string {
    // Extract delimiters from MSH.1 and MSH.2
    const fieldSeparator = this.extractNodeValue(xml, 'MSH.1') || HL7V2_DEFAULTS.FIELD_SEPARATOR;
    const encodingChars = this.unescapeXmlEntities(this.extractNodeValue(xml, 'MSH.2') || '^~\\&');

    const componentSeparator = encodingChars.charAt(0) || HL7V2_DEFAULTS.COMPONENT_SEPARATOR;
    const repetitionSeparator = encodingChars.charAt(1) || HL7V2_DEFAULTS.REPETITION_SEPARATOR;
    const escapeCharacter = encodingChars.charAt(2) || HL7V2_DEFAULTS.ESCAPE_CHARACTER;
    const subcomponentSeparator = encodingChars.charAt(3) || HL7V2_DEFAULTS.SUBCOMPONENT_SEPARATOR;

    const segmentDelimiter = unescapeSegmentDelimiter(this.properties.segmentDelimiter);

    // Clean up pretty-printed XML
    xml = this.removePrettyPrintWhitespace(xml);

    // Parse XML and build ER7
    const segments = this.extractSegments(xml);
    const er7Parts: string[] = [];

    for (const segment of segments) {
      const er7Segment = this.serializeSegment(
        segment.name,
        segment.content,
        fieldSeparator,
        componentSeparator,
        repetitionSeparator,
        escapeCharacter,
        subcomponentSeparator
      );
      if (er7Segment) {
        er7Parts.push(er7Segment);
      }
    }

    return er7Parts.join(segmentDelimiter) + segmentDelimiter;
  }

  /**
   * Extract all segment elements from XML
   */
  private extractSegments(xml: string): Array<{ name: string; content: string }> {
    // Find the HL7Message root element content
    const rootMatch = xml.match(
      new RegExp(`<${MESSAGE_ROOT_ID}[^>]*>([\\s\\S]*)</${MESSAGE_ROOT_ID}>`)
    );
    if (!rootMatch || !rootMatch[1]) {
      // Try without root element
      return this.extractSegmentsFromContent(xml);
    }

    return this.extractSegmentsFromContent(rootMatch[1]);
  }

  /**
   * Extract segments from content string
   */
  private extractSegmentsFromContent(content: string): Array<{ name: string; content: string }> {
    const segments: Array<{ name: string; content: string }> = [];

    // Match segment elements (3 uppercase letters)
    const segmentRegex = /<([A-Z][A-Z0-9]{2})>([\s\S]*?)<\/\1>/g;
    let match;

    while ((match = segmentRegex.exec(content)) !== null) {
      segments.push({
        name: match[1] ?? '',
        content: match[2] ?? '',
      });
    }

    return segments;
  }

  /**
   * Serialize a single segment to ER7
   */
  private serializeSegment(
    segmentName: string,
    content: string,
    fieldSeparator: string,
    componentSeparator: string,
    repetitionSeparator: string,
    escapeCharacter: string,
    subcomponentSeparator: string
  ): string {
    const isHeaderSegment = segmentName === 'MSH' || segmentName === 'FHS' || segmentName === 'BHS';

    // Extract all fields
    const fieldRegex = new RegExp(
      `<${segmentName}\\.(\\d+)>([\\s\\S]*?)</${segmentName}\\.\\d+>`,
      'g'
    );

    const fields: Map<number, string[]> = new Map();
    let maxFieldIndex = 0;
    let match;

    while ((match = fieldRegex.exec(content)) !== null) {
      const fieldIndex = parseInt(match[1] ?? '0', 10);
      const fieldContent = match[2] ?? '';
      maxFieldIndex = Math.max(maxFieldIndex, fieldIndex);

      if (!fields.has(fieldIndex)) {
        fields.set(fieldIndex, []);
      }

      // Parse field content (could be components or simple value)
      const fieldValue = this.parseFieldContent(
        fieldContent,
        segmentName,
        fieldIndex,
        componentSeparator,
        subcomponentSeparator
      );
      fields.get(fieldIndex)!.push(fieldValue);
    }

    // Build ER7 segment
    const parts: string[] = [segmentName];

    // Determine starting field index
    const startField = isHeaderSegment ? 1 : 1;

    for (let i = startField; i <= maxFieldIndex; i++) {
      // MSH.1 and MSH.2 are handled specially
      if (isHeaderSegment && i === 1) {
        // Skip MSH.1 (field separator is implicit)
        continue;
      }
      if (isHeaderSegment && i === 2) {
        // Skip MSH.2 (encoding chars are implicit)
        continue;
      }

      const fieldValues = fields.get(i) || [''];
      // Join repetitions with repetition separator
      parts.push(fieldValues.join(repetitionSeparator));
    }

    // For header segments, we need special handling
    if (isHeaderSegment) {
      // MSH starts with field separator then encoding chars
      return (
        segmentName +
        fieldSeparator +
        componentSeparator +
        repetitionSeparator +
        escapeCharacter +
        subcomponentSeparator +
        fieldSeparator +
        parts.slice(1).join(fieldSeparator)
      );
    }

    return parts.join(fieldSeparator);
  }

  /**
   * Parse field content from XML
   */
  private parseFieldContent(
    content: string,
    segmentName: string,
    fieldIndex: number,
    componentSeparator: string,
    subcomponentSeparator: string
  ): string {
    const fieldName = `${segmentName}.${fieldIndex}`;

    // Check for components
    const componentRegex = new RegExp(
      `<${fieldName}\\.(\\d+)>([\\s\\S]*?)</${fieldName}\\.\\d+>`,
      'g'
    );

    const components: Map<number, string> = new Map();
    let maxComponentIndex = 0;
    let match;

    while ((match = componentRegex.exec(content)) !== null) {
      const componentIndex = parseInt(match[1] ?? '0', 10);
      const componentContent = match[2] ?? '';
      maxComponentIndex = Math.max(maxComponentIndex, componentIndex);

      // Check for subcomponents
      const subcomponentValue = this.parseComponentContent(
        componentContent,
        fieldName,
        componentIndex,
        subcomponentSeparator
      );
      components.set(componentIndex, subcomponentValue);
    }

    if (maxComponentIndex === 0) {
      // No components, return decoded content directly
      return this.unescapeXmlEntities(content.trim());
    }

    // Build component string
    const componentParts: string[] = [];
    for (let i = 1; i <= maxComponentIndex; i++) {
      componentParts.push(components.get(i) || '');
    }

    // Trim trailing empty components
    while (componentParts.length > 0 && componentParts[componentParts.length - 1] === '') {
      componentParts.pop();
    }

    return componentParts.join(componentSeparator);
  }

  /**
   * Parse component content from XML (handle subcomponents)
   */
  private parseComponentContent(
    content: string,
    fieldName: string,
    componentIndex: number,
    subcomponentSeparator: string
  ): string {
    const componentName = `${fieldName}.${componentIndex}`;

    // Check for subcomponents
    const subcomponentRegex = new RegExp(
      `<${componentName}\\.(\\d+)>([\\s\\S]*?)</${componentName}\\.\\d+>`,
      'g'
    );

    const subcomponents: Map<number, string> = new Map();
    let maxSubcomponentIndex = 0;
    let match;

    while ((match = subcomponentRegex.exec(content)) !== null) {
      const subcomponentIndex = parseInt(match[1] ?? '0', 10);
      const subcomponentContent = match[2] ?? '';
      maxSubcomponentIndex = Math.max(maxSubcomponentIndex, subcomponentIndex);

      subcomponents.set(subcomponentIndex, this.unescapeXmlEntities(subcomponentContent.trim()));
    }

    if (maxSubcomponentIndex === 0) {
      // No subcomponents
      return this.unescapeXmlEntities(content.trim());
    }

    // Build subcomponent string
    const subcomponentParts: string[] = [];
    for (let i = 1; i <= maxSubcomponentIndex; i++) {
      subcomponentParts.push(subcomponents.get(i) || '');
    }

    // Trim trailing empty subcomponents
    while (subcomponentParts.length > 0 && subcomponentParts[subcomponentParts.length - 1] === '') {
      subcomponentParts.pop();
    }

    return subcomponentParts.join(subcomponentSeparator);
  }

  /**
   * Extract value from a specific node
   */
  private extractNodeValue(xml: string, nodeName: string): string {
    const match = xml.match(new RegExp(`<${nodeName}>([^<]*)</${nodeName}>`));
    return match && match[1] ? match[1] : '';
  }

  /**
   * Unescape XML entities
   */
  private unescapeXmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Remove whitespace from pretty-printed XML
   */
  private removePrettyPrintWhitespace(xml: string): string {
    // Remove whitespace between tags
    return xml.replace(/>\s+</g, '><').trim();
  }
}

/**
 * Serialize XML to ER7 (convenience function)
 */
export function serializeXMLToER7(
  xml: string,
  properties?: Partial<HL7v2DeserializationProperties>
): string {
  const serializer = new HL7v2Serializer(properties);
  return serializer.serialize(xml);
}
