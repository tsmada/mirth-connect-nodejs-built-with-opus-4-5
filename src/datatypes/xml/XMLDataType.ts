/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/xml/XMLSerializer.java
 *
 * Purpose: XML data type serialization and deserialization
 *
 * Key behaviors to replicate:
 * - Pass-through serialization (XML to XML)
 * - Optional namespace stripping
 * - Metadata extraction
 */

/**
 * XML serialization properties
 */
export interface XMLSerializationProperties {
  /** Strip XML namespaces */
  stripNamespaces: boolean;
}

/**
 * Get default XML serialization properties
 */
export function getDefaultXMLSerializationProperties(): XMLSerializationProperties {
  return {
    stripNamespaces: false,
  };
}

/**
 * XML metadata
 */
export interface XMLMetaData {
  /** XML version */
  version: string;
  /** Message type */
  type: string;
  /** Root element name */
  rootElement?: string;
  /** Encoding */
  encoding?: string;
}

/**
 * XML DataType - handles XML serialization and metadata
 */
export class XMLDataType {
  private properties: XMLSerializationProperties;

  constructor(properties?: Partial<XMLSerializationProperties>) {
    this.properties = {
      ...getDefaultXMLSerializationProperties(),
      ...properties,
    };
  }

  /**
   * Serialize to XML (pass-through with optional namespace stripping)
   */
  toXML(source: string): string {
    let result = source.trim();

    if (this.properties.stripNamespaces) {
      result = this.stripNamespaces(result);
    }

    return result;
  }

  /**
   * Deserialize from XML (pass-through)
   */
  fromXML(source: string): string {
    return source;
  }

  /**
   * Check if serialization is required
   */
  isSerializationRequired(): boolean {
    return false;
  }

  /**
   * Transform without full serialization
   */
  transformWithoutSerializing(message: string): string | null {
    if (this.properties.stripNamespaces) {
      return this.stripNamespaces(message);
    }
    return null;
  }

  /**
   * Extract metadata from XML message
   */
  getMetaData(message: string): XMLMetaData {
    const metadata: XMLMetaData = {
      version: '1.0',
      type: 'XML-Message',
    };

    // Extract XML declaration version
    const versionMatch = message.match(/<\?xml[^?]*version=["']([^"']+)["']/);
    if (versionMatch && versionMatch[1]) {
      metadata.version = versionMatch[1];
    }

    // Extract encoding
    const encodingMatch = message.match(/<\?xml[^?]*encoding=["']([^"']+)["']/);
    if (encodingMatch && encodingMatch[1]) {
      metadata.encoding = encodingMatch[1];
    }

    // Extract root element name
    const rootMatch = message.match(/<([a-zA-Z_][a-zA-Z0-9_\-.:]*)[>\s\/]/);
    if (rootMatch && rootMatch[1]) {
      let rootElement = rootMatch[1];
      // Remove namespace prefix if present
      const colonIndex = rootElement.indexOf(':');
      if (colonIndex !== -1) {
        rootElement = rootElement.substring(colonIndex + 1);
      }
      metadata.rootElement = rootElement;
      metadata.type = rootElement;
    }

    return metadata;
  }

  /**
   * Strip namespaces from XML
   */
  private stripNamespaces(xml: string): string {
    // Remove namespace declarations (xmlns:prefix="uri" and xmlns="uri")
    let result = xml.replace(/\s+xmlns(:\w+)?=["'][^"']*["']/g, '');

    // Remove namespace prefixes from element names and attributes
    result = result.replace(/<(\/?)\w+:/g, '<$1');
    result = result.replace(/\s+\w+:(\w+)=/g, ' $1=');

    return result;
  }
}

/**
 * Parse XML (convenience function - pass-through)
 */
export function parseXML(
  source: string,
  properties?: Partial<XMLSerializationProperties>
): string {
  const dataType = new XMLDataType(properties);
  return dataType.toXML(source);
}

/**
 * Extract metadata from XML
 */
export function extractXMLMetaData(message: string): XMLMetaData {
  const dataType = new XMLDataType();
  return dataType.getMetaData(message);
}

/**
 * Strip namespaces from XML
 */
export function stripNamespaces(xml: string): string {
  const dataType = new XMLDataType({ stripNamespaces: true });
  return dataType.toXML(xml);
}
