/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/util/ValueReplacer.java
 *
 * Purpose: Replace ${variable} placeholders in strings using template syntax.
 * This is used throughout Mirth Connect to substitute variables in channel
 * configurations, connector properties, and message content.
 *
 * Key behaviors to replicate:
 * - Velocity-style template replacement (${variable} syntax)
 * - Support for map variables from connector messages
 * - Built-in variables: DATE, COUNT, UUID, SYSTIME
 * - Utility classes: XmlUtil, JsonUtil, maps
 * - URL decoding before replacement
 */

import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

/**
 * Represents a connector message with various maps for variable substitution.
 */
export interface ConnectorMessage {
  channelId?: string;
  channelName?: string;
  sourceMap?: Map<string, unknown> | Record<string, unknown>;
  channelMap?: Map<string, unknown> | Record<string, unknown>;
  connectorMap?: Map<string, unknown> | Record<string, unknown>;
  responseMap?: Map<string, unknown> | Record<string, unknown>;
}

/**
 * Represents a message with merged connector message data.
 */
export interface Message {
  getMergedConnectorMessage(): ConnectorMessage;
}

/**
 * MapTool provides a get method that searches through multiple maps.
 */
class MapTool {
  private maps: Array<Map<string, unknown> | Record<string, unknown>> = [];

  addMap(map: Map<string, unknown> | Record<string, unknown>): void {
    this.maps.push(map);
  }

  get(key: string): unknown {
    for (const map of this.maps) {
      if (map instanceof Map) {
        if (map.has(key)) {
          return map.get(key);
        }
      } else if (key in map) {
        return map[key];
      }
    }
    return null;
  }
}

/**
 * CountTool provides an auto-incrementing counter.
 */
class CountTool {
  private counter: number;

  constructor(getCount: () => number) {
    this.counter = getCount();
  }

  toString(): string {
    return String(this.counter);
  }
}

/**
 * Context for variable replacement containing all available variables.
 */
export interface ReplacementContext {
  [key: string]: unknown;
}

/**
 * ValueReplacer replaces ${variable} placeholders in strings.
 * Uses a template syntax similar to Apache Velocity.
 */
export class ValueReplacer {
  private count = 1;

  /**
   * Get the current count and increment it.
   */
  getCount(): number {
    return this.count++;
  }

  /**
   * Reset the counter (useful for testing).
   */
  resetCount(): void {
    this.count = 1;
  }

  /**
   * Check if a string contains replaceable values (contains $).
   */
  static hasReplaceableValues(str: string | null | undefined): boolean {
    return str != null && str.indexOf('$') > -1;
  }

  /**
   * Replaces all values in a map. Uses the default context.
   * The original map is not modified.
   *
   * @returns A new Map with all replaced values.
   */
  replaceValuesInMap(map: Map<string, string>): Map<string, string>;
  replaceValuesInMap(map: Record<string, string>): Record<string, string>;
  replaceValuesInMap(
    map: Map<string, string> | Record<string, string>
  ): Map<string, string> | Record<string, string> {
    if (map instanceof Map) {
      const localMap = new Map<string, string>();
      for (const [key, value] of map) {
        localMap.set(key, this.replaceValues(value));
      }
      return localMap;
    } else {
      const localMap: Record<string, string> = {};
      for (const [key, value] of Object.entries(map)) {
        localMap[key] = this.replaceValues(value);
      }
      return localMap;
    }
  }

  /**
   * Replaces all values in a map using connector message context.
   * The original map is not modified.
   *
   * @returns A new Map with all replaced values.
   */
  replaceValuesInMapWithMessage(
    map: Map<string, string>,
    connectorMessage: ConnectorMessage
  ): Map<string, string>;
  replaceValuesInMapWithMessage(
    map: Record<string, string>,
    connectorMessage: ConnectorMessage
  ): Record<string, string>;
  replaceValuesInMapWithMessage(
    map: Map<string, string> | Record<string, string>,
    connectorMessage: ConnectorMessage
  ): Map<string, string> | Record<string, string> {
    if (map instanceof Map) {
      const localMap = new Map<string, string>();
      for (const [key, value] of map) {
        localMap.set(key, this.replaceValuesWithMessage(value, connectorMessage));
      }
      return localMap;
    } else {
      const localMap: Record<string, string> = {};
      for (const [key, value] of Object.entries(map)) {
        localMap[key] = this.replaceValuesWithMessage(value, connectorMessage);
      }
      return localMap;
    }
  }

