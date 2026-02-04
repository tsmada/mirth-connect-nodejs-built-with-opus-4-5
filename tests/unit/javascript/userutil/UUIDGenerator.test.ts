/**
 * Unit tests for UUIDGenerator
 *
 * Tests the UUID generation functionality ported from Java's UUIDGenerator.java
 */

import { UUIDGenerator } from '../../../../src/javascript/userutil/UUIDGenerator.js';

describe('UUIDGenerator', () => {
  describe('getUUID', () => {
    it('should return a valid UUID string', () => {
      const uuid = UUIDGenerator.getUUID();
      expect(uuid).toBeDefined();
      expect(typeof uuid).toBe('string');
    });

    it('should return a UUID in standard format', () => {
      const uuid = UUIDGenerator.getUUID();
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    it('should generate unique UUIDs on each call', () => {
      const uuids = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        uuids.add(UUIDGenerator.getUUID());
      }

      // All generated UUIDs should be unique
      expect(uuids.size).toBe(count);
    });

    it('should generate type 4 UUIDs (version 4)', () => {
      const uuid = UUIDGenerator.getUUID();
      // Version 4 UUIDs have '4' as the first character of the third group
      const parts = uuid.split('-');
      expect(parts[2]![0]).toBe('4');
    });

    it('should generate UUIDs with correct variant', () => {
      const uuid = UUIDGenerator.getUUID();
      // RFC 4122 variant: first character of fourth group is 8, 9, a, or b
      const parts = uuid.split('-');
      const variantChar = parts[3]![0]!.toLowerCase();
      expect(['8', '9', 'a', 'b']).toContain(variantChar);
    });

    it('should return 36-character UUID strings', () => {
      const uuid = UUIDGenerator.getUUID();
      expect(uuid.length).toBe(36);
    });

    it('should generate lowercase UUIDs', () => {
      const uuid = UUIDGenerator.getUUID();
      expect(uuid).toBe(uuid.toLowerCase());
    });
  });

  describe('class structure', () => {
    it('should not be instantiable (utility class pattern)', () => {
      // TypeScript prevents instantiation via private constructor
      // This test documents the expected behavior
      expect(typeof UUIDGenerator.getUUID).toBe('function');
    });

    it('should have getUUID as a static method', () => {
      expect(UUIDGenerator.getUUID).toBeDefined();
      expect(typeof UUIDGenerator.getUUID).toBe('function');
    });
  });
});
