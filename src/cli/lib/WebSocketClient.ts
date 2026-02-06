/**
 * WebSocket Client for CLI Dashboard
 *
 * Provides real-time connection to Mirth Connect server WebSocket endpoints
 * with auto-reconnection and event-based API.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * WebSocket message types (matching server protocol)
 */
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface ConnectionLogItem {
  id: number;
  serverId: string;
  channelId: string;
  channelName: string;
  connectorId: string;
  connectorType: string;
  connectorName: string;
  event: string;
  information?: string;
  timestamp: string;
}

export interface ConnectionStateItem {
  channelId: string;
  connectorId: string;
  connectorName: string;
  connectorType: string;
  socketAddress?: string;
  localAddress?: string;
  connected: boolean;
  sendAttempts: number;
  sendSuccesses: number;
  sendFailures: number;
  readAttempts: number;
  readSuccesses: number;
  readFailures: number;
  timestamp: string;
}

export interface WebSocketClientOptions {
  /** WebSocket URL (e.g., ws://localhost:8081/ws/dashboardstatus) */
  url: string;
  /** Reconnection interval in ms (default: 5000) */
  reconnectInterval?: number;
  /** Maximum reconnection attempts (default: 10, -1 for infinite) */
  maxReconnectAttempts?: number;
  /** Whether to auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

export interface WebSocketClientEvents {
  connected: (serverId: string) => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  stateChange: (connectorId: string, state: ConnectionStateItem) => void;
  connectionLog: (item: ConnectionLogItem) => void;
  states: (states: Record<string, ConnectionStateItem[]>) => void;
  history: (channelId: string | null, items: ConnectionLogItem[]) => void;
  error: (error: Error) => void;
}

/**
 * WebSocket Client for CLI
 *
 * Connects to Mirth Connect WebSocket endpoints for real-time updates.
 *
 * @example
 * ```typescript
 * const client = new WebSocketClient({
 *   url: 'ws://localhost:8081/ws/dashboardstatus',
 * });
 *
 * client.on('stateChange', (connectorId, state) => {
 *   console.log(`Connector ${connectorId} changed:`, state);
 * });
 *
 * await client.connect();
 * client.subscribe();
 * ```
 */
export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<WebSocketClientOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;
  private serverId: string | null = null;
  private subscribed = false;

  constructor(options: WebSocketClientOptions) {
    super();
    this.options = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      autoReconnect: true,
      ...options,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.isClosing = false;
      this.ws = new WebSocket(this.options.url);

      const onOpen = () => {
        this.reconnectAttempts = 0;
        this.startPing();
        // Don't cleanup yet — we still need onMessage to receive
        // the server's 'connected' welcome message and resolve the promise.
      };

      const onMessage = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WsMessage;
          if (message.type === 'connected') {
            this.serverId = message.serverId as string;
            this.emit('connected', this.serverId);
            resolve();
          }
          this.handleMessage(message);
        } catch (error) {
          this.emit('error', error as Error);
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed before established'));
      };

      const cleanup = () => {
        this.ws?.removeListener('open', onOpen);
        this.ws?.removeListener('message', onMessage);
        this.ws?.removeListener('error', onError);
        this.ws?.removeListener('close', onClose);
      };

      this.ws.on('open', onOpen);
      this.ws.once('message', onMessage);
      this.ws.once('error', onError);
      this.ws.once('close', onClose);

      // Setup permanent handlers after initial connection
      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WsMessage;
          this.handleMessage(message);
        } catch (error) {
          this.emit('error', error as Error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.stopPing();
        this.subscribed = false;

        if (!this.isClosing) {
          this.emit('disconnected', reason?.toString() || `Code: ${code}`);
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
      });
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.isClosing = true;
    this.stopPing();
    this.cancelReconnect();
    this.subscribed = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if subscribed
   */
  isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * Get the server ID
   */
  getServerId(): string | null {
    return this.serverId;
  }

  /**
   * Subscribe to real-time updates
   *
   * @param channelId Optional channel ID to filter updates
   */
  subscribe(channelId?: string): void {
    this.send({ type: 'subscribe', channelId });
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribe(): void {
    this.send({ type: 'unsubscribe' });
    this.subscribed = false;
  }

  /**
   * Get current connector states
   */
  getStates(): void {
    this.send({ type: 'getStates' });
  }

  /**
   * Get connection log history
   *
   * @param channelId Optional channel ID to filter
   * @param fetchSize Number of items to fetch (default: 100)
   * @param lastLogId ID of last known log item for pagination
   */
  getHistory(channelId?: string, fetchSize?: number, lastLogId?: number): void {
    this.send({ type: 'getHistory', channelId, fetchSize, lastLogId });
  }

  /**
   * Send a ping to keep connection alive
   */
  ping(): void {
    this.send({ type: 'ping' });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: WsMessage): void {
    switch (message.type) {
      case 'connected':
        // Already handled in connect()
        break;

      case 'subscribed':
        this.subscribed = true;
        break;

      case 'unsubscribed':
        this.subscribed = false;
        break;

      case 'stateChange':
        this.emit(
          'stateChange',
          message.connectorId as string,
          message.data as ConnectionStateItem
        );
        break;

      case 'connectionLog':
        this.emit('connectionLog', message.data as ConnectionLogItem);
        break;

      case 'states':
        this.emit('states', message.data as Record<string, ConnectionStateItem[]>);
        break;

      case 'history':
        this.emit(
          'history',
          (message.channelId as string) ?? null,
          message.data as ConnectionLogItem[]
        );
        break;

      case 'pong':
        // Ping response, connection is alive
        break;

      case 'error':
        this.emit('error', new Error(message.message as string));
        break;
    }
  }

  /**
   * Send a message to the server
   */
  private send(message: WsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start ping interval
   */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.ping();
    }, 25000); // Ping every 25 seconds (server expects activity within 30s)
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.options.autoReconnect) {
      return;
    }

    if (
      this.options.maxReconnectAttempts !== -1 &&
      this.reconnectAttempts >= this.options.maxReconnectAttempts
    ) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.cancelReconnect();
    this.reconnectAttempts++;

    this.emit(
      'reconnecting',
      this.reconnectAttempts,
      this.options.maxReconnectAttempts
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // Re-subscribe if we were subscribed before
        if (this.subscribed) {
          this.subscribe();
        }
      } catch {
        // Will trigger another reconnect via close handler
      }
    }, this.options.reconnectInterval);
  }

  /**
   * Cancel pending reconnection
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create a dashboard status WebSocket client
 */
export function createDashboardStatusClient(
  serverUrl: string,
  options?: Partial<WebSocketClientOptions>
): WebSocketClient {
  // Convert HTTP URL to WebSocket URL
  const wsUrl = serverUrl
    .replace(/^https?:\/\//, (match) =>
      match === 'https://' ? 'wss://' : 'ws://'
    )
    .replace(/\/$/, '') + '/ws/dashboardstatus';

  return new WebSocketClient({
    url: wsUrl,
    ...options,
  });
}

/**
 * Create a server log WebSocket client
 */
export function createServerLogClient(
  serverUrl: string,
  options?: Partial<WebSocketClientOptions>
): WebSocketClient {
  // Convert HTTP URL to WebSocket URL
  const wsUrl = serverUrl
    .replace(/^https?:\/\//, (match) =>
      match === 'https://' ? 'wss://' : 'ws://'
    )
    .replace(/\/$/, '') + '/ws/serverlog';

  return new WebSocketClient({
    url: wsUrl,
    ...options,
  });
}

export default WebSocketClient;
