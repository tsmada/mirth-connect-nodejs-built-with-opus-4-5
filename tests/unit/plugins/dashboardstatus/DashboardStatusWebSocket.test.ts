/**
 * Tests for DashboardStatusWebSocket maxClients limit
 */

import { DashboardStatusWebSocketHandler } from '../../../../src/plugins/dashboardstatus/DashboardStatusWebSocket.js';
import { DashboardStatusController } from '../../../../src/plugins/dashboardstatus/DashboardStatusController.js';

// Minimal mock WebSocket
function createMockWs(readyState = 1 /* OPEN */): any {
  const handlers: Record<string, Function[]> = {};
  return {
    readyState,
    OPEN: 1,
    on(event: string, handler: Function) {
      (handlers[event] = handlers[event] || []).push(handler);
    },
    send: jest.fn(),
    close: jest.fn(),
    ping: jest.fn(),
    emit(event: string, ...args: any[]) {
      (handlers[event] || []).forEach(h => h(...args));
    },
  };
}

// Minimal mock IncomingMessage
function createMockReq(): any {
  return { headers: {}, url: '/' };
}

describe('DashboardStatusWebSocket', () => {
  let controller: DashboardStatusController;
  let handler: DashboardStatusWebSocketHandler;

  beforeEach(() => {
    // Minimal controller mock
    controller = {
      getServerId: () => 'test-server-id',
      onConnectionLog: jest.fn(),
      offConnectionLog: jest.fn(),
      onStateChange: jest.fn(),
      offStateChange: jest.fn(),
      getSerializableChannelLog: jest.fn().mockReturnValue([]),
      getConnectionStatesForApi: jest.fn().mockReturnValue({}),
    } as any;
  });

  describe('maxClients limit', () => {
    it('should accept connections under the limit', () => {
      handler = new DashboardStatusWebSocketHandler(controller);
      const ws = createMockWs();
      // Access private method via bracket notation for testing
      (handler as any).handleConnection(ws, createMockReq());

      expect(ws.close).not.toHaveBeenCalled();
      expect(handler.getClientCount()).toBe(1);
    });

    it('should reject connections at the limit with close code 1013', () => {
      // Set very low limit for testing
      const originalEnv = process.env.MIRTH_WS_MAX_CLIENTS;
      process.env.MIRTH_WS_MAX_CLIENTS = '2';

      handler = new DashboardStatusWebSocketHandler(controller);

      // Fill to capacity
      (handler as any).handleConnection(createMockWs(), createMockReq());
      (handler as any).handleConnection(createMockWs(), createMockReq());
      expect(handler.getClientCount()).toBe(2);

      // Third connection should be rejected
      const rejectedWs = createMockWs();
      (handler as any).handleConnection(rejectedWs, createMockReq());

      expect(rejectedWs.close).toHaveBeenCalledWith(1013, 'Maximum WebSocket connections reached');
      expect(handler.getClientCount()).toBe(2); // Still 2, not 3

      process.env.MIRTH_WS_MAX_CLIENTS = originalEnv;
    });

    it('should use default limit of 100', () => {
      const originalEnv = process.env.MIRTH_WS_MAX_CLIENTS;
      delete process.env.MIRTH_WS_MAX_CLIENTS;

      handler = new DashboardStatusWebSocketHandler(controller);
      // Verify it doesn't reject the first connection (default is 100)
      const ws = createMockWs();
      (handler as any).handleConnection(ws, createMockReq());

      expect(ws.close).not.toHaveBeenCalled();
      expect(handler.getClientCount()).toBe(1);

      process.env.MIRTH_WS_MAX_CLIENTS = originalEnv;
    });

    it('should allow new connections after a client disconnects', () => {
      const originalEnv = process.env.MIRTH_WS_MAX_CLIENTS;
      process.env.MIRTH_WS_MAX_CLIENTS = '1';

      handler = new DashboardStatusWebSocketHandler(controller);

      // Fill to capacity
      const ws1 = createMockWs();
      (handler as any).handleConnection(ws1, createMockReq());
      expect(handler.getClientCount()).toBe(1);

      // Simulate disconnect
      (handler as any).handleClose(ws1);
      expect(handler.getClientCount()).toBe(0);

      // New connection should be accepted
      const ws2 = createMockWs();
      (handler as any).handleConnection(ws2, createMockReq());
      expect(ws2.close).not.toHaveBeenCalled();
      expect(handler.getClientCount()).toBe(1);

      process.env.MIRTH_WS_MAX_CLIENTS = originalEnv;
    });
  });
});
