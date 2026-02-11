import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  initializeLogging,
  getLogger,
  setGlobalLevel,
  getGlobalLevel,
  resetLogging,
} from '../../../src/logging/LoggerFactory.js';
import { resetLoggingConfig } from '../../../src/logging/config.js';
import { resetDebugRegistry } from '../../../src/logging/DebugModeRegistry.js';
import { LogLevel } from '../../../src/plugins/serverlog/ServerLogItem.js';

describe('LoggerFactory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetLogging();
    resetLoggingConfig();
    resetDebugRegistry();
  });

  afterEach(() => {
    resetLogging();
    resetLoggingConfig();
    resetDebugRegistry();
    process.env = { ...originalEnv };
  });

  describe('initializeLogging', () => {
    it('should initialize without errors', () => {
      expect(() => initializeLogging()).not.toThrow();
    });

    it('should accept a ServerLogController', () => {
      const mockCtrl = { log: () => {} } as any;
      expect(() => initializeLogging(mockCtrl)).not.toThrow();
    });

    it('should accept null controller', () => {
      expect(() => initializeLogging(null)).not.toThrow();
    });

    it('should respect LOG_LEVEL env var', () => {
      process.env['LOG_LEVEL'] = 'DEBUG';
      resetLoggingConfig();
      initializeLogging();
      expect(getGlobalLevel()).toBe(LogLevel.DEBUG);
    });

    it('should re-initialize cleanly on repeated calls', () => {
      initializeLogging();
      initializeLogging();
      const logger = getLogger('test');
      expect(logger).toBeDefined();
    });
  });

  describe('getLogger', () => {
    it('should return a Logger instance', () => {
      initializeLogging();
      const logger = getLogger('test-component');
      expect(logger).toBeDefined();
      expect(logger.getComponent()).toBe('test-component');
    });

    it('should cache Logger instances by component', () => {
      initializeLogging();
      const logger1 = getLogger('component-a');
      const logger2 = getLogger('component-a');
      expect(logger1).toBe(logger2);
    });

    it('should return different Loggers for different components', () => {
      initializeLogging();
      const logger1 = getLogger('component-a');
      const logger2 = getLogger('component-b');
      expect(logger1).not.toBe(logger2);
    });

    it('should lazy-initialize if called before initializeLogging', () => {
      // Do NOT call initializeLogging first
      const logger = getLogger('lazy-component');
      expect(logger).toBeDefined();
      expect(logger.getComponent()).toBe('lazy-component');
    });

    it('should re-wire cached loggers after re-initialization', () => {
      initializeLogging();
      const loggerBefore = getLogger('rewire-test');
      expect(loggerBefore.getComponent()).toBe('rewire-test');

      // Re-initialize with different config
      const mockCtrl = { log: () => {} } as any;
      initializeLogging(mockCtrl);
      const loggerAfter = getLogger('rewire-test');

      // After re-init, the cached entry is replaced with a new instance
      expect(loggerAfter.getComponent()).toBe('rewire-test');
      expect(loggerAfter).not.toBe(loggerBefore);
    });
  });

  describe('setGlobalLevel / getGlobalLevel', () => {
    it('should default to INFO', () => {
      initializeLogging();
      expect(getGlobalLevel()).toBe(LogLevel.INFO);
    });

    it('should update global level at runtime', () => {
      initializeLogging();
      setGlobalLevel(LogLevel.DEBUG);
      expect(getGlobalLevel()).toBe(LogLevel.DEBUG);
    });

    it('should affect Logger level filtering', () => {
      initializeLogging();
      const logger = getLogger('runtime-level-test');

      // At INFO, debug should be filtered
      setGlobalLevel(LogLevel.INFO);
      expect(logger.isDebugEnabled()).toBe(false);

      // At DEBUG, debug should pass
      setGlobalLevel(LogLevel.DEBUG);
      expect(logger.isDebugEnabled()).toBe(true);
    });

    it('should accept all LogLevel values', () => {
      initializeLogging();
      for (const level of [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]) {
        setGlobalLevel(level);
        expect(getGlobalLevel()).toBe(level);
      }
    });
  });

  describe('resetLogging', () => {
    it('should clear cached loggers', () => {
      initializeLogging();
      const before = getLogger('reset-test');
      resetLogging();
      initializeLogging();
      const after = getLogger('reset-test');
      expect(before).not.toBe(after);
    });

    it('should reset global level to INFO', () => {
      initializeLogging();
      setGlobalLevel(LogLevel.TRACE);
      resetLogging();
      expect(getGlobalLevel()).toBe(LogLevel.INFO);
    });
  });

  describe('environment integration', () => {
    it('should initialize debug components from MIRTH_DEBUG_COMPONENTS', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = 'donkey-engine:TRACE';
      resetLoggingConfig();
      initializeLogging();

      const logger = getLogger('donkey-engine');
      expect(logger.isTraceEnabled()).toBe(true);
    });

    it('should create file transport when LOG_FILE is set', () => {
      process.env['LOG_FILE'] = '/tmp/mirth-test.log';
      resetLoggingConfig();
      // Should not throw even though file may not be writable in test env
      expect(() => initializeLogging()).not.toThrow();
    });
  });
});
