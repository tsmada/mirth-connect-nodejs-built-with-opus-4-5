/**
 * Tests for Lists and ListBuilder
 */
import { Lists, ListBuilder } from '../../../../src/javascript/userutil/Lists';

describe('Lists', () => {
  describe('Lists.list()', () => {
    it('should create a ListBuilder with initial items', () => {
      const list = Lists.list(1, 2, 3);
      expect(list).toBeInstanceOf(ListBuilder);
      expect(list.size()).toBe(3);
    });

    it('should create empty list with no args', () => {
      const list = Lists.list();
      expect(list.size()).toBe(0);
    });
  });

  describe('Lists.emptyList()', () => {
    it('should create an empty ListBuilder', () => {
      const list = Lists.emptyList();
      expect(list.size()).toBe(0);
    });
  });

  describe('ListBuilder', () => {
    it('should support append (fluent)', () => {
      const list = new ListBuilder();
      const result = list.append('a').append('b').append('c');
      expect(result).toBe(list); // fluent
      expect(list.size()).toBe(3);
    });

    it('should support add (alias for append)', () => {
      const list = new ListBuilder();
      list.add('x');
      expect(list.size()).toBe(1);
      expect(list.get(0)).toBe('x');
    });

    it('should support get by index', () => {
      const list = Lists.list('a', 'b', 'c');
      expect(list.get(0)).toBe('a');
      expect(list.get(1)).toBe('b');
      expect(list.get(2)).toBe('c');
    });

    it('should support contains', () => {
      const list = Lists.list(1, 2, 3);
      expect(list.contains(2)).toBe(true);
      expect(list.contains(5)).toBe(false);
    });

    it('should convert to array', () => {
      const list = Lists.list('a', 'b');
      const arr = list.toArray();
      expect(arr).toEqual(['a', 'b']);
      // Should be a copy, not the internal array
      arr.push('c');
      expect(list.size()).toBe(2);
    });

    it('should be iterable', () => {
      const list = Lists.list(1, 2, 3);
      const items = [...list];
      expect(items).toEqual([1, 2, 3]);
    });

    it('should have string representation', () => {
      const list = Lists.list('a', 'b');
      expect(list.toString()).toBe('[a, b]');
    });
  });
});
