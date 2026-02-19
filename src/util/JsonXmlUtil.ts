/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/util/JsonXmlUtil.java
 *
 * Purpose: Convert between JSON and XML formats.
 * Used throughout Mirth Connect for data transformation.
 *
 * Key behaviors to replicate:
 * - xmlToJson: Convert XML string to JSON string
 * - jsonToXml: Convert JSON string to XML string
 * - Handle namespace prefixes
 * - Support arrays and primitive auto-detection
 * - Handle attributes (@attr)
 */

import { XMLParser, XMLBuilder, type XmlBuilderOptions } from 'fast-xml-parser';

/**
 * Options for XML to JSON conversion.
 */
export interface XmlToJsonOptions {
  /**
   * Whether to normalize namespace prefixes (extract prefix to xmlnsprefix attribute).
   * Default: true
   */
  normalizeNamespaces?: boolean;

  /**
   * Whether elements should always be converted to arrays.
   * Default: false
   */
  alwaysArray?: boolean;

  /**
   * Whether attributes should always be expanded as objects with $ property.
   * Default: false
   */
  alwaysExpandObjects?: boolean;

  /**
   * Whether to pretty print the output JSON.
   * Default: false
   */
  prettyPrint?: boolean;
}

/**
 * Options for JSON to XML conversion.
 */
export interface JsonToXmlOptions {
  /**
   * Whether to pretty print the output XML.
   * Default: false
   */
  prettyPrint?: boolean;

  /**
   * Indentation string for pretty printing.
   * Default: '  ' (2 spaces)
   */
  indentation?: string;
}

/**
 * Attribute prefix used in the intermediate JSON representation.
 */
const ATTR_PREFIX = '@_';
const TEXT_NODE_NAME = '#text';

/**
 * JsonXmlUtil provides static methods for converting between JSON and XML.
 */
export class JsonXmlUtil {
  /**
   * Converts an XML string to a JSON string.
   *
   * @param xmlStr - The XML string to convert
   * @returns The JSON string
   */
  static xmlToJson(xmlStr: string): string;

  /**
   * Converts an XML string to a JSON string with namespace normalization option.
   *
   * @param xmlStr - The XML string to convert
   * @param normalizeNamespaces - Whether to normalize namespaces
   * @returns The JSON string
   */
  static xmlToJson(xmlStr: string, normalizeNamespaces: boolean): string;

  /**
   * Converts an XML string to a JSON string with full options.
   *
   * @param xmlStr - The XML string to convert
   * @param normalizeNamespaces - Whether to normalize namespaces
   * @param alwaysArray - Whether to always use arrays
   * @param alwaysExpandObjects - Whether to always expand objects
   * @returns The JSON string
   */
  static xmlToJson(
    xmlStr: string,
    normalizeNamespaces: boolean,
    alwaysArray: boolean,
    alwaysExpandObjects: boolean
  ): string;

  /**
   * Converts an XML string to a JSON string with options object.
   *
   * @param xmlStr - The XML string to convert
   * @param options - Conversion options
   * @returns The JSON string
   */
  static xmlToJson(xmlStr: string, options: XmlToJsonOptions): string;

  static xmlToJson(
    xmlStr: string,
    optionsOrNormalize?: boolean | XmlToJsonOptions,
    alwaysArray?: boolean,
    alwaysExpandObjects?: boolean
  ): string {
    let options: XmlToJsonOptions;

    if (typeof optionsOrNormalize === 'object') {
      options = optionsOrNormalize;
    } else {
      options = {
        normalizeNamespaces: optionsOrNormalize ?? true,
        alwaysArray: alwaysArray ?? false,
        alwaysExpandObjects: alwaysExpandObjects ?? false,
        prettyPrint: false,
      };
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ATTR_PREFIX,
      textNodeName: TEXT_NODE_NAME,
      parseAttributeValue: true,
      parseTagValue: true,
      trimValues: true,
      isArray: options.alwaysArray
        ? () => true
        : (_name: string, _jpath: string, _isLeafNode: boolean, _isAttribute: boolean) => {
            // Default array detection - elements with same name become array
            return false;
          },
    });

    let parsed: unknown;
    try {
      parsed = parser.parse(xmlStr);
    } catch (error) {
      throw new Error(`Failed to parse XML: ${(error as Error).message}`);
    }

    // Post-process the parsed object
    const processed = this.processXmlToJson(
      parsed,
      options.normalizeNamespaces ?? true,
      options.alwaysExpandObjects ?? false
    );

