/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/json/JSONSerializer.java
 *
 * Purpose: JSON data type serialization and deserialization
 *
 * Key behaviors to replicate:
 * - Pass-through serialization (JSON to JSON)
 * - Metadata extraction
 * - JSON validation
 */

/**
 * JSON serialization properties
 */
export interface JSONSerializationProperties {
  /** Pretty print output */
  prettyPrint: boolean;
  /** Indentation for pretty print */
  indentation: number;
}

/**
 * Get default JSON serialization properties
 */
export function getDefaultJSONSerializationProperties(): JSONSerializationProperties {
  return {
    prettyPrint: false,
    indentation: 2,
  };
}

/**
 * JSON metadata
 */
export interface JSONMetaData {
  /** Message type */
  type: string;
  /** Root type (object, array, etc.) */
  rootType?: string;
  /** Top-level keys (for objects) */
  topLevelKeys?: string[];
}

/**
 * JSON DataType - handles JSON serialization and metadata
 */
export class JSONDataType {
  private properties: JSONSerializationProperties;

  constructor(properties?: Partial<JSONSerializationProperties>) {
    this.properties = {
      ...getDefaultJSONSerializationProperties(),
      ...properties,
    };
  }

  /**
   * Serialize to JSON (pass-through with optional formatting)
   */
  toJSON(source: string): string {
    if (this.properties.prettyPrint) {
      try {
        const parsed = JSON.parse(source);
        return JSON.stringify(parsed, null, this.properties.indentation);
      } catch {
        // Return as-is if parsing fails
        return source;
      }
    }
    return source;
  }

  /**
   * Deserialize from JSON (pass-through)
   */
  fromJSON(source: string): string {
    return source;
  }

  /**
   * Convert JSON to XML
   * Converts JSON objects/arrays to XML elements
   */
  toXML(source: string, rootName: string = 'root'): string | null {
    try {
      const parsed = JSON.parse(source);
      return jsonToXml(parsed, rootName);
    } catch {
      return null;
    }
  }

