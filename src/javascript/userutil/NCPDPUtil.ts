/**
 * NCPDPUtil - NCPDP utility methods
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/NCPDPUtil.java
 *
 * This class provides NCPDP (National Council for Prescription Drug Programs)
 * utility methods, specifically for handling signed overpunch codes used in
 * pharmacy billing and claim processing.
 *
 * Signed overpunch is a data encoding format where the last character of a number
 * indicates both the final digit and the sign of the entire number:
 * - Characters {, A-I represent digits 0-9 for positive numbers
 * - Characters }, J-R represent digits 0-9 for negative numbers
 */

/**
 * Mapping of positive overpunch characters to their digit values.
 * { = 0, A = 1, B = 2, ..., I = 9
 */
const POSITIVE_OVERPUNCH: Record<string, string> = {
  '{': '0',
  A: '1',
  B: '2',
  C: '3',
  D: '4',
  E: '5',
  F: '6',
  G: '7',
  H: '8',
  I: '9',
};

/**
 * Mapping of negative overpunch characters to their digit values.
 * } = 0, J = 1, K = 2, ..., R = 9
 */
const NEGATIVE_OVERPUNCH: Record<string, string> = {
  '}': '0',
  J: '1',
  K: '2',
  L: '3',
  M: '4',
  N: '5',
  O: '6',
  P: '7',
  Q: '8',
  R: '9',
};

/**
 * Provides NCPDP utility methods.
 */
export class NCPDPUtil {
  /**
   * Private constructor to prevent instantiation.
   * This is a utility class with only static methods.
   */
  private constructor() {}

  /**
   * Converts a signed overpunch code into a string representing the appropriate decimal value.
   *
   * Signed overpunch encoding uses special characters at the end of a number to indicate
   * both the last digit and the sign of the entire number:
   * - Positive: { = 0, A = 1, B = 2, C = 3, D = 4, E = 5, F = 6, G = 7, H = 8, I = 9
   * - Negative: } = 0, J = 1, K = 2, L = 3, M = 4, N = 5, O = 6, P = 7, Q = 8, R = 9
   *
   * @param origNumber The signed overpunch code to convert.
   * @param decimalPoints The index at which to place a decimal point in the converted string.
   *                      If this value is less than or equal to zero, or greater than or equal
   *                      to the length of the overpunch code, a decimal point will not be inserted.
   * @returns The string representation of the converted decimal value.
   *
   * @example
   * // Positive number with overpunch
   * NCPDPUtil.formatNCPDPNumber("123A", 2);  // Returns "12.31"
   *
   * @example
   * // Negative number with overpunch
   * NCPDPUtil.formatNCPDPNumber("123J", 2);  // Returns "-12.31"
   *
   * @example
   * // No decimal point insertion
   * NCPDPUtil.formatNCPDPNumber("123{", 0);  // Returns "1230"
   */
  public static formatNCPDPNumber(
    origNumber: string | null | undefined,
    decimalPoints: number
  ): string {
    // Handle null/undefined/empty string
    if (origNumber === null || origNumber === undefined || origNumber === '') {
      return '';
    }

    let result = origNumber;
    let isNegative = false;

    // Get the last character to check for overpunch
    const lastChar = origNumber.charAt(origNumber.length - 1);

    // Check for positive overpunch characters
    if (POSITIVE_OVERPUNCH[lastChar] !== undefined) {
      result = origNumber.slice(0, -1) + POSITIVE_OVERPUNCH[lastChar];
    }
    // Check for negative overpunch characters
    else if (NEGATIVE_OVERPUNCH[lastChar] !== undefined) {
      result = origNumber.slice(0, -1) + NEGATIVE_OVERPUNCH[lastChar];
      isNegative = true;
    }

    // Prepend minus sign for negative numbers
    if (isNegative) {
      result = '-' + result;
    }

    // Insert decimal point if appropriate
    // decimalPoints must be > 0 and < the length of the result (after potential minus sign)
    if (decimalPoints > 0 && decimalPoints < result.length) {
      const insertPos = result.length - decimalPoints;
      result = result.substring(0, insertPos) + '.' + result.substring(insertPos);
    }

    return result;
  }
}
