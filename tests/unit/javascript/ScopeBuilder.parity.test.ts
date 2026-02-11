/**
 * Parity tests for ScopeBuilder — verifies userutil injection and phase fixes
 *
 * Wave 8 original tests + Wave 9 additions (Fix 2.1-2.4)
 */
import {
  buildBasicScope,
  buildChannelScope,
  buildConnectorMessageScope,
  buildFilterTransformerScope,
  buildPreprocessorScope,
  buildPostprocessorScope,
  buildResponseTransformerScope,
  buildAttachmentScope,
  buildMessageReceiverScope,
  buildMessageDispatcherScope,
  buildBatchProcessorScope,
  ScriptContext,
} from '../../../src/javascript/runtime/ScopeBuilder';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Status } from '../../../src/model/Status';
import { Response } from '../../../src/model/Response';
import { ACKGenerator } from '../../../src/util/ACKGenerator';
import { SerializerFactory } from '../../../src/util/SerializerFactory';
import { XmlUtil } from '../../../src/javascript/userutil/XmlUtil';
import { JsonUtil } from '../../../src/javascript/userutil/JsonUtil';
import { Lists, ListBuilder } from '../../../src/javascript/userutil/Lists';
import { Maps, MapBuilder } from '../../../src/javascript/userutil/Maps';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore, ResponseMap } from '../../../src/javascript/userutil/MirthMap';

