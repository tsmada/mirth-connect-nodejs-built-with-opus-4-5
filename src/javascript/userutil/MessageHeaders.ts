/**
 * MessageHeaders - Wrapper for HTTP header multi-value map
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/userutil/MessageHeaders.java
 *
 * Provides convenience methods for accessing HTTP headers from Mirth Connect
 * JavaScript contexts. HTTP headers are case-insensitive per RFC 2616, so this
 * class normalizes keys to lowercase for lookup while preserving original casing
 * in getKeys().
 */

/**
 * Wrapper around a multi-value map of HTTP headers.
 * Available in script scope as MessageHeaders for constructing header wrappers,
 * and typically accessed via sourceMap.get('headers').
 */
export class MessageHeaders {
  private delegate: Map<string, string[]>;
  private lowerCaseIndex: Map<string, string>; // lowercase key -> original key

  /**
   * Construct a MessageHeaders wrapper.
   *
   * @param delegate - A Map of header name to value(s). Values may be a single
   *   string or an array of strings (normalized to arrays internally).
   */
  constructor(delegate: Map<string, string | string[]>) {
    this.delegate = new Map();
    this.lowerCaseIndex = new Map();

    for (const [key, value] of delegate) {
      const normalized = Array.isArray(value) ? value : [value];
      this.delegate.set(key, normalized);
      this.lowerCaseIndex.set(key.toLowerCase(), key);
    }
  }

  /**
   * Get the first header value for the given key (deprecated).
   *
   * @param key - The name of the header key.
   * @returns The associated value or null if no value exists.
   * @deprecated Use getHeader(key) or getHeaderList(key) instead.
   */
  get(key: string): string | null {
    console.error(
      'The get(key) method for retrieving Http headers is deprecated and will soon be removed. Please use getHeader(key) or getHeaderList(key) instead.'
    );
    return this.getHeader(key);
  }

  /**
   * Get the first header value for the given key.
   * Lookup is case-insensitive (HTTP headers are case-insensitive per RFC 2616).
   *
   * @param key - The name of the header key.
   * @returns The associated value or null if no value exists.
   */
  getHeader(key: string): string | null {
    const list = this._getList(key);
    if (list && list.length > 0) {
      return list[0]!;
    }
    return null;
  }

  /**
   * Get all header values for the given key.
   * Lookup is case-insensitive.
   *
   * @param key - The name of the header key.
   * @returns A list of all header values for the given key, or null if no values exist.
   */
  getHeaderList(key: string): string[] | null {
    const list = this._getList(key);
    if (list && list.length > 0) {
      return [...list]; // Return a copy (Java returns unmodifiableList)
    }
    return null;
  }

  /**
   * Get all header keys.
   *
   * @returns An array of all header key names (original casing preserved).
   */
  getKeys(): string[] {
    return Array.from(this.delegate.keys());
  }

  /**
   * Check if headers exist for a given key.
   * Lookup is case-insensitive.
   *
   * @param key - The name of the header key.
   * @returns true if headers exist for the given key, false otherwise.
   */
  contains(key: string): boolean {
    return this._getList(key) !== undefined;
  }

  toString(): string {
    const entries: string[] = [];
    for (const [key, values] of this.delegate) {
      entries.push(`${key}=[${values.join(', ')}]`);
    }
    return `{${entries.join(', ')}}`;
  }

  /**
   * Internal helper: look up by exact key first, then case-insensitive.
   */
  private _getList(key: string): string[] | undefined {
    // Try exact match first
    const exact = this.delegate.get(key);
    if (exact !== undefined) {
      return exact;
    }
    // Fall back to case-insensitive lookup
    const originalKey = this.lowerCaseIndex.get(key.toLowerCase());
    if (originalKey !== undefined) {
      return this.delegate.get(originalKey);
    }
    return undefined;
  }
}
