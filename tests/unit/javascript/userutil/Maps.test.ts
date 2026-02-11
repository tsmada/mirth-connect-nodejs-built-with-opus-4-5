/**
 * Tests for Maps and MapBuilder
 */
import { Maps, MapBuilder } from '../../../../src/javascript/userutil/Maps';

describe('Maps', () => {
  describe('Maps.map()', () => {
    it('should create a new MapBuilder', () => {
      const map = Maps.map();
      expect(map).toBeInstanceOf(MapBuilder);
      expect(map.size()).toBe(0);
    });
  });

  describe('Maps.emptyMap()', () => {
    it('should create an empty MapBuilder', () => {
      const map = Maps.emptyMap();
      expect(map.size()).toBe(0);
    });
  });

  describe('MapBuilder', () => {
    it('should support put (fluent)', () => {
      const map = new MapBuilder();
      const result = map.put('key1', 'val1').put('key2', 'val2');
      expect(result).toBe(map); // fluent
      expect(map.size()).toBe(2);
    });

    it('should support get', () => {
      const map = Maps.map().put('name', 'test');
      expect(map.get('name')).toBe('test');
      expect(map.get('missing')).toBeUndefined();
    });

    it('should support containsKey', () => {
      const map = Maps.map().put('key', 'val');
      expect(map.containsKey('key')).toBe(true);
      expect(map.containsKey('other')).toBe(false);
    });

    it('should support keySet', () => {
      const map = Maps.map().put('a', 1).put('b', 2);
      const keys = map.keySet();
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys.length).toBe(2);
    });

    it('should support values', () => {
      const map = Maps.map().put('a', 1).put('b', 2);
      const vals = map.values();
      expect(vals).toContain(1);
      expect(vals).toContain(2);
    });

    it('should convert to object', () => {
      const map = Maps.map().put('name', 'test').put('value', 42);
      const obj = map.toObject();
      expect(obj).toEqual({ name: 'test', value: 42 });
    });

    it('should be iterable (yields [key, value] pairs)', () => {
      const map = Maps.map().put('a', 1).put('b', 2);
      const entries = [...map];
      expect(entries.length).toBe(2);
      expect(entries[0]![0]).toBe('a');
      expect(entries[0]![1]).toBe(1);
    });

    it('should have string representation', () => {
      const map = Maps.map().put('a', 1).put('b', 2);
      const str = map.toString();
      expect(str).toContain('a=1');
      expect(str).toContain('b=2');
    });

    it('should overwrite existing keys', () => {
      const map = Maps.map().put('key', 'old').put('key', 'new');
      expect(map.get('key')).toBe('new');
      expect(map.size()).toBe(1);
    });
  });
});
