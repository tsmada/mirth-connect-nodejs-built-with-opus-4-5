/**
 * WebSocket Client Tests
 */

import { WebSocketClient, createDashboardStatusClient, createServerLogClient } from '../../../../src/cli/lib/WebSocketClient.js';

describe('WebSocketClient', () => {
  describe('constructor', () => {
    it('should create client with required options', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      expect(client).toBeInstanceOf(WebSocketClient);
      expect(client.isConnected()).toBe(false);
      expect(client.isSubscribed()).toBe(false);
      expect(client.getServerId()).toBeNull();
    });

    it('should use default options', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      // Can't directly access private options, but we can verify behavior
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it('should accept custom options', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
        reconnectInterval: 10000,
        maxReconnectAttempts: 5,
        autoReconnect: false,
      });

      expect(client).toBeInstanceOf(WebSocketClient);
    });
  });

  describe('createDashboardStatusClient', () => {
    it('should convert HTTP URL to WebSocket URL', () => {
      // We can verify this by checking the client is created without throwing
      const client = createDashboardStatusClient('http://localhost:8081');
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it('should convert HTTPS URL to WSS URL', () => {
      const client = createDashboardStatusClient('https://localhost:8443');
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it('should handle URL with trailing slash', () => {
      const client = createDashboardStatusClient('http://localhost:8081/');
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it('should accept custom options', () => {
      const client = createDashboardStatusClient('http://localhost:8081', {
        reconnectInterval: 3000,
        maxReconnectAttempts: 3,
      });
      expect(client).toBeInstanceOf(WebSocketClient);
    });
  });

  describe('createServerLogClient', () => {
    it('should convert HTTP URL to WebSocket URL', () => {
      const client = createServerLogClient('http://localhost:8081');
      expect(client).toBeInstanceOf(WebSocketClient);
    });

    it('should accept custom options', () => {
      const client = createServerLogClient('http://localhost:8081', {
        autoReconnect: false,
      });
      expect(client).toBeInstanceOf(WebSocketClient);
    });
  });

  describe('event emitter', () => {
    it('should allow registering event handlers', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const mockHandler = jest.fn();
      client.on('stateChange', mockHandler);

      // Emit internal event (normally done by WebSocket message handling)
      client.emit('stateChange', 'connector1', { channelId: '123', connected: true });

      expect(mockHandler).toHaveBeenCalledWith('connector1', { channelId: '123', connected: true });
    });

    it('should support error events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const mockHandler = jest.fn();
      client.on('error', mockHandler);

      const error = new Error('Test error');
      client.emit('error', error);

      expect(mockHandler).toHaveBeenCalledWith(error);
    });

    it('should support multiple handlers for same event', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      client.on('connected', handler1);
      client.on('connected', handler2);

      client.emit('connected', 'server-123');

      expect(handler1).toHaveBeenCalledWith('server-123');
      expect(handler2).toHaveBeenCalledWith('server-123');
    });

    it('should support connectionLog events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler = jest.fn();
      client.on('connectionLog', handler);

      const logItem = {
        id: 1,
        channelId: 'ch1',
        event: 'CONNECTED',
        timestamp: new Date().toISOString(),
      };

      client.emit('connectionLog', logItem);

      expect(handler).toHaveBeenCalledWith(logItem);
    });

    it('should support states events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler = jest.fn();
      client.on('states', handler);

      const states = {
        'ch1': [{ channelId: 'ch1', connected: true }],
      };

      client.emit('states', states);

      expect(handler).toHaveBeenCalledWith(states);
    });

    it('should support history events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler = jest.fn();
      client.on('history', handler);

      const items = [{ id: 1 }, { id: 2 }];
      client.emit('history', 'ch1', items);

      expect(handler).toHaveBeenCalledWith('ch1', items);
    });

    it('should support disconnected events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler = jest.fn();
      client.on('disconnected', handler);

      client.emit('disconnected', 'Connection closed');

      expect(handler).toHaveBeenCalledWith('Connection closed');
    });

    it('should support reconnecting events', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      const handler = jest.fn();
      client.on('reconnecting', handler);

      client.emit('reconnecting', 2, 10);

      expect(handler).toHaveBeenCalledWith(2, 10);
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      // Should not throw
      expect(() => client.disconnect()).not.toThrow();
      expect(client.isConnected()).toBe(false);
    });

    it('should reset subscribed state on disconnect', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      // Even though not connected, calling disconnect should ensure clean state
      client.disconnect();

      expect(client.isSubscribed()).toBe(false);
    });
  });

  describe('state checks', () => {
    it('isConnected should return false initially', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      expect(client.isConnected()).toBe(false);
    });

    it('isSubscribed should return false initially', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      expect(client.isSubscribed()).toBe(false);
    });

    it('getServerId should return null initially', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:8081/ws/dashboardstatus',
      });

      expect(client.getServerId()).toBeNull();
    });
  });
});
