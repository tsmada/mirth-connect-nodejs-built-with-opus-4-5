/**
 * MessageParameters - Wrapper for HTTP query parameter multi-value map
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/userutil/MessageParameters.java
 *
 * Provides convenience methods for accessing HTTP query parameters from Mirth Connect
 * JavaScript contexts. Unlike HTTP headers, query parameters are case-sensitive
 * (standard URL behavior).
 */

/**
 * Wrapper around a multi-value map of HTTP query parameters.
 * Available in script scope as MessageParameters for constructing parameter wrappers,
 * and typically accessed via sourceMap.get('parameters').
 */
export class MessageParameters {
  private delegate: Map<string, string[]>;

  /**
   * Construct a MessageParameters wrapper.
   *
   * @param delegate - A Map of parameter name to value(s). Values may be a single
   *   string or an array of strings (normalized to arrays internally).
   */
  constructor(delegate: Map<string, string | string[]>) {
    this.delegate = new Map();

    for (const [key, value] of delegate) {
      const normalized = Array.isArray(value) ? value : [value];
      this.delegate.set(key, normalized);
    }
  }

  /**
   * Get the first parameter value for the given key (deprecated).
   *
   * @param key - The name of the parameter key.
   * @returns The associated value or null if no value exists.
   * @deprecated Use getParameter(key) or getParameterList(key) instead.
   */
  get(key: string): string | null {
    console.error(
      'The get(key) method for retrieving Http parameters is deprecated and will soon be removed. Please use getParameter(key) or getParameterList(key) instead.'
    );
    return this.getParameter(key);
  }

  /**
   * Get the first parameter value for the given key.
   * Lookup is case-sensitive (standard URL behavior).
   *
   * @param key - The name of the parameter key.
   * @returns The associated value or null if no value exists.
   */
  getParameter(key: string): string | null {
    const list = this.delegate.get(key);
    if (list && list.length > 0) {
      return list[0]!;
    }
    return null;
  }

  /**
   * Get all parameter values for the given key.
   *
   * @param key - The name of the parameter key.
   * @returns A list of all parameter values for the given key, or null if no values exist.
   */
  getParameterList(key: string): string[] | null {
    const list = this.delegate.get(key);
    if (list && list.length > 0) {
      return [...list]; // Return a copy (Java returns unmodifiableList)
    }
    return null;
  }

  /**
   * Get all parameter keys.
   *
   * @returns An array of all parameter key names.
   */
  getKeys(): string[] {
    return Array.from(this.delegate.keys());
  }

  /**
   * Check if parameters exist for a given key.
   *
   * @param key - The name of the parameter key.
   * @returns true if parameters exist for the given key, false otherwise.
   */
  contains(key: string): boolean {
    return this.delegate.has(key);
  }

  toString(): string {
    const entries: string[] = [];
    for (const [key, values] of this.delegate) {
      entries.push(`${key}=[${values.join(', ')}]`);
    }
    return `{${entries.join(', ')}}`;
  }
}
