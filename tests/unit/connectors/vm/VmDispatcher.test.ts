import {
  VmDispatcher,
  VmDispatcherStatus,
  DispatcherStatusListener,
  EngineController,
  DispatchResult,
  TemplateReplacer,
} from '../../../../src/connectors/vm/VmDispatcher';
import {
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
  SOURCE_MESSAGE_ID,
  SOURCE_MESSAGE_IDS,
} from '../../../../src/connectors/vm/VmConnectorProperties';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { RawMessage } from '../../../../src/model/RawMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Mock engine controller
class MockEngineController implements EngineController {
  public dispatchedMessages: { channelId: string; rawMessage: RawMessage }[] = [];
  public responseMessage: string | null = null;
  public shouldThrow = false;

  async dispatchRawMessage(
    channelId: string,
    rawMessage: RawMessage,
    _force?: boolean,
    _waitForCompletion?: boolean
  ): Promise<DispatchResult | null> {
    if (this.shouldThrow) {
      throw new Error('Dispatch failed');
    }

    this.dispatchedMessages.push({ channelId, rawMessage });

    return {
      messageId: 12345,
      selectedResponse: this.responseMessage
        ? { message: this.responseMessage }
        : undefined,
    };
  }
}

// Mock template replacer
class MockTemplateReplacer implements TemplateReplacer {
  replaceValues(template: string, connectorMessage: ConnectorMessage): string {
    // Simple replacement of channel map variables
    let result = template;
    const channelMap = connectorMessage.getChannelMap();
    for (const [key, value] of channelMap) {
      result = result.replace(`\${${key}}`, String(value));
    }
    return result;
  }
}

function createConnectorMessage(options: {
  messageId?: number;
  channelId?: string;
  rawData?: string;
  encodedData?: string;
  transformedData?: string;
  sourceMap?: Map<string, unknown>;
  channelMap?: Map<string, unknown>;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: options.messageId ?? 1,
    metaDataId: 1,
    channelId: options.channelId ?? 'source-channel-id',
    channelName: 'Source Channel',
    connectorName: 'VM Dispatcher',
    serverId: 'node-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (options.rawData) {
    msg.setContent({
      contentType: ContentType.RAW,
      content: options.rawData,
      dataType: 'RAW',
      encrypted: false,
    });
  }

  if (options.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: options.encodedData,
      dataType: 'XML',
      encrypted: false,
    });
  }

  if (options.transformedData) {
    msg.setContent({
      contentType: ContentType.TRANSFORMED,
      content: options.transformedData,
      dataType: 'XML',
      encrypted: false,
    });
  }

  if (options.sourceMap) {
    for (const [key, value] of options.sourceMap) {
      msg.getSourceMap().set(key, value);
    }
  }

  if (options.channelMap) {
    for (const [key, value] of options.channelMap) {
      msg.getChannelMap().set(key, value);
    }
  }

  return msg;
}

