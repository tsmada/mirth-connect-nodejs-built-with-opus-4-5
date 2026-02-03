import {
  ResponseTransformerExecutor,
  ResponseTransformer,
  SimpleDataType,
  SerializationType,
  DefaultResponseStorageSettings,
} from '../../../../src/donkey/channel/ResponseTransformerExecutor';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Response } from '../../../../src/model/Response';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';

// Mock response transformer
class MockResponseTransformer implements ResponseTransformer {
  public lastResponse: Response | null = null;
  public transformResult: string = 'transformed-content';
  public shouldThrow = false;

  doTransform(response: Response, _connectorMessage: ConnectorMessage): string {
    if (this.shouldThrow) {
      throw new Error('Transform failed');
    }
    this.lastResponse = response;
    return this.transformResult;
  }
}

function createTestMessage(messageId: number): ConnectorMessage {
  const message = new ConnectorMessage({
    messageId,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Destination 1',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.SENT,
  });

  return message;
}

describe('ResponseTransformerExecutor', () => {
  let executor: ResponseTransformerExecutor;
  let inboundType: SimpleDataType;
  let outboundType: SimpleDataType;

  beforeEach(() => {
    inboundType = new SimpleDataType('HL7V2', SerializationType.XML);
    outboundType = new SimpleDataType('HL7V2', SerializationType.XML);
    executor = new ResponseTransformerExecutor(inboundType, outboundType);
  });

  describe('constructor', () => {
    it('should create executor with data types', () => {
      expect(executor.getInbound()).toBe(inboundType);
      expect(executor.getOutbound()).toBe(outboundType);
    });
  });

  describe('inbound/outbound', () => {
    it('should get and set inbound type', () => {
      const newInbound = new SimpleDataType('JSON', SerializationType.JSON);
      executor.setInbound(newInbound);
      expect(executor.getInbound()).toBe(newInbound);
    });

    it('should get and set outbound type', () => {
      const newOutbound = new SimpleDataType('JSON', SerializationType.JSON);
      executor.setOutbound(newOutbound);
      expect(executor.getOutbound()).toBe(newOutbound);
    });
  });

  describe('responseTransformer', () => {
    it('should get and set response transformer', () => {
      const transformer = new MockResponseTransformer();
      executor.setResponseTransformer(transformer);
      expect(executor.getResponseTransformer()).toBe(transformer);
    });
  });

  describe('isActive', () => {
    it('should return false when no transformer', () => {
      const response = Response.sent('test');
      expect(executor.isActive(response)).toBe(false);
    });

    it('should return true when transformer and message present', () => {
      executor.setResponseTransformer(new MockResponseTransformer());
      const response = Response.sent('test message');
      expect(executor.isActive(response)).toBe(true);
    });

    it('should return true for RAW serialization with empty message', () => {
      const rawInbound = new SimpleDataType('RAW', SerializationType.RAW);
      const rawExecutor = new ResponseTransformerExecutor(rawInbound, outboundType);
      rawExecutor.setResponseTransformer(new MockResponseTransformer());

      const response = Response.sent('');
      expect(rawExecutor.isActive(response)).toBe(true);
    });

    it('should return false when message empty and not RAW', () => {
      executor.setResponseTransformer(new MockResponseTransformer());
      const response = Response.sent('');
      expect(executor.isActive(response)).toBe(false);
    });
  });

  describe('runResponseTransformer', () => {
    let message: ConnectorMessage;
    let response: Response;

    beforeEach(() => {
      message = createTestMessage(1);
      response = Response.sent('original response');
    });

    it('should run transformer when active', async () => {
      const transformer = new MockResponseTransformer();
      transformer.transformResult = 'transformed response';
      executor.setResponseTransformer(transformer);

      await executor.runResponseTransformer(message, response, false);

      expect(transformer.lastResponse).toBe(response);
      expect(response.getMessage()).toBe('transformed response');
    });

    it('should set response transformed content', async () => {
      const transformer = new MockResponseTransformer();
      executor.setResponseTransformer(transformer);

      await executor.runResponseTransformer(message, response, false);

      const transformedContent = message.getContent(ContentType.RESPONSE_TRANSFORMED);
      expect(transformedContent).toBeDefined();
      expect(transformedContent?.content).toBe('transformed-content');
    });

    it('should set processed response content', async () => {
      const transformer = new MockResponseTransformer();
      executor.setResponseTransformer(transformer);

      await executor.runResponseTransformer(message, response, false);

      const processedContent = message.getContent(ContentType.PROCESSED_RESPONSE);
      expect(processedContent).toBeDefined();
    });

    it('should handle transformer error', async () => {
      const transformer = new MockResponseTransformer();
      transformer.shouldThrow = true;
      executor.setResponseTransformer(transformer);

      await expect(
        executor.runResponseTransformer(message, response, false)
      ).rejects.toThrow('Transform failed');
    });

    it('should handle no transformer (inactive)', async () => {
      await executor.runResponseTransformer(message, response, false);

      // Should still process response content
      const processedContent = message.getContent(ContentType.PROCESSED_RESPONSE);
      expect(processedContent).toBeDefined();
    });

    it('should fix status when queue enabled and error', async () => {
      const transformer = new MockResponseTransformer();
      executor.setResponseTransformer(transformer);
      // Error response with a message so transformer is active
      const errorResponse = Response.error('failed', 'response content');

      await executor.runResponseTransformer(message, errorResponse, true);

      expect(errorResponse.getStatus()).toBe(Status.QUEUED);
    });

    it('should not change status when queue disabled', async () => {
      const transformer = new MockResponseTransformer();
      executor.setResponseTransformer(transformer);
      // Error response with a message so transformer is active
      const errorResponse = Response.error('failed', 'response content');

      await executor.runResponseTransformer(message, errorResponse, false);

      expect(errorResponse.getStatus()).toBe(Status.ERROR);
    });

    describe('serialization types', () => {
      it('should handle XML inbound type', async () => {
        const transformer = new MockResponseTransformer();
        executor.setResponseTransformer(transformer);

        await executor.runResponseTransformer(message, response, false);

        const content = message.getContent(ContentType.RESPONSE_TRANSFORMED);
        expect(content?.dataType).toBe(SerializationType.XML);
      });

      it('should handle JSON inbound type', async () => {
        const jsonInbound = new SimpleDataType('JSON', SerializationType.JSON);
        const jsonExecutor = new ResponseTransformerExecutor(jsonInbound, outboundType);
        const transformer = new MockResponseTransformer();
        jsonExecutor.setResponseTransformer(transformer);

        await jsonExecutor.runResponseTransformer(message, response, false);

        const content = message.getContent(ContentType.RESPONSE_TRANSFORMED);
        expect(content).toBeDefined();
      });

      it('should handle RAW inbound type', async () => {
        const rawInbound = new SimpleDataType('RAW', SerializationType.RAW);
        const rawExecutor = new ResponseTransformerExecutor(rawInbound, outboundType);
        const transformer = new MockResponseTransformer();
        rawExecutor.setResponseTransformer(transformer);

        await rawExecutor.runResponseTransformer(message, response, false);

        expect(transformer.lastResponse).toBe(response);
      });
    });

    describe('with custom storage settings', () => {
      it('should use provided storage settings', async () => {
        const settings = new DefaultResponseStorageSettings();
        const transformer = new MockResponseTransformer();
        executor.setResponseTransformer(transformer);

        await executor.runResponseTransformer(message, response, false, settings);

        // Should complete without error
        expect(transformer.lastResponse).toBe(response);
      });
    });
  });
});

