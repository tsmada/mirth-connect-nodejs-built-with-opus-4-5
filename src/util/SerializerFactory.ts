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

import {
  HL7v2SerializerAdapter,
  XMLSerializerAdapter,
  JSONSerializerAdapter,
  RawSerializerAdapter,
  DelimitedSerializerAdapter,
  EDISerializerAdapter,
  HL7V3SerializerAdapter,
  NCPDPSerializerAdapter,
  DICOMSerializerAdapter,
} from './serializers/index.js';

// Re-export base types for backward compatibility — consumers that import
// { BaseSerializer, IMessageSerializer } from './SerializerFactory.js' still work.
export {
  IMessageSerializer,
  SerializationProperties,
  DeserializationProperties,
  HL7v2SerializationProperties,
  HL7v2DeserializationProperties,
  EDISerializationProperties,
  BaseSerializer,
} from './SerializerBase.js';

import type {
  IMessageSerializer,
  SerializationProperties,
  DeserializationProperties,
} from './SerializerBase.js';
import { BaseSerializer } from './SerializerBase.js';

/**
 * SerializerFactory creates message serializers for different data types.
 *
 * All 9 data types are registered via adapter classes that wrap the standalone
 * implementations in src/datatypes/. Metadata keys use the mirth_ prefix
 * (mirth_source, mirth_type, mirth_version) matching Java's DefaultMetaData.
 */
export class SerializerFactory {
  private static readonly dataTypes: Map<string, typeof BaseSerializer> = new Map([
    ['HL7V2', HL7v2SerializerAdapter as unknown as typeof BaseSerializer],
    ['XML', XMLSerializerAdapter as unknown as typeof BaseSerializer],
    ['JSON', JSONSerializerAdapter as unknown as typeof BaseSerializer],
    ['RAW', RawSerializerAdapter as unknown as typeof BaseSerializer],
    ['DELIMITED', DelimitedSerializerAdapter as unknown as typeof BaseSerializer],
    ['EDI/X12', EDISerializerAdapter as unknown as typeof BaseSerializer],
    ['HL7V3', HL7V3SerializerAdapter as unknown as typeof BaseSerializer],
    ['NCPDP', NCPDPSerializerAdapter as unknown as typeof BaseSerializer],
    ['DICOM', DICOMSerializerAdapter as unknown as typeof BaseSerializer],
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
        return {};

      case 'DELIMITED':
        return {
          columnDelimiter: ',',
          recordDelimiter: '\\n',
          columnWidths: null,
          quoteToken: '"',
          escapeWithDoubleQuote: true,
          quoteEscapeToken: '\\',
          columnNames: null,
          numberedRows: false,
          ignoreCR: true,
        };

      case 'EDI/X12':
        return {
          segmentDelimiter: '~',
          elementDelimiter: '*',
          subelementDelimiter: ':',
          inferX12Delimiters: true,
        };

      case 'HL7V3':
        return {
          stripNamespaces: false,
        };

      case 'NCPDP':
        return {
          segmentDelimiter: '0x1E',
          groupDelimiter: '0x1D',
          fieldDelimiter: '0x1C',
        };

      case 'DICOM':
        return {};

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
      case 'JSON':
      case 'RAW':
      case 'EDI/X12':
      case 'HL7V3':
      case 'DICOM':
        return {};

      case 'DELIMITED':
        return {
          columnDelimiter: ',',
          recordDelimiter: '\\n',
          columnWidths: null,
          quoteToken: '"',
          escapeWithDoubleQuote: true,
          quoteEscapeToken: '\\',
        };

      case 'NCPDP':
        return {
          segmentDelimiter: '0x1E',
          groupDelimiter: '0x1D',
          fieldDelimiter: '0x1C',
          useStrictValidation: false,
        };

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
