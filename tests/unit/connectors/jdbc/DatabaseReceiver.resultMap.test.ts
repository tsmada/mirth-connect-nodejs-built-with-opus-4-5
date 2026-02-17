/**
 * Tests for JRC-SVM-006: resultMap injection in Database Reader update scripts
 *
 * Validates that the Database Reader's update scripts receive:
 * 1. resultMap — the current database row as a Record<string, unknown>
 * 2. results — the aggregated results list (for aggregate mode)
 * 3. mergedConnectorMessage — the processed message with all connector maps merged
 *
 * Java behavior (DatabaseReceiverScript.UpdateTask.doCall()):
 * - scope includes resultMap when processing individual rows (UPDATE_EACH)
 * - scope includes results list when processing aggregated rows (UPDATE_ONCE with aggregate)
 * - scope includes mergedConnectorMessage from dispatchResult.getProcessedMessage()
 * - $c(), $s(), $r() work in update scripts via mergedConnectorMessage maps
 */

import { DatabaseReceiver } from '../../../../src/connectors/jdbc/DatabaseReceiver';
import { UpdateMode } from '../../../../src/connectors/jdbc/DatabaseConnectorProperties';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message } from '../../../../src/model/Message';
import { Status } from '../../../../src/model/Status';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

/**
 * Helper to create a mock channel that returns a processed Message
 * from dispatchRawMessage, matching Java's DispatchResult behavior.
 */
