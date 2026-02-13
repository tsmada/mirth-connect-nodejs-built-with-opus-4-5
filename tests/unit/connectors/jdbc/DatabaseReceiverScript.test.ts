/**
 * Tests for DatabaseReceiver script mode
 *
 * Validates that the JDBC receiver's script mode matches Java Mirth's
 * DatabaseReceiverScript behavior:
 * - Script compilation and caching at deploy time
 * - Scope injection (maps, logger, DatabaseConnectionFactory)
 * - Poll cycle branching (SQL vs script mode)
 * - Post-process update script with resultMap/results injection
 * - Update mode variants (NEVER, ONCE, EACH)
 */

import { DatabaseReceiver } from '../../../../src/connectors/jdbc/DatabaseReceiver';
import { UpdateMode } from '../../../../src/connectors/jdbc/DatabaseConnectorProperties';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

describe('DatabaseReceiver Script Mode', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('script compilation', () => {
    it('should store compiled select script at deploy time', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'var result = []; result.push({id: 1, name: "test"}); return result;',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      // Before deploy, compiled script should not exist
      expect((receiver as any).compiledSelectScript).toBeUndefined();

      // After compileScripts(), the select script should be cached
      (receiver as any).compileScripts();
      expect((receiver as any).compiledSelectScript).toBeDefined();
    });

    it('should compile update script when updateMode is not NEVER', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'dbConn.executeUpdate("UPDATE t SET processed=1");',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();
      expect((receiver as any).compiledSelectScript).toBeDefined();
      expect((receiver as any).compiledUpdateScript).toBeDefined();
    });

    it('should NOT compile update script when updateMode is NEVER', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'dbConn.executeUpdate("UPDATE t SET processed=1");',
          updateMode: UpdateMode.NEVER,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();
      expect((receiver as any).compiledSelectScript).toBeDefined();
      expect((receiver as any).compiledUpdateScript).toBeUndefined();
    });

    it('should throw on invalid select script', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'function{ invalid syntax!!!',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      expect(() => (receiver as any).compileScripts()).toThrow();
    });
  });

  describe('script scope injection', () => {
    it('should build receiver scope with maps and logger', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'return [];',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      // Set up channel context (normally done by ChannelBuilder)
      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
        dispatchRawMessage: jest.fn(),
      };
      (receiver as any).channel = mockChannel;

      const scope = (receiver as any).buildReceiverScope();

      // Core variables from Java getMessageReceiverScope → getBasicScope
      expect(scope.logger).toBeDefined();
      expect(scope.globalMap).toBeDefined();
      expect(scope.configurationMap).toBeDefined();
      expect(scope.$g).toBeDefined();
      expect(scope.$cfg).toBeDefined();
      expect(scope.channelId).toBe('test-channel-id');
      expect(scope.channelName).toBe('Test Channel');

      // Userutil classes available for script use
      expect(scope.DatabaseConnectionFactory).toBeDefined();
      expect(scope.DatabaseConnection).toBeDefined();
    });

    it('should build update scope with resultMap when provided', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
        dispatchRawMessage: jest.fn(),
      };
      (receiver as any).channel = mockChannel;

      const resultMap = { id: 1, name: 'test' };
      const scope = (receiver as any).buildUpdateScope(resultMap, null, null);

      // resultMap should be injected (Java: scope.put("resultMap", ...))
      expect(scope.resultMap).toBeDefined();
      expect(scope.resultMap).toEqual(resultMap);
    });

    it('should build update scope with results list when provided', () => {
      const receiver = new DatabaseReceiver({
        name: 'Script Receiver',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.ONCE,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
        dispatchRawMessage: jest.fn(),
      };
      (receiver as any).channel = mockChannel;

      const resultsList = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ];
      const scope = (receiver as any).buildUpdateScope(null, resultsList, null);

      // results list should be injected (Java: scope.put("results", ...))
      expect(scope.results).toBeDefined();
      expect(scope.results).toEqual(resultsList);
    });
  });

  describe('properties', () => {
    it('should reflect useScript in properties', () => {
      const receiver = new DatabaseReceiver({
        properties: {
          useScript: true,
          select: 'return dbConn.executeCachedQuery("SELECT * FROM t");',
        },
      });

      expect(receiver.getProperties().useScript).toBe(true);
    });

    it('should default useScript to false', () => {
      const receiver = new DatabaseReceiver({});
      expect(receiver.getProperties().useScript).toBe(false);
    });
  });
});
