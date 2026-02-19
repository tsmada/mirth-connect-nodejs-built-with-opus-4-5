/**
 * useWebSocket Hook
 *
 * React hook for managing WebSocket connection in the dashboard.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  WebSocketClient,
  createDashboardStatusClient,
  ConnectionStateItem,
  ConnectionLogItem,
} from '../../lib/WebSocketClient.js';

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface UseWebSocketOptions {
  /** Server URL (HTTP) */
  serverUrl: string;
  /** Whether to enable WebSocket (default: true) */
  enabled?: boolean;
  /** Auto-subscribe on connect (default: true) */
  autoSubscribe?: boolean;
  /** Channel ID to filter updates (optional) */
  channelId?: string;
  /** Reconnection interval in ms (default: 5000) */
  reconnectInterval?: number;
}

export interface UseWebSocketResult {
  /** Current connection status */
  status: WebSocketStatus;
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Server ID (available after connection) */
  serverId: string | null;
  /** Last error (if any) */
  error: Error | null;
  /** Connect to WebSocket */
  connect: () => Promise<void>;
  /** Disconnect from WebSocket */
  disconnect: () => void;
  /** Subscribe to updates */
  subscribe: (channelId?: string) => void;
  /** Unsubscribe from updates */
  unsubscribe: () => void;
  /** Request current states */
  getStates: () => void;
  /** Register state change handler */
  onStateChange: (handler: (connectorId: string, state: ConnectionStateItem) => void) => void;
  /** Register connection log handler */
  onConnectionLog: (handler: (item: ConnectionLogItem) => void) => void;
  /** Register states handler (for getStates response) */
  onStates: (handler: (states: Record<string, ConnectionStateItem[]>) => void) => void;
}

/**
 * Hook for managing WebSocket connection
 */
export function useWebSocket(options: UseWebSocketOptions): UseWebSocketResult {
  const {
    serverUrl,
    enabled = true,
    autoSubscribe = true,
    channelId,
    reconnectInterval = 5000,
  } = options;

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [serverId, setServerId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const clientRef = useRef<WebSocketClient | null>(null);
  const handlersRef = useRef<{
    stateChange: ((connectorId: string, state: ConnectionStateItem) => void)[];
    connectionLog: ((item: ConnectionLogItem) => void)[];
    states: ((states: Record<string, ConnectionStateItem[]>) => void)[];
  }>({
    stateChange: [],
    connectionLog: [],
    states: [],
  });

  // Create/update client when options change
  useEffect(() => {
    if (!enabled) {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      return;
    }

    const client = createDashboardStatusClient(serverUrl, {
      reconnectInterval,
      autoReconnect: true,
    });

    // Setup event handlers
    client.on('connected', (id: string) => {
      setStatus('connected');
      setServerId(id);
      setError(null);

      if (autoSubscribe) {
        client.subscribe(channelId);
      }
    });

    client.on('disconnected', () => {
      setStatus('disconnected');
    });

    client.on('reconnecting', () => {
      setStatus('reconnecting');
    });

    client.on('stateChange', (connectorId: string, state: ConnectionStateItem) => {
      handlersRef.current.stateChange.forEach((handler) => handler(connectorId, state));
    });

    client.on('connectionLog', (item: ConnectionLogItem) => {
      handlersRef.current.connectionLog.forEach((handler) => handler(item));
    });

    client.on('states', (states: Record<string, ConnectionStateItem[]>) => {
      handlersRef.current.states.forEach((handler) => handler(states));
    });

    client.on('error', (err: Error) => {
      setError(err);
    });

    clientRef.current = client;

    // Cleanup on unmount or options change
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [serverUrl, enabled, reconnectInterval, autoSubscribe, channelId]);

  const connect = useCallback(async () => {
    if (!clientRef.current) return;

    setStatus('connecting');
    setError(null);

    try {
      await clientRef.current.connect();
    } catch (err) {
      setError(err as Error);
      setStatus('disconnected');
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      setStatus('disconnected');
    }
  }, []);

  const subscribe = useCallback((filterChannelId?: string) => {
    if (clientRef.current && clientRef.current.isConnected()) {
      clientRef.current.subscribe(filterChannelId);
    }
  }, []);

  const unsubscribe = useCallback(() => {
    if (clientRef.current && clientRef.current.isConnected()) {
      clientRef.current.unsubscribe();
    }
  }, []);

  const getStates = useCallback(() => {
    if (clientRef.current && clientRef.current.isConnected()) {
      clientRef.current.getStates();
    }
  }, []);

  const onStateChange = useCallback(
    (handler: (connectorId: string, state: ConnectionStateItem) => void) => {
      handlersRef.current.stateChange.push(handler);
    },
    []
  );

  const onConnectionLog = useCallback((handler: (item: ConnectionLogItem) => void) => {
    handlersRef.current.connectionLog.push(handler);
  }, []);

  const onStates = useCallback(
    (handler: (states: Record<string, ConnectionStateItem[]>) => void) => {
      handlersRef.current.states.push(handler);
    },
    []
  );

  return {
    status,
    isConnected: status === 'connected',
    serverId,
    error,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    getStates,
    onStateChange,
    onConnectionLog,
    onStates,
  };
}

export default useWebSocket;
