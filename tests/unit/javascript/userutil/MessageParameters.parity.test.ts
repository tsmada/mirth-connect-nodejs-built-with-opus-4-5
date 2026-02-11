/**
 * MessageParameters parity tests
 *
 * Validates that the Node.js MessageParameters implementation matches
 * Java Mirth's com.mirth.connect.userutil.MessageParameters behavior.
 */

import { MessageParameters } from '../../../../src/javascript/userutil/MessageParameters.js';

describe('MessageParameters', () => {
  let params: MessageParameters;

  beforeEach(() => {
    const delegate = new Map<string, string | string[]>([
      ['id', '12345'],
      ['tags', ['alpha', 'beta', 'gamma']],
      ['format', 'json'],
    ]);
    params = new MessageParameters(delegate);
  });

  describe('getParameter()', () => {
    it('returns the first value for a single-value parameter', () => {
      expect(params.getParameter('id')).toBe('12345');
    });

    it('returns the first value for a multi-value parameter', () => {
      expect(params.getParameter('tags')).toBe('alpha');
    });

    it('returns null for a missing parameter', () => {
      expect(params.getParameter('missing')).toBeNull();
    });
  });

  describe('getParameterList()', () => {
    it('returns all values for a multi-value parameter', () => {
      expect(params.getParameterList('tags')).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('returns a single-element list for a single-value parameter', () => {
      expect(params.getParameterList('id')).toEqual(['12345']);
    });

    it('returns null for a missing parameter', () => {
      expect(params.getParameterList('missing')).toBeNull();
    });

    it('returns a copy, not the original array', () => {
      const list1 = params.getParameterList('tags');
      const list2 = params.getParameterList('tags');
      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe('getKeys()', () => {
    it('returns all parameter names', () => {
      const keys = params.getKeys();
      expect(keys).toContain('id');
      expect(keys).toContain('tags');
      expect(keys).toContain('format');
      expect(keys).toHaveLength(3);
    });
  });

  describe('contains()', () => {
    it('returns true for an existing parameter', () => {
      expect(params.contains('id')).toBe(true);
    });

    it('returns false for a missing parameter', () => {
      expect(params.contains('missing')).toBe(false);
    });
  });

  describe('case-sensitive lookup', () => {
    it('getParameter() is case-sensitive (unlike headers)', () => {
      expect(params.getParameter('id')).toBe('12345');
      expect(params.getParameter('ID')).toBeNull();
      expect(params.getParameter('Id')).toBeNull();
    });

    it('contains() is case-sensitive', () => {
      expect(params.contains('id')).toBe(true);
      expect(params.contains('ID')).toBe(false);
    });
  });

  describe('constructor normalization', () => {
    it('normalizes single string values to arrays', () => {
      const p = new MessageParameters(
        new Map<string, string | string[]>([['key', 'value']])
      );
      expect(p.getParameterList('key')).toEqual(['value']);
      expect(p.getParameter('key')).toBe('value');
    });

    it('handles empty map', () => {
      const p = new MessageParameters(new Map());
      expect(p.getKeys()).toEqual([]);
      expect(p.getParameter('anything')).toBeNull();
    });
  });

  describe('get() (deprecated)', () => {
    it('returns the first value and logs deprecation', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(params.get('id')).toBe('12345');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('deprecated')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('toString()', () => {
    it('returns a readable representation', () => {
      const str = params.toString();
      expect(str).toContain('id');
      expect(str).toContain('12345');
      expect(str).toContain('tags');
    });
  });
});