describe('ScopeBuilder Parity Fixes', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
  });

  describe('2.1 - Userutil classes injected into scope', () => {
    it('should include DatabaseConnectionFactory', () => {
      const scope = buildBasicScope();
      expect(scope.DatabaseConnectionFactory).toBeDefined();
    });

    it('should include DatabaseConnection', () => {
      const scope = buildBasicScope();
      expect(scope.DatabaseConnection).toBeDefined();
    });

    it('should include FileUtil', () => {
      const scope = buildBasicScope();
      expect(scope.FileUtil).toBeDefined();
    });

    it('should include HTTPUtil', () => {
      const scope = buildBasicScope();
      expect(scope.HTTPUtil).toBeDefined();
    });

    it('should include DateUtil', () => {
      const scope = buildBasicScope();
      expect(scope.DateUtil).toBeDefined();
    });

    it('should include SMTPConnectionFactory', () => {
      const scope = buildBasicScope();
      expect(scope.SMTPConnectionFactory).toBeDefined();
    });

    it('should include SMTPConnection', () => {
      const scope = buildBasicScope();
      expect(scope.SMTPConnection).toBeDefined();
    });

    it('should include UUIDGenerator', () => {
      const scope = buildBasicScope();
      expect(scope.UUIDGenerator).toBeDefined();
    });

    it('should include RawMessage', () => {
      const scope = buildBasicScope();
      expect(scope.RawMessage).toBeDefined();
    });

    it('should include ResponseFactory', () => {
      const scope = buildBasicScope();
      expect(scope.ResponseFactory).toBeDefined();
    });

    it('should include ImmutableResponse', () => {
      const scope = buildBasicScope();
      expect(scope.ImmutableResponse).toBeDefined();
    });

    it('should include AttachmentUtil', () => {
      const scope = buildBasicScope();
      expect(scope.AttachmentUtil).toBeDefined();
    });

    it('should include ChannelUtil', () => {
      const scope = buildBasicScope();
      expect(scope.ChannelUtil).toBeDefined();
    });

    it('should include Attachment', () => {
      const scope = buildBasicScope();
      expect(scope.Attachment).toBeDefined();
    });

    it('should include MirthCachedRowSet', () => {
      const scope = buildBasicScope();
      expect(scope.MirthCachedRowSet).toBeDefined();
    });

    it('should include Future', () => {
      const scope = buildBasicScope();
      expect(scope.Future).toBeDefined();
    });

    it('should include ContextFactory', () => {
      const scope = buildBasicScope();
      expect(scope.ContextFactory).toBeDefined();
    });

    it('should include NCPDPUtil', () => {
      const scope = buildBasicScope();
      expect(scope.NCPDPUtil).toBeDefined();
    });

    it('should include DICOMUtil', () => {
      const scope = buildBasicScope();
      expect(scope.DICOMUtil).toBeDefined();
    });

    // Wave 9 — Fix 2.1: Wave 8 userutil classes must be in scope
    it('should include XmlUtil', () => {
      const scope = buildBasicScope();
      expect(scope.XmlUtil).toBeDefined();
      expect(scope.XmlUtil).toBe(XmlUtil);
    });

    it('should include JsonUtil', () => {
      const scope = buildBasicScope();
      expect(scope.JsonUtil).toBeDefined();
      expect(scope.JsonUtil).toBe(JsonUtil);
    });

    it('should include Lists', () => {
      const scope = buildBasicScope();
      expect(scope.Lists).toBeDefined();
      expect(scope.Lists).toBe(Lists);
    });

    it('should include ListBuilder', () => {
      const scope = buildBasicScope();
      expect(scope.ListBuilder).toBeDefined();
      expect(scope.ListBuilder).toBe(ListBuilder);
    });

    it('should include Maps (builder factory)', () => {
      const scope = buildBasicScope();
      expect(scope.Maps).toBeDefined();
      expect(scope.Maps).toBe(Maps);
    });

    it('should include MapBuilder', () => {
      const scope = buildBasicScope();
      expect(scope.MapBuilder).toBeDefined();
      expect(scope.MapBuilder).toBe(MapBuilder);
    });
  });

  // Wave 9 — Fix 2.2: ACKGenerator in scope
  describe('2.2 - ACKGenerator in scope', () => {
    it('should include ACKGenerator class in basic scope', () => {
      const scope = buildBasicScope();
      expect(scope.ACKGenerator).toBeDefined();
      expect(scope.ACKGenerator).toBe(ACKGenerator);
    });

    it('ACKGenerator.generateAckResponse should be callable from scope', () => {
      const scope = buildBasicScope();
      const ACKGen = scope.ACKGenerator as typeof ACKGenerator;
      const hl7 = 'MSH|^~\\&|SendApp|SendFac|RecvApp|RecvFac|20230101120000||ADT^A01|12345|P|2.5\rEVN|A01\r';
      const ack = ACKGen.generateAckResponse(hl7, 'AA', 'Message accepted');
      expect(ack).toContain('MSA|AA|12345');
    });
  });

  // Wave 9 — Fix 2.3: Response class in scope
  describe('2.3 - Response class in scope', () => {
    it('should include Response class in basic scope', () => {
      const scope = buildBasicScope();
      expect(scope.Response).toBeDefined();
      expect(scope.Response).toBe(Response);
    });

    it('should allow new Response(Status.SENT, ...) from scope', () => {
      const scope = buildBasicScope();
      const ResponseClass = scope.Response as typeof Response;
      const StatusEnum = scope.Status as typeof Status;
      const resp = new ResponseClass({ status: StatusEnum.SENT, message: 'OK' });
      expect(resp.getStatus()).toBe(Status.SENT);
      expect(resp.getMessage()).toBe('OK');
    });
  });

  // Wave 9 — Fix 2.4: Status object in scope (not just individual values)
  describe('2.4 - Status object in scope', () => {
    it('should include Status enum object in basic scope', () => {
      const scope = buildBasicScope();
      expect(scope.Status).toBeDefined();
      expect(scope.Status).toBe(Status);
    });

    it('Status.SENT should be accessible from scope', () => {
      const scope = buildBasicScope();
      const StatusEnum = scope.Status as typeof Status;
      expect(StatusEnum.SENT).toBe('S');
    });

    it('Status.ERROR should be accessible from scope', () => {
      const scope = buildBasicScope();
      const StatusEnum = scope.Status as typeof Status;
      expect(StatusEnum.ERROR).toBe('E');
    });

    it('individual status values should still be exposed at top level', () => {
      const scope = buildBasicScope();
      // Both Status.SENT and SENT should work (backward compat)
      expect(scope.SENT).toBe(Status.SENT);
      expect(scope.ERROR).toBe(Status.ERROR);
      expect(scope.RECEIVED).toBe(Status.RECEIVED);
    });
  });

  describe('2.5 - destinationSet injection in source scope', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
      metaDataId: 0,
    };

    function createMockConnectorMessage(): ConnectorMessage {
      return new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    }

    it('should inject destinationSet in filter/transformer scope for source (metaDataId=0)', () => {
      const cm = createMockConnectorMessage();
      const scope = buildFilterTransformerScope(context, cm, '<msg/>', '', 'filter');
      expect(scope.destinationSet).toBeDefined();
    });

    it('should inject destinationSet when metaDataId is undefined', () => {
      const ctxNoMeta: ScriptContext = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
      };
      const cm = createMockConnectorMessage();
      const scope = buildFilterTransformerScope(ctxNoMeta, cm, '<msg/>', '', 'filter');
      expect(scope.destinationSet).toBeDefined();
    });

    it('should NOT inject destinationSet for destination (metaDataId=1)', () => {
      const destCtx: ScriptContext = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
        metaDataId: 1,
      };
      const cm = createMockConnectorMessage();
      const scope = buildFilterTransformerScope(destCtx, cm, '<msg/>', '', 'filter');
      expect(scope.destinationSet).toBeUndefined();
    });

    it('should inject destinationSet in preprocessor scope', () => {
      const cm = createMockConnectorMessage();
      const scope = buildPreprocessorScope(context, '<msg/>', cm);
      expect(scope.destinationSet).toBeDefined();
    });
  });

  describe('2.6 - phase initialized as array', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
    };

    function createMockConnectorMessage(): ConnectorMessage {
      return new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    }

    it('phase should be an array in filter/transformer scope', () => {
      const cm = createMockConnectorMessage();
      const scope = buildFilterTransformerScope(context, cm, '<msg/>', '', 'filter');
      expect(Array.isArray(scope.phase)).toBe(true);
      expect(scope.phase).toEqual(['filter']);
    });

    it('phase[0] should match the phase string passed in', () => {
      const cm = createMockConnectorMessage();
      const scope = buildFilterTransformerScope(context, cm, '<msg/>', '', 'transform');
      expect((scope.phase as string[])[0]).toBe('transform');
    });
  });

  describe('2.7 - Placeholder classes replaced with real implementations', () => {
    it('router should exist (real VMRouter or stub)', () => {
      const scope = buildBasicScope();
      expect(scope.router).toBeDefined();
      // Should have routeMessage method
      expect(typeof (scope.router as any).routeMessage).toBe('function');
    });

    it('alerts should exist in channel scope', () => {
      const context: ScriptContext = {
        channelId: 'test-channel',
        channelName: 'Test Channel',
      };
      const scope = buildChannelScope(context);
      expect(scope.alerts).toBeDefined();
    });

    it('replacer should exist', () => {
      const scope = buildBasicScope();
      expect(scope.replacer).toBeDefined();
    });
  });

  describe('Wave 10 Parity Fixes', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
      metaDataId: 0,
    };

    function createMockConnectorMessage(): ConnectorMessage {
      return new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    }

    function createMockMessage(): Message {
      const msg = new Message({
        messageId: 1,
        serverId: 'server-1',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: false,
      });
      const cm = createMockConnectorMessage();
      msg.setConnectorMessage(0, cm);
      return msg;
    }

    describe('SerializerFactory in scope', () => {
      it('buildBasicScope() should include SerializerFactory', () => {
        const scope = buildBasicScope();
        expect(scope.SerializerFactory).toBeDefined();
      });

      it('SerializerFactory should be the actual class (not undefined)', () => {
        const scope = buildBasicScope();
        expect(scope.SerializerFactory).toBe(SerializerFactory);
      });
    });

    describe('Postprocessor response parameter', () => {
      it('buildPostprocessorScope() without response should NOT have response in scope', () => {
        const msg = createMockMessage();
        const scope = buildPostprocessorScope(context, msg);
        expect(scope.response).toBeUndefined();
      });

      it('buildPostprocessorScope() with response should inject response into scope', () => {
        const msg = createMockMessage();
        const response = new Response({ status: Status.SENT, message: 'OK' });
        const scope = buildPostprocessorScope(context, msg, response);
        expect(scope.response).toBe(response);
      });
    });

    describe('Sandbox timer protection', () => {
      it('setTimeout should be undefined in basic scope', () => {
        const scope = buildBasicScope();
        expect(scope.setTimeout).toBeUndefined();
      });

      it('setInterval should be undefined in basic scope', () => {
        const scope = buildBasicScope();
        expect(scope.setInterval).toBeUndefined();
      });

      it('setImmediate should be undefined in basic scope', () => {
        const scope = buildBasicScope();
        expect(scope.setImmediate).toBeUndefined();
      });

      it('queueMicrotask should be undefined in basic scope', () => {
        const scope = buildBasicScope();
        expect(scope.queueMicrotask).toBeUndefined();
      });
    });

    describe('Attachment scope builder', () => {
      it('buildAttachmentScope() should inject message, sourceMap, mirth_attachments, binary', () => {
        const sourceMapData = new Map<string, unknown>([['key1', 'value1']]);
        const attachments = [{ id: 'att-1', content: 'data' }];
        const scope = buildAttachmentScope(context, '<raw/>', sourceMapData, attachments, false);

        expect(scope.message).toBe('<raw/>');
        expect(scope.sourceMap).toBeDefined();
        expect(scope.mirth_attachments).toBeDefined();
        expect(scope.binary).toBeDefined();
      });

      it('mirth_attachments should be the array passed in', () => {
        const sourceMapData = new Map<string, unknown>();
        const attachments = [{ id: 'att-1' }, { id: 'att-2' }];
        const scope = buildAttachmentScope(context, 'raw', sourceMapData, attachments, true);

        expect(scope.mirth_attachments).toBe(attachments);
      });

      it('binary should be the boolean passed in', () => {
        const sourceMapData = new Map<string, unknown>();
        const scope = buildAttachmentScope(context, 'raw', sourceMapData, [], true);
        expect(scope.binary).toBe(true);

        const scope2 = buildAttachmentScope(context, 'raw', sourceMapData, [], false);
        expect(scope2.binary).toBe(false);
      });

      it('sourceMap should be accessible via $s shorthand', () => {
        const sourceMapData = new Map<string, unknown>([['testKey', 'testVal']]);
        const scope = buildAttachmentScope(context, 'raw', sourceMapData, [], false);
        expect(scope.$s).toBeDefined();
        expect(scope.$s).toBe(scope.sourceMap);
      });
    });
  });

  describe('Wave 11 Parity Fixes (js-runtime-checker scan)', () => {
    const context: ScriptContext = {
      channelId: 'test-channel',
      channelName: 'Test Channel',
      metaDataId: 0,
    };

    function createMockConnectorMessage(): ConnectorMessage {
      return new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
    }

    describe('JRC-SVM-001: ResponseMap destinationIdMap wiring', () => {
      it('buildConnectorMessageScope should pass destinationIdMap to ResponseMap', () => {
        const cm = createMockConnectorMessage();
        // Attach a destinationIdMap to the mock
        const destIdMap = new Map<string, number>([['HTTP Sender', 1], ['File Writer', 2]]);
        (cm as any).getDestinationIdMap = () => destIdMap;

        const scope = buildConnectorMessageScope(context, cm);
        const responseMap = scope.responseMap as ResponseMap;

        // ResponseMap should resolve destination names via destinationIdMap
        responseMap.put('d1', 'response-from-http');
        expect(responseMap.get('HTTP Sender')).toBe('response-from-http');
      });

      it('ResponseMap should work even without destinationIdMap', () => {
        const cm = createMockConnectorMessage();
        const scope = buildConnectorMessageScope(context, cm);
        const responseMap = scope.responseMap as ResponseMap;

        responseMap.put('d1', 'some-response');
        expect(responseMap.get('d1')).toBe('some-response');
        // Without destinationIdMap, name lookup returns undefined
        expect(responseMap.get('HTTP Sender')).toBeUndefined();
      });

      it('$r function shorthand should also use destinationIdMap for lookups', () => {
        const cm = createMockConnectorMessage();
        const destIdMap = new Map<string, number>([['Dest A', 3]]);
        (cm as any).getDestinationIdMap = () => destIdMap;

        const scope = buildConnectorMessageScope(context, cm);
        const responseMap = scope.responseMap as ResponseMap;
        responseMap.put('d3', 'dest-a-response');

        // $r is the same ResponseMap instance
        expect(scope.$r).toBe(responseMap);
        expect((scope.$r as ResponseMap).get('Dest A')).toBe('dest-a-response');
      });
    });

    describe('JRC-SVM-002: Response transformer scope includes template', () => {
      it('buildResponseTransformerScope should accept and inject template', () => {
        const cm = createMockConnectorMessage();
        const response = { status: Status.SENT, statusMessage: 'OK' };
        const scope = buildResponseTransformerScope(context, cm, response, '<template/>');
        expect(scope.template).toBe('<template/>');
      });

      it('buildResponseTransformerScope without template should not set template', () => {
        const cm = createMockConnectorMessage();
        const response = { status: Status.SENT };
        const scope = buildResponseTransformerScope(context, cm, response);
        expect(scope.template).toBeUndefined();
      });

      it('response variables should still be injected with template', () => {
        const cm = createMockConnectorMessage();
        const response = { status: Status.ERROR, statusMessage: 'Failed', error: 'Timeout' };
        const scope = buildResponseTransformerScope(context, cm, response, '<tmpl/>');
        expect(scope.responseStatus).toBe(Status.ERROR);
        expect(scope.responseStatusMessage).toBe('Failed');
        expect(scope.responseErrorMessage).toBe('Timeout');
        expect(scope.template).toBe('<tmpl/>');
      });
    });

    describe('JRC-SVM-003: Convenience scope builder methods', () => {
      it('buildMessageReceiverScope should create channel scope with optional connector message', () => {
        const cm = createMockConnectorMessage();
        const scope = buildMessageReceiverScope(context, cm);
        expect(scope.channelId).toBe('test-channel');
        expect(scope.connectorMessage).toBe(cm);
      });

      it('buildMessageReceiverScope without connector message should still have channel context', () => {
        const scope = buildMessageReceiverScope(context);
        expect(scope.channelId).toBe('test-channel');
        expect(scope.connectorMessage).toBeUndefined();
      });

      it('buildMessageDispatcherScope should create connector message scope', () => {
        const cm = createMockConnectorMessage();
        const scope = buildMessageDispatcherScope(context, cm);
        expect(scope.channelId).toBe('test-channel');
        expect(scope.connectorMessage).toBe(cm);
      });

      it('buildBatchProcessorScope should inject custom scope objects', () => {
        const scopeObjects = { batchReader: { next: () => null }, batchSize: 100 };
        const scope = buildBatchProcessorScope(context, scopeObjects);
        expect(scope.channelId).toBe('test-channel');
        expect(scope.batchReader).toBe(scopeObjects.batchReader);
        expect(scope.batchSize).toBe(100);
      });
    });
  });
});
