import {
  buildBasicScope,
  buildChannelScope,
  buildConnectorMessageScope,
  buildFilterTransformerScope,
  buildPreprocessorScope,
  buildPostprocessorScope,
  syncMapsToConnectorMessage,
  ScopeBuilder,
  ScriptContext,
} from '../../../src/javascript/runtime/ScopeBuilder';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Status } from '../../../src/model/Status';
import { MirthMap, ChannelMap, SourceMap, GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../src/javascript/userutil/MirthMap';
import { XMLProxy } from '../../../src/javascript/e4x/XMLProxy';

describe('ScopeBuilder', () => {
  // Reset singletons before each test
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
  });

  describe('buildBasicScope', () => {
    it('should include logger', () => {
      const scope = buildBasicScope();
      expect(scope.logger).toBeDefined();
    });

    it('should include router', () => {
      const scope = buildBasicScope();
      expect(scope.router).toBeDefined();
    });

    it('should include replacer', () => {
      const scope = buildBasicScope();
      expect(scope.replacer).toBeDefined();
    });

    it('should include global maps', () => {
      const scope = buildBasicScope();
      expect(scope.globalMap).toBeDefined();
      expect(scope.configurationMap).toBeDefined();
      expect(scope.$g).toBe(scope.globalMap);
      expect(scope.$cfg).toBe(scope.configurationMap);
    });

    it('should include XMLProxy utilities', () => {
      const scope = buildBasicScope();
      expect(scope.XMLProxy).toBe(XMLProxy);
      expect(scope.XML).toBe(XMLProxy);
      expect(typeof scope.createXML).toBe('function');
    });

    it('should include Status enum values', () => {
      const scope = buildBasicScope();
      expect(scope.RECEIVED).toBe(Status.RECEIVED);
      expect(scope.SENT).toBe(Status.SENT);
      expect(scope.FILTERED).toBe(Status.FILTERED);
      expect(scope.ERROR).toBe(Status.ERROR);
    });

    it('should include built-in functions', () => {
      const scope = buildBasicScope();
      expect(scope.parseInt).toBe(parseInt);
      expect(scope.JSON).toBe(JSON);
      expect(scope.Array).toBe(Array);
    });

    it('should use custom logger when provided', () => {
      const customLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      const scope = buildBasicScope(customLogger);
      expect(scope.logger).toBe(customLogger);
    });
  });

  describe('buildChannelScope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel-123',
      channelName: 'Test Channel',
    };

    it('should include channel info', () => {
      const scope = buildChannelScope(context);
      expect(scope.channelId).toBe('test-channel-123');
      expect(scope.channelName).toBe('Test Channel');
    });

    it('should include global channel map', () => {
      const scope = buildChannelScope(context);
      expect(scope.globalChannelMap).toBeDefined();
      expect(scope.$gc).toBe(scope.globalChannelMap);
    });

    it('should include alerts sender', () => {
      const scope = buildChannelScope(context);
      expect(scope.alerts).toBeDefined();
    });

    it('should inherit from basic scope', () => {
      const scope = buildChannelScope(context);
      expect(scope.logger).toBeDefined();
      expect(scope.router).toBeDefined();
      expect(scope.$g).toBeDefined();
    });
  });

  describe('buildConnectorMessageScope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
      connectorName: 'Test Connector',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should include connector message', () => {
      const scope = buildConnectorMessageScope(context, connectorMessage);
      expect(scope.connectorMessage).toBe(connectorMessage);
      expect(scope.connector).toBe('Test Connector');
    });

    it('should include all maps with shorthand', () => {
      const scope = buildConnectorMessageScope(context, connectorMessage);

      expect(scope.sourceMap).toBeInstanceOf(SourceMap);
      expect(scope.$s).toBe(scope.sourceMap);

      expect(scope.channelMap).toBeInstanceOf(ChannelMap);
      expect(scope.$c).toBe(scope.channelMap);

      expect(scope.connectorMap).toBeInstanceOf(MirthMap);
      expect(scope.$co).toBe(scope.connectorMap);

      expect(scope.responseMap).toBeDefined();
      expect(scope.$r).toBe(scope.responseMap);
    });

    it('should parse XML content when provided', () => {
      const xmlContent = '<root><child>value</child></root>';
      const scope = buildConnectorMessageScope(context, connectorMessage, xmlContent);

      expect(scope.message).toBe(xmlContent);
      expect(scope.msg).toBeInstanceOf(XMLProxy);
    });

    it('should keep raw content for non-XML', () => {
      const rawContent = 'plain text message';
      const scope = buildConnectorMessageScope(context, connectorMessage, rawContent);

      expect(scope.message).toBe(rawContent);
      expect(scope.msg).toBe(rawContent);
    });

    it('should set tmp to same as msg', () => {
      const xmlContent = '<root/>';
      const scope = buildConnectorMessageScope(context, connectorMessage, xmlContent);
      expect(scope.tmp).toBe(scope.msg);
    });
  });

  describe('buildFilterTransformerScope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should include template and phase', () => {
      const scope = buildFilterTransformerScope(
        context,
        connectorMessage,
        '<msg/>',
        'template content',
        'filter'
      );

      expect(scope.template).toBe('template content');
      expect(scope.phase).toEqual(['filter']);
    });
  });

  describe('buildPreprocessorScope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should include raw message', () => {
      const rawMessage = 'MSH|^~\\&|...';
      const scope = buildPreprocessorScope(context, rawMessage, connectorMessage);
      expect(scope.message).toBe(rawMessage);
    });
  });

  describe('buildPostprocessorScope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let message: Message;
    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      message = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: false,
      });

      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.SENT,
      });

      message.setConnectorMessage(0, connectorMessage);
    });

    it('should include message object', () => {
      const scope = buildPostprocessorScope(context, message);
      expect(scope.message).toBe(message);
    });

    it('should include maps from source connector', () => {
      // Add some data to source connector maps
      connectorMessage.getChannelMap().set('testKey', 'testValue');

      const scope = buildPostprocessorScope(context, message);

      const channelMap = scope.channelMap as ChannelMap;
      expect(channelMap.get('testKey')).toBe('testValue');
    });
  });

  describe('syncMapsToConnectorMessage', () => {
    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should sync channel map changes', () => {
      const context: ScriptContext = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
      };

      const scope = buildConnectorMessageScope(context, connectorMessage);

      // Modify channel map in scope
      const channelMap = scope.channelMap as ChannelMap;
      channelMap.put('newKey', 'newValue');

      // Sync back
      syncMapsToConnectorMessage(scope, connectorMessage);

      // Verify change is in connector message
      expect(connectorMessage.getChannelMap().get('newKey')).toBe('newValue');
    });

    it('should sync connector map changes', () => {
      const context: ScriptContext = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
      };

      const scope = buildConnectorMessageScope(context, connectorMessage);

      // Modify connector map in scope
      const connectorMap = scope.connectorMap as MirthMap;
      connectorMap.put('connectorKey', 'connectorValue');

      // Sync back
      syncMapsToConnectorMessage(scope, connectorMessage);

      // Verify change is in connector message
      expect(connectorMessage.getConnectorMap().get('connectorKey')).toBe('connectorValue');
    });
  });

  describe('ScopeBuilder class', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    let connectorMessage: ConnectorMessage;

    beforeEach(() => {
      connectorMessage = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    });

    it('should support fluent API', () => {
      const scope = new ScopeBuilder(context)
        .withConnectorMessage(connectorMessage, '<msg/>')
        .withFilterTransformer('template', 'filter')
        .withVariable('customVar', 'customValue')
        .build();

      expect(scope.connectorMessage).toBe(connectorMessage);
      expect(scope.template).toBe('template');
      expect(scope.phase).toEqual(['filter']);
      expect(scope.customVar).toBe('customValue');
    });

    it('should support response context', () => {
      const scope = new ScopeBuilder(context)
        .withConnectorMessage(connectorMessage)
        .withResponse({ status: Status.SENT, statusMessage: 'OK' })
        .build();

      expect(scope.responseStatus).toBe(Status.SENT);
      expect(scope.responseStatusMessage).toBe('OK');
    });
  });
});
