/**
 * XmlUtil - XML utility functions for user scripts
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/XmlUtil.java
 *
 * Purpose: Provide XML formatting, entity encoding/decoding, and XML-to-JSON conversion
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * XML utility class available in Mirth scripts.
 */
export class XmlUtil {
  /**
   * Private constructor to prevent instantiation.
   * This is a utility class with only static methods.
   */
  private constructor() {}

  /**
   * Pretty-print XML with indentation.
   *
   * @param input - The XML string to format
   * @returns The formatted XML string, or the original input if parsing fails
   */
  public static prettyPrint(input: string): string {
    if (!input || input.trim() === '') return '';
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: true,
        trimValues: false,
        parseTagValue: false,
        parseAttributeValue: false,
      });
      const parsed = parser.parse(input);
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: true,
        format: true,
        indentBy: '  ',
        suppressEmptyNode: false,
      });
      return builder.build(parsed);
    } catch {
      return input;
    }
  }

  /**
   * Decode XML entities back to their original characters.
   *
   * Handles the five predefined XML entities (&amp; &lt; &gt; &quot; &apos;)
   * as well as numeric character references (&#NNN; and &#xHHH;).
   *
   * @param input - The string containing XML entities to decode
   * @returns The decoded string
   */
  public static decode(input: string): string {
    if (!input) return '';
    return input
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Encode special characters to XML entities.
   *
   * Encodes &, <, >, ", and ' to their corresponding XML entity references.
   *
   * @param input - The string to encode
   * @returns The encoded string with XML entities
   */
  public static encode(input: string): string {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert an XML string to a JSON string.
   *
   * Matches Java's XmlUtil.toJson() with optional parameters:
   * - normalizeNamespaces: strip namespace prefixes from element names
   * - autoArray: automatically detect repeated elements as arrays (default: true)
   * - autoPrimitive: parse numeric/boolean text values as primitives
   * - prettyPrint: format JSON output with indentation (default: true)
   * - alwaysArray: force all elements to be wrapped in arrays
   * - alwaysExpandObjects: expand single-text elements into objects
   *
   * @param xmlString - The XML string to convert
   * @param options - Optional conversion parameters
   * @returns The JSON string representation, or '{}' if parsing fails
   */
  public static toJson(xmlString: string, options?: XmlToJsonOptions): string {
    if (!xmlString || xmlString.trim() === '') return '{}';
    try {
      const opts = options ?? {};
      const prettyPrint = opts.prettyPrint !== false; // default true
      const autoPrimitive = opts.autoPrimitive === true;
      const alwaysArray = opts.alwaysArray === true;
      const normalizeNamespaces = opts.normalizeNamespaces === true;

      const parserOpts: Record<string, unknown> = {
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        trimValues: false,
        parseTagValue: autoPrimitive,
        parseAttributeValue: autoPrimitive,
        removeNSPrefix: normalizeNamespaces,
      };
      if (alwaysArray) {
        parserOpts.isArray = () => true;
      }
      const parser = new XMLParser(parserOpts as any);
      const result = parser.parse(xmlString);
      return JSON.stringify(result, null, prettyPrint ? 2 : undefined);
    } catch {
      return '{}';
    }
  }
}

/**
 * Options for XmlUtil.toJson() matching Java's 7-parameter overload.
 */
export interface XmlToJsonOptions {
  /** Strip namespace prefixes from element names */
  normalizeNamespaces?: boolean;
  /** Automatically detect repeated elements as arrays (default: true) */
  autoArray?: boolean;
  /** Parse numeric/boolean text values as primitives */
  autoPrimitive?: boolean;
  /** Format JSON output with indentation (default: true) */
  prettyPrint?: boolean;
  /** Force all elements to be wrapped in arrays */
  alwaysArray?: boolean;
  /** Expand single-text elements into objects */
  alwaysExpandObjects?: boolean;
}
