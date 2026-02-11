/**
 * Wave 12 parity tests for ScopeBuilder — postprocessor merged maps, AlertSender context
 */
import {
  buildConnectorMessageScope,
  buildPostprocessorScope,
  ScriptContext,
} from '../../../src/javascript/runtime/ScopeBuilder';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Status } from '../../../src/model/Status';
import { Response } from '../../../src/model/Response';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
  ResponseMap,
} from '../../../src/javascript/userutil/MirthMap';
import { AlertSender } from '../../../src/javascript/userutil/AlertSender';

const testContext: ScriptContext = {
  channelId: 'ch-001',
  channelName: 'Test Channel',
  connectorName: 'Source',
  metaDataId: 0,
};

function createConnectorMessage(
  metaDataId: number,
  connectorName: string,
  status: Status = Status.SENT
): ConnectorMessage {
  return new ConnectorMessage({
    messageId: 1,
    metaDataId,
    channelId: 'ch-001',
    channelName: 'Test Channel',
    connectorName,
    serverId: 'server-1',
    receivedDate: new Date(),
    status,
  });
}

describe('ScopeBuilder Wave 12 Parity Fixes', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
  });

  describe('JRC-SBD-008 — getMergedConnectorMessage in postprocessor', () => {
    it('should merge channelMap from source + all destinations', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });

      const source = createConnectorMessage(0, 'Source');
      source.getChannelMap().set('sourceKey', 'sourceValue');
      source.getChannelMap().set('shared', 'fromSource');

      const dest1 = createConnectorMessage(1, 'HTTP Sender');
      dest1.getChannelMap().set('dest1Key', 'dest1Value');
      dest1.getChannelMap().set('shared', 'fromDest1');

      const dest2 = createConnectorMessage(2, 'File Writer');
      dest2.getChannelMap().set('dest2Key', 'dest2Value');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const scope = buildPostprocessorScope(testContext, message);

      // Channel map should have all keys, with later destinations overwriting earlier
      expect((scope.channelMap as any).get('sourceKey')).toBe('sourceValue');
      expect((scope.channelMap as any).get('dest1Key')).toBe('dest1Value');
      expect((scope.channelMap as any).get('dest2Key')).toBe('dest2Value');
      expect((scope.channelMap as any).get('shared')).toBe('fromDest1');
    });

    it('should merge responseMap from source + all destinations', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });

      const source = createConnectorMessage(0, 'Source');
      source.getResponseMap().set('Source', 'ack-response');

      const dest1 = createConnectorMessage(1, 'HTTP Sender');
      dest1.getResponseMap().set('d1', 'http-response');

      const dest2 = createConnectorMessage(2, 'File Writer');
      dest2.getResponseMap().set('d2', 'file-response');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const scope = buildPostprocessorScope(testContext, message);
      const responseMap = scope.responseMap as ResponseMap;

      // Response map should have all responses merged
      expect(responseMap.get('Source')).toBe('ack-response');
      expect(responseMap.get('d1')).toBe('http-response');
      expect(responseMap.get('d2')).toBe('file-response');
    });

    it('should enable $r("Destination Name") lookups via destinationIdMap', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });

      const source = createConnectorMessage(0, 'Source');
      const dest1 = createConnectorMessage(1, 'HTTP Sender');
      dest1.getResponseMap().set('d1', 'http-response-data');

      const dest2 = createConnectorMessage(2, 'File Writer');
      dest2.getResponseMap().set('d2', 'file-response-data');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const scope = buildPostprocessorScope(testContext, message);
      const responseMap = scope.responseMap as ResponseMap;

      // The critical fix: $r('HTTP Sender') should resolve to d1's response
      expect(responseMap.get('HTTP Sender')).toBe('http-response-data');
      expect(responseMap.get('File Writer')).toBe('file-response-data');
    });

    it('should use sourceMap from source connector only', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });

      const source = createConnectorMessage(0, 'Source');
      source.getSourceMap().set('sourceOnly', 'value1');

      const dest1 = createConnectorMessage(1, 'HTTP Sender');
      dest1.getSourceMap().set('destSourceKey', 'shouldNotAppear');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);

      const scope = buildPostprocessorScope(testContext, message);
      expect((scope.sourceMap as any).get('sourceOnly')).toBe('value1');
      // Destination source maps are NOT merged (sourceMap comes from source only)
      expect((scope.sourceMap as any).get('destSourceKey')).toBeUndefined();
    });

    it('should set connectorMessage and connectorMap on scope', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });

      const source = createConnectorMessage(0, 'Source');
      message.setConnectorMessage(0, source);

      const scope = buildPostprocessorScope(testContext, message);

      // connectorMessage and connectorMap should exist (prevents ReferenceError)
      expect(scope.connectorMessage).toBeDefined();
      expect(scope.connectorMap).toBeDefined();
      expect(scope.connector).toBe('Source');
    });

    it('should work with empty message (no connector messages)', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: false,
      });

      const scope = buildPostprocessorScope(testContext, message);
      expect(scope.connectorMessage).toBeDefined();
      expect(scope.sourceMap).toBeDefined();
      expect(scope.channelMap).toBeDefined();
      expect(scope.responseMap).toBeDefined();
    });

    it('should include response when provided', () => {
      const message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'ch-001',
        receivedDate: new Date(),
        processed: true,
      });
      const source = createConnectorMessage(0, 'Source');
      message.setConnectorMessage(0, source);

      const response = new Response({ status: Status.SENT, message: 'OK' });
      const scope = buildPostprocessorScope(testContext, message, response);
      expect(scope.response).toBe(response);
    });
  });

  describe('JRC-SVM-004 — AlertSender connector context', () => {
    it('should have connector-aware AlertSender in connector scope', () => {
      const cm = createConnectorMessage(1, 'HTTP Sender');
      const context: ScriptContext = {
        channelId: 'ch-001',
        channelName: 'Test Channel',
        connectorName: 'HTTP Sender',
        metaDataId: 1,
      };

      const scope = buildConnectorMessageScope(context, cm);
      const alerts = scope.alerts as AlertSender;

      // AlertSender should have full connector context (not just channelId)
      expect(alerts.getChannelId()).toBe('ch-001');
      expect(alerts.getMetaDataId()).toBe(1);
      expect(alerts.getConnectorName()).toBe('HTTP Sender');
    });

    it('should have connector-aware AlertSender for source connector', () => {
      const cm = createConnectorMessage(0, 'Source');
      const context: ScriptContext = {
        channelId: 'ch-001',
        channelName: 'Test Channel',
        connectorName: 'Source',
        metaDataId: 0,
      };

      const scope = buildConnectorMessageScope(context, cm);
      const alerts = scope.alerts as AlertSender;

      expect(alerts.getMetaDataId()).toBe(0);
      expect(alerts.getConnectorName()).toBe('Source');
    });
  });
});
