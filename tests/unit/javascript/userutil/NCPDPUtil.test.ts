/**
 * Unit tests for NCPDPUtil
 *
 * Tests the NCPDP signed overpunch conversion functionality
 * ported from Java's NCPDPUtil.java
 */

import { NCPDPUtil } from '../../../../src/javascript/userutil/NCPDPUtil.js';

describe('NCPDPUtil', () => {
  describe('formatNCPDPNumber', () => {
    describe('null and empty handling', () => {
      it('should return empty string for null input', () => {
        expect(NCPDPUtil.formatNCPDPNumber(null, 2)).toBe('');
      });

      it('should return empty string for undefined input', () => {
        expect(NCPDPUtil.formatNCPDPNumber(undefined, 2)).toBe('');
      });

      it('should return empty string for empty string input', () => {
        expect(NCPDPUtil.formatNCPDPNumber('', 2)).toBe('');
      });
    });

    describe('positive overpunch characters', () => {
      it('should convert { to 0 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123{', 0)).toBe('1230');
      });

      it('should convert A to 1 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123A', 0)).toBe('1231');
      });

      it('should convert B to 2 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123B', 0)).toBe('1232');
      });

      it('should convert C to 3 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123C', 0)).toBe('1233');
      });

      it('should convert D to 4 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123D', 0)).toBe('1234');
      });

      it('should convert E to 5 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123E', 0)).toBe('1235');
      });

      it('should convert F to 6 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123F', 0)).toBe('1236');
      });

      it('should convert G to 7 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123G', 0)).toBe('1237');
      });

      it('should convert H to 8 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123H', 0)).toBe('1238');
      });

      it('should convert I to 9 (positive)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123I', 0)).toBe('1239');
      });
    });

    describe('negative overpunch characters', () => {
      it('should convert } to 0 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123}', 0)).toBe('-1230');
      });

      it('should convert J to 1 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123J', 0)).toBe('-1231');
      });

      it('should convert K to 2 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123K', 0)).toBe('-1232');
      });

      it('should convert L to 3 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123L', 0)).toBe('-1233');
      });

      it('should convert M to 4 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123M', 0)).toBe('-1234');
      });

      it('should convert N to 5 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123N', 0)).toBe('-1235');
      });

      it('should convert O to 6 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123O', 0)).toBe('-1236');
      });

      it('should convert P to 7 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123P', 0)).toBe('-1237');
      });

      it('should convert Q to 8 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123Q', 0)).toBe('-1238');
      });

      it('should convert R to 9 and prepend minus (negative)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123R', 0)).toBe('-1239');
      });
    });

    describe('decimal point insertion', () => {
      it('should insert decimal point at specified position for positive numbers', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123A', 2)).toBe('12.31');
      });

      it('should insert decimal point at specified position for negative numbers', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123J', 2)).toBe('-12.31');
      });

      it('should not insert decimal if decimalPoints is 0', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123A', 0)).toBe('1231');
      });

      it('should not insert decimal if decimalPoints is negative', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123A', -1)).toBe('1231');
      });

      it('should not insert decimal if decimalPoints >= string length', () => {
        expect(NCPDPUtil.formatNCPDPNumber('123A', 4)).toBe('1231');
        expect(NCPDPUtil.formatNCPDPNumber('123A', 5)).toBe('1231');
      });

      it('should handle decimal point at the beginning (decimalPoints == length - 1)', () => {
        expect(NCPDPUtil.formatNCPDPNumber('12A', 3)).toBe('121');
      });

      it('should insert decimal 1 position from end', () => {
        expect(NCPDPUtil.formatNCPDPNumber('1234A', 1)).toBe('1234.1');
      });

      it('should insert decimal 3 positions from end', () => {
        expect(NCPDPUtil.formatNCPDPNumber('12345A', 3)).toBe('123.451');
      });
    });

    describe('edge cases', () => {
      it('should handle single character positive overpunch', () => {
        expect(NCPDPUtil.formatNCPDPNumber('{', 0)).toBe('0');
        expect(NCPDPUtil.formatNCPDPNumber('A', 0)).toBe('1');
      });

      it('should handle single character negative overpunch', () => {
        expect(NCPDPUtil.formatNCPDPNumber('}', 0)).toBe('-0');
        expect(NCPDPUtil.formatNCPDPNumber('J', 0)).toBe('-1');
      });

      it('should pass through numbers without overpunch characters', () => {
        expect(NCPDPUtil.formatNCPDPNumber('12345', 0)).toBe('12345');
        expect(NCPDPUtil.formatNCPDPNumber('12345', 2)).toBe('123.45');
      });

      it('should only process the last character for overpunch', () => {
        // Only the last character is checked for overpunch
        expect(NCPDPUtil.formatNCPDPNumber('A23{', 0)).toBe('A230');
      });

      it('should handle numbers with leading zeros', () => {
        expect(NCPDPUtil.formatNCPDPNumber('00123A', 2)).toBe('0012.31');
      });

      it('should handle decimal point insertion with negative numbers', () => {
        // For negative: -1234, decimalPoints=2 should give -12.34
        expect(NCPDPUtil.formatNCPDPNumber('123M', 2)).toBe('-12.34');
      });
    });

    describe('real-world NCPDP examples', () => {
      it('should format pharmacy cost amount (positive)', () => {
        // 1250 cents = $12.50
        expect(NCPDPUtil.formatNCPDPNumber('125{', 2)).toBe('12.50');
      });

      it('should format pharmacy refund amount (negative)', () => {
        // -1250 cents = -$12.50
        expect(NCPDPUtil.formatNCPDPNumber('125}', 2)).toBe('-12.50');
      });

      it('should format quantity with 3 decimal places', () => {
        // 1500 = 1.500 (quantity of 1.5 with 3 decimal precision)
        expect(NCPDPUtil.formatNCPDPNumber('150{', 3)).toBe('1.500');
      });

      it('should format negative quantity', () => {
        expect(NCPDPUtil.formatNCPDPNumber('150}', 3)).toBe('-1.500');
      });
    });
  });

  describe('class structure', () => {
    it('should have formatNCPDPNumber as a static method', () => {
      expect(NCPDPUtil.formatNCPDPNumber).toBeDefined();
      expect(typeof NCPDPUtil.formatNCPDPNumber).toBe('function');
    });
  });
});
