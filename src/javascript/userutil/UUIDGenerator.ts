/**
 * UUIDGenerator - Utility class to create unique identifiers
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/UUIDGenerator.java
 *
 * This class provides UUID generation functionality for use in Mirth Connect
 * JavaScript contexts. It generates type 4 (pseudo randomly generated) UUIDs
 * using a cryptographically strong pseudo random number generator.
 */

import { randomUUID } from 'crypto';

/**
 * Utility class to create unique identifiers.
 */
export class UUIDGenerator {
  /**
   * Private constructor to prevent instantiation.
   * This is a utility class with only static methods.
   */
  private constructor() {}

  /**
   * Returns a type 4 (pseudo randomly generated) UUID. The UUID is generated using a
   * cryptographically strong pseudo random number generator.
   *
   * @returns The UUID string in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   */
  public static getUUID(): string {
    return randomUUID();
  }
}
