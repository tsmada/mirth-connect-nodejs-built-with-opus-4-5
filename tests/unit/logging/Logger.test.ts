import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import winston from 'winston';
import { Logger, setGlobalLevelProvider } from '../../../src/logging/Logger.js';
import { LogLevel } from '../../../src/plugins/serverlog/ServerLogItem.js';
import { resetDebugRegistry, setComponentLevel } from '../../../src/logging/DebugModeRegistry.js';

// Create a mock ServerLogController
function createMockServerLogController() {
  return {
    log: jest.fn(),
  };
}

// Create a silent winston logger that captures calls
function createTestWinston() {
  const calls: Array<{ level: string; message: string; meta: Record<string, unknown> }> = [];
  const logger = winston.createLogger({
    levels: { error: 0, warn: 1, info: 2, debug: 3, trace: 4 },
    level: 'trace', // Accept all levels — filtering is done in Logger
    transports: [
      new winston.transports.Console({
        silent: true, // Don't actually output
      }),
    ],
  });

  // Intercept log calls
  const originalLog = logger.log.bind(logger);
  logger.log = ((level: string, message: string, ...rest: unknown[]) => {
    const meta = (rest[0] as Record<string, unknown>) ?? {};
    calls.push({ level, message, meta });
    return originalLog(level, message, ...rest);
  }) as typeof logger.log;

  return { logger, calls };
}

