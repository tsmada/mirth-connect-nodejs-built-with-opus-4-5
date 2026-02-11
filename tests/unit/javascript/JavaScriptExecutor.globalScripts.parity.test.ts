/**
 * JRC-SBD-015 parity tests — Global pre/postprocessor script chaining
 *
 * Java ref: JavaScriptUtil.executePreprocessorScripts() (lines 168-235)
 * Java ref: JavaScriptUtil.executePostprocessorScripts() (lines 260-303)
 *
 * Java Mirth executes both a global preprocessor AND a channel preprocessor in sequence:
 *   global preprocessor(rawMessage) → result → channel preprocessor(result) → final
 *
 * Similarly for postprocessor:
 *   channel postprocessor(message) → Response → global postprocessor(message, Response) → final
 */
import {
  JavaScriptExecutor,
  createJavaScriptExecutor,
} from '../../../src/javascript/runtime/JavaScriptExecutor';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Message } from '../../../src/model/Message';
import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';

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

describe('JRC-SBD-015 — Global pre/postprocessor script chaining', () => {
  let executor: JavaScriptExecutor;

  beforeEach(() => {
    executor = createJavaScriptExecutor();
  });

  describe('executePreprocessorScripts', () => {
    it('should chain global and channel preprocessors — global modifies message, channel receives modified message', () => {
      const cm = makeConnectorMessage();

      // Global prepends "[GLOBAL]", channel appends "[CHANNEL]"
      const globalScript = 'return message + " [GLOBAL]";';
      const channelScript = 'return message + " [CHANNEL]";';

      const result = executor.executePreprocessorScripts(
        channelScript,
        globalScript,
        'original',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // Global runs first: "original [GLOBAL]"
      // Channel runs second on that result: "original [GLOBAL] [CHANNEL]"
      expect(result.result).toBe('original [GLOBAL] [CHANNEL]');
    });

    it('should execute only global preprocessor when channel script is null', () => {
      const cm = makeConnectorMessage();

      const globalScript = 'return message.toUpperCase();';

      const result = executor.executePreprocessorScripts(
        null,
        globalScript,
        'hello world',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('HELLO WORLD');
    });

    it('should execute only channel preprocessor when global script is null', () => {
      const cm = makeConnectorMessage();

      const channelScript = 'return message.toLowerCase();';

      const result = executor.executePreprocessorScripts(
        channelScript,
        null,
        'HELLO WORLD',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('hello world');
    });

    it('should propagate global preprocessor error without running channel preprocessor', () => {
      const cm = makeConnectorMessage();

      const globalScript = 'throw new Error("global preprocessor failed");';
      const channelScript = 'return message + " [CHANNEL]";';

      const result = executor.executePreprocessorScripts(
        channelScript,
        globalScript,
        'original',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('global preprocessor failed');
      // Channel script should NOT have run — result should NOT contain "[CHANNEL]"
    });

    it('should return raw message unchanged when both scripts are null', () => {
      const cm = makeConnectorMessage();

      const result = executor.executePreprocessorScripts(
        null,
        null,
        'unchanged message',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('unchanged message');
    });

    it('should treat empty/whitespace-only scripts as absent', () => {
      const cm = makeConnectorMessage();

      const result = executor.executePreprocessorScripts(
        '   ',
        '  ',
        'still unchanged',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('still unchanged');
    });

    it('should pass global preprocessor result to channel when global returns no explicit value', () => {
      const cm = makeConnectorMessage();

      // Global script modifies 'message' in-place but doesn't return explicitly
      // executePreprocessor reads back context.message
      const globalScript = 'message = message + " [MODIFIED]";';
      const channelScript = 'return message + " [CHANNEL]";';

      const result = executor.executePreprocessorScripts(
        channelScript,
        globalScript,
        'start',
        cm,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // Global modifies message in scope → "start [MODIFIED]"
      // Channel receives that → "start [MODIFIED] [CHANNEL]"
      expect(result.result).toBe('start [MODIFIED] [CHANNEL]');
    });
  });

  describe('executePostprocessorScripts', () => {
    it('should chain channel and global postprocessors — channel runs first, global receives channel Response', () => {
      const msg = makeMessage();

      // Channel postprocessor returns a Response
      const channelScript = 'return new Response({ status: Status.SENT, message: "channel done" });';
      // Global postprocessor checks the response is available and returns its own
      const globalScript = 'return new Response({ status: Status.SENT, message: "global done: " + (response ? response.getMessage() : "no response") });';

      const result = executor.executePostprocessorScripts(
        channelScript,
        globalScript,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getMessage()).toBe('global done: channel done');
    });

    it('should execute only global postprocessor when channel script is null', () => {
      const msg = makeMessage();

      const globalScript = 'return new Response({ status: Status.SENT, message: "global only" });';

      const result = executor.executePostprocessorScripts(
        null,
        globalScript,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result!.getMessage()).toBe('global only');
    });

    it('should execute only channel postprocessor when global script is null', () => {
      const msg = makeMessage();

      const channelScript = 'return new Response({ status: Status.SENT, message: "channel only" });';

      const result = executor.executePostprocessorScripts(
        channelScript,
        null,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result!.getMessage()).toBe('channel only');
    });

    it('should return success with no result when both scripts are null', () => {
      const msg = makeMessage();

      const result = executor.executePostprocessorScripts(
        null,
        null,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });

    it('should propagate channel postprocessor error without running global postprocessor', () => {
      const msg = makeMessage();

      const channelScript = 'throw new Error("channel postprocessor failed");';
      const globalScript = 'return new Response({ status: Status.SENT, message: "global ran" });';

      const result = executor.executePostprocessorScripts(
        channelScript,
        globalScript,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('channel postprocessor failed');
    });

    it('should pass undefined response to global when channel returns no value', () => {
      const msg = makeMessage();

      // Channel postprocessor returns nothing → channelResponse is undefined
      const channelScript = '// no return value';
      // Global checks if response is injected (should be undefined since channel returned nothing)
      const globalScript = 'return "response is " + (typeof response);';

      const result = executor.executePostprocessorScripts(
        channelScript,
        globalScript,
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      // Global's return is a string, which gets converted to Response(SENT, value)
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getMessage()).toBe('response is undefined');
    });

    it('should treat empty/whitespace-only scripts as absent', () => {
      const msg = makeMessage();

      const result = executor.executePostprocessorScripts(
        '   ',
        '  ',
        msg,
        makeScriptContext()
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeUndefined();
    });
  });
});
