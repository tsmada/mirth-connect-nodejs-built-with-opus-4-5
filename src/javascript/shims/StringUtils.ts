/**
 * Apache Commons Lang3 StringUtils polyfill
 *
 * Provides the most commonly used StringUtils static methods from
 * org.apache.commons.lang3.StringUtils. Real-world Mirth channels
 * frequently use StringUtils via:
 *   - Direct import: Packages.org.apache.commons.lang3.StringUtils
 *   - Scope injection: StringUtils.isBlank(value)
 *
 * This polyfill covers ~40 methods that appear in production channels.
 */

export const StringUtils = {
  // --- Blank/Empty checks ---
  isBlank: (s: string | null | undefined): boolean => !s || s.trim().length === 0,
  isNotBlank: (s: string | null | undefined): boolean => !!s && s.trim().length > 0,
  isEmpty: (s: string | null | undefined): boolean => !s || s.length === 0,
  isNotEmpty: (s: string | null | undefined): boolean => !!s && s.length > 0,

  // --- Trim variants ---
  trim: (s: string | null): string | null => s?.trim() ?? null,
  trimToEmpty: (s: string | null): string => s?.trim() ?? '',
  trimToNull: (s: string | null): string | null => {
    const t = s?.trim();
    return t && t.length > 0 ? t : null;
  },

  // --- Default variants ---
  defaultString: (s: string | null | undefined, def = ''): string => s ?? def,
  defaultIfBlank: (s: string | null | undefined, def: string): string =>
    (!s || s.trim().length === 0) ? def : s,
  defaultIfEmpty: (s: string | null | undefined, def: string): string =>
    (!s || s.length === 0) ? def : s,

  // --- Count ---
  countMatches: (str: string, sub: string): number => {
    if (!str || !sub) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos += sub.length; }
    return count;
  },

  // --- Strip ---
  chomp: (str: string): string => str.replace(/\r?\n$/, ''),
  strip: (str: string): string => str.trim(),
  stripToNull: (s: string | null): string | null => {
    const t = s?.trim();
    return t && t.length > 0 ? t : null;
  },
  stripToEmpty: (s: string | null): string => s?.trim() ?? '',

  // --- Join / Split ---
  join: (arr: unknown[], sep: string): string => arr.map(String).join(sep),
  split: (str: string, sep?: string): string[] =>
    sep ? str.split(sep) : str.trim().split(/\s+/),

  // --- Contains ---
  contains: (str: string, search: string): boolean => str.includes(search),
  containsIgnoreCase: (str: string, search: string): boolean =>
    str.toLowerCase().includes(search.toLowerCase()),

  // --- StartsWith / EndsWith ---
  startsWith: (str: string, prefix: string): boolean => str.startsWith(prefix),
  startsWithIgnoreCase: (str: string, prefix: string): boolean =>
    str.toLowerCase().startsWith(prefix.toLowerCase()),
  endsWith: (str: string, suffix: string): boolean => str.endsWith(suffix),
  endsWithIgnoreCase: (str: string, suffix: string): boolean =>
    str.toLowerCase().endsWith(suffix.toLowerCase()),

  // --- Replace ---
  replace: (str: string, search: string, replacement: string): string =>
    str.split(search).join(replacement),
  replaceAll: (str: string, regex: string, replacement: string): string =>
    str.replace(new RegExp(regex, 'g'), replacement),

  // --- Remove ---
  removeStart: (str: string, remove: string): string =>
    str.startsWith(remove) ? str.slice(remove.length) : str,
  removeEnd: (str: string, remove: string): string =>
    str.endsWith(remove) ? str.slice(0, -remove.length) : str,

  // --- Case ---
  upperCase: (s: string): string => s.toUpperCase(),
  lowerCase: (s: string): string => s.toLowerCase(),
  capitalize: (s: string): string => s.charAt(0).toUpperCase() + s.slice(1),
  uncapitalize: (s: string): string => s.charAt(0).toLowerCase() + s.slice(1),
  swapCase: (s: string): string =>
    s.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),

  // --- Pad / Repeat ---
  repeat: (s: string, count: number): string => s.repeat(count),
  rightPad: (s: string, size: number, padStr = ' '): string => s.padEnd(size, padStr),
  leftPad: (s: string, size: number, padStr = ' '): string => s.padStart(size, padStr),
  center: (s: string, size: number, padStr = ' '): string => {
    if (s.length >= size) return s;
    const left = Math.floor((size - s.length) / 2);
    return s.padStart(s.length + left, padStr).padEnd(size, padStr);
  },

  // --- Substring ---
  substringBefore: (str: string, sep: string): string => {
    const i = str.indexOf(sep);
    return i < 0 ? str : str.slice(0, i);
  },
  substringAfter: (str: string, sep: string): string => {
    const i = str.indexOf(sep);
    return i < 0 ? '' : str.slice(i + sep.length);
  },
  substringBeforeLast: (str: string, sep: string): string => {
    const i = str.lastIndexOf(sep);
    return i < 0 ? str : str.slice(0, i);
  },
  substringAfterLast: (str: string, sep: string): string => {
    const i = str.lastIndexOf(sep);
    return i < 0 ? '' : str.slice(i + sep.length);
  },

  // --- Abbreviate ---
  abbreviate: (str: string, maxWidth: number): string =>
    str.length <= maxWidth ? str : str.slice(0, maxWidth - 3) + '...',

  // --- Character class checks ---
  isNumeric: (s: string): boolean => /^\d+$/.test(s),
  isAlpha: (s: string): boolean => /^[a-zA-Z]+$/.test(s),
  isAlphanumeric: (s: string): boolean => /^[a-zA-Z0-9]+$/.test(s),

  // --- Reverse ---
  reverse: (s: string): string => s.split('').reverse().join(''),

  // --- Equality ---
  equals: (a: string | null, b: string | null): boolean => a === b,
  equalsIgnoreCase: (a: string | null, b: string | null): boolean =>
    a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase(),
};
