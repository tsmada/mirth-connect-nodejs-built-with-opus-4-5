/**
 * Wave 15 Parity Tests
 *
 * Tests for 3 findings from js-runtime-checker scan:
 * - JRC-UAM-001 (Critical): Response constructor positional overloads
 * - JRC-SBD-024 (Major): Preprocessor return-value semantics
 * - JRC-TCD-006 (Minor): validate() boxed String → primitive String
 */

import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';
import { createJavaScriptExecutor, JavaScriptExecutor } from '../../../src/javascript/runtime/JavaScriptExecutor';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import {
  buildBasicScope,
  ScriptContext,
} from '../../../src/javascript/runtime/ScopeBuilder';

// Helper to create a minimal ScriptContext
function createTestContext(overrides: Partial<ScriptContext> = {}): ScriptContext {
  return {
    channelId: 'test-channel',
    channelName: 'Test Channel',
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      isDebugEnabled: () => false,
    },
    ...overrides,
  } as ScriptContext;
}

// Helper to create a ConnectorMessage for testing
function createTestConnectorMessage(): ConnectorMessage {
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

describe('Wave 15 Parity Tests', () => {
  // ============================================================
  // JRC-UAM-001: Response constructor positional overloads
  // Java: new Response(), new Response("msg"), new Response(SENT, "msg"), etc.
  // ============================================================
  describe('JRC-UAM-001: Response constructor positional overloads', () => {
    it('should support no-arg constructor: new Response()', () => {
      // Java: Response() → chains to Response("") → Response(null, "")
      const response = new Response();
      expect(response.getMessage()).toBe('');
      expect(response.getStatusMessage()).toBe('');
      expect(response.getError()).toBe('');
    });

    it('should support string-only constructor: new Response("message")', () => {
      // Java: Response(String message) → chains to Response(null, message)
      const response = new Response('test message');
      expect(response.getMessage()).toBe('test message');
      expect(response.getStatusMessage()).toBe('');
      expect(response.getError()).toBe('');
    });

    it('should support status + message: new Response(SENT, "msg")', () => {
      // Java: Response(Status, String) → most common postprocessor pattern
      const response = new Response(Status.SENT, 'OK');
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('OK');
      expect(response.getStatusMessage()).toBe('');
      expect(response.getError()).toBe('');
    });

    it('should support 3-arg: new Response(SENT, "msg", "statusMsg")', () => {
      const response = new Response(Status.SENT, 'response body', 'HTTP 200 OK');
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('response body');
      expect(response.getStatusMessage()).toBe('HTTP 200 OK');
      expect(response.getError()).toBe('');
    });

    it('should support 4-arg: new Response(ERROR, "msg", "statusMsg", "error")', () => {
      const response = new Response(Status.ERROR, 'failed', 'Connection refused', 'ECONNREFUSED');
      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBe('failed');
      expect(response.getStatusMessage()).toBe('Connection refused');
      expect(response.getError()).toBe('ECONNREFUSED');
    });

    it('should support copy constructor: new Response(otherResponse)', () => {
      const original = new Response(Status.SENT, 'original message', 'OK', '');
      const copy = new Response(original);
      expect(copy.getStatus()).toBe(Status.SENT);
      expect(copy.getMessage()).toBe('original message');
      expect(copy.getStatusMessage()).toBe('OK');
      expect(copy.getError()).toBe('');
    });

    it('should still support existing object form: new Response({status, message})', () => {
      // Backward compatibility with Node.js internal callers
      const response = new Response({ status: Status.SENT, message: 'OK' });
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('OK');
    });

    it('should handle null message in positional form (Java: message == null → "")', () => {
      const response = new Response(Status.SENT, null as unknown as string);
      expect(response.getMessage()).toBe('');
    });

    it('should work from within VM scope (user script pattern)', () => {
      const executor = createJavaScriptExecutor();
      const scope = buildBasicScope();
      // Simulate user script: return new Response(SENT, "OK")
      const result = executor.executeRaw<Response>(
        'new Response(SENT, "processed successfully")',
        scope
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getStatus()).toBe(Status.SENT);
      expect(result.result!.getMessage()).toBe('processed successfully');
    });

    it('should work with ERROR status from VM scope', () => {
      const executor = createJavaScriptExecutor();
      const scope = buildBasicScope();
      const result = executor.executeRaw<Response>(
        'new Response(ERROR, "failed", "timeout", "ETIMEDOUT")',
        scope
      );
      expect(result.success).toBe(true);
      expect(result.result!.getStatus()).toBe(Status.ERROR);
      expect(result.result!.getMessage()).toBe('failed');
      expect(result.result!.getStatusMessage()).toBe('timeout');
      expect(result.result!.getError()).toBe('ETIMEDOUT');
    });

    it('should work with no-arg from VM scope', () => {
      const executor = createJavaScriptExecutor();
      const scope = buildBasicScope();
      const result = executor.executeRaw<Response>(
        'new Response()',
        scope
      );
      expect(result.success).toBe(true);
      expect(result.result).toBeInstanceOf(Response);
      expect(result.result!.getMessage()).toBe('');
    });

    it('should work with string-only from VM scope', () => {
      const executor = createJavaScriptExecutor();
      const scope = buildBasicScope();
      const result = executor.executeRaw<Response>(
        'new Response("just a message")',
        scope
      );
      expect(result.success).toBe(true);
      expect(result.result!.getMessage()).toBe('just a message');
    });
  });

  // ============================================================
  // JRC-SBD-024: Preprocessor return-value semantics
  // Java: if doPreprocess() returns null/undefined, the original
  // raw message is used — even if the user modified `message` in scope.
  // ============================================================
  describe('JRC-SBD-024: Preprocessor return-value semantics', () => {
    let executor: JavaScriptExecutor;

    beforeEach(() => {
      executor = createJavaScriptExecutor();
    });

    it('should use return value when user returns modified message', () => {
      // User script: modifies and returns message (standard pattern)
      const result = executor.executePreprocessor(
        'message = message.replace("foo", "bar"); return message;',
        'hello foo world',
        createTestConnectorMessage(),
        createTestContext()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe('hello bar world');
    });

    it('should use original message when user modifies but does not return', () => {
      // Java behavior: doPreprocess() returns undefined → original message used
      // The user modified `message` in scope but forgot to `return message;`
      const result = executor.executePreprocessor(
        'message = message.replace("foo", "bar");',
        'hello foo world',
        createTestConnectorMessage(),
        createTestContext()
      );
      expect(result.success).toBe(true);
      // Java discards scope modifications when no return — uses original
      expect(result.result).toBe('hello foo world');
    });

    it('should use original message when doPreprocess returns null', () => {
      const result = executor.executePreprocessor(
        'message = "modified"; return null;',
        'original message',
        createTestConnectorMessage(),
        createTestContext()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe('original message');
    });

    it('should use return value when user returns a different string', () => {
      const result = executor.executePreprocessor(
        'return "completely new message";',
        'original',
        createTestConnectorMessage(),
        createTestContext()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe('completely new message');
    });

    it('should use empty string return value (not fallback to original)', () => {
      // Java: if return is empty string (not null/undefined), use it
      const result = executor.executePreprocessor(
        'return "";',
        'original message',
        createTestConnectorMessage(),
        createTestContext()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe('');
    });
  });

  // ============================================================
  // JRC-TCD-006: validate() returns primitive String, not boxed
  // Java: replaceAll returns primitive string
  // Node.js: new String() creates boxed wrapper → strict equality fails
  // Fix: String() (without new) returns primitive
  // ============================================================
  describe('JRC-TCD-006: validate() returns primitive string', () => {
    let executor: JavaScriptExecutor;

    beforeEach(() => {
      executor = createJavaScriptExecutor();
    });

    it('should return primitive string from validate() with replacements', () => {
      // executeWithScope wraps in generateScript() which includes validate()
      const result = executor.executeWithScope<string>(
        'return typeof validate("hello world", "", [["world", "earth"]]);',
        buildBasicScope()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe('string'); // primitive, not 'object' (boxed)
    });

    it('should pass strict equality after validate() replacement', () => {
      const result = executor.executeWithScope<boolean>(
        'return validate("hello world", "", [["world", "earth"]]) === "hello earth";',
        buildBasicScope()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe(true);
    });

    it('should pass strict equality for validate() without replacements', () => {
      const result = executor.executeWithScope<boolean>(
        'return validate("hello", "default") === "hello";',
        buildBasicScope()
      );
      expect(result.success).toBe(true);
      expect(result.result).toBe(true);
    });
  });
});
