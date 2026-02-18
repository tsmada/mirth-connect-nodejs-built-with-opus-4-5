/**
 * Dashboard Status WebSocket Handler
 *
 * Provides real-time WebSocket streaming of dashboard status updates.
 *
 * Protocol:
 * - Client sends: { type: 'subscribe', channelId?: string }
 * - Server sends: { type: 'connectionLog', data: ConnectionLogItem }
 * - Server sends: { type: 'stateChange', connectorId: string, data: ConnectionStateItem }
 * - Client sends: { type: 'unsubscribe' }
 * - Client sends: { type: 'getHistory', channelId?: string, fetchSize?: number, lastLogId?: number }
 * - Server sends: { type: 'history', data: ConnectionLogItem[] }
 * - Client sends: { type: 'getStates' }
 * - Server sends: { type: 'states', data: Record<string, ConnectionStateItem[]> }
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import {
  DashboardStatusController,
  dashboardStatusController,
} from './DashboardStatusController.js';
import { isShadowMode, getPromotedChannels } from '../../cluster/ShadowMode.js';
import {
  ConnectionLogItem,
  serializeConnectionLogItem,
} from './ConnectionLogItem.js';
import {
  ConnectionStateItem,
  serializeConnectionStateItem,
} from './ConnectionStateItem.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

/**
 * WebSocket message types
 */
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface SubscribeMessage extends WsMessage {
  type: 'subscribe';
  channelId?: string;
}

export interface UnsubscribeMessage extends WsMessage {
  type: 'unsubscribe';
}

export interface GetHistoryMessage extends WsMessage {
  type: 'getHistory';
  channelId?: string;
  fetchSize?: number;
  lastLogId?: number;
}

export interface GetStatesMessage extends WsMessage {
  type: 'getStates';
}

/**
 * Client subscription state
 */
interface ClientState {
  subscribed: boolean;
  channelId: string | null;
  logListener: ((item: ConnectionLogItem) => void) | null;
  stateListener: ((connectorId: string, state: ConnectionStateItem) => void) | null;
}

/**
 * Dashboard Status WebSocket Handler
 */
export class DashboardStatusWebSocketHandler {
  private wss: WebSocketServer | null = null;
  private controller: DashboardStatusController;
  private clients: Map<WebSocket, ClientState> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(controller: DashboardStatusController = dashboardStatusController) {
    this.controller = controller;
  }

  /**
   * Attach to an HTTP server.
   * Uses noServer mode — the caller must route upgrade requests
   * via handleUpgrade() to avoid conflicts with other WebSocketServers
   * on the same HTTP server.
   */
  attach(_server: HttpServer, path: string = '/ws/dashboardstatus'): void {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Ping clients periodically
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000);

    logger.info(`Dashboard Status WebSocket attached at ${path}`);
  }

  /**
   * Handle an HTTP upgrade request.
   * Called by the shared upgrade dispatcher in server.ts.
   */
  handleUpgrade(request: IncomingMessage, socket: import('stream').Duplex, head: Buffer): void {
    if (!this.wss) return;
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss!.emit('connection', ws, request);
    });
  }

  /**
   * Create a standalone WebSocket server
   */
  listen(port: number): void {
    this.wss = new WebSocketServer({ port, perMessageDeflate: false });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Ping clients periodically
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000);

    logger.info(`Dashboard Status WebSocket listening on port ${port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientState: ClientState = {
      subscribed: false,
      channelId: null,
      logListener: null,
      stateListener: null,
    };

    this.clients.set(ws, clientState);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        this.handleMessage(ws, message);
      } catch {
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      this.handleClose(ws);
    });

    ws.on('error', (error) => {
      logger.error('Dashboard Status WebSocket error', error as Error);
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

      case 'getStates':
        this.handleGetStates(ws);
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
    this.cleanupSubscription(state);

    // Set channel filter
    state.channelId = message.channelId ?? null;

    // Create log listener
    state.logListener = (item: ConnectionLogItem) => {
      // Filter by channel if specified
      if (state.channelId !== null && item.channelId !== state.channelId) {
        return;
      }

      this.send(ws, {
        type: 'connectionLog',
        data: serializeConnectionLogItem(item),
      });
    };

    // Create state listener
    state.stateListener = (connectorId: string, stateItem: ConnectionStateItem) => {
      // Filter by channel if specified
      if (state.channelId !== null && stateItem.channelId !== state.channelId) {
        return;
      }

      this.send(ws, {
        type: 'stateChange',
        connectorId,
        data: serializeConnectionStateItem(stateItem),
      });
    };

    // Subscribe
    this.controller.onConnectionLog(state.logListener);
    this.controller.onStateChange(state.stateListener);
    state.subscribed = true;

    this.send(ws, { type: 'subscribed', channelId: state.channelId });
  }

  /**
   * Handle unsubscribe message
   */
  private handleUnsubscribe(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state) return;

    this.cleanupSubscription(state);
    state.subscribed = false;

    this.send(ws, { type: 'unsubscribed' });
  }

  /**
   * Handle get history message
   */
  private handleGetHistory(ws: WebSocket, message: GetHistoryMessage): void {
    const fetchSize = message.fetchSize ?? 100;
    const channelId = message.channelId ?? null;
    const lastLogId = message.lastLogId;

    const logs = this.controller.getSerializableChannelLog(channelId, fetchSize, lastLogId);

    this.send(ws, {
      type: 'history',
      channelId,
      data: logs,
    });
  }

  /**
   * Handle get states message
   */
  private handleGetStates(ws: WebSocket): void {
    const states = this.controller.getConnectionStatesForApi();
    const shadowMode = isShadowMode();

    this.send(ws, {
      type: 'states',
      data: states,
      ...(shadowMode && {
        shadowMode: true,
        promotedChannels: Array.from(getPromotedChannels()),
      }),
    });
  }

  /**
   * Cleanup subscription for a client
   */
  private cleanupSubscription(state: ClientState): void {
    if (state.logListener) {
      this.controller.offConnectionLog(state.logListener);
      state.logListener = null;
    }
    if (state.stateListener) {
      this.controller.offStateChange(state.stateListener);
      state.stateListener = null;
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (state) {
      this.cleanupSubscription(state);
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

    // Cleanup all client subscriptions
    for (const [ws, state] of this.clients) {
      this.cleanupSubscription(state);
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
export const dashboardStatusWebSocket = new DashboardStatusWebSocketHandler();
