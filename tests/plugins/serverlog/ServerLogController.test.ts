/**
 * Server Log Controller Tests
 */

import {
  ServerLogController,
} from '../../../src/plugins/serverlog/ServerLogController';
import { LogLevel } from '../../../src/plugins/serverlog/ServerLogItem';

describe('ServerLogController', () => {
  let controller: ServerLogController;

  beforeEach(() => {
    controller = new ServerLogController(100);
    controller.setServerId('test-server-1');
  });

  describe('constructor', () => {
    it('should create with default max log size', () => {
      const c = new ServerLogController();
      expect(c.getMaxLogSize()).toBe(100);
    });

    it('should create with custom max log size', () => {
      const c = new ServerLogController(50);
      expect(c.getMaxLogSize()).toBe(50);
    });
  });

  describe('setServerId/getServerId', () => {
    it('should set and get server ID', () => {
      controller.setServerId('new-server');
      expect(controller.getServerId()).toBe('new-server');
    });
  });

  describe('log methods', () => {
    it('should log info message', () => {
      const item = controller.info('Test info message', 'test.category');

      expect(item.level).toBe(LogLevel.INFO);
      expect(item.message).toBe('Test info message');
      expect(item.category).toBe('test.category');
      expect(item.serverId).toBe('test-server-1');
      expect(item.id).toBeGreaterThan(0);
    });

    it('should log warning message', () => {
      const item = controller.warn('Test warning');

      expect(item.level).toBe(LogLevel.WARN);
      expect(item.message).toBe('Test warning');
    });

    it('should log error message with stack trace', () => {
      const error = new Error('Test error');
      const item = controller.error('Error occurred', 'error.category', error);

      expect(item.level).toBe(LogLevel.ERROR);
      expect(item.message).toBe('Error occurred');
      expect(item.throwableInformation).toContain('Test error');
    });

    it('should log debug message', () => {
      const item = controller.debug('Debug info');

      expect(item.level).toBe(LogLevel.DEBUG);
      expect(item.message).toBe('Debug info');
    });
  });

  describe('addLogItem', () => {
    it('should add log item and assign ID', () => {
      const item = controller.addLogItem({
        serverId: null,
        level: LogLevel.INFO,
        date: new Date(),
        threadName: null,
        category: null,
        lineNumber: null,
        message: 'Custom log',
        throwableInformation: null,
      });

      expect(item.id).toBe(1);
      expect(item.serverId).toBe('test-server-1'); // Should use controller's serverId
    });

    it('should enforce max log size', () => {
      const smallController = new ServerLogController(5);

      for (let i = 0; i < 10; i++) {
        smallController.info(`Message ${i}`);
      }

      expect(smallController.getLogCount()).toBe(5);
      // Most recent should be first
      const logs = smallController.getServerLogs(10);
      expect(logs[0]!.message).toBe('Message 9');
    });

    it('should emit log event', (done) => {
      controller.onLog((item) => {
        expect(item.message).toBe('Event test');
        done();
      });

      controller.info('Event test');
    });
  });

  describe('getServerLogs', () => {
    beforeEach(() => {
      controller.info('Message 1');
      controller.info('Message 2');
      controller.info('Message 3');
    });

    it('should return logs in reverse chronological order', () => {
      const logs = controller.getServerLogs(10);

      expect(logs.length).toBe(3);
      expect(logs[0]!.message).toBe('Message 3');
      expect(logs[1]!.message).toBe('Message 2');
      expect(logs[2]!.message).toBe('Message 1');
    });

    it('should respect fetchSize limit', () => {
      const logs = controller.getServerLogs(2);

      expect(logs.length).toBe(2);
      expect(logs[0]!.message).toBe('Message 3');
      expect(logs[1]!.message).toBe('Message 2');
    });

    it('should filter by lastLogId', () => {
      const allLogs = controller.getServerLogs(10);
      const firstLogId = allLogs[2]!.id; // Message 1's ID

      const newLogs = controller.getServerLogs(10, firstLogId);

      expect(newLogs.length).toBe(2);
      expect(newLogs[0]!.message).toBe('Message 3');
      expect(newLogs[1]!.message).toBe('Message 2');
    });
  });

  describe('getFilteredLogs', () => {
    beforeEach(() => {
      controller.debug('Debug message', 'app.debug');
      controller.info('Info message', 'app.core');
      controller.warn('Warning message', 'app.security');
      controller.error('Error message', 'app.core');
    });

    it('should filter by log level', () => {
      const logs = controller.getFilteredLogs(10, { level: LogLevel.WARN });

      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.level === LogLevel.WARN || l.level === LogLevel.ERROR)).toBe(true);
    });

    it('should filter by category', () => {
      const logs = controller.getFilteredLogs(10, { category: 'core' });

      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.category?.includes('core'))).toBe(true);
    });

    it('should combine filters', () => {
      const logs = controller.getFilteredLogs(10, {
        level: LogLevel.WARN,
        category: 'core',
      });

      expect(logs.length).toBe(1);
      expect(logs[0]!.message).toBe('Error message');
    });

    it('should filter by afterId', () => {
      const allLogs = controller.getServerLogs(10);
      const secondLogId = allLogs[2]!.id;

      const logs = controller.getFilteredLogs(10, { afterId: secondLogId });

      expect(logs.length).toBe(2);
    });
  });

  describe('clearLogs', () => {
    it('should clear all logs', () => {
      controller.info('Message 1');
      controller.info('Message 2');
      expect(controller.getLogCount()).toBe(2);

      controller.clearLogs();

      expect(controller.getLogCount()).toBe(0);
      expect(controller.getServerLogs(10)).toEqual([]);
    });

    it('should emit clear event', (done) => {
      controller.onClear(() => {
        done();
      });

      controller.clearLogs();
    });
  });

  describe('getLatestLogId', () => {
    it('should return null for empty logs', () => {
      expect(controller.getLatestLogId()).toBeNull();
    });

    it('should return the most recent log ID', () => {
      controller.info('Message 1');
      const id1 = controller.getLatestLogId();

      controller.info('Message 2');
      const id2 = controller.getLatestLogId();

      expect(id2).toBeGreaterThan(id1!);
    });
  });

  describe('setMaxLogSize', () => {
    it('should update max log size', () => {
      controller.setMaxLogSize(50);
      expect(controller.getMaxLogSize()).toBe(50);
    });

    it('should trim logs if new size is smaller', () => {
      for (let i = 0; i < 20; i++) {
        controller.info(`Message ${i}`);
      }

      expect(controller.getLogCount()).toBe(20);

      controller.setMaxLogSize(10);

      expect(controller.getLogCount()).toBe(10);
      expect(controller.getMaxLogSize()).toBe(10);
    });
  });

  describe('getSerializableLogs', () => {
    it('should return serializable format', () => {
      controller.info('Test message', 'test.category');

      const logs = controller.getSerializableLogs(10);

      expect(logs.length).toBe(1);
      expect(logs[0]!.message).toBe('Test message');
      expect(typeof logs[0]!.date).toBe('string'); // ISO string
      expect(logs[0]!.level).toBe('INFO');
    });
  });

  describe('event listeners', () => {
    it('should add and remove log listeners', () => {
      let called = false;
      const listener = () => {
        called = true;
      };

      controller.onLog(listener);
      controller.info('Test');
      expect(called).toBe(true);

      called = false;
      controller.offLog(listener);
      controller.info('Test 2');
      expect(called).toBe(false);
    });
  });
});
