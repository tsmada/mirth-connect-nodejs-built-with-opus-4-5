import { getDefaultHttpReceiverProperties } from '../../../../src/connectors/http/HttpConnectorProperties';
import { HttpReceiver } from '../../../../src/connectors/http/HttpReceiver';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message, MessageData } from '../../../../src/model/Message';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

/**
 * Parity tests for HTTP Receiver:
 * - Wave 17: CPC-MCP-002, CPC-MCE-001
 * - Wave 20: CPC-W20-001 (response body), CPC-W20-002 (variable headers)
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

      // Stub dispatchRawMessageWithResult to avoid needing a full channel
      receiver['dispatchRawMessageWithResult'] = async () => null;

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

/**
 * Wave 20 parity tests:
 * - CPC-W20-001: HTTP Receiver returns channel response body (not empty)
 * - CPC-W20-002: HTTP Receiver applies variable response headers
 */
describe('HttpReceiver Parity (Wave 20)', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('CPC-W20-001: response body from channel pipeline', () => {
    it('should return channel response body in HTTP response', async () => {
      const receiver = new HttpReceiver({
        name: 'Response Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
        },
      });

      // Suppress connection event dispatching (no channel wiring needed for this)
      receiver['dispatchConnectionEvent'] = () => {};

      // Create a mock dispatch result with response content
      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceConnectorMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      sourceConnectorMsg.setContent({
        contentType: ContentType.RESPONSE,
        content: 'CHANNEL_RESPONSE_BODY',
        dataType: 'RAW',
        encrypted: false,
      });
      mockMessage.setConnectorMessage(0, sourceConnectorMsg);

      // Stub dispatchRawMessageWithResult to return our mock message
      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();

      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test input',
        });

        const body = await response.text();
        expect(body).toBe('CHANNEL_RESPONSE_BODY');
      } finally {
        await receiver.stop();
      }
    });

    it('should return empty body when no channel response', async () => {
      const receiver = new HttpReceiver({
        name: 'No Response Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      // Dispatch result with no response content
      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);
      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        const body = await response.text();
        expect(body).toBe('');
      } finally {
        await receiver.stop();
      }
    });

    it('should prefer response-transformed data over raw response', async () => {
      const receiver = new HttpReceiver({
        name: 'Transformed Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      // Set both response and response-transformed content
      sourceMsg.setContent({
        contentType: ContentType.RESPONSE,
        content: 'RAW_RESPONSE',
        dataType: 'RAW',
        encrypted: false,
      });
      sourceMsg.setContent({
        contentType: ContentType.RESPONSE_TRANSFORMED,
        content: 'TRANSFORMED_RESPONSE',
        dataType: 'RAW',
        encrypted: false,
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        const body = await response.text();
        expect(body).toBe('TRANSFORMED_RESPONSE');
      } finally {
        await receiver.stop();
      }
    });

    it('should fall back to first destination response', async () => {
      const receiver = new HttpReceiver({
        name: 'Dest Response Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      // Source with no response
      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      // Destination with response
      const destMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 1,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'HTTP Sender',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });
      destMsg.setContent({
        contentType: ContentType.RESPONSE,
        content: 'DESTINATION_RESPONSE',
        dataType: 'RAW',
        encrypted: false,
      });
      mockMessage.setConnectorMessage(1, destMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        const body = await response.text();
        expect(body).toBe('DESTINATION_RESPONSE');
      } finally {
        await receiver.stop();
      }
    });

    it('should return 500 when source message has ERROR status and no explicit status code', async () => {
      const receiver = new HttpReceiver({
        name: 'Error Status Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
          responseStatusCode: '', // No explicit status code
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.ERROR,
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        expect(response.status).toBe(500);
      } finally {
        await receiver.stop();
      }
    });
  });

  describe('CPC-W20-002: variable response headers', () => {
    it('should apply response headers from channelMap variable', async () => {
      const receiver = new HttpReceiver({
        name: 'Var Headers Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
          useResponseHeadersVariable: true,
          responseHeadersVariable: 'myHeaders',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });

      // Set response headers in channel map as a plain object
      sourceMsg.getChannelMap().set('myHeaders', {
        'X-Custom-Header': 'custom-value',
        'X-Request-Id': '12345',
      });

      sourceMsg.setContent({
        contentType: ContentType.RESPONSE,
        content: 'OK',
        dataType: 'RAW',
        encrypted: false,
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        expect(response.headers.get('x-custom-header')).toBe('custom-value');
        expect(response.headers.get('x-request-id')).toBe('12345');
      } finally {
        await receiver.stop();
      }
    });

    it('should apply response headers from Map variable', async () => {
      const receiver = new HttpReceiver({
        name: 'Map Headers Test',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
          useResponseHeadersVariable: true,
          responseHeadersVariable: 'headerMap',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });

      // Set response headers as a Map in channelMap
      const headersMap = new Map<string, string>();
      headersMap.set('X-From-Map', 'map-value');
      sourceMsg.getChannelMap().set('headerMap', headersMap);

      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        expect(response.headers.get('x-from-map')).toBe('map-value');
      } finally {
        await receiver.stop();
      }
    });

    it('should not apply variable headers when useResponseHeadersVariable is false', async () => {
      const receiver = new HttpReceiver({
        name: 'No Var Headers',
        properties: {
          host: '127.0.0.1',
          port: 0,
          contextPath: '/test',
          useResponseHeadersVariable: false,
          responseHeadersVariable: 'myHeaders',
        },
      });

      receiver['dispatchConnectionEvent'] = () => {};

      const mockMessage = new Message({
        messageId: 1,
        serverId: 'test',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
      } as MessageData);

      const sourceMsg = new ConnectorMessage({
        messageId: 1,
        metaDataId: 0,
        channelId: 'test-channel',
        channelName: 'Test',
        connectorName: 'Source',
        serverId: 'test',
        receivedDate: new Date(),
        status: Status.SENT,
      });

      sourceMsg.getChannelMap().set('myHeaders', {
        'X-Should-Not-Appear': 'hidden',
      });
      mockMessage.setConnectorMessage(0, sourceMsg);

      receiver['dispatchRawMessageWithResult'] = async () => mockMessage;

      await receiver.start();
      try {
        const server = receiver.getServer();
        const address = server?.address();
        if (!address || typeof address === 'string') throw new Error('No address');

        const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
          method: 'POST',
          body: 'test',
        });

        expect(response.headers.get('x-should-not-appear')).toBeNull();
      } finally {
        await receiver.stop();
      }
    });
  });
});
