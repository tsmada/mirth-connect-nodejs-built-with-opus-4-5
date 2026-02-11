/**
 * MessageHeaders parity tests
 *
 * Validates that the Node.js MessageHeaders implementation matches
 * Java Mirth's com.mirth.connect.userutil.MessageHeaders behavior.
 */

import { MessageHeaders } from '../../../../src/javascript/userutil/MessageHeaders.js';

describe('MessageHeaders', () => {
  let headers: MessageHeaders;

  beforeEach(() => {
    const delegate = new Map<string, string | string[]>([
      ['Content-Type', 'application/json'],
      ['Accept', ['text/html', 'application/xml', 'application/json']],
      ['X-Custom-Header', 'custom-value'],
      ['Authorization', 'Bearer abc123'],
    ]);
    headers = new MessageHeaders(delegate);
  });

  describe('getHeader()', () => {
    it('returns the first value for a single-value header', () => {
      expect(headers.getHeader('Content-Type')).toBe('application/json');
    });

    it('returns the first value for a multi-value header', () => {
      expect(headers.getHeader('Accept')).toBe('text/html');
    });

    it('returns null for a missing header', () => {
      expect(headers.getHeader('X-Missing')).toBeNull();
    });
  });

  describe('getHeaderList()', () => {
    it('returns all values for a multi-value header', () => {
      expect(headers.getHeaderList('Accept')).toEqual([
        'text/html',
        'application/xml',
        'application/json',
      ]);
    });

    it('returns a single-element list for a single-value header', () => {
      expect(headers.getHeaderList('Content-Type')).toEqual(['application/json']);
    });

    it('returns null for a missing header', () => {
      expect(headers.getHeaderList('X-Missing')).toBeNull();
    });

    it('returns a copy, not the original array', () => {
      const list1 = headers.getHeaderList('Accept');
      const list2 = headers.getHeaderList('Accept');
      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe('getKeys()', () => {
    it('returns all header names', () => {
      const keys = headers.getKeys();
      expect(keys).toContain('Content-Type');
      expect(keys).toContain('Accept');
      expect(keys).toContain('X-Custom-Header');
      expect(keys).toContain('Authorization');
      expect(keys).toHaveLength(4);
    });
  });

  describe('contains()', () => {
    it('returns true for an existing header', () => {
      expect(headers.contains('Content-Type')).toBe(true);
    });

    it('returns false for a missing header', () => {
      expect(headers.contains('X-Missing')).toBe(false);
    });
  });

  describe('case-insensitive lookup', () => {
    it('getHeader() finds headers regardless of case', () => {
      expect(headers.getHeader('content-type')).toBe('application/json');
      expect(headers.getHeader('CONTENT-TYPE')).toBe('application/json');
      expect(headers.getHeader('Content-type')).toBe('application/json');
    });

    it('getHeaderList() finds headers regardless of case', () => {
      expect(headers.getHeaderList('accept')).toEqual([
        'text/html',
        'application/xml',
        'application/json',
      ]);
    });

    it('contains() checks case-insensitively', () => {
      expect(headers.contains('content-type')).toBe(true);
      expect(headers.contains('CONTENT-TYPE')).toBe(true);
      expect(headers.contains('x-custom-header')).toBe(true);
    });

    it('getKeys() preserves original casing', () => {
      const keys = headers.getKeys();
      expect(keys).toContain('Content-Type');
      expect(keys).not.toContain('content-type');
    });
  });

  describe('constructor normalization', () => {
    it('normalizes single string values to arrays', () => {
      const h = new MessageHeaders(
        new Map<string, string | string[]>([['X-Single', 'value']])
      );
      expect(h.getHeaderList('X-Single')).toEqual(['value']);
      expect(h.getHeader('X-Single')).toBe('value');
    });

    it('handles empty map', () => {
      const h = new MessageHeaders(new Map());
      expect(h.getKeys()).toEqual([]);
      expect(h.getHeader('anything')).toBeNull();
    });
  });

  describe('get() (deprecated)', () => {
    it('returns the first value and logs deprecation', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('deprecated')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('toString()', () => {
    it('returns a readable representation', () => {
      const str = headers.toString();
      expect(str).toContain('Content-Type');
      expect(str).toContain('application/json');
    });
  });
});
