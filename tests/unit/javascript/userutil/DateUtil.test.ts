import { DateUtil } from '../../../../src/javascript/userutil/DateUtil';

describe('DateUtil', () => {
  describe('getDate', () => {
    it('should parse date with yyyyMMdd pattern', () => {
      const result = DateUtil.getDate('yyyyMMdd', '20240115');

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January is 0
      expect(result.getDate()).toBe(15);
    });

    it('should parse date with yyyyMMddHHmmss pattern', () => {
      const result = DateUtil.getDate('yyyyMMddHHmmss', '20240115143052');

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(52);
    });

    it('should parse date with yyyy-MM-dd pattern', () => {
      const result = DateUtil.getDate('yyyy-MM-dd', '2024-01-15');

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
    });

    it('should parse date with MM/dd/yyyy pattern', () => {
      const result = DateUtil.getDate('MM/dd/yyyy', '01/15/2024');

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
    });

    it('should parse date with time and AM/PM', () => {
      const result = DateUtil.getDate('yyyy-MM-dd hh:mm:ss a', '2024-01-15 02:30:45 PM');

      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(45);
    });

    it('should parse date with milliseconds', () => {
      const result = DateUtil.getDate('yyyy-MM-dd HH:mm:ss.SSS', '2024-01-15 14:30:52.123');

      expect(result.getMilliseconds()).toBe(123);
    });

    it('should throw error for invalid date', () => {
      expect(() => DateUtil.getDate('yyyyMMdd', 'invalid')).toThrow();
    });

    it('should throw error for mismatched pattern', () => {
      expect(() => DateUtil.getDate('yyyy-MM-dd', '20240115')).toThrow();
    });
  });

  describe('formatDate', () => {
    it('should format date with yyyyMMdd pattern', () => {
      const date = new Date(2024, 0, 15); // January 15, 2024

      const result = DateUtil.formatDate('yyyyMMdd', date);

      expect(result).toBe('20240115');
    });

    it('should format date with yyyyMMddHHmmss pattern', () => {
      const date = new Date(2024, 0, 15, 14, 30, 52);

      const result = DateUtil.formatDate('yyyyMMddHHmmss', date);

      expect(result).toBe('20240115143052');
    });

    it('should format date with yyyy-MM-dd pattern', () => {
      const date = new Date(2024, 0, 15);

      const result = DateUtil.formatDate('yyyy-MM-dd', date);

      expect(result).toBe('2024-01-15');
    });

    it('should format date with MM/dd/yyyy pattern', () => {
      const date = new Date(2024, 0, 15);

      const result = DateUtil.formatDate('MM/dd/yyyy', date);

      expect(result).toBe('01/15/2024');
    });

    it('should format date with time', () => {
      const date = new Date(2024, 0, 15, 14, 30, 52);

      const result = DateUtil.formatDate('yyyy-MM-dd HH:mm:ss', date);

      expect(result).toBe('2024-01-15 14:30:52');
    });

    it('should format date with 12-hour time', () => {
      const date = new Date(2024, 0, 15, 14, 30, 52);

      const result = DateUtil.formatDate('yyyy-MM-dd hh:mm:ss a', date);

      expect(result).toContain('02:30:52');
      expect(result.toUpperCase()).toContain('PM');
    });

    it('should format date with milliseconds', () => {
      const date = new Date(2024, 0, 15, 14, 30, 52, 123);

      const result = DateUtil.formatDate('yyyy-MM-dd HH:mm:ss.SSS', date);

      expect(result).toBe('2024-01-15 14:30:52.123');
    });

    it('should format date with day of week', () => {
      const date = new Date(2024, 0, 15); // Monday

      const result = DateUtil.formatDate('EEEE', date);

      expect(result).toBe('Monday');
    });

    it('should format date with short day of week', () => {
      const date = new Date(2024, 0, 15); // Monday

      const result = DateUtil.formatDate('EEE', date);

      expect(result).toBe('Mon');
    });

    it('should format date with month name', () => {
      const date = new Date(2024, 0, 15);

      const result = DateUtil.formatDate('MMMM', date);

      expect(result).toBe('January');
    });

    it('should format date with short month name', () => {
      const date = new Date(2024, 0, 15);

      const result = DateUtil.formatDate('MMM', date);

      expect(result).toBe('Jan');
    });
  });

  describe('getCurrentDate', () => {
    it('should return current date formatted with pattern', () => {
      const now = new Date();
      const result = DateUtil.getCurrentDate('yyyy');

      expect(result).toBe(now.getFullYear().toString());
    });

    it('should return current date with full pattern', () => {
      const result = DateUtil.getCurrentDate('yyyyMMdd');

      // Just check format is correct (8 digits)
      expect(result).toMatch(/^\d{8}$/);
    });

    it('should return current date with time', () => {
      const result = DateUtil.getCurrentDate('yyyyMMddHHmmss');

      // Should be 14 digits
      expect(result).toMatch(/^\d{14}$/);
    });
  });

  describe('convertDate', () => {
    it('should convert date from yyyyMMdd to yyyy-MM-dd', () => {
      const result = DateUtil.convertDate('yyyyMMdd', 'yyyy-MM-dd', '20240115');

      expect(result).toBe('2024-01-15');
    });

    it('should convert date from yyyy-MM-dd to MM/dd/yyyy', () => {
      const result = DateUtil.convertDate('yyyy-MM-dd', 'MM/dd/yyyy', '2024-01-15');

      expect(result).toBe('01/15/2024');
    });

    it('should convert date with time', () => {
      const result = DateUtil.convertDate(
        'yyyyMMddHHmmss',
        'yyyy-MM-dd HH:mm:ss',
        '20240115143052'
      );

      expect(result).toBe('2024-01-15 14:30:52');
    });

    it('should convert date and strip time', () => {
      const result = DateUtil.convertDate(
        'yyyyMMddHHmmss',
        'yyyyMMdd',
        '20240115143052'
      );

      expect(result).toBe('20240115');
    });

    it('should convert complex formats', () => {
      const result = DateUtil.convertDate(
        'MM-dd-yyyy',
        'EEEE, MMMM d, yyyy',
        '01-15-2024'
      );

      expect(result).toBe('Monday, January 15, 2024');
    });

    it('should throw error for invalid input date', () => {
      expect(() =>
        DateUtil.convertDate('yyyyMMdd', 'yyyy-MM-dd', 'invalid')
      ).toThrow();
    });

    it('should convert HL7 timestamp format', () => {
      // HL7 often uses yyyyMMddHHmmss.SSS format
      const result = DateUtil.convertDate(
        'yyyyMMddHHmmss',
        'MM/dd/yyyy HH:mm:ss',
        '20240115143052'
      );

      expect(result).toBe('01/15/2024 14:30:52');
    });
  });

  describe('pattern edge cases', () => {
    it('should handle single-digit month and day patterns', () => {
      const date = new Date(2024, 0, 5); // January 5

      const result = DateUtil.formatDate('M/d/yyyy', date);

      expect(result).toBe('1/5/2024');
    });

    it('should handle yy (2-digit year)', () => {
      const result = DateUtil.getDate('yy-MM-dd', '24-01-15');

      expect(result.getFullYear()).toBe(2024);
    });

    it('should handle 24-hour time edge cases', () => {
      const date = new Date(2024, 0, 15, 0, 0, 0);

      const result = DateUtil.formatDate('HH:mm:ss', date);

      expect(result).toBe('00:00:00');
    });

    it('should handle midnight in 12-hour format', () => {
      const date = new Date(2024, 0, 15, 0, 0, 0);

      const result = DateUtil.formatDate('hh:mm:ss a', date);

      expect(result).toContain('12:00:00');
      expect(result.toUpperCase()).toContain('AM');
    });

    it('should handle noon in 12-hour format', () => {
      const date = new Date(2024, 0, 15, 12, 0, 0);

      const result = DateUtil.formatDate('hh:mm:ss a', date);

      expect(result).toContain('12:00:00');
      expect(result.toUpperCase()).toContain('PM');
    });
  });
});
