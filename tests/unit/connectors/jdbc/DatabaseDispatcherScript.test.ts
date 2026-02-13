/**
 * Tests for DatabaseDispatcher script mode
 *
 * Validates that the JDBC dispatcher's script mode matches Java Mirth's
 * DatabaseDispatcherScript behavior:
 * - Script compilation at deploy time
 * - Script execution with proper scope (maps, logger, status values)
 * - Return value handling (Response, Status, string, undefined)
 * - Error handling (QUEUED status on error)
 * - Scope includes connector message maps and destination context
 */

import { DatabaseDispatcher } from '../../../../src/connectors/jdbc/DatabaseDispatcher';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';

function createMockConnectorMessage(): ConnectorMessage {
  const msg = new ConnectorMessage({
    channelId: 'test-channel-id',
    channelName: 'Test Channel',
    connectorName: 'Database Writer',
    messageId: 1,
    metaDataId: 1,
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
  msg.setRawData('<test>data</test>');
  return msg;
}

describe('DatabaseDispatcher Script Mode', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('script compilation', () => {
    it('should compile script at deploy time', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'return new Response(SENT, "OK");',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      expect((dispatcher as any).compiledScript).toBeUndefined();

      (dispatcher as any).compileScripts();
      expect((dispatcher as any).compiledScript).toBeDefined();
    });

    it('should NOT compile script when useScript is false', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'SQL Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: false,
          query: 'INSERT INTO t (data) VALUES (?)',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (dispatcher as any).compileScripts();
      expect((dispatcher as any).compiledScript).toBeUndefined();
    });

    it('should throw on invalid script syntax', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Bad Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'function{ invalid !!!',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      expect(() => (dispatcher as any).compileScripts()).toThrow();
    });
  });

  describe('script scope for dispatcher', () => {
    it('should build dispatcher scope with connector message', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'return "OK";',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
      };
      (dispatcher as any).channel = mockChannel;

      const connectorMessage = createMockConnectorMessage();
      const scope = (dispatcher as any).buildDispatcherScope(connectorMessage);

      // Core scope variables from Java getMessageDispatcherScope
      expect(scope.logger).toBeDefined();
      expect(scope.globalMap).toBeDefined();
      expect(scope.configurationMap).toBeDefined();
      expect(scope.channelId).toBe('test-channel-id');
      expect(scope.channelName).toBe('Test Channel');

      // Connector message maps
      expect(scope.channelMap).toBeDefined();
      expect(scope.sourceMap).toBeDefined();
      expect(scope.connectorMap).toBeDefined();
      expect(scope.responseMap).toBeDefined();
      expect(scope.$c).toBeDefined();
      expect(scope.$s).toBeDefined();
      expect(scope.$co).toBeDefined();
      expect(scope.$r).toBeDefined();

      // Status values (Java: addStatusValues)
      expect(scope.SENT).toBe(Status.SENT);
      expect(scope.QUEUED).toBe(Status.QUEUED);
      expect(scope.ERROR).toBe(Status.ERROR);

      // Userutil classes available
      expect(scope.DatabaseConnectionFactory).toBeDefined();
      expect(scope.Response).toBeDefined();
    });
  });

  describe('script result handling', () => {
    it('should handle Response return value', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'return new Response(SENT, "Data inserted");',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
      };
      (dispatcher as any).channel = mockChannel;

      (dispatcher as any).compileScripts();
      const connectorMessage = createMockConnectorMessage();

      // Execute the script via the internal method
      const response = (dispatcher as any).executeScriptMode(connectorMessage);

      expect(response).toBeDefined();
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('Data inserted');
    });

    it('should handle string return value', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'return "42 rows affected";',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
      };
      (dispatcher as any).channel = mockChannel;

      (dispatcher as any).compileScripts();
      const connectorMessage = createMockConnectorMessage();

      const response = (dispatcher as any).executeScriptMode(connectorMessage);

      expect(response).toBeDefined();
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toContain('42 rows affected');
    });

    it('should handle undefined return value with default SENT', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'var x = 1;', // No return statement
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
      };
      (dispatcher as any).channel = mockChannel;

      (dispatcher as any).compileScripts();
      const connectorMessage = createMockConnectorMessage();

      const response = (dispatcher as any).executeScriptMode(connectorMessage);

      expect(response).toBeDefined();
      expect(response.getStatus()).toBe(Status.SENT);
    });

    it('should return QUEUED status on script error', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Script Dispatcher',
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'throw new Error("Connection failed");',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
        emit: () => {},
      };
      (dispatcher as any).channel = mockChannel;

      (dispatcher as any).compileScripts();
      const connectorMessage = createMockConnectorMessage();

      const response = (dispatcher as any).executeScriptMode(connectorMessage);

      // Java: on error, returns QUEUED status for retry
      expect(response).toBeDefined();
      expect(response.getStatus()).toBe(Status.QUEUED);
      expect(response.getError()).toBeDefined();
    });
  });

  describe('parameter extraction', () => {
    it('should extract ${variable} placeholders from SQL query', () => {
      const result = DatabaseDispatcher.extractParameters(
        'INSERT INTO t (name, age) VALUES (${name}, ${age})'
      );

      expect(result.query).toBe('INSERT INTO t (name, age) VALUES (?, ?)');
      expect(result.paramNames).toEqual(['${name}', '${age}']);
    });

    it('should handle query with no parameters', () => {
      const result = DatabaseDispatcher.extractParameters(
        'INSERT INTO t (name) VALUES ("static")'
      );

      expect(result.query).toBe('INSERT INTO t (name) VALUES ("static")');
      expect(result.paramNames).toEqual([]);
    });

    it('should handle null/empty query', () => {
      const result = DatabaseDispatcher.extractParameters('');
      expect(result.query).toBe('');
      expect(result.paramNames).toEqual([]);
    });

    it('should extract multiple occurrences of same parameter', () => {
      const result = DatabaseDispatcher.extractParameters(
        'SELECT * FROM t WHERE name = ${name} OR alias = ${name}'
      );

      expect(result.query).toBe('SELECT * FROM t WHERE name = ? OR alias = ?');
      expect(result.paramNames).toEqual(['${name}', '${name}']);
    });

    it('should resolve parameters from connector message maps', () => {
      const connectorMessage = createMockConnectorMessage();
      connectorMessage.getChannelMap().set('patientName', 'John Doe');
      connectorMessage.getChannelMap().set('patientAge', 42);

      const paramNames = ['${patientName}', '${patientAge}'];
      const resolved = DatabaseDispatcher.resolveParameters(
        paramNames,
        connectorMessage
      );

      expect(resolved).toEqual(['John Doe', '42']);
    });
  });
});
