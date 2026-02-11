/**
 * JsonUtil - JSON utility functions for user scripts
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/JsonUtil.java
 *
 * Purpose: Provide JSON formatting, escaping, and JSON-to-XML conversion
 */

/**
 * JSON utility class available in Mirth scripts.
 */
export class JsonUtil {
  /**
   * Private constructor to prevent instantiation.
   * This is a utility class with only static methods.
   */
  private constructor() {}

  /**
   * Pretty-print JSON with indentation.
   *
   * @param input - The JSON string to format
   * @returns The formatted JSON string, or the original input if parsing fails
   */
  public static prettyPrint(input: string): string {
    if (!input || input.trim() === '') return '';
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      return input;
    }
  }

  /**
   * Escape special characters for JSON string embedding.
   *
   * Escapes backslash, double quote, newline, carriage return, tab,
   * form feed, and backspace characters.
   *
   * @param input - The string to escape
   * @returns The escaped string safe for embedding in JSON
   */
  public static escape(input: string): string {
    if (!input) return '';
    return input
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/[\b]/g, '\\b');
  }

  /**
   * Convert a JSON string to an XML string.
   *
   * Matches Java's JsonUtil.toXml() with optional parameters:
   * - multiplePI: whether to allow multiple processing instructions (reserved)
   * - prettyPrint: whether to format the output with indentation
   *
   * @param jsonString - The JSON string to convert
   * @param options - Optional conversion parameters
   * @returns The XML string representation, or '' if parsing fails
   */
  public static toXml(jsonString: string, options?: JsonToXmlOptions): string {
    if (!jsonString || jsonString.trim() === '') return '';
    try {
      const opts = options ?? {};
      const prettyPrint = opts.prettyPrint !== undefined ? opts.prettyPrint : false;
      const obj = JSON.parse(jsonString);
      const indent = prettyPrint ? '' : undefined;
      return JsonUtil.objectToXml(obj, indent);
    } catch {
      return '';
    }
  }

  /**
   * Recursively convert a JavaScript value to XML.
   * When indent is undefined, output is compact (no indentation/newlines).
   * When indent is a string, output is pretty-printed with increasing indentation.
   */
  private static objectToXml(obj: unknown, indent: string | undefined): string {
    if (obj === null || obj === undefined) {
      return '';
    }

    if (typeof obj !== 'object') {
      return JsonUtil.escapeXml(String(obj));
    }

    const pretty = indent !== undefined;
    const currentIndent = indent ?? '';
    const nextIndent = pretty ? currentIndent + '  ' : undefined;
    const separator = pretty ? '\n' : '';

    if (Array.isArray(obj)) {
      return obj.map(item => JsonUtil.objectToXml(item, indent)).join('');
    }

    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const safeName = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (Array.isArray(value)) {
        for (const item of value) {
          const inner = JsonUtil.objectToXml(item, nextIndent);
          if (pretty && typeof item === 'object' && item !== null) {
            lines.push(`${currentIndent}<${safeName}>\n${inner}\n${currentIndent}</${safeName}>`);
          } else {
            lines.push(`${currentIndent}<${safeName}>${inner}</${safeName}>`);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        const inner = JsonUtil.objectToXml(value, nextIndent);
        if (pretty) {
          lines.push(`${currentIndent}<${safeName}>\n${inner}\n${currentIndent}</${safeName}>`);
        } else {
          lines.push(`${currentIndent}<${safeName}>${inner}</${safeName}>`);
        }
      } else {
        lines.push(`${currentIndent}<${safeName}>${JsonUtil.escapeXml(String(value ?? ''))}</${safeName}>`);
      }
    }
    return lines.join(separator);
  }

  /**
   * Escape special XML characters in text content.
   */
  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

/**
 * Options for JsonUtil.toXml() matching Java's overloaded parameters.
 */
export interface JsonToXmlOptions {
  /** Whether to allow multiple processing instructions (reserved for future use) */
  multiplePI?: boolean;
  /** Whether to format the output with indentation */
  prettyPrint?: boolean;
}
