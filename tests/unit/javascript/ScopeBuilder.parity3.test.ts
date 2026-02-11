/**
 * Wave 13 parity tests for ScopeBuilder — ImmutableResponse wrapping (JRC-SBD-014),
 * batch processor scope alerts/globalChannelMap (JRC-SVM-005).
 */
import {
  buildResponseTransformerScope,
  buildBatchProcessorScope,
  ScriptContext,
} from '../../../src/javascript/runtime/ScopeBuilder';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';
import { ImmutableResponse } from '../../../src/javascript/userutil/ImmutableResponse';
import { AlertSender } from '../../../src/javascript/userutil/AlertSender';

function makeConnectorMessage(): ConnectorMessage {
  return new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'HTTP Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
}

function makeScriptContext(): ScriptContext {
  return {
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'HTTP Sender',
    metaDataId: 1,
  };
}

describe('ScopeBuilder Wave 13 Parity Fixes', () => {
  describe('JRC-SBD-014 — ImmutableResponse wrapping in response transformer scope', () => {
    it('should wrap Response in ImmutableResponse', () => {
      const response = new Response({ status: Status.SENT, message: 'OK', statusMessage: 'success' });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      expect(scope.response).toBeInstanceOf(ImmutableResponse);
    });

    it('should expose getNewMessageStatus() on wrapped response', () => {
      const response = new Response({ status: Status.QUEUED, statusMessage: 'retry' });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      const immutable = scope.response as ImmutableResponse;
      expect(immutable.getNewMessageStatus()).toBe(Status.QUEUED);
    });

    it('should expose getMessage() on wrapped response', () => {
      const response = new Response({ status: Status.SENT, message: 'response body' });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      const immutable = scope.response as ImmutableResponse;
      expect(immutable.getMessage()).toBe('response body');
    });

    it('should expose getError() on wrapped response', () => {
      const response = new Response({ status: Status.ERROR, error: 'connection refused' });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      const immutable = scope.response as ImmutableResponse;
      expect(immutable.getError()).toBe('connection refused');
    });

    it('should expose getStatusMessage() on wrapped response', () => {
      const response = new Response({ status: Status.SENT, statusMessage: 'HTTP 200 OK' });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      const immutable = scope.response as ImmutableResponse;
      expect(immutable.getStatusMessage()).toBe('HTTP 200 OK');
    });

    it('should also set responseStatus/responseStatusMessage/responseErrorMessage in scope', () => {
      const response = new Response({
        status: Status.ERROR,
        statusMessage: 'timeout',
        error: 'Connection timed out',
      });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response
      );

      expect(scope.responseStatus).toBe(Status.ERROR);
      expect(scope.responseStatusMessage).toBe('timeout');
      expect(scope.responseErrorMessage).toBe('Connection timed out');
    });

    it('should handle plain object response (backward compat)', () => {
      // Some callers may still pass plain objects
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        { status: Status.SENT, statusMessage: 'ok' }
      );

      expect(scope.response).toBeInstanceOf(ImmutableResponse);
      const immutable = scope.response as ImmutableResponse;
      expect(immutable.getNewMessageStatus()).toBe(Status.SENT);
    });

    it('should include template in scope when provided', () => {
      const response = new Response({ status: Status.SENT });
      const scope = buildResponseTransformerScope(
        makeScriptContext(),
        makeConnectorMessage(),
        response,
        '<template/>'
      );

      expect(scope.template).toBe('<template/>');
    });
  });

  describe('JRC-SVM-005 — Batch processor scope with alerts and globalChannelMap', () => {
    it('should include alerts when channelId is present', () => {
      const scope = buildBatchProcessorScope(
        { channelId: 'test-channel', channelName: 'Test Channel' },
        { batchReader: 'mock-reader' }
      );

      expect(scope.alerts).toBeDefined();
      // AlertSender is constructed with channelId
      expect(scope.alerts).toBeInstanceOf(AlertSender);
    });

    it('should include globalChannelMap and $gc when channelId is present', () => {
      const scope = buildBatchProcessorScope(
        { channelId: 'test-channel', channelName: 'Test Channel' },
        {}
      );

      expect(scope.globalChannelMap).toBeDefined();
      expect(scope.$gc).toBeDefined();
      expect(scope.globalChannelMap).toBe(scope.$gc);
    });

    it('should include channelId and channelName', () => {
      const scope = buildBatchProcessorScope(
        { channelId: 'ch-123', channelName: 'Batch Channel' },
        {}
      );

      expect(scope.channelId).toBe('ch-123');
      expect(scope.channelName).toBe('Batch Channel');
    });

    it('should pass through scopeObjects', () => {
      const scope = buildBatchProcessorScope(
        { channelId: 'test-channel', channelName: 'Test Channel' },
        { batchReader: 'reader', batchComplete: false }
      );

      expect(scope.batchReader).toBe('reader');
      expect(scope.batchComplete).toBe(false);
    });

    it('should include basic scope vars (logger, router, etc.)', () => {
      const scope = buildBatchProcessorScope(
        { channelId: 'test-channel', channelName: 'Test Channel' },
        {}
      );

      // These come from buildBasicScope
      expect(scope.logger).toBeDefined();
      expect(scope.router).toBeDefined();
      expect(scope.replacer).toBeDefined();
      expect(scope.$g).toBeDefined();
      expect(scope.$cfg).toBeDefined();
    });
  });
});