    return options.prettyPrint ? JSON.stringify(processed, null, 2) : JSON.stringify(processed);
  }

  /**
   * Process parsed XML object to match Mirth's JSON format.
   */
  private static processXmlToJson(
    obj: unknown,
    normalizeNamespaces: boolean,
    alwaysExpandObjects: boolean
  ): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) =>
        this.processXmlToJson(item, normalizeNamespaces, alwaysExpandObjects)
      );
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      let newKey = key;
      let newValue = value;

      // Handle attributes (prefixed with @_)
      if (key.startsWith(ATTR_PREFIX)) {
        const attrName = key.substring(ATTR_PREFIX.length);
        newKey = `@${attrName}`;

        // Handle namespace prefix normalization
        if (normalizeNamespaces && attrName.startsWith('xmlns:')) {
          // Keep namespace declarations as-is but under @xmlns object
          const prefix = attrName.substring(6); // Remove 'xmlns:'
          if (!result['@xmlns']) {
            result['@xmlns'] = {};
          }
          (result['@xmlns'] as Record<string, unknown>)[prefix] = value;
          continue;
        }

        if (alwaysExpandObjects) {
          newValue = { $: value };
        }
      } else if (key === TEXT_NODE_NAME) {
        // Handle text content
        if (alwaysExpandObjects) {
          result['$'] = value;
          continue;
        } else {
          // If there are no other keys, return just the value
          const otherKeys = Object.keys(obj as Record<string, unknown>).filter(
            (k) => k !== TEXT_NODE_NAME
          );
          if (otherKeys.length === 0) {
            return value;
          }
          result['$'] = value;
          continue;
        }
      } else {
        // Handle element names with namespace prefixes
        if (normalizeNamespaces && key.includes(':')) {
          const [prefix, localName] = key.split(':');
          newKey = localName!;
          // Process the value
          const processed = this.processXmlToJson(value, normalizeNamespaces, alwaysExpandObjects);
          if (typeof processed === 'object' && processed !== null && !Array.isArray(processed)) {
            (processed as Record<string, unknown>)['xmlnsprefix'] = prefix;
          }
          newValue = processed;
        } else {
          newValue = this.processXmlToJson(value, normalizeNamespaces, alwaysExpandObjects);
        }
      }

      result[newKey] = newValue;
    }

    return result;
  }

  /**
   * Converts a JSON string to an XML string.
   *
   * @param jsonStr - The JSON string to convert
   * @returns The XML string
   */
  static jsonToXml(jsonStr: string): string;

  /**
   * Converts a JSON string to an XML string with options.
   *
   * @param jsonStr - The JSON string to convert
   * @param options - Conversion options
   * @returns The XML string
   */
  static jsonToXml(jsonStr: string, options: JsonToXmlOptions): string;

  static jsonToXml(jsonStr: string, options?: JsonToXmlOptions): string {
    const opts = options ?? {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${(error as Error).message}`);
    }

    // Pre-process JSON to convert back to XML format
    const processed = this.processJsonToXml(parsed);

    const builderOptions: Partial<XmlBuilderOptions> = {
      ignoreAttributes: false,
      attributeNamePrefix: ATTR_PREFIX,
      textNodeName: TEXT_NODE_NAME,
      format: opts.prettyPrint ?? false,
      indentBy: opts.indentation ?? '  ',
      suppressEmptyNode: false,
    };

    const builder = new XMLBuilder(builderOptions);

    try {
      return builder.build(processed);
    } catch (error) {
      throw new Error(`Failed to build XML: ${(error as Error).message}`);
    }
  }

  /**
   * Process JSON object to prepare for XML building.
   */
  private static processJsonToXml(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.processJsonToXml(item));
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      let newKey = key;
      let newValue = value;

      // Handle @xmlns object (namespace declarations)
      if (key === '@xmlns') {
        if (typeof value === 'object' && value !== null) {
          for (const [prefix, uri] of Object.entries(value as Record<string, unknown>)) {
            if (prefix === '$') {
              result[`${ATTR_PREFIX}xmlns`] = uri;
            } else {
              result[`${ATTR_PREFIX}xmlns:${prefix}`] = uri;
            }
          }
        } else {
          result[`${ATTR_PREFIX}xmlns`] = value;
        }
        continue;
      }

      // Handle attributes (prefixed with @)
      if (key.startsWith('@')) {
        const attrName = key.substring(1);
        newKey = `${ATTR_PREFIX}${attrName}`;

        // Handle expanded attributes { $: value, xmlnsprefix: prefix }
        if (typeof value === 'object' && value !== null && '$' in value) {
          const attrObj = value as Record<string, unknown>;
          if ('xmlnsprefix' in attrObj) {
            // Attribute has namespace prefix
            newKey = `${ATTR_PREFIX}${attrObj['xmlnsprefix']}:${attrName}`;
          }
          newValue = attrObj['$'];
        }
      } else if (key === '$') {
        // Handle text content
        newKey = TEXT_NODE_NAME;
      } else if (key === 'xmlnsprefix') {
        // Skip xmlnsprefix as it's handled differently
        continue;
      } else {
        // Handle elements with xmlnsprefix
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          'xmlnsprefix' in value
        ) {
          const elemObj = value as Record<string, unknown>;
          const prefix = elemObj['xmlnsprefix'];
          newKey = `${prefix}:${key}`;
          // Create a copy without xmlnsprefix
          const { xmlnsprefix: _xmlnsprefix, ...rest } = elemObj;
          newValue = this.processJsonToXml(rest);
        } else {
          newValue = this.processJsonToXml(value);
        }
      }

      result[newKey] = newValue;
    }

    return result;
  }

  /**
   * Checks if a string is valid JSON.
   *
   * @param str - The string to check
   * @returns True if the string is valid JSON
   */
  static isValidJson(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a string is valid XML.
   *
   * @param str - The string to check
   * @returns True if the string is valid XML
   */
  static isValidXml(str: string): boolean {
    const parser = new XMLParser({
      ignoreAttributes: false,
    });

    try {
      parser.parse(str);
      return true;
    } catch {
      return false;
    }
  }
}

// Export shorthand functions
export const xmlToJson = JsonXmlUtil.xmlToJson.bind(JsonXmlUtil);
export const jsonToXml = JsonXmlUtil.jsonToXml.bind(JsonXmlUtil);
export const isValidJson = JsonXmlUtil.isValidJson.bind(JsonXmlUtil);
export const isValidXml = JsonXmlUtil.isValidXml.bind(JsonXmlUtil);
