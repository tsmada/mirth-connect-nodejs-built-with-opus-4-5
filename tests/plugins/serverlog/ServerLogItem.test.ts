/**
 * Server Log Item Tests
 */

import {
  LogLevel,
  createServerLogItem,
  createSimpleLogItem,
  serializeServerLogItem,
  formatServerLogItem,
  parseLogLevel,
  shouldDisplayLogLevel,
} from '../../../src/plugins/serverlog/ServerLogItem';

describe('ServerLogItem', () => {
  describe('createServerLogItem', () => {
    it('should create a log item with all fields', () => {
      const date = new Date('2026-01-15T10:30:00.123Z');
      const item = createServerLogItem(1, 'Test message', {
        serverId: 'server-1',
        level: LogLevel.ERROR,
        date,
        threadName: 'main',
        category: 'com.test.MyClass',
        lineNumber: '42',
        throwableInformation: 'Stack trace here',
      });

      expect(item.id).toBe(1);
      expect(item.message).toBe('Test message');
      expect(item.serverId).toBe('server-1');
      expect(item.level).toBe(LogLevel.ERROR);
      expect(item.date).toBe(date);
      expect(item.threadName).toBe('main');
      expect(item.category).toBe('com.test.MyClass');
      expect(item.lineNumber).toBe('42');
      expect(item.throwableInformation).toBe('Stack trace here');
    });

    it('should create a log item with defaults', () => {
      const item = createServerLogItem(2, 'Simple message');

      expect(item.id).toBe(2);
      expect(item.message).toBe('Simple message');
      expect(item.serverId).toBeNull();
      expect(item.level).toBe(LogLevel.INFO);
      expect(item.date).toBeInstanceOf(Date);
      expect(item.threadName).toBeNull();
      expect(item.category).toBeNull();
      expect(item.lineNumber).toBeNull();
      expect(item.throwableInformation).toBeNull();
    });
  });

  describe('createSimpleLogItem', () => {
    it('should create a simple message-only log item', () => {
      const item = createSimpleLogItem('Hello world');

      expect(item.id).toBe(0);
      expect(item.message).toBe('Hello world');
      expect(item.level).toBe(LogLevel.INFO);
    });
  });

  describe('serializeServerLogItem', () => {
    it('should convert to serializable format', () => {
      const date = new Date('2026-01-15T10:30:00.123Z');
      const item = createServerLogItem(1, 'Test', {
        serverId: 'server-1',
        level: LogLevel.WARN,
        date,
        category: 'test.Category',
      });

      const serialized = serializeServerLogItem(item);

      expect(serialized.id).toBe(1);
      expect(serialized.message).toBe('Test');
      expect(serialized.level).toBe('WARN');
      expect(serialized.date).toBe('2026-01-15T10:30:00.123Z');
      expect(serialized.serverId).toBe('server-1');
      expect(serialized.category).toBe('test.Category');
    });
  });

  describe('formatServerLogItem', () => {
    it('should format a simple message item', () => {
      const item = createSimpleLogItem('Simple message');
      expect(formatServerLogItem(item)).toBe('Simple message');
    });

    it('should format a full log item', () => {
      const date = new Date('2026-01-15T10:30:00.123Z');
      const item = createServerLogItem(1, 'Error occurred', {
        level: LogLevel.ERROR,
        date,
        category: 'com.test.MyClass',
        lineNumber: '42',
      });

      const formatted = formatServerLogItem(item);
      expect(formatted).toContain('ERROR');
      expect(formatted).toContain('com.test.MyClass:42');
      expect(formatted).toContain('Error occurred');
    });

    it('should include throwable information', () => {
      const item = createServerLogItem(1, 'Error', {
        level: LogLevel.ERROR,
        throwableInformation: 'at com.test.Main.run(Main.java:10)',
      });

      const formatted = formatServerLogItem(item);
      expect(formatted).toContain('at com.test.Main.run(Main.java:10)');
    });
  });

  describe('parseLogLevel', () => {
    it('should parse valid log levels', () => {
      expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('INFO')).toBe(LogLevel.INFO);
      expect(parseLogLevel('WARN')).toBe(LogLevel.WARN);
      expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR);
      expect(parseLogLevel('TRACE')).toBe(LogLevel.TRACE);
    });

    it('should handle case-insensitive input', () => {
      expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG);
      expect(parseLogLevel('Info')).toBe(LogLevel.INFO);
      expect(parseLogLevel('WARNING')).toBe(LogLevel.WARN);
    });

    it('should default to INFO for unknown levels', () => {
      expect(parseLogLevel('UNKNOWN')).toBe(LogLevel.INFO);
      expect(parseLogLevel('')).toBe(LogLevel.INFO);
    });
  });

  describe('shouldDisplayLogLevel', () => {
    it('should filter correctly with DEBUG filter', () => {
      expect(shouldDisplayLogLevel(LogLevel.DEBUG, LogLevel.DEBUG)).toBe(true);
      expect(shouldDisplayLogLevel(LogLevel.INFO, LogLevel.DEBUG)).toBe(true);
      expect(shouldDisplayLogLevel(LogLevel.WARN, LogLevel.DEBUG)).toBe(true);
      expect(shouldDisplayLogLevel(LogLevel.ERROR, LogLevel.DEBUG)).toBe(true);
    });

    it('should filter correctly with WARN filter', () => {
      expect(shouldDisplayLogLevel(LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      expect(shouldDisplayLogLevel(LogLevel.INFO, LogLevel.WARN)).toBe(false);
      expect(shouldDisplayLogLevel(LogLevel.WARN, LogLevel.WARN)).toBe(true);
      expect(shouldDisplayLogLevel(LogLevel.ERROR, LogLevel.WARN)).toBe(true);
    });

    it('should filter correctly with ERROR filter', () => {
      expect(shouldDisplayLogLevel(LogLevel.DEBUG, LogLevel.ERROR)).toBe(false);
      expect(shouldDisplayLogLevel(LogLevel.INFO, LogLevel.ERROR)).toBe(false);
      expect(shouldDisplayLogLevel(LogLevel.WARN, LogLevel.ERROR)).toBe(false);
      expect(shouldDisplayLogLevel(LogLevel.ERROR, LogLevel.ERROR)).toBe(true);
    });
  });
});