  /**
   * Replaces all keys and values in a map using connector message context.
   * The original map is not modified.
   *
   * @returns A new Map with all replaced keys and values.
   */
  replaceKeysAndValuesInMap(
    map: Map<string, string[]>,
    connectorMessage: ConnectorMessage
  ): Map<string, string[]>;
  replaceKeysAndValuesInMap(
    map: Record<string, string[]>,
    connectorMessage: ConnectorMessage
  ): Record<string, string[]>;
  replaceKeysAndValuesInMap(
    map: Map<string, string[]> | Record<string, string[]>,
    connectorMessage: ConnectorMessage
  ): Map<string, string[]> | Record<string, string[]> {
    if (map instanceof Map) {
      const localMap = new Map<string, string[]>();
      for (const [key, value] of map) {
        const replacedKey = this.replaceValuesWithMessage(key, connectorMessage);
        const replacedList = [...value];
        this.replaceValuesInListWithMessage(replacedList, connectorMessage);
        localMap.set(replacedKey, replacedList);
      }
      return localMap;
    } else {
      const localMap: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(map)) {
        const replacedKey = this.replaceValuesWithMessage(key, connectorMessage);
        const replacedList = [...value];
        this.replaceValuesInListWithMessage(replacedList, connectorMessage);
        localMap[replacedKey] = replacedList;
      }
      return localMap;
    }
  }

  /**
   * Replaces all values in a list. Uses the default context.
   * Modifies the list in place.
   */
  replaceValuesInList(list: string[]): void {
    for (let i = 0; i < list.length; i++) {
      list[i] = this.replaceValues(list[i]!);
    }
  }

  /**
   * Replaces all values in a list using connector message context.
   * Modifies the list in place.
   */
  replaceValuesInListWithMessage(list: string[], connectorMessage: ConnectorMessage): void {
    for (let i = 0; i < list.length; i++) {
      list[i] = this.replaceValuesWithMessage(list[i]!, connectorMessage);
    }
  }

  /**
   * Replaces variables in the template with values from the passed in map.
   * Uses the default context.
   *
   * @returns The replaced template
   */
  replaceValuesWithMap(template: string, map: Record<string, unknown>): string {
    if (ValueReplacer.hasReplaceableValues(template)) {
      const context = this.getDefaultContext();
      this.loadContextFromMap(context, map);
      return this.evaluate(context, template);
    }
    return template;
  }

  /**
   * Replaces variables in the template using connector message context.
   *
   * @returns The replaced template
   */
  replaceValuesWithMessage(template: string, connectorMessage: ConnectorMessage): string {
    if (ValueReplacer.hasReplaceableValues(template)) {
      const context = this.getDefaultContext();
      this.loadContextFromConnectorMessage(context, connectorMessage);
      return this.evaluate(context, template);
    }
    return template;
  }

  /**
   * Replaces variables in the template using full message context.
   *
   * @returns The replaced template
   */
  replaceValuesWithFullMessage(template: string, message: Message): string {
    if (ValueReplacer.hasReplaceableValues(template)) {
      const context = this.getDefaultContext();
      this.loadContextFromMessage(context, message);
      return this.evaluate(context, template);
    }
    return template;
  }

  /**
   * Replaces variables in the template using the default context.
   *
   * @returns The replaced template
   */
  replaceValues(template: string): string {
    if (ValueReplacer.hasReplaceableValues(template)) {
      const context = this.getDefaultContext();
      return this.evaluate(context, template);
    }
    return template;
  }

  /**
   * Decodes a MIME application/x-www-form-urlencoded string and then replaces any variables.
   * Uses connector message context.
   *
   * @returns The decoded and replaced string
   */
  replaceURLValues(url: string, connectorMessage: ConnectorMessage): string {
    if (!url || url.trim() === '') {
      return '';
    }

    let host: string;
    try {
      host = decodeURIComponent(url);
    } catch {
      // If decoding fails, use the original URL
      host = url;
    }

    return this.replaceValuesWithMessage(host, connectorMessage);
  }

  /**
   * Performs the actual template replacement using the passed context.
   * Uses a simple ${variable} syntax similar to Velocity templates.
   *
   * Supports:
   * - ${variable} - Simple variable replacement
   * - ${object.property} - Nested property access
   * - ${maps.get('key')} - MapTool access
   *
   * @returns The replaced template
   */
  protected evaluate(context: ReplacementContext, template: string): string {
    try {
      // Match ${...} patterns
      return template.replace(/\$\{([^}]+)\}/g, (match, expression: string) => {
        const value = this.evaluateExpression(context, expression.trim());
        return value !== null && value !== undefined ? String(value) : match;
      });
    } catch {
      // If replacement fails, return original template
      return template;
    }
  }

  /**
   * Evaluates a single expression within the context.
   */
  private evaluateExpression(context: ReplacementContext, expression: string): unknown {
    // Handle maps.get('key') syntax
    const mapsGetMatch = expression.match(/^maps\.get\s*\(\s*['"]([^'"]+)['"]\s*\)$/);
    if (mapsGetMatch) {
      const maps = context['maps'] as MapTool | undefined;
      if (maps) {
        return maps.get(mapsGetMatch[1]!);
      }
      return null;
    }

    // Handle dot notation (object.property)
    const parts = expression.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return null;
      }

      // Handle method calls like date.format()
      const methodMatch = part.match(/^(\w+)\s*\(([^)]*)\)$/);
      if (methodMatch) {
        const methodName = methodMatch[1];
        const args = methodMatch[2];

        if (typeof value === 'object' && value !== null && methodName! in value) {
          const method = (value as Record<string, unknown>)[methodName!];
          if (typeof method === 'function') {
            // Parse arguments (simple string arguments)
            const parsedArgs = args
              ? args.split(',').map((arg) => {
                  const trimmed = arg.trim();
                  // Remove quotes if present
                  if (
                    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
                    (trimmed.startsWith('"') && trimmed.endsWith('"'))
                  ) {
                    return trimmed.slice(1, -1);
                  }
                  return trimmed;
                })
              : [];
            value = method.apply(value, parsedArgs);
          } else {
            return null;
          }
        } else {
          return null;
        }
      } else if (typeof value === 'object' && value !== null) {
        if (value instanceof Map) {
          value = value.get(part);
        } else {
          value = (value as Record<string, unknown>)[part];
        }
      } else {
        return null;
      }
    }

    return value;
  }

  /**
   * Returns the default context used to replace template values.
   * Includes utility classes and variables.
   */
  protected getDefaultContext(): ReplacementContext {
    const context: ReplacementContext = {};

    // Date tool for formatting dates
    context['date'] = {
      format: (pattern: string, date?: Date) => {
        const d = date || new Date();
        return this.formatDate(d, pattern);
      },
    };

    // Default formatted date
    context['DATE'] = format(new Date(), 'dd-MM-yy_HH-mm-ss.SS');

    // Count tool
    context['COUNT'] = new CountTool(() => this.getCount());

    // UUID
    context['UUID'] = uuidv4();

    // System time
    context['SYSTIME'] = String(Date.now());

    // Map tool
    context['maps'] = new MapTool();

    return context;
  }

  /**
   * Formats a date using a Java-style pattern.
   * Converts common Java date format patterns to date-fns patterns.
   */
  private formatDate(date: Date, pattern: string): string {
    // Convert Java date format patterns to date-fns patterns
    const converted = pattern
      .replace(/yyyy/g, 'yyyy')
      .replace(/yy/g, 'yy')
      .replace(/MM/g, 'MM')
      .replace(/dd/g, 'dd')
      .replace(/HH/g, 'HH')
      .replace(/mm/g, 'mm')
      .replace(/ss/g, 'ss')
      .replace(/SS/g, 'SS')
      .replace(/SSS/g, 'SSS');

    return format(date, converted);
  }

  /**
   * Loads all key/value pairs from a Map into the passed context.
   */
  protected loadContextFromMap(
    context: ReplacementContext,
    map: Record<string, unknown> | Map<string, unknown> | null | undefined
  ): void {
    if (!map) return;

    const maps = context['maps'] as MapTool;

    if (map instanceof Map) {
      maps.addMap(map);
      for (const [key, value] of map) {
        context[key] = value;
      }
    } else {
      maps.addMap(map);
      for (const [key, value] of Object.entries(map)) {
        context[key] = value;
      }
    }
  }

  /**
   * Loads the connector message and all available variable maps into the context.
   */
  protected loadContextFromConnectorMessage(
    context: ReplacementContext,
    connectorMessage: ConnectorMessage
  ): void {
    context['message'] = connectorMessage;
    context['channelName'] = connectorMessage.channelName;
    context['channelId'] = connectorMessage.channelId;

    // Load maps
    this.loadContextFromMap(context, connectorMessage.sourceMap);
    this.loadContextFromMap(context, connectorMessage.channelMap);
    this.loadContextFromMap(context, connectorMessage.connectorMap);
    this.loadContextFromMap(context, connectorMessage.responseMap);

    // Use the current time as the original file name if there is no original file name
    if (!('originalFilename' in context)) {
      context['originalFilename'] = `${Date.now()}.dat`;
    }
  }

  /**
   * Loads the message and merged connector message maps into the context.
   */
  protected loadContextFromMessage(context: ReplacementContext, message: Message): void {
    context['message'] = message;

    const mergedConnectorMessage = message.getMergedConnectorMessage();

    // Load maps
    this.loadContextFromMap(context, mergedConnectorMessage.sourceMap);
    this.loadContextFromMap(context, mergedConnectorMessage.channelMap);
    this.loadContextFromMap(context, mergedConnectorMessage.responseMap);

    // Use the current time as the original file name if there is no original file name
    if (!('originalFilename' in context)) {
      context['originalFilename'] = `${Date.now()}.dat`;
    }
  }
}

// Export a singleton instance for convenience
export const valueReplacer = new ValueReplacer();
