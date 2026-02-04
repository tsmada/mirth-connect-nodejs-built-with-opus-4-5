/**
 * Server Log WebSocket Handler
 *
 * Provides real-time WebSocket streaming of server logs.
 *
 * Protocol:
 * - Client sends: { type: 'subscribe', filter?: { level?: string, category?: string } }
 * - Server sends: { type: 'log', data: ServerLogItem }
 * - Client sends: { type: 'unsubscribe' }
 * - Client sends: { type: 'getHistory', fetchSize?: number, lastLogId?: number }
 * - Server sends: { type: 'history', data: ServerLogItem[] }
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import { ServerLogController, serverLogController, LogFilter } from './ServerLogController.js';
import {
  ServerLogItem,
  parseLogLevel,
  serializeServerLogItem,
  shouldDisplayLogLevel,
} from './ServerLogItem.js';

/**
 * WebSocket message types
 */
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface SubscribeMessage extends WsMessage {
  type: 'subscribe';
  filter?: {
    level?: string;
    category?: string;
  };
}

export interface UnsubscribeMessage extends WsMessage {
  type: 'unsubscribe';
}

export interface GetHistoryMessage extends WsMessage {
  type: 'getHistory';
  fetchSize?: number;
  lastLogId?: number;
}

export interface LogMessage extends WsMessage {
  type: 'log';
  data: unknown;
}

export interface HistoryMessage extends WsMessage {
  type: 'history';
  data: unknown[];
}

export interface ErrorMessage extends WsMessage {
  type: 'error';
  message: string;
}

/**
 * Client subscription state
 */
interface ClientState {
  subscribed: boolean;
  filter: LogFilter;
  listener: ((item: ServerLogItem) => void) | null;
}

/**
 * Server Log WebSocket Handler
 */
export class ServerLogWebSocketHandler {
  private wss: WebSocketServer | null = null;
  private controller: ServerLogController;
  private clients: Map<WebSocket, ClientState> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(controller: ServerLogController = serverLogController) {
    this.controller = controller;
  }

  /**
   * Attach to an HTTP server
   */
  attach(server: HttpServer, path: string = '/ws/serverlog'): void {
    this.wss = new WebSocketServer({
      server,
      path,
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Ping clients periodically to keep connections alive
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000);

    console.log(`Server Log WebSocket attached at ${path}`);
  }

  /**
   * Create a standalone WebSocket server
   */
  listen(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Ping clients periodically
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000);

    console.log(`Server Log WebSocket listening on port ${port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientState: ClientState = {
      subscribed: false,
      filter: {},
      listener: null,
    };

    this.clients.set(ws, clientState);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        this.handleMessage(ws, message);
      } catch (error) {
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      this.handleClose(ws);
    });

    ws.on('error', (error) => {
      console.error('Server Log WebSocket error:', error);
      this.handleClose(ws);
    });

    // Send welcome message
    this.send(ws, { type: 'connected', serverId: this.controller.getServerId() });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(ws: WebSocket, message: WsMessage): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(ws, message as SubscribeMessage);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(ws);
        break;

      case 'getHistory':
        this.handleGetHistory(ws, message as GetHistoryMessage);
        break;

      case 'ping':
        this.send(ws, { type: 'pong' });
        break;

      default:
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle subscribe message
   */
  private handleSubscribe(ws: WebSocket, message: SubscribeMessage): void {
    const state = this.clients.get(ws);
    if (!state) return;

    // Unsubscribe from previous if any
    if (state.listener) {
      this.controller.offLog(state.listener);
    }

    // Parse filter
    state.filter = {};
    if (message.filter?.level) {
      state.filter.level = parseLogLevel(message.filter.level);
    }
    if (message.filter?.category) {
      state.filter.category = message.filter.category;
    }

    // Create listener
    state.listener = (item: ServerLogItem) => {
      // Apply filter
      if (state.filter.level && !shouldDisplayLogLevel(item.level, state.filter.level)) {
        return;
      }
      if (
        state.filter.category &&
        item.category &&
        !item.category.toLowerCase().includes(state.filter.category.toLowerCase())
      ) {
        return;
      }

      this.send(ws, {
        type: 'log',
        data: serializeServerLogItem(item),
      });
    };

    // Subscribe
    this.controller.onLog(state.listener);
    state.subscribed = true;

    this.send(ws, { type: 'subscribed', filter: state.filter });
  }

  /**
   * Handle unsubscribe message
   */
  private handleUnsubscribe(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state) return;

    if (state.listener) {
      this.controller.offLog(state.listener);
      state.listener = null;
    }

    state.subscribed = false;
    this.send(ws, { type: 'unsubscribed' });
  }

  /**
   * Handle get history message
   */
  private handleGetHistory(ws: WebSocket, message: GetHistoryMessage): void {
    const state = this.clients.get(ws);
    if (!state) return;

    const fetchSize = message.fetchSize ?? 100;
    const lastLogId = message.lastLogId;

    // Get logs with current filter
    const logs = this.controller.getFilteredLogs(fetchSize, {
      ...state.filter,
      afterId: lastLogId,
    });

    this.send(ws, {
      type: 'history',
      data: logs.map(serializeServerLogItem),
    });
  }

  /**
   * Handle connection close
   */
  private handleClose(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (state?.listener) {
      this.controller.offLog(state.listener);
    }
    this.clients.delete(ws);
  }

  /**
   * Send message to client
   */
  private send(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message });
  }

  /**
   * Ping all clients
   */
  private pingClients(): void {
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }
  }

  /**
   * Broadcast message to all subscribed clients
   */
  broadcast(message: WsMessage): void {
    for (const [ws, state] of this.clients) {
      if (state.subscribed && ws.readyState === WebSocket.OPEN) {
        this.send(ws, message);
      }
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get subscribed client count
   */
  getSubscribedClientCount(): number {
    let count = 0;
    for (const state of this.clients.values()) {
      if (state.subscribed) count++;
    }
    return count;
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Unsubscribe all clients
    for (const [ws, state] of this.clients) {
      if (state.listener) {
        this.controller.offLog(state.listener);
      }
      ws.close();
    }

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

/**
 * Singleton WebSocket handler instance
 */
export const serverLogWebSocket = new ServerLogWebSocketHandler();
