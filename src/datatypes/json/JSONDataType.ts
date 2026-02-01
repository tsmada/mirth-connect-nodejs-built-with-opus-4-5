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
   * Convert JSON to XML (not implemented - returns null)
   */
  toXML(): string | null {
    return null;
  }

  /**
   * Convert XML to JSON (not implemented - returns null)
   */
  fromXML(): string | null {
    return null;
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