function createMockChannelWithMessage(
  channelId = 'test-channel-id',
  channelName = 'Test Channel'
): {
  channel: Record<string, unknown>;
  getDispatchedMessages: () => Array<{ xml: string; sourceMap?: Map<string, unknown> }>;
} {
  const dispatched: Array<{ xml: string; sourceMap?: Map<string, unknown> }> = [];

  const channel = {
    getId: () => channelId,
    getName: () => channelName,
    emit: jest.fn(),
    dispatchRawMessage: jest.fn(async (xml: string, sourceMap?: Map<string, unknown>) => {
      dispatched.push({ xml, sourceMap });

      // Build a Message with source connector message (matching Channel.dispatchRawMessage)
      const message = new Message({
        messageId: dispatched.length,
        serverId: 'test-server',
        channelId,
        receivedDate: new Date(),
        processed: true,
      });

      const sourceMessage = new ConnectorMessage({
        messageId: dispatched.length,
        metaDataId: 0,
        channelId,
        channelName,
        connectorName: 'Source',
        serverId: 'test-server',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });

      // Simulate channel map being populated by transformer
      sourceMessage.getChannelMap().set('transformerVar', 'transformerValue');

      // Simulate source map
      sourceMessage.getSourceMap().set('sourceKey', 'sourceValue');

      message.setConnectorMessage(0, sourceMessage);

      // Add a destination connector message to enable mergedConnectorMessage
      const destMessage = new ConnectorMessage({
        messageId: dispatched.length,
        metaDataId: 1,
        channelId,
        channelName,
        connectorName: 'HTTP Sender',
        serverId: 'test-server',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      destMessage.getResponseMap().set('d1', { status: 'SENT', message: 'OK' });

      message.setConnectorMessage(1, destMessage);

      return message;
    }),
  };

  return {
    channel,
    getDispatchedMessages: () => dispatched,
  };
}

describe('DatabaseReceiver resultMap injection (JRC-SVM-006)', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('buildUpdateScope injects resultMap and maps', () => {
    it('should inject resultMap with column values into update scope', () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const resultMap = { patient_id: 12345, name: 'John Doe', status: 'active' };
      const scope = (receiver as any).buildUpdateScope(resultMap, null, null);

      // resultMap should be injected (Java: scope.put("resultMap", scope, Context.javaToJS(resultMap, scope)))
      expect(scope.resultMap).toBeDefined();
      expect(scope.resultMap.patient_id).toBe(12345);
      expect(scope.resultMap.name).toBe('John Doe');
      expect(scope.resultMap.status).toBe('active');
    });

    it('should inject results list for aggregate mode', () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.ONCE,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const resultsList = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];
      const scope = (receiver as any).buildUpdateScope(null, resultsList, null);

      // results should be injected (Java: scope.put("results", scope, Context.javaToJS(resultsList, scope)))
      expect(scope.results).toBeDefined();
      expect(scope.results).toHaveLength(3);
      expect(scope.results[0].name).toBe('Alice');
      expect(scope.results[2].name).toBe('Charlie');
    });

    it('should inject mergedConnectorMessage maps when provided', () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      // Create a mergedConnectorMessage with maps
      const merged = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'ch-1',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'srv-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      merged.getChannelMap().set('testKey', 'testValue');
      merged.getSourceMap().set('sourceKey', 'sourceValue');
      merged.getResponseMap().set('d1', { status: 'SENT' });

      const resultMap = { id: 1 };
      const scope = (receiver as any).buildUpdateScope(resultMap, null, merged);

      // Both resultMap AND connector message maps should be available
      expect(scope.resultMap).toEqual({ id: 1 });
      expect(scope.channelMap).toBeDefined();
      expect(scope.sourceMap).toBeDefined();
      expect(scope.responseMap).toBeDefined();
    });

    it('should handle null resultMap and null results gracefully', () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.ONCE,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      // Java afterPoll: scope with no resultMap, no results, no mergedConnectorMessage
      const scope = (receiver as any).buildUpdateScope(null, null, null);

      expect(scope.resultMap).toBeUndefined();
      expect(scope.results).toBeUndefined();
      // Basic scope variables should still be present
      expect(scope.logger).toBeDefined();
      expect(scope.globalMap).toBeDefined();
    });

    it('should support various column types (string, number, null, Date)', () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'return;',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const now = new Date();
      const resultMap = {
        string_col: 'hello',
        number_col: 42,
        float_col: 3.14,
        null_col: null,
        date_col: now,
        bool_col: true,
      };
      const scope = (receiver as any).buildUpdateScope(resultMap, null, null);

      expect(scope.resultMap.string_col).toBe('hello');
      expect(scope.resultMap.number_col).toBe(42);
      expect(scope.resultMap.float_col).toBe(3.14);
      expect(scope.resultMap.null_col).toBeNull();
      expect(scope.resultMap.date_col).toBe(now);
      expect(scope.resultMap.bool_col).toBe(true);
    });
  });

  describe('update script execution with resultMap', () => {
    it('should execute update script with resultMap accessible', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1, name: "test"}];',
          update: 'globalMap.put("lastId", resultMap.id); globalMap.put("lastName", resultMap.name);',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      // Run the update script directly
      const resultMap = { id: 42, name: 'John' };
      await (receiver as any).runUpdateScript(resultMap, null, null);

      // The update script should have been able to access resultMap.id and resultMap.name
      expect(GlobalMap.getInstance().get('lastId')).toBe(42);
      expect(GlobalMap.getInstance().get('lastName')).toBe('John');
    });

    it('should execute update script with results list accessible', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'globalMap.put("count", results.length);',
          updateMode: UpdateMode.ONCE,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const resultsList = [{ id: 1 }, { id: 2 }, { id: 3 }];
      await (receiver as any).runUpdateScript(null, resultsList, null);

      expect(GlobalMap.getInstance().get('count')).toBe(3);
    });

    it('should execute update script with connector message maps (via mergedConnectorMessage)', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [];',
          update: 'globalMap.put("gotChannelMap", channelMap.containsKey("testKey"));',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const merged = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'ch-1',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'srv-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      merged.getChannelMap().set('testKey', 'testValue');

      await (receiver as any).runUpdateScript({ id: 1 }, null, merged);

      expect(GlobalMap.getInstance().get('gotChannelMap')).toBe(true);
    });
  });

  describe('SourceConnector.dispatchRawMessage returns Message', () => {
    it('should return Message from dispatchRawMessage for update script consumption', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1}];',
          update: 'return;',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      // Call dispatchRawMessage through the protected method
      const result = await (receiver as any).dispatchRawMessage('<result><id>1</id></result>');

      // Should return a Message object (not void/undefined)
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Message);
      expect(result.getMessageId()).toBe(1);
    });

    it('should provide mergedConnectorMessage with destination maps', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1}];',
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      const result = await (receiver as any).dispatchRawMessage('<result><id>1</id></result>');
      const merged = result.getMergedConnectorMessage();

      // mergedConnectorMessage should include destination connector maps
      expect(merged).toBeDefined();
      expect(merged.getResponseMap().has('d1')).toBe(true);
      expect(merged.getChannelMap().has('transformerVar')).toBe(true);
    });
  });

  describe('executeScript passes mergedConnectorMessage to update scripts', () => {
    it('should pass mergedConnectorMessage to per-row update (UPDATE_EACH)', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1, name: "test"}];',
          update: 'globalMap.put("hasMergedMaps", typeof channelMap !== "undefined");',
          updateMode: UpdateMode.EACH,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      // Execute the full script mode flow
      await (receiver as any).executeScript(null);

      // The update script should have received the mergedConnectorMessage
      // which provides channelMap in the scope
      expect(GlobalMap.getInstance().get('hasMergedMaps')).toBe(true);
    });

    it('should pass mergedConnectorMessage to aggregate update', async () => {
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1}, {id: 2}];',
          update: 'globalMap.put("resultsCount", results.length); globalMap.put("hasMaps", typeof channelMap !== "undefined");',
          updateMode: UpdateMode.ONCE,
          aggregateResults: true,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      await (receiver as any).executeScript(null);

      // Aggregate update should have received results AND mergedConnectorMessage
      expect(GlobalMap.getInstance().get('resultsCount')).toBe(2);
      expect(GlobalMap.getInstance().get('hasMaps')).toBe(true);
    });

    it('should pass null mergedConnectorMessage for afterPoll (UPDATE_ONCE, non-aggregate)', async () => {
      // For afterPoll (UPDATE_ONCE without aggregateResults), Java passes null
      // for both resultMap and mergedConnectorMessage
      const receiver = new DatabaseReceiver({
        name: 'DB Reader',
        properties: {
          useScript: true,
          select: 'return [{id: 1}];',
          update: 'globalMap.put("afterPollRan", true); globalMap.put("hasResultMap", typeof resultMap !== "undefined");',
          updateMode: UpdateMode.ONCE,
          aggregateResults: false,
          url: 'jdbc:mysql://localhost:3306/testdb',
        },
      });

      (receiver as any).compileScripts();

      const { channel } = createMockChannelWithMessage();
      (receiver as any).channel = channel;

      await (receiver as any).executeScript(null);

      // afterPoll update runs without resultMap or mergedConnectorMessage
      expect(GlobalMap.getInstance().get('afterPollRan')).toBe(true);
      expect(GlobalMap.getInstance().get('hasResultMap')).toBe(false);
    });
  });
});
