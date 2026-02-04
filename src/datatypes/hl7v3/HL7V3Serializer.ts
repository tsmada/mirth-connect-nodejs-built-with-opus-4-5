/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v3/HL7V3Serializer.java
 *
 * Purpose: HL7v3 XML data type serialization and deserialization
 *
 * Key behaviors to replicate:
 * - isSerializationRequired() returns false (HL7v3 is already XML)
 * - toXML() trims and optionally strips namespaces
 * - fromXML() is pass-through
 * - getMetaData() extracts version and message type from root element
 *
 * Note: The Java implementation is relatively simple because HL7v3 is already XML.
 * The main functionality is namespace stripping and metadata extraction.
 */

import {
  HL7V3SerializationProperties,
  getDefaultHL7V3SerializationProperties,
} from './HL7V3Properties.js';

/**
 * HL7v3 metadata extracted from messages
 */
export interface HL7V3MetaData {
  /** HL7 version - always "3.0" for HL7v3 */
  version: string;
  /** Message type - the QName of the root element (e.g., "PRPA_IN201301UV02") */
  type: string;
}

/**
 * Default metadata variable mapping keys (matching Java DefaultMetaData)
 */
export const VERSION_VARIABLE_MAPPING = 'version';
export const TYPE_VARIABLE_MAPPING = 'type';

/**
 * HL7V3 Serializer - handles HL7v3 XML message serialization
 *
 * HL7v3 messages are XML-based (unlike HL7v2 which is pipe-delimited).
 * The serializer provides:
 * - Pass-through serialization (already XML)
 * - Optional namespace stripping
 * - Metadata extraction from root element
 *
 * Common HL7v3 message types include:
 * - PRPA_IN201301UV02 (Patient Registry Add)
 * - PRPA_IN201305UV02 (Patient Registry Query)
 * - MCCI_IN000002UV01 (Application Acknowledgment)
 * - CDA documents (Clinical Document Architecture)
 */
export class HL7V3Serializer {
  private properties: HL7V3SerializationProperties;

  constructor(properties?: Partial<HL7V3SerializationProperties>) {
    this.properties = {
      ...getDefaultHL7V3SerializationProperties(),
      ...properties,
    };
  }

  /**
   * Check if serialization is required
   *
   * HL7v3 messages are already XML, so no serialization is required.
   * This returns false regardless of the toXml parameter.
   *
   * @param _toXml Whether converting to XML (unused for HL7v3)
   * @returns Always false - HL7v3 is natively XML
   */
  isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  /**
   * Transform without full serialization
   *
   * If stripNamespaces is enabled, strips namespace declarations from the message.
   * Otherwise returns null (no transformation needed).
   *
   * @param message The HL7v3 XML message
   * @returns Transformed message with namespaces stripped, or null
   */
  transformWithoutSerializing(message: string): string | null {
    if (this.properties.stripNamespaces) {
      return this.stripNamespaces(message);
    }
    return null;
  }

  /**
   * Convert to XML representation
   *
   * For HL7v3, this trims whitespace and optionally strips namespaces.
   * The message is already XML, so no format conversion is needed.
   *
   * @param source The HL7v3 XML message
   * @returns The processed XML message
   */
  toXML(source: string): string {
    let result = source;

    if (this.properties.stripNamespaces) {
      result = this.stripNamespaces(result);
    }

    return result.trim();
  }

  /**
   * Convert from XML representation
   *
   * For HL7v3, this is a pass-through since the native format is XML.
   *
   * @param source The XML message
   * @returns The message unchanged
   */
  fromXML(source: string): string {
    return source;
  }

  /**
   * Convert to JSON representation
   *
   * Not implemented for HL7v3 - returns null.
   * JSON conversion would require XML-to-JSON transformation which
   * may lose namespace and attribute information.
   *
   * @param _message The HL7v3 message (unused)
   * @returns null
   */
  toJSON(_message: string): string | null {
    return null;
  }

  /**
   * Convert from JSON representation
   *
   * Not implemented for HL7v3 - returns null.
   *
   * @param _message The JSON message (unused)
   * @returns null
   */
  fromJSON(_message: string): string | null {
    return null;
  }

