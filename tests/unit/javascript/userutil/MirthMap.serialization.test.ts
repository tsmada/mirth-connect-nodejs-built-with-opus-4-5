/**
 * Map serialization safety tests
 *
 * Tests that DonkeyDao's safeSerializeMap() handles all value types correctly,
 * matching Java MapUtil.serializeMap() behavior:
 * - Serializable values (string, number, boolean, null) serialize normally
 * - Functions are stored as their toString() representation
 * - Circular references do NOT throw — fall back to per-value toString()
 * - Date objects serialize to ISO string via JSON.stringify
 * - undefined values are preserved (omitted by JSON.stringify → absent from result)
 * - Nested objects serialize normally
 * - Mixed maps with serializable + non-serializable values serialize gracefully
 */

import { safeSerializeMap } from '../../../../src/db/DonkeyDao';

describe('safeSerializeMap', () => {
  // ─────────────────────────────────────────────────
  // Serializable primitives
  // ─────────────────────────────────────────────────
  describe('serializable primitives', () => {
    it('should serialize string values correctly', () => {
      const map = new Map<string, unknown>([['greeting', 'hello']]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.greeting).toBe('hello');
    });

    it('should serialize number values correctly', () => {
      const map = new Map<string, unknown>([['count', 42]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(42);
    });

    it('should serialize boolean values correctly', () => {
      const map = new Map<string, unknown>([
        ['active', true],
        ['deleted', false],
      ]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.active).toBe(true);
      expect(parsed.deleted).toBe(false);
    });

    it('should serialize null correctly', () => {
      const map = new Map<string, unknown>([['empty', null]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.empty).toBeNull();
    });

    it('should handle undefined values (omitted by JSON.stringify)', () => {
      const map = new Map<string, unknown>([['missing', undefined]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      // undefined is omitted by JSON.stringify — key should be absent or undefined
      expect(parsed.missing).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────
  // Complex serializable values
  // ─────────────────────────────────────────────────
  describe('complex serializable values', () => {
    it('should serialize nested objects correctly', () => {
      const map = new Map<string, unknown>([
        ['patient', { name: 'John', age: 30, address: { city: 'NYC' } }],
      ]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.patient.name).toBe('John');
      expect(parsed.patient.age).toBe(30);
      expect(parsed.patient.address.city).toBe('NYC');
    });

    it('should serialize arrays correctly', () => {
      const map = new Map<string, unknown>([['ids', [1, 2, 3]]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.ids).toEqual([1, 2, 3]);
    });

    it('should serialize Date objects to ISO string', () => {
      const date = new Date('2026-02-22T10:30:00.000Z');
      const map = new Map<string, unknown>([['timestamp', date]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.timestamp).toBe('2026-02-22T10:30:00.000Z');
    });
  });

  // ─────────────────────────────────────────────────
  // Non-serializable values — graceful fallback
  // ─────────────────────────────────────────────────
  describe('non-serializable values', () => {
    it('should convert function values to their toString representation', () => {
      const fn = () => { return 42; };
      const map = new Map<string, unknown>([['callback', fn]]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      // Function should be stored as its source code string
      expect(parsed.callback).toContain('return 42');
    });

    it('should NOT throw on circular references', () => {
      const obj: Record<string, unknown> = { name: 'circular' };
      obj.self = obj; // Create circular reference

      const map = new Map<string, unknown>([
        ['normal', 'hello'],
        ['circular', obj],
      ]);

      // Should NOT throw
      expect(() => safeSerializeMap(map)).not.toThrow();

      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      // Normal value should be preserved
      expect(parsed.normal).toBe('hello');
      // Circular value should fall back to toString()
      expect(parsed.circular).toBe('[object Object]');
    });

    it('should handle BigInt via toString fallback', () => {
      const map = new Map<string, unknown>([
        ['big', BigInt(9007199254740991)],
      ]);
      // BigInt throws on JSON.stringify — safe serialization should catch it
      expect(() => safeSerializeMap(map)).not.toThrow();
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.big).toBe('9007199254740991');
    });
  });

  // ─────────────────────────────────────────────────
  // Mixed maps
  // ─────────────────────────────────────────────────
  describe('mixed maps with serializable and non-serializable values', () => {
    it('should serialize mixed maps gracefully, preserving serializable values', () => {
      const circObj: Record<string, unknown> = { x: 1 };
      circObj.ref = circObj;

      const map = new Map<string, unknown>([
        ['name', 'test'],
        ['count', 42],
        ['active', true],
        ['fn', () => 'hello'],
        ['circular', circObj],
        ['list', [1, 2, 3]],
      ]);

      expect(() => safeSerializeMap(map)).not.toThrow();
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);

      // Serializable values preserved exactly
      expect(parsed.name).toBe('test');
      expect(parsed.count).toBe(42);
      expect(parsed.active).toBe(true);
      expect(parsed.list).toEqual([1, 2, 3]);

      // Function stored as source string
      expect(parsed.fn).toContain('hello');

      // Circular object falls back to toString
      expect(parsed.circular).toBe('[object Object]');
    });
  });

  // ─────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle empty map', () => {
      const map = new Map<string, unknown>();
      const result = safeSerializeMap(map);
      expect(result).toBe('{}');
    });

    it('should handle map with empty string key', () => {
      const map = new Map<string, unknown>([['', 'empty-key-value']]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed['']).toBe('empty-key-value');
    });

    it('should handle map with special characters in values', () => {
      const map = new Map<string, unknown>([
        ['msg', 'Line1\nLine2\tTabbed'],
        ['html', '<script>alert("xss")</script>'],
      ]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed.msg).toBe('Line1\nLine2\tTabbed');
      expect(parsed.html).toBe('<script>alert("xss")</script>');
    });

    it('should handle map with numeric string keys', () => {
      const map = new Map<string, unknown>([
        ['0', 'zero'],
        ['123', 'one-two-three'],
      ]);
      const result = safeSerializeMap(map);
      const parsed = JSON.parse(result);
      expect(parsed['0']).toBe('zero');
      expect(parsed['123']).toBe('one-two-three');
    });
  });
});