describe('SimpleDataType', () => {
  describe('constructor', () => {
    it('should create with type and serialization type', () => {
      const dataType = new SimpleDataType('HL7V2', SerializationType.XML);
      expect(dataType.getType()).toBe('HL7V2');
      expect(dataType.getSerializationType()).toBe(SerializationType.XML);
    });

    it('should default to RAW serialization', () => {
      const dataType = new SimpleDataType('RAW');
      expect(dataType.getSerializationType()).toBe(SerializationType.RAW);
    });
  });

  describe('serialization methods', () => {
    let dataType: SimpleDataType;

    beforeEach(() => {
      dataType = new SimpleDataType('TEST', SerializationType.XML);
    });

    it('should return content from toXML', () => {
      const result = dataType.toXML('<test/>');
      expect(result).toBe('<test/>');
    });

    it('should return content from toJSON', () => {
      const result = dataType.toJSON('{"test": true}');
      expect(result).toBe('{"test": true}');
    });

    it('should return content from fromXML', () => {
      const result = dataType.fromXML('<test/>');
      expect(result).toBe('<test/>');
    });

    it('should return content from fromJSON', () => {
      const result = dataType.fromJSON('{"test": true}');
      expect(result).toBe('{"test": true}');
    });
  });
});

describe('SerializationType', () => {
  it('should have RAW, XML, JSON values', () => {
    expect(SerializationType.RAW).toBe('RAW');
    expect(SerializationType.XML).toBe('XML');
    expect(SerializationType.JSON).toBe('JSON');
  });
});

describe('DefaultResponseStorageSettings', () => {
  let settings: DefaultResponseStorageSettings;

  beforeEach(() => {
    settings = new DefaultResponseStorageSettings();
  });

  it('should return true for storeResponseTransformed', () => {
    expect(settings.isStoreResponseTransformed()).toBe(true);
  });

  it('should return true for storeProcessedResponse', () => {
    expect(settings.isStoreProcessedResponse()).toBe(true);
  });
});
