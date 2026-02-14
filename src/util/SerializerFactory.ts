/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/SerializerFactory.java
 *
 * Purpose: Factory for creating data type serializers for conversion to/from XML.
 * Used by channels and transformers to serialize and deserialize message data.
 *
 * Key behaviors to replicate:
 * - Create serializers for different data types (HL7V2, XML, JSON, EDI/X12, etc.)
 * - Support custom serialization/deserialization properties
 * - Provide default properties for each data type
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * Interface for message serializers that convert between native format and XML.
 * Matches Java's com.mirth.connect.donkey.model.message.IMessageSerializer.
 */
export interface IMessageSerializer {
  /**
   * Serialize from native format to XML.
   * @param message - The message in native format
   * @returns The message as XML string, or null if not supported
   */
  toXML(message: string): string | null;

  /**
   * Deserialize from XML to native format.
   * @param xml - The message as XML string
   * @returns The message in native format, or null if not supported
   */
  fromXML(xml: string): string | null;

  /**
   * Serialize from native format to JSON.
   * @param message - The message in native format
   * @returns The message as JSON string, or null if not supported
   */
  toJSON(message: string): string | null;

  /**
   * Deserialize from JSON to native format.
   * @param json - The message as JSON string
   * @returns The message in native format, or null if not supported
   */
  fromJSON(json: string): string | null;

  /**
   * Whether serialization is required for this data type.
   * Data types like Raw and JSON don't need XML conversion.
   * @param toXml - True if checking for toXML direction, false for fromXML
   */
  isSerializationRequired(toXml?: boolean): boolean;

  /**
   * Transform message without full serialization/deserialization cycle.
   * Used for data types that can apply transformations directly.
   * @param message - The message to transform
   * @returns The transformed message, or null if not supported
   */
  transformWithoutSerializing(message: string): string | null;

  /**
   * Populate metadata map from a message.
   * Writes keys like 'mirth_source', 'mirth_type', 'mirth_version'.
   * @param message - The message to extract metadata from
   * @param map - The map to populate with metadata key-value pairs
   */
  populateMetaData(message: string, map: Map<string, unknown>): void;

  /**
   * Get metadata from a message as a Map.
   * Convenience method that creates a Map and calls populateMetaData.
   * @param message - The message to extract metadata from
   * @returns Map of metadata key-value pairs
   */
  getMetaDataFromMessage(message: string): Map<string, string>;

  /**
   * Get the data type name.
   */
  getDataType(): string;
}

/**
 * Serialization properties for customizing how data is serialized to XML.
 */
export interface SerializationProperties {
  [key: string]: unknown;
}

/**
 * Deserialization properties for customizing how XML is deserialized to native format.
 */
export interface DeserializationProperties {
  [key: string]: unknown;
}

/**
 * HL7v2 specific serialization properties.
 */
export interface HL7v2SerializationProperties extends SerializationProperties {
  handleRepetitions?: boolean;
  handleSubcomponents?: boolean;
  useStrictParser?: boolean;
  useStrictValidation?: boolean;
  segmentDelimiter?: string;
  convertLineBreaks?: boolean;
  stripNamespaces?: boolean;
}

/**
 * HL7v2 specific deserialization properties.
 */
export interface HL7v2DeserializationProperties extends DeserializationProperties {
  useStrictParser?: boolean;
  useStrictValidation?: boolean;
}

/**
 * EDI/X12 specific serialization properties.
 */
export interface EDISerializationProperties extends SerializationProperties {
  segmentDelimiter?: string;
  elementDelimiter?: string;
  subelementDelimiter?: string;
  inferX12Delimiters?: boolean;
}

/**
 * Abstract base class for message serializers.
 * Provides default implementations for optional methods.
 */
export abstract class BaseSerializer implements IMessageSerializer {
  protected serializationProps: SerializationProperties;
  protected deserializationProps: DeserializationProperties;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    this.serializationProps = serializationProps;
    this.deserializationProps = deserializationProps;
  }

  abstract toXML(message: string): string | null;
  abstract fromXML(xml: string): string | null;
  abstract getDataType(): string;

  toJSON(_message: string): string | null {
    return null;
  }

  fromJSON(_json: string): string | null {
    return null;
  }

  isSerializationRequired(_toXml?: boolean): boolean {
    return true;
  }

  transformWithoutSerializing(_message: string): string | null {
    return null;
  }

  populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // No-op by default
  }

  getMetaDataFromMessage(message: string): Map<string, string> {
    const map = new Map<string, unknown>();
    this.populateMetaData(message, map);
    const result = new Map<string, string>();
    for (const [key, value] of map) {
      if (value !== undefined && value !== null) {
        result.set(key, String(value));
      }
    }
    return result;
  }
}