  /**
   * Convert XML to JSON
   * Converts XML elements to JSON objects
   */
  fromXML(source: string): string | null {
    try {
      const result = xmlToJson(source);
      return JSON.stringify(result, null, this.properties.prettyPrint ? this.properties.indentation : undefined);
    } catch {
      return null;
    }
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
  transformWithoutSerializing(): string | null {
    return null;
  }

  /**
   * Extract metadata from JSON message
   */
  getMetaData(message: string): JSONMetaData {
    const metadata: JSONMetaData = {
      type: 'JSON',
    };

    try {
      const parsed = JSON.parse(message);

      if (Array.isArray(parsed)) {
        metadata.rootType = 'array';
      } else if (parsed === null) {
        metadata.rootType = 'null';
      } else if (typeof parsed === 'object') {
        metadata.rootType = 'object';
        metadata.topLevelKeys = Object.keys(parsed);

        // Use first key as type hint if available
        if (metadata.topLevelKeys.length > 0 && metadata.topLevelKeys[0]) {
          metadata.type = metadata.topLevelKeys[0];
        }
      } else {
        metadata.rootType = typeof parsed;
      }
    } catch {
      // Keep default metadata if parsing fails
    }

    return metadata;
  }

  /**
   * Validate JSON string
   */
  validate(message: string): { valid: boolean; error?: string } {
    try {
      JSON.parse(message);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Minify JSON (remove whitespace)
   */
  minify(message: string): string {
    try {
      const parsed = JSON.parse(message);
      return JSON.stringify(parsed);
    } catch {
      return message;
    }
  }

  /**
   * Pretty print JSON
   */
  prettify(message: string, indentation?: number): string {
    try {
      const parsed = JSON.parse(message);
      return JSON.stringify(
        parsed,
        null,
        indentation ?? this.properties.indentation
      );
    } catch {
      return message;
    }
  }
}

/**
 * Parse JSON (convenience function - pass-through)
 */
export function parseJSON(
  source: string,
  properties?: Partial<JSONSerializationProperties>
): string {
  const dataType = new JSONDataType(properties);
  return dataType.toJSON(source);
}

/**
 * Extract metadata from JSON
 */
export function extractJSONMetaData(message: string): JSONMetaData {
  const dataType = new JSONDataType();
  return dataType.getMetaData(message);
}

/**
 * Validate JSON string
 */
export function validateJSON(message: string): { valid: boolean; error?: string } {
  const dataType = new JSONDataType();
  return dataType.validate(message);
}

/**
 * Minify JSON
 */
export function minifyJSON(message: string): string {
  const dataType = new JSONDataType();
  return dataType.minify(message);
}

/**
 * Pretty print JSON
 */
export function prettifyJSON(message: string, indentation?: number): string {
  const dataType = new JSONDataType();
  return dataType.prettify(message, indentation);
}

/**
 * Convert JSON value to XML string
 */
function jsonToXml(value: unknown, tagName: string): string {
  const escapedName = escapeXmlName(tagName);

  if (value === null || value === undefined) {
    return `<${escapedName}/>`;
  }

  if (Array.isArray(value)) {
    // For arrays, wrap each item in the tag name
    return value.map((item) => jsonToXml(item, escapedName)).join('');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const children = Object.entries(obj)
      .map(([key, val]) => jsonToXml(val, key))
      .join('');
    return `<${escapedName}>${children}</${escapedName}>`;
  }

  // Primitive value
  return `<${escapedName}>${escapeXmlValue(String(value))}</${escapedName}>`;
}

/**
 * Convert XML string to JSON object
 * Simple recursive descent parser for basic XML
 * Returns null if the input is not valid XML
 */
function xmlToJson(xml: string): unknown {
  const trimmed = xml.trim();

  // Must start with < to be valid XML
  if (!trimmed.startsWith('<')) {
    throw new Error('Invalid XML: must start with <');
  }

  // Parse using regex for simple cases
  const tagMatch = trimmed.match(/^<([^\s/>]+)([^>]*)>([\s\S]*)<\/\1>$/);
  if (!tagMatch) {
    // Self-closing tag
    const selfClosing = trimmed.match(/^<([^\s/>]+)([^>]*)\/>$/);
    if (selfClosing) {
      return null;
    }
    // Not valid XML
    throw new Error('Invalid XML structure');
  }

  const [, , , content] = tagMatch;
  const trimmedContent = (content ?? '').trim();

  // Check if content has child elements
  if (trimmedContent.startsWith('<')) {
    const result: Record<string, unknown> = {};
    const children = parseXmlChildren(trimmedContent);

    for (const child of children) {
      const childMatch = child.match(/^<([^\s/>]+)/);
      if (!childMatch) continue;

      const childTag = childMatch[1];
      const childValue = xmlToJson(child);

      // Handle repeated tags as arrays
      if (childTag && childTag in result) {
        const existing = result[childTag];
        if (Array.isArray(existing)) {
          existing.push(childValue);
        } else {
          result[childTag] = [existing, childValue];
        }
      } else if (childTag) {
        result[childTag] = childValue;
      }
    }

    return result;
  }

  // Text content
  return unescapeXmlValue(trimmedContent);
}

/**
 * Parse XML children (simple tokenizer)
 */
function parseXmlChildren(xml: string): string[] {
  const children: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < xml.length) {
    if (xml[i] === '<') {
      if (xml[i + 1] === '/') {
        depth--;
        if (depth === 0) {
          // Find end of closing tag
          const end = xml.indexOf('>', i) + 1;
          children.push(xml.substring(start, end));
          i = end;
          start = i;
          continue;
        }
      } else if (xml.substring(i).match(/^<[^/]/)) {
        if (depth === 0) {
          start = i;
        }
        // Check for self-closing
        const tagEnd = xml.indexOf('>', i);
        if (tagEnd > 0 && xml[tagEnd - 1] === '/') {
          if (depth === 0) {
            children.push(xml.substring(start, tagEnd + 1));
            i = tagEnd + 1;
            start = i;
            continue;
          }
        } else {
          depth++;
        }
      }
    }
    i++;
  }

  return children;
}

/**
 * Escape XML element name (replace invalid chars)
 */
function escapeXmlName(name: string): string {
  // Replace invalid XML name characters with underscores
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^([0-9-])/, '_$1');
}

/**
 * Escape XML text content
 */
function escapeXmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Unescape XML text content
 */
function unescapeXmlValue(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
