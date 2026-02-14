/**
 * HL7v2 serializer adapter for the IMessageSerializer interface.
 *
 * Wraps the HL7v2 ER7<->XML conversion logic (originally inline in SerializerFactory.ts)
 * and delegates metadata extraction to HL7v2MetaData.extractMetaData().
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/ER7Serializer.java
 */

import { XMLParser } from 'fast-xml-parser';
import {
  BaseSerializer,
  HL7v2SerializationProperties,
  HL7v2DeserializationProperties,
} from '../SerializerFactory.js';
import { extractMetaData } from '../../datatypes/hl7v2/HL7v2MetaData.js';
import {
  SOURCE_VARIABLE_MAPPING,
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../model/DefaultMetaData.js';

export class HL7v2SerializerAdapter extends BaseSerializer {
  private readonly fieldDelimiter: string;
  private readonly componentDelimiter: string;
  private readonly repetitionDelimiter: string;
  // @ts-expect-error - Reserved for future use in escape sequence handling
  private readonly escapeChar: string;
  private readonly subcomponentDelimiter: string;

  constructor(
    serializationProps: HL7v2SerializationProperties = {},
    deserializationProps: HL7v2DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);

    this.fieldDelimiter = '|';
    this.componentDelimiter = '^';
    this.repetitionDelimiter = '~';
    this.escapeChar = '\\';
    this.subcomponentDelimiter = '&';
  }

  getDataType(): string {
    return 'HL7V2';
  }

  isSerializationRequired(_toXml?: boolean): boolean {
    return true;
  }

  toXML(message: string): string {
    const handleRepetitions = this.serializationProps.handleRepetitions !== false;
    const handleSubcomponents = this.serializationProps.handleSubcomponents !== false;
    const convertLineBreaks = this.serializationProps.convertLineBreaks !== false;

    let normalizedMessage = message;
    if (convertLineBreaks) {
      normalizedMessage = normalizedMessage.replace(/\n/g, '\r');
    }

    const segments = normalizedMessage.split('\r').filter((s) => s.trim());

    if (segments.length === 0) {
      return '<HL7Message/>';
    }

    let xml = '<HL7Message>\n';

    for (const segment of segments) {
      xml += this.segmentToXML(segment, handleRepetitions, handleSubcomponents);
    }

    xml += '</HL7Message>';
    return xml;
  }

  fromXML(xml: string): string {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const parsed = parser.parse(xml);
    const root = parsed.HL7Message || parsed;

    const segments: string[] = [];

    for (const [segmentName, segmentData] of Object.entries(root)) {
      if (segmentName.startsWith('?xml') || segmentName === '@_') continue;

      const segmentArray = Array.isArray(segmentData) ? segmentData : [segmentData];

      for (const segment of segmentArray) {
        segments.push(this.xmlToSegment(segmentName, segment as Record<string, unknown>));
      }
    }

    return segments.join('\r') + '\r';
  }

  populateMetaData(message: string, map: Map<string, unknown>): void {
    const metadata = extractMetaData(message);

    if (metadata.source !== undefined) {
      map.set(SOURCE_VARIABLE_MAPPING, metadata.source);
    }
    if (metadata.type !== undefined) {
      map.set(TYPE_VARIABLE_MAPPING, metadata.type);
    }
    if (metadata.version !== undefined) {
      map.set(VERSION_VARIABLE_MAPPING, metadata.version);
    }
  }

  // --- Private ER7 -> XML conversion methods ---

  private segmentToXML(
    segment: string,
    handleRepetitions: boolean,
    handleSubcomponents: boolean
  ): string {
    const fields = segment.split(this.fieldDelimiter);
    const segmentName = fields[0];

    if (!segmentName) {
      return '';
    }

    let xml = `  <${segmentName}>\n`;

    if (segmentName === 'MSH') {
      xml += `    <MSH.1>${this.escapeXml(this.fieldDelimiter)}</MSH.1>\n`;

      if (fields.length > 1) {
        xml += `    <MSH.2>${this.escapeXml(fields[1]!)}</MSH.2>\n`;
      }

      for (let i = 2; i < fields.length; i++) {
        const field = fields[i]!;
        const fieldNum = i + 1;

        if (field === '') {
          xml += `    <MSH.${fieldNum}/>\n`;
          continue;
        }

        if (handleRepetitions && field.includes(this.repetitionDelimiter)) {
          const repetitions = field.split(this.repetitionDelimiter);
          for (const rep of repetitions) {
            xml += this.fieldToXML(segmentName, fieldNum, rep, handleSubcomponents);
          }
        } else {
          xml += this.fieldToXML(segmentName, fieldNum, field, handleSubcomponents);
        }
      }
    } else {
      for (let i = 1; i < fields.length; i++) {
        const field = fields[i]!;
        const fieldNum = i;

        if (field === '') {
          xml += `    <${segmentName}.${fieldNum}/>\n`;
          continue;
        }

        if (handleRepetitions && field.includes(this.repetitionDelimiter)) {
          const repetitions = field.split(this.repetitionDelimiter);
          for (const rep of repetitions) {
            xml += this.fieldToXML(segmentName, fieldNum, rep, handleSubcomponents);
          }
        } else {
          xml += this.fieldToXML(segmentName, fieldNum, field, handleSubcomponents);
        }
      }
    }

    xml += `  </${segmentName}>\n`;
    return xml;
  }

  private fieldToXML(
    segmentName: string,
    fieldNum: number,
    value: string,
    handleSubcomponents: boolean
  ): string {
    if (value.includes(this.componentDelimiter)) {
      const components = value.split(this.componentDelimiter);
      let xml = `    <${segmentName}.${fieldNum}>\n`;

      for (let j = 0; j < components.length; j++) {
        const component = components[j]!;
        const compNum = j + 1;

        if (handleSubcomponents && component.includes(this.subcomponentDelimiter)) {
          const subcomponents = component.split(this.subcomponentDelimiter);
          xml += `      <${segmentName}.${fieldNum}.${compNum}>\n`;
          for (let k = 0; k < subcomponents.length; k++) {
            xml += `        <${segmentName}.${fieldNum}.${compNum}.${k + 1}>${this.escapeXml(subcomponents[k]!)}</${segmentName}.${fieldNum}.${compNum}.${k + 1}>\n`;
          }
          xml += `      </${segmentName}.${fieldNum}.${compNum}>\n`;
        } else {
          xml += `      <${segmentName}.${fieldNum}.${compNum}>${this.escapeXml(component)}</${segmentName}.${fieldNum}.${compNum}>\n`;
        }
      }

      xml += `    </${segmentName}.${fieldNum}>\n`;
      return xml;
    }

    return `    <${segmentName}.${fieldNum}>${this.escapeXml(value)}</${segmentName}.${fieldNum}>\n`;
  }

  // --- Private XML -> ER7 conversion methods ---

  private xmlToSegment(segmentName: string, data: Record<string, unknown>): string {
    const fields: string[] = [segmentName];

    let maxField = 0;
    for (const key of Object.keys(data)) {
      const match = key.match(/\.(\d+)$/);
      if (match) {
        maxField = Math.max(maxField, parseInt(match[1]!, 10));
      }
    }

    for (let i = 1; i <= maxField; i++) {
      const fieldKey = `${segmentName}.${i}`;
      const fieldData = data[fieldKey];

      if (fieldData === undefined || fieldData === null) {
        fields.push('');
      } else if (typeof fieldData === 'object' && !Array.isArray(fieldData)) {
        fields.push(this.xmlToField(fieldData as Record<string, unknown>));
      } else {
        fields.push(String(fieldData));
      }
    }

    return fields.join(this.fieldDelimiter);
  }

  private xmlToField(data: Record<string, unknown>): string {
    const components: string[] = [];

    let maxComp = 0;
    for (const key of Object.keys(data)) {
      const match = key.match(/\.(\d+)$/);
      if (match) {
        maxComp = Math.max(maxComp, parseInt(match[1]!, 10));
      }
    }

    for (let i = 1; i <= maxComp; i++) {
      const found = Object.entries(data).find(([key]) => key.endsWith(`.${i}`));
      if (found) {
        const [, value] = found;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          components.push(this.xmlToSubcomponents(value as Record<string, unknown>));
        } else {
          components.push(String(value ?? ''));
        }
      } else {
        components.push('');
      }
    }

    return components.join(this.componentDelimiter);
  }

  private xmlToSubcomponents(data: Record<string, unknown>): string {
    const subcomponents: string[] = [];

    let maxSub = 0;
    for (const key of Object.keys(data)) {
      const match = key.match(/\.(\d+)$/);
      if (match) {
        maxSub = Math.max(maxSub, parseInt(match[1]!, 10));
      }
    }

    for (let i = 1; i <= maxSub; i++) {
      const found = Object.entries(data).find(([key]) => key.endsWith(`.${i}`));
      if (found) {
        subcomponents.push(String(found[1] ?? ''));
      } else {
        subcomponents.push('');
      }
    }

    return subcomponents.join(this.subcomponentDelimiter);
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
