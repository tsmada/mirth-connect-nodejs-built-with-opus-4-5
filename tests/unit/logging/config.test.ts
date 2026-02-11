import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getLoggingConfig, resetLoggingConfig } from '../../../src/logging/config.js';
import { LogLevel } from '../../../src/plugins/serverlog/ServerLogItem.js';

describe('LoggingConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetLoggingConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetLoggingConfig();
  });

  describe('defaults', () => {
    it('should return INFO as default log level', () => {
      delete process.env['LOG_LEVEL'];
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.INFO);
    });

    it('should return empty debug components by default', () => {
      delete process.env['MIRTH_DEBUG_COMPONENTS'];
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual([]);
    });

    it('should return text as default format', () => {
      delete process.env['LOG_FORMAT'];
      const config = getLoggingConfig();
      expect(config.logFormat).toBe('text');
    });

    it('should return undefined logFile by default', () => {
      delete process.env['LOG_FILE'];
      const config = getLoggingConfig();
      expect(config.logFile).toBeUndefined();
    });

    it('should return mirth as default timestamp format', () => {
      delete process.env['LOG_TIMESTAMP_FORMAT'];
      const config = getLoggingConfig();
      expect(config.timestampFormat).toBe('mirth');
    });
  });

  describe('LOG_LEVEL parsing', () => {
    it('should parse DEBUG level', () => {
      process.env['LOG_LEVEL'] = 'DEBUG';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.DEBUG);
    });

    it('should parse TRACE level', () => {
      process.env['LOG_LEVEL'] = 'TRACE';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.TRACE);
    });

    it('should parse WARN level', () => {
      process.env['LOG_LEVEL'] = 'WARN';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.WARN);
    });

    it('should parse ERROR level', () => {
      process.env['LOG_LEVEL'] = 'ERROR';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.ERROR);
    });

    it('should handle lowercase level', () => {
      process.env['LOG_LEVEL'] = 'debug';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.DEBUG);
    });

    it('should default to INFO for unknown level', () => {
      process.env['LOG_LEVEL'] = 'VERBOSE';
      const config = getLoggingConfig();
      expect(config.logLevel).toBe(LogLevel.INFO);
    });
  });

  describe('MIRTH_DEBUG_COMPONENTS parsing', () => {
    it('should parse single component', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = 'donkey-engine';
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual(['donkey-engine']);
    });

    it('should parse multiple comma-separated components', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = 'donkey-engine,mllp-connector,http-connector';
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual(['donkey-engine', 'mllp-connector', 'http-connector']);
    });

    it('should trim whitespace around component names', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = ' donkey-engine , mllp-connector ';
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual(['donkey-engine', 'mllp-connector']);
    });

    it('should filter empty entries', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = 'donkey-engine,,mllp-connector';
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual(['donkey-engine', 'mllp-connector']);
    });

    it('should return empty array for empty string', () => {
      process.env['MIRTH_DEBUG_COMPONENTS'] = '';
      const config = getLoggingConfig();
      expect(config.debugComponents).toEqual([]);
    });
  });

  describe('LOG_FORMAT parsing', () => {
    it('should accept json format', () => {
      process.env['LOG_FORMAT'] = 'json';
      const config = getLoggingConfig();
      expect(config.logFormat).toBe('json');
    });

    it('should default to text for unknown format', () => {
      process.env['LOG_FORMAT'] = 'yaml';
      const config = getLoggingConfig();
      expect(config.logFormat).toBe('text');
    });
  });

  describe('LOG_FILE parsing', () => {
    it('should set logFile when env var is present', () => {
      process.env['LOG_FILE'] = '/var/log/mirth.log';
      const config = getLoggingConfig();
      expect(config.logFile).toBe('/var/log/mirth.log');
    });

    it('should return undefined for empty LOG_FILE', () => {
      process.env['LOG_FILE'] = '';
      const config = getLoggingConfig();
      expect(config.logFile).toBeUndefined();
    });
  });

  describe('LOG_TIMESTAMP_FORMAT parsing', () => {
    it('should accept iso format', () => {
      process.env['LOG_TIMESTAMP_FORMAT'] = 'iso';
      const config = getLoggingConfig();
      expect(config.timestampFormat).toBe('iso');
    });

    it('should default to mirth for unknown format', () => {
      process.env['LOG_TIMESTAMP_FORMAT'] = 'unix';
      const config = getLoggingConfig();
      expect(config.timestampFormat).toBe('mirth');
    });
  });

  describe('caching', () => {
    it('should return the same config object on repeated calls', () => {
      const config1 = getLoggingConfig();
      const config2 = getLoggingConfig();
      expect(config1).toBe(config2);
    });

    it('should return fresh config after reset', () => {
      process.env['LOG_LEVEL'] = 'DEBUG';
      const config1 = getLoggingConfig();
      expect(config1.logLevel).toBe(LogLevel.DEBUG);

      resetLoggingConfig();
      process.env['LOG_LEVEL'] = 'ERROR';
      const config2 = getLoggingConfig();
      expect(config2.logLevel).toBe(LogLevel.ERROR);
      expect(config1).not.toBe(config2);
    });
  });
});
