/**
 * Tests for Apache Commons Lang3 StringUtils polyfill
 */

import { StringUtils } from '../../../../src/javascript/shims/StringUtils.js';

describe('StringUtils', () => {
  // --- Blank / Empty ---
  describe('isBlank / isNotBlank', () => {
    it('null is blank', () => expect(StringUtils.isBlank(null)).toBe(true));
    it('undefined is blank', () => expect(StringUtils.isBlank(undefined)).toBe(true));
    it('empty string is blank', () => expect(StringUtils.isBlank('')).toBe(true));
    it('whitespace is blank', () => expect(StringUtils.isBlank('   ')).toBe(true));
    it('non-empty is not blank', () => expect(StringUtils.isBlank('hello')).toBe(false));
    it('isNotBlank is inverse', () => {
      expect(StringUtils.isNotBlank('hello')).toBe(true);
      expect(StringUtils.isNotBlank('')).toBe(false);
    });
  });

  describe('isEmpty / isNotEmpty', () => {
    it('null is empty', () => expect(StringUtils.isEmpty(null)).toBe(true));
    it('empty string is empty', () => expect(StringUtils.isEmpty('')).toBe(true));
    it('whitespace is NOT empty', () => expect(StringUtils.isEmpty('  ')).toBe(false));
    it('non-empty is not empty', () => expect(StringUtils.isEmpty('a')).toBe(false));
    it('isNotEmpty is inverse', () => {
      expect(StringUtils.isNotEmpty('a')).toBe(true);
      expect(StringUtils.isNotEmpty(null)).toBe(false);
    });
  });

  // --- Trim ---
  describe('trim variants', () => {
    it('trim returns trimmed string', () => expect(StringUtils.trim('  abc  ')).toBe('abc'));
    it('trim null returns null', () => expect(StringUtils.trim(null)).toBeNull());
    it('trimToEmpty returns "" for null', () => expect(StringUtils.trimToEmpty(null)).toBe(''));
    it('trimToEmpty trims', () => expect(StringUtils.trimToEmpty('  x  ')).toBe('x'));
    it('trimToNull returns null for blank', () => expect(StringUtils.trimToNull('   ')).toBeNull());
    it('trimToNull returns trimmed', () => expect(StringUtils.trimToNull('  x  ')).toBe('x'));
  });

  // --- Defaults ---
  describe('defaultString / defaultIfBlank / defaultIfEmpty', () => {
    it('defaultString returns string', () => expect(StringUtils.defaultString('a')).toBe('a'));
    it('defaultString returns default for null', () => expect(StringUtils.defaultString(null, 'x')).toBe('x'));
    it('defaultIfBlank returns default for blank', () =>
      expect(StringUtils.defaultIfBlank('   ', 'x')).toBe('x'));
    it('defaultIfBlank returns string for non-blank', () =>
      expect(StringUtils.defaultIfBlank('a', 'x')).toBe('a'));
    it('defaultIfEmpty returns default for empty', () =>
      expect(StringUtils.defaultIfEmpty('', 'x')).toBe('x'));
    it('defaultIfEmpty returns string for non-empty', () =>
      expect(StringUtils.defaultIfEmpty(' ', 'x')).toBe(' '));
  });

  // --- Count ---
  describe('countMatches', () => {
    it('counts occurrences', () => expect(StringUtils.countMatches('abcabc', 'abc')).toBe(2));
    it('returns 0 for no match', () => expect(StringUtils.countMatches('abc', 'xyz')).toBe(0));
    it('returns 0 for empty', () => expect(StringUtils.countMatches('', 'a')).toBe(0));
  });

  // --- Contains ---
  describe('contains / containsIgnoreCase', () => {
    it('contains finds match', () => expect(StringUtils.contains('abcdef', 'cde')).toBe(true));
    it('contains returns false', () => expect(StringUtils.contains('abc', 'xyz')).toBe(false));
    it('containsIgnoreCase finds match', () =>
      expect(StringUtils.containsIgnoreCase('Hello World', 'hello')).toBe(true));
  });

  // --- StartsWith / EndsWith ---
  describe('startsWith / endsWith', () => {
    it('startsWith', () => expect(StringUtils.startsWith('abc', 'ab')).toBe(true));
    it('startsWithIgnoreCase', () =>
      expect(StringUtils.startsWithIgnoreCase('ABC', 'ab')).toBe(true));
    it('endsWith', () => expect(StringUtils.endsWith('abc', 'bc')).toBe(true));
    it('endsWithIgnoreCase', () =>
      expect(StringUtils.endsWithIgnoreCase('ABC', 'bc')).toBe(true));
  });

  // --- Replace ---
  describe('replace / replaceAll', () => {
    it('replace replaces all literal occurrences', () =>
      expect(StringUtils.replace('aXbXc', 'X', '-')).toBe('a-b-c'));
    it('replaceAll uses regex', () =>
      expect(StringUtils.replaceAll('a1b2c3', '[0-9]', '#')).toBe('a#b#c#'));
  });

  // --- Remove ---
  describe('removeStart / removeEnd', () => {
    it('removeStart removes prefix', () =>
      expect(StringUtils.removeStart('www.example.com', 'www.')).toBe('example.com'));
    it('removeStart returns unchanged if no match', () =>
      expect(StringUtils.removeStart('abc', 'xyz')).toBe('abc'));
    it('removeEnd removes suffix', () =>
      expect(StringUtils.removeEnd('file.txt', '.txt')).toBe('file'));
    it('removeEnd returns unchanged if no match', () =>
      expect(StringUtils.removeEnd('abc', 'xyz')).toBe('abc'));
  });

  // --- Case ---
  describe('case methods', () => {
    it('upperCase', () => expect(StringUtils.upperCase('abc')).toBe('ABC'));
    it('lowerCase', () => expect(StringUtils.lowerCase('ABC')).toBe('abc'));
    it('capitalize', () => expect(StringUtils.capitalize('hello')).toBe('Hello'));
    it('uncapitalize', () => expect(StringUtils.uncapitalize('Hello')).toBe('hello'));
    it('swapCase', () => expect(StringUtils.swapCase('aBc')).toBe('AbC'));
  });

  // --- Pad ---
  describe('pad methods', () => {
    it('leftPad', () => expect(StringUtils.leftPad('42', 5, '0')).toBe('00042'));
    it('rightPad', () => expect(StringUtils.rightPad('ab', 5)).toBe('ab   '));
    it('center', () => {
      const result = StringUtils.center('ab', 6);
      expect(result.length).toBe(6);
      expect(result.trim()).toBe('ab');
    });
  });

  // --- Substring ---
  describe('substring methods', () => {
    it('substringBefore', () =>
      expect(StringUtils.substringBefore('abc.def.ghi', '.')).toBe('abc'));
    it('substringBefore no match', () =>
      expect(StringUtils.substringBefore('abc', 'x')).toBe('abc'));
    it('substringAfter', () =>
      expect(StringUtils.substringAfter('abc.def.ghi', '.')).toBe('def.ghi'));
    it('substringAfter no match', () =>
      expect(StringUtils.substringAfter('abc', 'x')).toBe(''));
    it('substringBeforeLast', () =>
      expect(StringUtils.substringBeforeLast('abc.def.ghi', '.')).toBe('abc.def'));
    it('substringAfterLast', () =>
      expect(StringUtils.substringAfterLast('abc.def.ghi', '.')).toBe('ghi'));
  });

  // --- Abbreviate ---
  describe('abbreviate', () => {
    it('abbreviates long string', () =>
      expect(StringUtils.abbreviate('Hello World', 8)).toBe('Hello...'));
    it('does not abbreviate short string', () =>
      expect(StringUtils.abbreviate('Hi', 10)).toBe('Hi'));
  });

  // --- Character class checks ---
  describe('character checks', () => {
    it('isNumeric', () => {
      expect(StringUtils.isNumeric('123')).toBe(true);
      expect(StringUtils.isNumeric('12a')).toBe(false);
    });
    it('isAlpha', () => {
      expect(StringUtils.isAlpha('abc')).toBe(true);
      expect(StringUtils.isAlpha('ab1')).toBe(false);
    });
    it('isAlphanumeric', () => {
      expect(StringUtils.isAlphanumeric('abc123')).toBe(true);
      expect(StringUtils.isAlphanumeric('abc!')).toBe(false);
    });
  });

  // --- Reverse ---
  describe('reverse', () => {
    it('reverses string', () => expect(StringUtils.reverse('abc')).toBe('cba'));
  });

  // --- Equals ---
  describe('equals / equalsIgnoreCase', () => {
    it('equals matches same strings', () => expect(StringUtils.equals('a', 'a')).toBe(true));
    it('equals fails on different strings', () => expect(StringUtils.equals('a', 'b')).toBe(false));
    it('equals handles nulls', () => {
      expect(StringUtils.equals(null, null)).toBe(true);
      expect(StringUtils.equals(null, 'a')).toBe(false);
    });
    it('equalsIgnoreCase', () => {
      expect(StringUtils.equalsIgnoreCase('ABC', 'abc')).toBe(true);
      expect(StringUtils.equalsIgnoreCase('ABC', 'xyz')).toBe(false);
    });
    it('equalsIgnoreCase handles nulls', () => {
      expect(StringUtils.equalsIgnoreCase(null, null)).toBe(true);
      expect(StringUtils.equalsIgnoreCase(null, 'a')).toBe(false);
    });
  });

  // --- Join / Split ---
  describe('join / split', () => {
    it('join with separator', () =>
      expect(StringUtils.join(['a', 'b', 'c'], ',')).toBe('a,b,c'));
    it('split with separator', () =>
      expect(StringUtils.split('a,b,c', ',')).toEqual(['a', 'b', 'c']));
    it('split with whitespace (default)', () =>
      expect(StringUtils.split('  a  b  c  ')).toEqual(['a', 'b', 'c']));
  });

  // --- Strip ---
  describe('strip / chomp', () => {
    it('strip trims', () => expect(StringUtils.strip('  abc  ')).toBe('abc'));
    it('stripToNull for blank', () => expect(StringUtils.stripToNull('   ')).toBeNull());
    it('stripToEmpty for null', () => expect(StringUtils.stripToEmpty(null)).toBe(''));
    it('chomp removes trailing newline', () =>
      expect(StringUtils.chomp('hello\n')).toBe('hello'));
    it('chomp removes trailing CRLF', () =>
      expect(StringUtils.chomp('hello\r\n')).toBe('hello'));
  });

  // --- Repeat ---
  describe('repeat', () => {
    it('repeats string', () => expect(StringUtils.repeat('ab', 3)).toBe('ababab'));
  });
});
