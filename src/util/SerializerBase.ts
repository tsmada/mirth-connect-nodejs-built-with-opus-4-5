/**
 * Base types and abstract class for message serializers.
 *
 * Extracted from SerializerFactory.ts to break circular dependency:
 * SerializerFactory imports adapters, adapters extend BaseSerializer.
 * Both now import from this file instead.
 */

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
