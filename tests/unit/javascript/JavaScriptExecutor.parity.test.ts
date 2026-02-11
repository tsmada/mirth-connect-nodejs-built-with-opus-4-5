/**
 * Wave 13 parity tests for JavaScriptExecutor — transformed data readback (JRC-SBD-012),
 * postprocessor return value conversion (JRC-SBD-013).
 */
import {
  JavaScriptExecutor,
  createJavaScriptExecutor,
} from '../../../src/javascript/runtime/JavaScriptExecutor';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';
import { SerializationType } from '../../../src/javascript/runtime/ScriptBuilder';

function makeConnectorMessage(): ConnectorMessage {
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

function makeMessage(): Message {
  const msg = new Message({
    messageId: 1,
    serverId: 'server-1',
    channelId: 'test-channel',
    receivedDate: new Date(),
    processed: false,
  });
  const cm = makeConnectorMessage();
  msg.getConnectorMessages().set(0, cm);
  return msg;
}

function makeScriptContext() {
  return {
    channelId: 'test-channel',
    channelName: 'Test Channel',
  };
}

describe('JavaScriptExecutor Wave 13 Parity Fixes', () => {
  let executor: JavaScriptExecutor;

  beforeEach(() => {
    executor = createJavaScriptExecutor();
  });

  describe('JRC-SBD-012 — Transformed data readback from VM scope', () => {
    it('should read back string msg after transformer modifies it', () => {
      const cm = makeConnectorMessage();
      const result = executor.executeFilterTransformer(
        [], // no filter rules (accept all)
        [{ name: 'Step 1', script: 'msg = "transformed data";', enabled: true }],
        cm,
        'original data',
        '', // no template
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // The transformed data should be read back from scope
      expect(cm.getTransformedData()).toBe('transformed data');
    });

    it('should read back JSON-serialized object after transformer creates object', () => {
      const cm = makeConnectorMessage();
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: 'msg = { name: "Smith", age: 42 };', enabled: true }],
        cm,
        '{}',
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      const transformed = cm.getTransformedData();
      expect(transformed).toBeTruthy();
      const parsed = JSON.parse(transformed!);
      expect(parsed.name).toBe('Smith');
      expect(parsed.age).toBe(42);
    });

    it('should read back tmp when template is provided', () => {
      const cm = makeConnectorMessage();
      cm.setRawData('raw message');  // Script reads from connectorMessage.getProcessedRawData()
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: 'tmp = "template output";', enabled: true }],
        cm,
        'raw message',
        '<template/>', // template is present
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(cm.getTransformedData()).toBe('template output');
    });

    it('should read back msg (not tmp) when no template is provided', () => {
      const cm = makeConnectorMessage();
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: 'msg = "modified msg"; tmp = "should be ignored";', enabled: true }],
        cm,
        'original',
        '', // no template
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(cm.getTransformedData()).toBe('modified msg');
    });

    it('should preserve original data when transformer does not modify msg', () => {
      const cm = makeConnectorMessage();
      cm.setRawData('keep this');  // Script reads from connectorMessage.getProcessedRawData()
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: '// no modifications to msg', enabled: true }],
        cm,
        'keep this',
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // msg is still the original string — readback should update to same value
      expect(cm.getTransformedData()).toBe('keep this');
    });

    it('should handle numeric msg values via String() conversion', () => {
      const cm = makeConnectorMessage();
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: 'msg = 42;', enabled: true }],
        cm,
        '0',
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(cm.getTransformedData()).toBe('42');
    });

    it('should handle array msg values via JSON.stringify', () => {
      const cm = makeConnectorMessage();
      const result = executor.executeFilterTransformer(
        [],
        [{ name: 'Step 1', script: 'msg = [1, 2, 3];', enabled: true }],
        cm,
        '[]',
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(cm.getTransformedData()).toBe('[1,2,3]');
    });
  });

  describe('JRC-SBD-013 — Postprocessor return value to Response', () => {
    it('should convert Response return value to Response result', () => {
      const msg = makeMessage();
      const result = executor.executePostprocessor(
        'return new Response({ status: Status.SENT, message: "custom response" });',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getStatus()).toBe(Status.SENT);
      expect(result.result!.getMessage()).toBe('custom response');
    });

    it('should convert non-null string return to Response(SENT, value)', () => {
      const msg = makeMessage();
      const result = executor.executePostprocessor(
        'return "postprocess complete";',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getStatus()).toBe(Status.SENT);
      expect(result.result!.getMessage()).toBe('postprocess complete');
    });

    it('should return undefined when postprocessor returns nothing', () => {
      const msg = makeMessage();
      const result = executor.executePostprocessor(
        '// no return value',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });

    it('should return undefined when postprocessor returns null', () => {
      const msg = makeMessage();
      const result = executor.executePostprocessor(
        'return null;',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });

    it('should convert numeric return to Response(SENT, "42")', () => {
      const msg = makeMessage();
      const result = executor.executePostprocessor(
        'return 42;',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getMessage()).toBe('42');
    });

    it('should accept optional response parameter (for global postprocessor)', () => {
      const msg = makeMessage();
      const channelResponse = new Response({ status: Status.SENT, message: 'from channel' });
      const result = executor.executePostprocessor(
        '// global postprocessor with channel response in scope',
        msg,
        makeScriptContext(),
        channelResponse
      );

      expect(result.success).toBe(true);
    });
  });
});