describe('Logger', () => {
  let globalLevel: LogLevel;

  beforeEach(() => {
    resetDebugRegistry();
    globalLevel = LogLevel.INFO;
    setGlobalLevelProvider(() => globalLevel);
  });

  describe('basic logging', () => {
    it('should log info messages', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test-component', winstonLogger);

      log.info('Hello world');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.level).toBe('info');
      expect(calls[0]!.message).toBe('Hello world');
      expect(calls[0]!.meta['component']).toBe('test-component');
    });

    it('should log warn messages', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.warn('Something concerning');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.level).toBe('warn');
      expect(calls[0]!.message).toBe('Something concerning');
    });

    it('should log error messages', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.error('Something broke');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.level).toBe('error');
    });

    it('should log error with Error object', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      const err = new Error('test error');

      log.error('Operation failed', err);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.meta['errorStack']).toContain('test error');
    });

    it('should include metadata in log calls', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.info('Processing', { channelId: 'abc-123', count: 5 });

      expect(calls[0]!.meta['channelId']).toBe('abc-123');
      expect(calls[0]!.meta['count']).toBe(5);
      expect(calls[0]!.meta['component']).toBe('test');
    });
  });

  describe('level filtering', () => {
    it('should not log DEBUG when global level is INFO', () => {
      globalLevel = LogLevel.INFO;
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.debug('Debug message');

      expect(calls).toHaveLength(0);
    });

    it('should not log TRACE when global level is INFO', () => {
      globalLevel = LogLevel.INFO;
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.trace('Trace message');

      expect(calls).toHaveLength(0);
    });

    it('should log DEBUG when global level is DEBUG', () => {
      globalLevel = LogLevel.DEBUG;
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.debug('Debug message');

      expect(calls).toHaveLength(1);
    });

    it('should log TRACE when global level is TRACE', () => {
      globalLevel = LogLevel.TRACE;
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.trace('Trace message');

      expect(calls).toHaveLength(1);
    });

    it('should only log ERROR when global level is ERROR', () => {
      globalLevel = LogLevel.ERROR;
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger);

      log.trace('nope');
      log.debug('nope');
      log.info('nope');
      log.warn('nope');
      log.error('yes');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.level).toBe('error');
    });
  });

  describe('component-level overrides', () => {
    it('should allow DEBUG for component with DEBUG override even when global is INFO', () => {
      globalLevel = LogLevel.INFO;
      setComponentLevel('special', LogLevel.DEBUG);
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('special', winstonLogger);

      log.debug('Debug from overridden component');

      expect(calls).toHaveLength(1);
    });

    it('should still filter TRACE for component with DEBUG override', () => {
      globalLevel = LogLevel.INFO;
      setComponentLevel('special', LogLevel.DEBUG);
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('special', winstonLogger);

      log.trace('Should not appear');

      expect(calls).toHaveLength(0);
    });

    it('should restrict logging when component override is stricter than global', () => {
      globalLevel = LogLevel.DEBUG;
      setComponentLevel('noisy', LogLevel.ERROR);
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('noisy', winstonLogger);

      log.debug('filtered');
      log.info('filtered');
      log.warn('filtered');
      log.error('visible');

      expect(calls).toHaveLength(1);
    });
  });

  describe('ServerLogController integration', () => {
    it('should write to ServerLogController when provided', () => {
      const mockCtrl = createMockServerLogController();
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger, mockCtrl as any);

      log.info('Hello from logger');

      expect(mockCtrl.log).toHaveBeenCalledWith(
        LogLevel.INFO,
        'Hello from logger',
        { category: 'test', throwableInformation: undefined }
      );
    });

    it('should pass error stack to ServerLogController', () => {
      const mockCtrl = createMockServerLogController();
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger, mockCtrl as any);
      const err = new Error('boom');

      log.error('Failed', err);

      expect(mockCtrl.log).toHaveBeenCalledWith(
        LogLevel.ERROR,
        'Failed',
        expect.objectContaining({
          category: 'test',
          throwableInformation: expect.stringContaining('boom'),
        })
      );
    });

    it('should not write to ServerLogController when level is filtered', () => {
      globalLevel = LogLevel.INFO;
      const mockCtrl = createMockServerLogController();
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger, mockCtrl as any);

      log.debug('Should not reach controller');

      expect(mockCtrl.log).not.toHaveBeenCalled();
    });

    it('should work without ServerLogController', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const log = new Logger('test', winstonLogger, null);

      log.info('No controller');

      expect(calls).toHaveLength(1);
    });
  });

  describe('isDebugEnabled / isTraceEnabled', () => {
    it('should return false for isDebugEnabled when global is INFO', () => {
      globalLevel = LogLevel.INFO;
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      expect(log.isDebugEnabled()).toBe(false);
    });

    it('should return true for isDebugEnabled when global is DEBUG', () => {
      globalLevel = LogLevel.DEBUG;
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      expect(log.isDebugEnabled()).toBe(true);
    });

    it('should return true for isDebugEnabled with component override', () => {
      globalLevel = LogLevel.INFO;
      setComponentLevel('test', LogLevel.DEBUG);
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      expect(log.isDebugEnabled()).toBe(true);
    });

    it('should return false for isTraceEnabled when global is INFO', () => {
      globalLevel = LogLevel.INFO;
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      expect(log.isTraceEnabled()).toBe(false);
    });

    it('should return true for isTraceEnabled when global is TRACE', () => {
      globalLevel = LogLevel.TRACE;
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('test', winstonLogger);
      expect(log.isTraceEnabled()).toBe(true);
    });
  });

  describe('child loggers', () => {
    it('should create child with combined component name', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const parent = new Logger('mllp-connector', winstonLogger);
      const child = parent.child('parser');

      child.info('Parsing message');

      expect(calls[0]!.meta['component']).toBe('mllp-connector.parser');
    });

    it('should share the same winston logger', () => {
      const { logger: winstonLogger, calls } = createTestWinston();
      const parent = new Logger('engine', winstonLogger);
      const child = parent.child('queue');

      parent.info('Parent log');
      child.info('Child log');

      expect(calls).toHaveLength(2);
    });

    it('should use child component name for level checks', () => {
      globalLevel = LogLevel.INFO;
      setComponentLevel('engine.queue', LogLevel.DEBUG);
      const { logger: winstonLogger, calls } = createTestWinston();
      const parent = new Logger('engine', winstonLogger);
      const child = parent.child('queue');

      parent.debug('Filtered by global');
      child.debug('Allowed by override');

      expect(calls).toHaveLength(1);
      expect(calls[0]!.meta['component']).toBe('engine.queue');
    });
  });

  describe('getComponent', () => {
    it('should return the component name', () => {
      const { logger: winstonLogger } = createTestWinston();
      const log = new Logger('my-component', winstonLogger);
      expect(log.getComponent()).toBe('my-component');
    });
  });
});
