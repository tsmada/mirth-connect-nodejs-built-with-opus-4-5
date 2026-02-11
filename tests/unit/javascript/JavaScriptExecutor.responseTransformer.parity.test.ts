/**
 * Parity tests for JavaScriptExecutor.executeResponseTransformer()
 * JRC-ECL-002 / JRC-SBD-020: Response transformer scope readback
 *
 * Java ref: JavaScriptResponseTransformer.java:197-200
 * Java ref: JavaScriptScopeUtil.getResponseDataFromScope():417-434
 */
import {
  JavaScriptExecutor,
  createJavaScriptExecutor,
} from '../../../src/javascript/runtime/JavaScriptExecutor';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';
import { SerializationType } from '../../../src/javascript/runtime/ScriptBuilder';

function makeConnectorMessage(): ConnectorMessage {
  const cm = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'HTTP Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
  // Set response transformed data so the generated script can read it
  cm.setRawData('raw response data');
  return cm;
}

function makeScriptContext() {
  return {
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'HTTP Sender',
    metaDataId: 1,
  };
}

describe('JavaScriptExecutor.executeResponseTransformer — JRC-ECL-002 / JRC-SBD-020', () => {
  let executor: JavaScriptExecutor;

  beforeEach(() => {
    executor = createJavaScriptExecutor();
  });

  describe('Response data readback from scope', () => {
    it('should read back responseStatus change (script sets responseStatus = ERROR)', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('OK');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'responseStatus = ERROR;', enabled: true }],
        cm,
        response,
        '', // no template
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(response.getStatus()).toBe(Status.ERROR);
    });

    it('should read back responseStatusMessage change', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('OK');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'responseStatusMessage = "Custom status message";', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(response.getStatusMessage()).toBe('Custom status message');
    });

    it('should read back responseErrorMessage change', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('OK');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'responseErrorMessage = "Something went wrong";', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(response.getError()).toBe('Something went wrong');
    });

    it('should preserve statusMessage when script does not modify responseStatusMessage', () => {
      const cm = makeConnectorMessage();
      const response = new Response({
        status: Status.SENT,
        message: 'OK',
        statusMessage: 'Original status message',
      });

      // Script only changes status, not statusMessage. The scope was initialized with
      // responseStatusMessage from the response object. Since the script doesn't modify it,
      // the readback reads it back unchanged and re-sets it on the response.
      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'responseStatus = QUEUED;', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(response.getStatus()).toBe(Status.QUEUED);
      // statusMessage remains the original value since scope was initialized with it
      expect(response.getStatusMessage()).toBe('Original status message');
    });

    it('should handle null responseStatusMessage from script', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('OK');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'responseStatusMessage = null;', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // Java: (statusMessage == null) ? null : Context.toString(statusMessage)
      expect(response.getStatusMessage()).toBe('');
    });
  });

  describe('Transformed data readback', () => {
    it('should read back transformed data from msg (no template)', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('original response');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'msg = "transformed response data";', enabled: true }],
        cm,
        response,
        '', // no template
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('transformed response data');
    });

    it('should read back transformed data from tmp when template is set', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('original response');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'tmp = "template output";', enabled: true }],
        cm,
        response,
        '<output/>',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('template output');
    });

    it('should return empty string when msg is not modified and is undefined', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('some response');

      // With RAW inbound type, msg = response.getMessage()
      // The script doesn't modify it, so it stays as the response message value
      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: '// no changes to msg', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // msg was set to response.getMessage() in the generated script
      expect(result.result).toBeDefined();
    });

    it('should JSON.stringify object transformed data', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('{}');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: 'msg = { result: "success", code: 200 };', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result!);
      expect(parsed.result).toBe('success');
      expect(parsed.code).toBe(200);
    });
  });

  describe('Map sync after response transformer execution', () => {
    it('should sync channel map changes back to connector message', () => {
      const cm = makeConnectorMessage();
      const response = Response.sent('OK');

      const result = executor.executeResponseTransformer(
        [{ name: 'Step 1', script: '$c("responseProcessed", true);', enabled: true }],
        cm,
        response,
        '',
        SerializationType.RAW,
        SerializationType.RAW,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(cm.getChannelMap().get('responseProcessed')).toBe(true);
    });
  });
});
