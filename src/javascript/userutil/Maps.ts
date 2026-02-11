/**
 * Maps - Fluent map builder for user scripts
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/Maps.java
 *
 * Purpose: Provide Java-style Map builder equivalent for Mirth scripts
 */

/**
 * Fluent map builder that wraps a Map with a chainable API.
 */
export class MapBuilder {
  private entries: Map<string, unknown>;

  /**
   * Create a new empty MapBuilder.
   */
  constructor() {
    this.entries = new Map();
  }

  /**
   * Put a key-value pair into the map.
   *
   * @param key - The key
   * @param value - The value
   * @returns This builder for chaining
   */
  public put(key: string, value: unknown): this {
    this.entries.set(key, value);
    return this;
  }

  /**
   * Get the value associated with a key.
   *
   * @param key - The key to look up
   * @returns The value, or undefined if the key is not present
   */
  public get(key: string): unknown {
    return this.entries.get(key);
  }

  /**
   * Check if the map contains the specified key.
   *
   * @param key - The key to check
   * @returns True if the key exists in the map
   */
  public containsKey(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Get the number of entries in the map.
   *
   * @returns The map size
   */
  public size(): number {
    return this.entries.size;
  }

  /**
   * Get all keys in the map.
   *
   * @returns An array of all keys
   */
  public keySet(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Get all values in the map.
   *
   * @returns An array of all values
   */
  public values(): unknown[] {
    return [...this.entries.values()];
  }

  /**
   * Convert to a plain JavaScript object.
   *
   * @returns A Record with all key-value pairs
   */
  public toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.entries) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * Make the map iterable with for...of loops (yields [key, value] pairs).
   */
  public *[Symbol.iterator](): Iterator<[string, unknown]> {
    yield* this.entries;
  }

  /**
   * String representation of the map.
   *
   * @returns A string in the format {key1=value1, key2=value2}
   */
  public toString(): string {
    const pairs = [...this.entries].map(([k, v]) => `${k}=${v}`);
    return `{${pairs.join(', ')}}`;
  }
}

/**
 * Maps factory class providing static methods to create map builders.
 * Matches the Java API: Maps.map().put("key", "value")
 */
export class Maps {
  /**
   * Private constructor to prevent instantiation.
   * This is a factory class with only static methods.
   */
  private constructor() {}

  /**
   * Create a new map builder.
   *
   * @returns A new empty MapBuilder
   */
  public static map(): MapBuilder {
    return new MapBuilder();
  }

  /**
   * Create an empty map.
   *
   * @returns A new empty MapBuilder
   */
  public static emptyMap(): MapBuilder {
    return new MapBuilder();
  }
}