describe('VmDispatcher', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const dispatcher = new VmDispatcher({ metaDataId: 1 });

      expect(dispatcher.getName()).toBe('Channel Writer');
      expect(dispatcher.getTransportName()).toBe('VM');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should create with custom name', () => {
      const dispatcher = new VmDispatcher({
        metaDataId: 1,
        name: 'Custom VM Writer',
      });

      expect(dispatcher.getName()).toBe('Custom VM Writer');
    });

    it('should create with custom properties', () => {
      const dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: {
          channelId: 'target-channel',
          channelTemplate: 'custom template',
          mapVariables: ['var1', 'var2'],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.channelId).toBe('target-channel');
      expect(props.channelTemplate).toBe('custom template');
      expect(props.mapVariables).toEqual(['var1', 'var2']);
    });
  });

  describe('static methods', () => {
    it('should return correct connector name', () => {
      expect(VmDispatcher.getConnectorName()).toBe('Channel Writer');
    });

    it('should return correct protocol', () => {
      expect(VmDispatcher.getProtocol()).toBe('VM');
    });
  });

  describe('properties', () => {
    let dispatcher: VmDispatcher;

    beforeEach(() => {
      dispatcher = new VmDispatcher({ metaDataId: 1 });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.channelId).toBe('none');
      expect(props.channelTemplate).toBe('${message.encodedData}');
      expect(props.mapVariables).toEqual([]);
      expect(props.validateResponse).toBe(false);
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        channelId: 'new-target',
        validateResponse: true,
      });

      const props = dispatcher.getProperties();
      expect(props.channelId).toBe('new-target');
      expect(props.validateResponse).toBe(true);
    });
  });

  describe('lifecycle', () => {
    let dispatcher: VmDispatcher;

    beforeEach(() => {
      dispatcher = new VmDispatcher({ metaDataId: 1 });
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should be stopped initially', () => {
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);
    });

    it('should not fail when starting twice', async () => {
      await dispatcher.start();
      await dispatcher.start(); // Should not throw
      expect(dispatcher.isRunning()).toBe(true);
    });

    it('should stop successfully', async () => {
      await dispatcher.start();
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should not fail when stopping a stopped dispatcher', async () => {
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
  });

  describe('status events', () => {
    let dispatcher: VmDispatcher;
    let statusEvents: { status: VmDispatcherStatus; info?: string }[];
    let listener: DispatcherStatusListener;

    beforeEach(() => {
      dispatcher = new VmDispatcher({ metaDataId: 1 });
      statusEvents = [];
      listener = (status, info) => statusEvents.push({ status, info });
      dispatcher.addStatusListener(listener);
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should emit IDLE on start', async () => {
      await dispatcher.start();
      expect(statusEvents.map((e) => e.status)).toContain(VmDispatcherStatus.IDLE);
    });

    it('should emit DISCONNECTED on stop', async () => {
      await dispatcher.start();
      statusEvents = [];
      await dispatcher.stop();
      expect(statusEvents.map((e) => e.status)).toContain(VmDispatcherStatus.DISCONNECTED);
    });

    it('should remove listener', async () => {
      dispatcher.removeStatusListener(listener);
      await dispatcher.start();
      expect(statusEvents).toEqual([]);
    });
  });

  describe('send', () => {
    let dispatcher: VmDispatcher;
    let engineController: MockEngineController;

    beforeEach(async () => {
      dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: {
          channelId: 'target-channel-id',
          channelTemplate: '${message.encodedData}',
        },
      });
      engineController = new MockEngineController();
      dispatcher.setEngineController(engineController);
      await dispatcher.start();
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should dispatch message to target channel', async () => {
      const message = createConnectorMessage({
        encodedData: '<test>encoded content</test>',
      });

      await dispatcher.send(message);

      expect(engineController.dispatchedMessages).toHaveLength(1);
      expect(engineController.dispatchedMessages[0]!.channelId).toBe('target-channel-id');
    });

    it('should use encoded data in template', async () => {
      const message = createConnectorMessage({
        encodedData: '<encoded>data</encoded>',
      });

      await dispatcher.send(message);

      expect(engineController.dispatchedMessages).toHaveLength(1);
      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getRawData()).toBe('<encoded>data</encoded>');
    });

    it('should use transformed data in template', async () => {
      dispatcher.setProperties({
        channelId: 'target',
        channelTemplate: '${message.transformedData}',
      });

      const message = createConnectorMessage({
        transformedData: '<transformed>data</transformed>',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getRawData()).toBe('<transformed>data</transformed>');
    });

    it('should use raw data in template', async () => {
      dispatcher.setProperties({
        channelId: 'target',
        channelTemplate: '${message.rawData}',
      });

      const message = createConnectorMessage({
        rawData: 'raw content',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getRawData()).toBe('raw content');
    });

    it('should not dispatch when channelId is "none"', async () => {
      dispatcher.setProperties({ channelId: 'none' });

      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      expect(engineController.dispatchedMessages).toHaveLength(0);
      expect(message.getStatus()).toBe(Status.SENT);
    });

    it('should set SENT status on success', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      expect(message.getStatus()).toBe(Status.SENT);
    });

    it('should set send date on success', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      expect(message.getSendDate()).toBeDefined();
    });

    it('should store target channel ID in connector map', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      expect(message.getConnectorMap().get('targetChannelId')).toBe('target-channel-id');
    });

    it('should handle response from target channel', async () => {
      engineController.responseMessage = '<ack>received</ack>';

      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const response = message.getResponseContent();
      expect(response).toBeDefined();
      expect(response!.content).toBe('<ack>received</ack>');
    });

    it('should handle dispatch errors', async () => {
      engineController.shouldThrow = true;

      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await expect(dispatcher.send(message)).rejects.toThrow('Dispatch failed');
    });

    it('should throw when no engine controller', async () => {
      const unConfiguredDispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: { channelId: 'target' },
      });
      await unConfiguredDispatcher.start();

      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await expect(unConfiguredDispatcher.send(message)).rejects.toThrow('No engine controller');
      await unConfiguredDispatcher.stop();
    });
  });

  describe('source channel tracking', () => {
    let dispatcher: VmDispatcher;
    let engineController: MockEngineController;

    beforeEach(async () => {
      dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: { channelId: 'target' },
      });
      engineController = new MockEngineController();
      dispatcher.setEngineController(engineController);
      await dispatcher.start();
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should set source channel ID on first dispatch', async () => {
      const message = createConnectorMessage({
        channelId: 'original-channel',
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get(SOURCE_CHANNEL_ID)).toBe('original-channel');
    });

    it('should set source message ID on first dispatch', async () => {
      const message = createConnectorMessage({
        messageId: 42,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get(SOURCE_MESSAGE_ID)).toBe(42);
    });

    it('should build channel ID chain on subsequent dispatch', async () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_CHANNEL_ID, 'first-channel');

      const message = createConnectorMessage({
        channelId: 'second-channel',
        sourceMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      const channelIds = rawMessage.getSourceMap().get(SOURCE_CHANNEL_IDS) as string[];

      expect(channelIds).toContain('first-channel');
      expect(channelIds).toContain('second-channel');
    });

    it('should build message ID chain on subsequent dispatch', async () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set(SOURCE_MESSAGE_ID, 100);

      const message = createConnectorMessage({
        messageId: 200,
        sourceMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      const messageIds = rawMessage.getSourceMap().get(SOURCE_MESSAGE_IDS) as number[];

      expect(messageIds).toContain(100);
      expect(messageIds).toContain(200);
    });
  });

  describe('map variable propagation', () => {
    let dispatcher: VmDispatcher;
    let engineController: MockEngineController;

    beforeEach(async () => {
      dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: {
          channelId: 'target',
          mapVariables: ['patientId', 'visitId', 'missingVar'],
        },
      });
      engineController = new MockEngineController();
      dispatcher.setEngineController(engineController);
      await dispatcher.start();
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should propagate channel map variables', async () => {
      const channelMap = new Map<string, unknown>();
      channelMap.set('patientId', 'P123');
      channelMap.set('visitId', 'V456');

      const message = createConnectorMessage({
        channelMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get('patientId')).toBe('P123');
      expect(rawMessage.getSourceMap().get('visitId')).toBe('V456');
    });

    it('should not set missing variables', async () => {
      const channelMap = new Map<string, unknown>();
      channelMap.set('patientId', 'P123');
      // visitId and missingVar not set

      const message = createConnectorMessage({
        channelMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get('patientId')).toBe('P123');
      expect(rawMessage.getSourceMap().has('visitId')).toBe(false);
      expect(rawMessage.getSourceMap().has('missingVar')).toBe(false);
    });

    it('should propagate source map variables', async () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('patientId', 'P999');

      const message = createConnectorMessage({
        sourceMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get('patientId')).toBe('P999');
    });

    it('should prioritize response map over other maps', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });
      message.getChannelMap().set('patientId', 'channel-value');
      message.getResponseMap().set('patientId', 'response-value');

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get('patientId')).toBe('response-value');
    });

    it('should check global map for variables', async () => {
      GlobalMap.getInstance().put('patientId', 'global-patient');

      const message = createConnectorMessage({
        encodedData: 'test',
      });

      await dispatcher.send(message);

      const rawMessage = engineController.dispatchedMessages[0]!.rawMessage;
      expect(rawMessage.getSourceMap().get('patientId')).toBe('global-patient');
    });
  });

  describe('template replacement', () => {
    let dispatcher: VmDispatcher;
    let engineController: MockEngineController;
    let templateReplacer: MockTemplateReplacer;

    beforeEach(async () => {
      dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: {
          channelId: '${targetChannel}',
          channelTemplate: '${message.encodedData}',
        },
      });
      engineController = new MockEngineController();
      templateReplacer = new MockTemplateReplacer();
      dispatcher.setEngineController(engineController);
      dispatcher.setTemplateReplacer(templateReplacer);
      await dispatcher.start();
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should replace channel ID with template value', async () => {
      const channelMap = new Map<string, unknown>();
      channelMap.set('targetChannel', 'dynamic-channel-id');

      const message = createConnectorMessage({
        channelMap,
        encodedData: 'test',
      });

      await dispatcher.send(message);

      expect(engineController.dispatchedMessages[0]!.channelId).toBe('dynamic-channel-id');
    });
  });

  describe('replaceConnectorProperties (CPC-W18-003)', () => {
    let dispatcher: VmDispatcher;

    beforeEach(() => {
      dispatcher = new VmDispatcher({ metaDataId: 1 });
    });

    it('should resolve ${variable} in channelId from channelMap', () => {
      const props = {
        channelId: '${targetChannelId}',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });
      msg.getChannelMap().set('targetChannelId', 'resolved-channel-abc');

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('resolved-channel-abc');
      // Original should NOT be modified
      expect(props.channelId).toBe('${targetChannelId}');
    });

    it('should resolve ${variable} in channelTemplate from channelMap', () => {
      const props = {
        channelId: 'target',
        channelTemplate: 'Patient: ${patientName}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });
      msg.getChannelMap().set('patientName', 'John Doe');

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelTemplate).toBe('Patient: John Doe');
    });

    it('should resolve ${message.encodedData} in channelTemplate', () => {
      const props = {
        channelId: 'target',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: '<HL7>encoded</HL7>' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelTemplate).toBe('<HL7>encoded</HL7>');
    });

    it('should resolve ${message.rawData} in channelTemplate', () => {
      const props = {
        channelId: 'target',
        channelTemplate: '${message.rawData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ rawData: 'MSH|^~\\&|SEND|...' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelTemplate).toBe('MSH|^~\\&|SEND|...');
    });

    it('should resolve ${message.transformedData} in channelTemplate', () => {
      const props = {
        channelId: 'target',
        channelTemplate: '${message.transformedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ transformedData: '<xml>transformed</xml>' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelTemplate).toBe('<xml>transformed</xml>');
    });

    it('should resolve variables from sourceMap when not in channelMap', () => {
      const props = {
        channelId: '${routeTarget}',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const sourceMap = new Map<string, unknown>();
      sourceMap.set('routeTarget', 'source-map-channel');
      const msg = createConnectorMessage({ sourceMap, encodedData: 'test' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('source-map-channel');
    });

    it('should resolve variables from connectorMap as fallback', () => {
      const props = {
        channelId: '${routeTarget}',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });
      msg.getConnectorMap().set('routeTarget', 'connector-map-channel');

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('connector-map-channel');
    });

    it('should leave unresolved variables as-is', () => {
      const props = {
        channelId: '${unknownVar}',
        channelTemplate: 'prefix-${alsoUnknown}-suffix',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('${unknownVar}');
      expect(resolved.channelTemplate).toBe('prefix-${alsoUnknown}-suffix');
    });

    it('should resolve multiple variables in a single string', () => {
      const props = {
        channelId: 'target',
        channelTemplate: '${prefix}-${middle}-${suffix}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });
      msg.getChannelMap().set('prefix', 'A');
      msg.getChannelMap().set('middle', 'B');
      msg.getChannelMap().set('suffix', 'C');

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelTemplate).toBe('A-B-C');
    });

    it('should not modify non-string properties', () => {
      const props = {
        channelId: 'target',
        channelTemplate: '${message.encodedData}',
        mapVariables: ['var1'],
        validateResponse: true,
        reattachAttachments: false,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.mapVariables).toEqual(['var1']);
      expect(resolved.validateResponse).toBe(true);
      expect(resolved.reattachAttachments).toBe(false);
    });

    it('should handle template with no variables (passthrough)', () => {
      const props = {
        channelId: 'static-channel-id',
        channelTemplate: 'static template content',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const msg = createConnectorMessage({ encodedData: 'test' });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('static-channel-id');
      expect(resolved.channelTemplate).toBe('static template content');
    });

    it('should prioritize channelMap over sourceMap', () => {
      const props = {
        channelId: '${routeTarget}',
        channelTemplate: '${message.encodedData}',
        mapVariables: [],
        validateResponse: false,
        reattachAttachments: true,
      };

      const sourceMap = new Map<string, unknown>();
      sourceMap.set('routeTarget', 'source-channel');
      const msg = createConnectorMessage({ sourceMap, encodedData: 'test' });
      msg.getChannelMap().set('routeTarget', 'channel-map-channel');

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.channelId).toBe('channel-map-channel');
    });

    it('should be used in send() for dynamic channel routing', async () => {
      const engineController = new MockEngineController();
      dispatcher = new VmDispatcher({
        metaDataId: 1,
        properties: {
          channelId: '${dynamicTarget}',
          channelTemplate: '${message.encodedData}',
        },
      });
      dispatcher.setEngineController(engineController);
      await dispatcher.start();

      const msg = createConnectorMessage({ encodedData: 'test message' });
      msg.getChannelMap().set('dynamicTarget', 'runtime-resolved-channel');

      await dispatcher.send(msg);

      expect(engineController.dispatchedMessages).toHaveLength(1);
      expect(engineController.dispatchedMessages[0]!.channelId).toBe('runtime-resolved-channel');

      await dispatcher.stop();
    });
  });

  describe('getResponse', () => {
    let dispatcher: VmDispatcher;

    beforeEach(async () => {
      dispatcher = new VmDispatcher({ metaDataId: 1 });
      await dispatcher.start();
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should return response content', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });
      message.setContent({
        contentType: ContentType.RESPONSE,
        content: '<response>data</response>',
        dataType: 'XML',
        encrypted: false,
      });

      const response = await dispatcher.getResponse(message);

      expect(response).toBe('<response>data</response>');
    });

    it('should return null when no response', async () => {
      const message = createConnectorMessage({
        encodedData: 'test',
      });

      const response = await dispatcher.getResponse(message);

      expect(response).toBeNull();
    });
  });
});
