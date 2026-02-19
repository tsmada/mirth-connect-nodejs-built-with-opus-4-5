/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DateUtil.java
 *
 * Purpose: Date/time formatting utilities for Mirth scripts
 *
 * Key behaviors to replicate:
 * - getDate(pattern, date) - Parse date string to Date
 * - formatDate(pattern, date) - Format Date to string
 * - getCurrentDate(pattern) - Format current date
 * - convertDate(inPattern, outPattern, date) - Convert date string format
 *
 * Pattern format: Uses Java SimpleDateFormat patterns which need to be
 * converted to date-fns format.
 */

import { parse, format } from 'date-fns';

/**
 * Mapping from Java SimpleDateFormat patterns to date-fns patterns.
 * Note: Some patterns are identical, others need conversion.
 */
const JAVA_TO_DATEFNS_PATTERNS: Record<string, string> = {
  // Year
  yyyy: 'yyyy',
  yy: 'yy',

  // Month
  MMMM: 'MMMM',
  MMM: 'MMM',
  MM: 'MM',
  M: 'M',

  // Day of month
  dd: 'dd',
  d: 'd',

  // Day of week
  EEEE: 'EEEE',
  EEE: 'EEE',
  EE: 'EE',
  E: 'E',

  // Hour (0-23)
  HH: 'HH',
  H: 'H',

  // Hour (1-12)
  hh: 'hh',
  h: 'h',

  // Hour (0-11) - Java 'K' -> date-fns doesn't have direct equiv, use 'h' and adjust
  KK: 'hh', // approximation
  K: 'h', // approximation

  // Hour (1-24) - Java 'k' -> date-fns 'k' (note: date-fns 'k' is 1-24)
  kk: 'kk',
  k: 'k',

  // Minute
  mm: 'mm',
  m: 'm',

  // Second
  ss: 'ss',
  s: 's',

  // Millisecond - Java 'S' -> date-fns 'SSS'
  SSS: 'SSS',
  SS: 'SS',
  S: 'S',

  // AM/PM
  a: 'a',

  // Timezone
  z: 'zzz', // approximation
  zzzz: 'zzzz',
  Z: 'xx',
  X: 'xxx',
  XX: 'xxxx',
  XXX: 'xxxxx',

  // Week in year
  w: 'w',
  ww: 'ww',

  // Day in year
  D: 'D',
  DD: 'DD',
  DDD: 'DDD',
};

/**
 * Converts a Java SimpleDateFormat pattern to a date-fns format pattern.
 * This handles most common patterns used in Mirth channels.
 */
function convertPattern(javaPattern: string): string {
  // Sort patterns by length (longest first) to avoid partial replacements
  const sortedPatterns = Object.keys(JAVA_TO_DATEFNS_PATTERNS).sort((a, b) => b.length - a.length);

  let result = javaPattern;

  // Replace patterns while preserving literals (text in single quotes)
  // First, extract literals and replace with placeholders
  const literals: string[] = [];
  result = result.replace(/'([^']+)'/g, (_, literal) => {
    literals.push(literal);
    return `\x00${literals.length - 1}\x00`;
  });

  // Handle escaped single quotes
  result = result.replace(/''/g, '\x01');

  // Now replace patterns
  for (const pattern of sortedPatterns) {
    // Use regex with word boundaries for more accurate replacement
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, JAVA_TO_DATEFNS_PATTERNS[pattern]!);
  }

  // Restore literals
  result = result.replace(/\x00(\d+)\x00/g, (_, index) => {
    return `'${literals[parseInt(index)]}'`;
  });

  // Restore escaped single quotes
  result = result.replace(/\x01/g, "''");

  return result;
}

/**
 * Provides date/time utility methods.
 */
export class DateUtil {
  private constructor() {
    // Private constructor - static utility class
  }

  /**
   * Parses a date string according to the specified pattern and returns a Date object.
   *
   * @param pattern - The SimpleDateFormat pattern to use (e.g. "yyyyMMddHHmmss").
   * @param date - The date string to parse.
   * @returns A Date object representing the parsed date.
   * @throws Error if the pattern could not be parsed.
   */
  static getDate(pattern: string, date: string): Date {
    const dateFnsPattern = convertPattern(pattern);
    const result = parse(date, dateFnsPattern, new Date());

    if (isNaN(result.getTime())) {
      throw new Error(`Unable to parse date "${date}" with pattern "${pattern}"`);
    }

    return result;
  }

  /**
   * Formats a Date object into a string according to a specified pattern.
   *
   * @param pattern - The SimpleDateFormat pattern to use (e.g. "yyyyMMddHHmmss").
   * @param date - The Date object to format.
   * @returns The formatted date string.
   */
  static formatDate(pattern: string, date: Date): string {
    const dateFnsPattern = convertPattern(pattern);
    return format(date, dateFnsPattern);
  }

  /**
   * Formats the current date into a string according to a specified pattern.
   *
   * @param pattern - The SimpleDateFormat pattern to use (e.g. "yyyyMMddHHmmss").
   * @returns The current formatted date string.
   */
  static getCurrentDate(pattern: string): string {
    return DateUtil.formatDate(pattern, new Date());
  }

  /**
   * Parses a date string according to a specified input pattern, and formats the date
   * back to a string according to a specified output pattern.
   *
   * @param inPattern - The SimpleDateFormat pattern for parsing the input date.
   * @param outPattern - The SimpleDateFormat pattern for formatting the output date.
   * @param date - The date string to convert.
   * @returns The converted date string.
   * @throws Error if the pattern could not be parsed.
   */
  static convertDate(inPattern: string, outPattern: string, date: string): string {
    const parsedDate = DateUtil.getDate(inPattern, date);
    return DateUtil.formatDate(outPattern, parsedDate);
  }
}
