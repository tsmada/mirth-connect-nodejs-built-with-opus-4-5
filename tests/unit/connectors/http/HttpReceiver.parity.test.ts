import { getDefaultHttpReceiverProperties } from '../../../../src/connectors/http/HttpConnectorProperties';
import { HttpReceiver } from '../../../../src/connectors/http/HttpReceiver';

/**
 * Parity tests for HTTP Receiver - Wave 17 findings:
 * - CPC-MCP-002: useResponseHeadersVariable
 * - CPC-MCE-001: Event dispatch (CONNECTED, RECEIVING, SENDING, IDLE)
 */

describe('HttpReceiver Parity (Wave 17)', () => {
  describe('CPC-MCP-002: response headers variable properties', () => {
    it('should include useResponseHeadersVariable in default properties', () => {
      const defaults = getDefaultHttpReceiverProperties();
      expect(defaults.useResponseHeadersVariable).toBe(false);
      expect(defaults.responseHeadersVariable).toBe('');
    });

    it('should create receiver with response headers variable properties', () => {
      const receiver = new HttpReceiver({
        name: 'Test',
        properties: {
          port: 9999,
          useResponseHeadersVariable: true,
          responseHeadersVariable: 'responseHeaders',
        },
      });

      const props = receiver.getProperties();
      expect(props.useResponseHeadersVariable).toBe(true);
      expect(props.responseHeadersVariable).toBe('responseHeaders');
    });

    it('should default useResponseHeadersVariable to false', () => {
      const receiver = new HttpReceiver({
        name: 'Test',
        properties: { port: 9998 },
      });

      const props = receiver.getProperties();
      expect(props.useResponseHeadersVariable).toBe(false);
      expect(props.responseHeadersVariable).toBe('');
    });
  });

  describe('CPC-MCE-001: event dispatching', () => {
    it('should dispatch IDLE event on successful start', async () => {
      const receiver = new HttpReceiver({
        name: 'Event Test',
        properties: {
          host: '127.0.0.1',
          port: 0, // Let OS assign port
        },
      });

      // Track dispatched events
      const events: string[] = [];
      receiver['dispatchConnectionEvent'] = (eventType: string, _info?: string) => {
        events.push(eventType);
        // Don't call original since it requires channel/dashboard wiring
      };

      await receiver.start();

      try {
        expect(events).toContain('IDLE');
      } finally {
        await receiver.stop();
      }
    });

    it('should dispatch DISCONNECTED event on stop', async () => {
      const receiver = new HttpReceiver({
        name: 'Stop Event Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
        },
      });

      const events: string[] = [];
      receiver['dispatchConnectionEvent'] = (eventType: string) => {
        events.push(eventType);
      };

      await receiver.start();
      events.length = 0; // Clear start events

      await receiver.stop();

      expect(events).toContain('DISCONNECTED');
    });

    it('should dispatch CONNECTED, RECEIVING, SENDING, IDLE during request handling', async () => {
      const receiver = new HttpReceiver({
        name: 'Request Event Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
        },
      });

      const events: string[] = [];
      receiver['dispatchConnectionEvent'] = (eventType: string) => {
        events.push(eventType);
      };

      // Stub dispatchRawMessage to avoid needing a full channel
      receiver['dispatchRawMessage'] = async () => {};

      await receiver.start();

      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Could not get server address');
        }

        // Send a test request
        await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test message',
        });

        // Wait for async handling
        await new Promise(resolve => setTimeout(resolve, 50));

        // Should have: IDLE (start), CONNECTED (request), RECEIVING (body read),
        // SENDING (response write), IDLE (finally)
        expect(events).toContain('CONNECTED');
        expect(events).toContain('RECEIVING');
        expect(events).toContain('SENDING');
        // The last event should be IDLE (from finally block)
        const idleEvents = events.filter(e => e === 'IDLE');
        expect(idleEvents.length).toBeGreaterThanOrEqual(2); // start IDLE + request IDLE
      } finally {
        await receiver.stop();
      }
    });
  });
});