  /**
   * Extract metadata from HL7v3 message
   *
   * Extracts:
   * - version: Always "3.0" for HL7v3 messages
   * - type: The QName of the root element (e.g., "PRPA_IN201301UV02")
   *
   * @param message The HL7v3 XML message
   * @returns Map of metadata keys to values
   */
  getMetaDataFromMessage(message: string): Map<string, unknown> {
    const map = new Map<string, unknown>();

    // HL7v3 version is always 3.0
    map.set(VERSION_VARIABLE_MAPPING, '3.0');

    // Find the QName of the root node of the XML
    const rootElement = this.extractRootElementName(message);
    if (rootElement) {
      map.set(TYPE_VARIABLE_MAPPING, rootElement);
    }

    return map;
  }

  /**
   * Get metadata as a plain object (convenience method)
   *
   * @param message The HL7v3 XML message
   * @returns HL7V3MetaData object
   */
  getMetaData(message: string): HL7V3MetaData {
    const metadata: HL7V3MetaData = {
      version: '3.0',
      type: '',
    };

    const rootElement = this.extractRootElementName(message);
    if (rootElement) {
      metadata.type = rootElement;
    }

    return metadata;
  }

  /**
   * Populate metadata map (for compatibility with Java interface)
   *
   * @param _message The message (unused)
   * @param _map The map to populate (unused)
   */
  populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // No additional metadata to populate
  }

  /**
   * Extract the root element name from an XML message
   *
   * Finds the QName of the root element (including namespace prefix if present).
   * This matches the Java implementation which scans character by character.
   *
   * @param message The XML message
   * @returns The root element QName, or empty string if not found
   */
  private extractRootElementName(message: string): string {
    const builder: string[] = [];
    let index = 0;
    let found = false;

    // Find the QName of the root node of the XML
    while (index < message.length - 1) {
      const c = message.charAt(index);
      const next = message.charAt(index + 1);

      if (!found && c === '<') {
        // Check if this is the start of an element (not a comment, PI, or declaration)
        if (
          (next >= 'A' && next <= 'Z') ||
          (next >= 'a' && next <= 'z') ||
          next === '_'
        ) {
          found = true;
        }
      } else if (found) {
        // Stop at whitespace, '/', or '>'
        if (c <= ' ' || c === '/' || c === '>') {
          break;
        }
        builder.push(c);
      }
      index++;
    }

    return builder.join('');
  }

  /**
   * Strip namespace declarations from XML
   *
   * Removes xmlns:prefix="uri" and xmlns="uri" declarations.
   * Does NOT remove namespace prefixes from elements/attributes.
   *
   * This matches the Java StringUtil.stripNamespaces() implementation which uses:
   * Pattern.compile("xmlns:?[^=]*=[\\\"\\\""][^\\\"\\\"]*[\\\"\\\""]")
   *
   * @param xml The XML message
   * @returns XML with namespace declarations removed
   */
  private stripNamespaces(xml: string): string {
    // Pattern matches:
    // xmlns:prefix="value" or xmlns:prefix='value'
    // xmlns="value" or xmlns='value'
    return xml.replace(/xmlns:?[^=]*=["'][^"']*["']/g, '');
  }
}

/**
 * Parse HL7v3 XML message (convenience function)
 *
 * @param source The HL7v3 XML message
 * @param properties Optional serialization properties
 * @returns The processed XML message
 */
export function parseHL7V3(
  source: string,
  properties?: Partial<HL7V3SerializationProperties>
): string {
  const serializer = new HL7V3Serializer(properties);
  return serializer.toXML(source);
}

/**
 * Extract metadata from HL7v3 message (convenience function)
 *
 * @param message The HL7v3 XML message
 * @returns HL7V3MetaData object
 */
export function extractHL7V3MetaData(message: string): HL7V3MetaData {
  const serializer = new HL7V3Serializer();
  return serializer.getMetaData(message);
}

/**
 * Strip namespaces from HL7v3 XML (convenience function)
 *
 * @param xml The XML message
 * @returns XML with namespace declarations removed
 */
export function stripHL7V3Namespaces(xml: string): string {
  const serializer = new HL7V3Serializer({ stripNamespaces: true });
  return serializer.toXML(xml);
}