/**
 * HL7v2 message serializer.
 */
class HL7v2Serializer extends BaseSerializer {
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

    // Standard HL7v2 delimiters
    this.fieldDelimiter = '|';
    this.componentDelimiter = '^';
    this.repetitionDelimiter = '~';
    this.escapeChar = '\\';
    this.subcomponentDelimiter = '&';
  }

  getDataType(): string {
    return 'HL7V2';
  }

  toXML(message: string): string {
    const handleRepetitions = this.serializationProps.handleRepetitions !== false;
    const handleSubcomponents = this.serializationProps.handleSubcomponents !== false;
    const convertLineBreaks = this.serializationProps.convertLineBreaks !== false;

    // Normalize line breaks if enabled
    let normalizedMessage = message;
    if (convertLineBreaks) {
      normalizedMessage = normalizedMessage.replace(/\n/g, '\r');
    }

    // Split into segments
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

    // Special handling for MSH segment:
    // When split by '|', MSH yields:
    // fields[0] = 'MSH'
    // fields[1] = encoding chars (^~\&) - this is MSH.2 (MSH.1 is the separator itself)
    // fields[2] = sending application - this is MSH.3
    // etc.

    if (segmentName === 'MSH') {
      // MSH.1 is the field separator character itself
      xml += `    <MSH.1>${this.escapeXml(this.fieldDelimiter)}</MSH.1>\n`;

      // MSH.2 is the encoding characters (first element after segment name)
      if (fields.length > 1) {
        xml += `    <MSH.2>${this.escapeXml(fields[1]!)}</MSH.2>\n`;
      }

      // Process remaining fields starting from index 2 (MSH.3)
      for (let i = 2; i < fields.length; i++) {
        const field = fields[i]!;
        const fieldNum = i + 1; // fields[2] is MSH.3, fields[3] is MSH.4, etc.

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
      // For non-MSH segments: fields[1] is the first field (e.g., PID.1)
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
    // Check for components
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

  private xmlToSegment(segmentName: string, data: Record<string, unknown>): string {
    const fields: string[] = [segmentName];

    // Find max field number
    let maxField = 0;
    for (const key of Object.keys(data)) {
      const match = key.match(/\.(\d+)$/);
      if (match) {
        maxField = Math.max(maxField, parseInt(match[1]!, 10));
      }
    }

    // Build fields array
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

    // Find max component number
    let maxComp = 0;
    for (const key of Object.keys(data)) {
      const match = key.match(/\.(\d+)$/);
      if (match) {
        maxComp = Math.max(maxComp, parseInt(match[1]!, 10));
      }
    }

    // Build components
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

/**
 * XML message serializer (passthrough).
 */
class XMLSerializer extends BaseSerializer {
  getDataType(): string {
    return 'XML';
  }

  toXML(message: string): string {
    // XML is already XML, just return as-is
    return message;
  }

  fromXML(xml: string): string {
    // XML to XML, just return as-is
    return xml;
  }
}

/**
 * JSON message serializer.
 */
class JSONSerializer extends BaseSerializer {
  getDataType(): string {
    return 'JSON';
  }

  toXML(message: string): string {
    const parsed = JSON.parse(message);
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
    });
    return builder.build({ root: parsed });
  }

  fromXML(xml: string): string {
    const parser = new XMLParser({
      ignoreAttributes: false,
    });
    const parsed = parser.parse(xml);

    // Remove the wrapper if present
    const data = parsed.root || parsed;
    return JSON.stringify(data);
  }
}

/**
 * Raw/Delimited text serializer.
 */
class RawSerializer extends BaseSerializer {
  getDataType(): string {
    return 'RAW';
  }

  toXML(message: string): string {
    // Wrap raw text in CDATA
    return `<raw><![CDATA[${message}]]></raw>`;
  }

  fromXML(xml: string): string {
    // Extract content from CDATA or text
    const match = xml.match(/<raw>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/raw>/s);
    if (match) {
      return match[1] || '';
    }
    return xml;
  }
}

/**
 * SerializerFactory creates message serializers for different data types.
 */
export class SerializerFactory {
  private static readonly dataTypes: Map<string, typeof BaseSerializer> = new Map([
    ['HL7V2', HL7v2Serializer as unknown as typeof BaseSerializer],
    ['XML', XMLSerializer as unknown as typeof BaseSerializer],
    ['JSON', JSONSerializer as unknown as typeof BaseSerializer],
    ['RAW', RawSerializer as unknown as typeof BaseSerializer],
    ['DELIMITED', RawSerializer as unknown as typeof BaseSerializer],
  ]);

  /**
   * Returns a serializer for a given data type with default properties.
   *
   * @param dataType - The data type (e.g., "HL7V2", "XML", "JSON")
   * @returns The serializer instance, or null if data type not supported
   */
  static getSerializer(dataType: string): IMessageSerializer | null;

  /**
   * Returns a serializer for a given data type with custom properties.
   *
   * @param dataType - The data type (e.g., "HL7V2", "XML", "JSON")
   * @param serializationPropertiesMap - Custom serialization properties
   * @param deserializationPropertiesMap - Custom deserialization properties
   * @returns The serializer instance, or null if data type not supported
   */
  static getSerializer(
    dataType: string,
    serializationPropertiesMap: SerializationProperties | null,
    deserializationPropertiesMap: DeserializationProperties | null
  ): IMessageSerializer | null;

  static getSerializer(
    dataType: string,
    serializationPropertiesMap?: SerializationProperties | null,
    deserializationPropertiesMap?: DeserializationProperties | null
  ): IMessageSerializer | null {
    const upperDataType = dataType.toUpperCase();
    const SerializerClass = this.dataTypes.get(upperDataType);

    if (!SerializerClass) {
      return null;
    }

    const serProps = serializationPropertiesMap ?? this.getDefaultSerializationProperties(dataType);
    const deserProps =
      deserializationPropertiesMap ?? this.getDefaultDeserializationProperties(dataType);

    // Type assertion needed due to the abstract class pattern
    return new (SerializerClass as unknown as new (
      s: SerializationProperties,
      d: DeserializationProperties
    ) => IMessageSerializer)(serProps || {}, deserProps || {});
  }

  /**
   * Returns default serialization properties for a data type.
   *
   * @param dataType - The data type
   * @returns The default properties or null if not supported
   */
  static getDefaultSerializationProperties(dataType: string): SerializationProperties | null {
    const upperDataType = dataType.toUpperCase();

    switch (upperDataType) {
      case 'HL7V2':
        return {
          handleRepetitions: true,
          handleSubcomponents: true,
          useStrictParser: false,
          useStrictValidation: false,
          segmentDelimiter: '\\r',
          convertLineBreaks: true,
          stripNamespaces: true,
        };

      case 'XML':
        return {
          stripNamespaces: false,
        };

      case 'JSON':
        return {};

      case 'RAW':
      case 'DELIMITED':
        return {};

      case 'EDI/X12':
        return {
          segmentDelimiter: '~',
          elementDelimiter: '*',
          subelementDelimiter: ':',
          inferX12Delimiters: true,
        };

      default:
        return null;
    }
  }

  /**
   * Returns default deserialization properties for a data type.
   *
   * @param dataType - The data type
   * @returns The default properties or null if not supported
   */
  static getDefaultDeserializationProperties(dataType: string): DeserializationProperties | null {
    const upperDataType = dataType.toUpperCase();

    switch (upperDataType) {
      case 'HL7V2':
        return {
          useStrictParser: false,
          useStrictValidation: false,
        };

      case 'XML':
        return {};

      case 'JSON':
        return {};

      case 'RAW':
      case 'DELIMITED':
        return {};

      default:
        return null;
    }
  }

  /**
   * Get list of supported data types.
   *
   * @returns Array of supported data type names
   */
  static getSupportedDataTypes(): string[] {
    return Array.from(this.dataTypes.keys());
  }

  /**
   * Check if a data type is supported.
   *
   * @param dataType - The data type to check
   * @returns True if supported
   */
  static isDataTypeSupported(dataType: string): boolean {
    return this.dataTypes.has(dataType.toUpperCase());
  }

  /**
   * Register a custom serializer for a data type.
   *
   * @param dataType - The data type name
   * @param serializerClass - The serializer class constructor
   */
  static registerSerializer(
    dataType: string,
    serializerClass: new (
      s: SerializationProperties,
      d: DeserializationProperties
    ) => IMessageSerializer
  ): void {
    this.dataTypes.set(dataType.toUpperCase(), serializerClass as unknown as typeof BaseSerializer);
  }
}

// Export shorthand functions
export const getSerializer = SerializerFactory.getSerializer.bind(SerializerFactory);
export const getDefaultSerializationProperties =
  SerializerFactory.getDefaultSerializationProperties.bind(SerializerFactory);
export const getDefaultDeserializationProperties =
  SerializerFactory.getDefaultDeserializationProperties.bind(SerializerFactory);
