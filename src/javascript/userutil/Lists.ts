/**
 * Lists - Fluent list builder for user scripts
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/Lists.java
 *
 * Purpose: Provide Java-style Collections.list() equivalent for Mirth scripts
 */

/**
 * Fluent list builder that wraps an array with a chainable API.
 */
export class ListBuilder {
  private items: unknown[];

  /**
   * Create a new ListBuilder with optional initial items.
   *
   * @param items - Initial items to populate the list
   */
  constructor(...items: unknown[]) {
    this.items = [...items];
  }

  /**
   * Append an item to the list.
   *
   * @param item - The item to append
   * @returns This builder for chaining
   */
  public append(item: unknown): this {
    this.items.push(item);
    return this;
  }

  /**
   * Add an item to the list (alias for append).
   *
   * @param item - The item to add
   * @returns This builder for chaining
   */
  public add(item: unknown): this {
    return this.append(item);
  }

  /**
   * Get the number of items in the list.
   *
   * @returns The list size
   */
  public size(): number {
    return this.items.length;
  }

  /**
   * Get the item at the specified index.
   *
   * @param index - The zero-based index
   * @returns The item at the index, or undefined if out of bounds
   */
  public get(index: number): unknown {
    return this.items[index];
  }

  /**
   * Check if the list contains the specified item.
   *
   * @param item - The item to search for
   * @returns True if the item is found
   */
  public contains(item: unknown): boolean {
    return this.items.includes(item);
  }

  /**
   * Convert to a plain JavaScript array.
   *
   * @returns A shallow copy of the internal array
   */
  public toArray(): unknown[] {
    return [...this.items];
  }

  /**
   * Make the list iterable with for...of loops.
   */
  public *[Symbol.iterator](): Iterator<unknown> {
    yield* this.items;
  }

  /**
   * String representation of the list.
   *
   * @returns A string in the format [item1, item2, ...]
   */
  public toString(): string {
    return `[${this.items.join(', ')}]`;
  }
}

/**
 * Lists factory class providing static methods to create list builders.
 * Matches the Java API: Lists.list("a", "b", "c")
 */
export class Lists {
  /**
   * Private constructor to prevent instantiation.
   * This is a factory class with only static methods.
   */
  private constructor() {}

  /**
   * Create a new list with initial items.
   *
   * @param items - Initial items for the list
   * @returns A new ListBuilder containing the items
   */
  public static list(...items: unknown[]): ListBuilder {
    return new ListBuilder(...items);
  }

  /**
   * Create an empty list.
   *
   * @returns A new empty ListBuilder
   */
  public static emptyList(): ListBuilder {
    return new ListBuilder();
  }
}
