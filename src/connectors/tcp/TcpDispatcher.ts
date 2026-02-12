/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpDispatcher.java
 *
 * Purpose: TCP destination connector that sends messages over TCP/MLLP
 *
 * Key behaviors to replicate:
 * - Connect to remote TCP server
 * - MLLP message framing
 * - Wait for ACK response
 * - Connection map for persistent connections (keyed by dispatcherId+host+port)
 * - Connection event dispatching for dashboard status
 * - Socket timeout with queueOnResponseTimeout
 * - Send timeout thread for closing idle persistent connections
 */

import * as net from 'net';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import {
  TcpDispatcherProperties,
  getDefaultTcpDispatcherProperties,
  frameMessage,
  unframeMessage,
  hasCompleteMessage,
} from './TcpConnectorProperties.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';

export interface TcpDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<TcpDispatcherProperties>;
}

/**
 * TCP Destination Connector that sends messages
 */
export class TcpDispatcher extends DestinationConnector {
  private properties: TcpDispatcherProperties;

  /**
   * CPC-CLG-002: Persistent connection map matching Java's ConcurrentHashMap<String, Socket>.
   * Key format: dispatcherId + host + port (+ localAddress + localPort if overriding)
   */
  private connectedSockets: Map<string, net.Socket> = new Map();

  /**
   * Timeout threads for closing idle persistent connections.
   * Matches Java's timeoutThreads ConcurrentHashMap<String, Thread>.
   */
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: TcpDispatcherConfig) {
    super({
      name: config.name ?? 'TCP Sender',
      transportName: 'TCP',
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultTcpDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): TcpDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<TcpDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the TCP dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // CPC-MCE-001: Dispatch IDLE event on deploy (matching Java onDeploy)
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

    this.running = true;
  }

  /**
   * Stop the TCP dispatcher
   * Closes all persistent connections and clears timeout timers.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Clear all timeout timers
    for (const [, timer] of this.timeoutTimers) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();

    // Close all persistent connections
    for (const [socketKey, socket] of this.connectedSockets) {
      this.closeSocketQuietly(socketKey, socket);
    }
    this.connectedSockets.clear();

    this.running = false;
  }

  /**
   * Build the socket key for the connection map.
   * Matches Java: dispatcherId + remoteAddress + remotePort [+ localAddress + localPort]
   */
  private getSocketKey(connectorMessage: ConnectorMessage): string {
    let key = `${connectorMessage.getMetaDataId()}${this.properties.host}${this.properties.port}`;
    if (this.properties.localAddress) {
      key += `${this.properties.localAddress}${this.properties.localPort ?? 0}`;
    }
    return key;
  }

  /**
   * Send message to the TCP destination.
   * CPC-MCE-001: Full connection event lifecycle
   * CPC-CLG-002: Persistent connection map
   * CPC-MEH-003: Socket timeout with queueOnResponseTimeout
   * CPC-STG-002: CONNECTING/SENDING/WAITING_FOR_RESPONSE states
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    const socketKey = this.getSocketKey(connectorMessage);
    let socket: net.Socket | null = null;

    try {
      // Cancel existing timeout timer for this socket key
      const existingTimer = this.timeoutTimers.get(socketKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.timeoutTimers.delete(socketKey);
      }

      // CPC-CLG-002: Look up existing socket in connection map
      socket = this.connectedSockets.get(socketKey) ?? null;

      // Check if we need a new socket
      if (!this.properties.keepConnectionOpen || !socket || socket.destroyed) {
        // Close existing stale socket
        if (socket) {
          this.closeSocketQuietly(socketKey, socket);
          this.connectedSockets.delete(socketKey);
        }

        // CPC-STG-002: CONNECTING state
        const connectInfo = `Trying to connect on ${this.properties.host}:${this.properties.port}...`;
        this.dispatchConnectionEvent(ConnectionStatusEventType.CONNECTING, connectInfo);

        socket = await this.connectSocket();

        // CPC-CLG-002: Store in connection map
        this.connectedSockets.set(socketKey, socket);

        // CPC-MCE-001: CONNECTED + ConnectorCountEvent
        const connInfo = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
        this.dispatchConnectorCountEvent(true, connInfo);
      }

      // CPC-MCE-001: SENDING event
      const sendInfo = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
      this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING, sendInfo);

      // Get message content
      const content = this.getContent(connectorMessage);

      // Frame the message
      const framedMessage = frameMessage(
        content,
        this.properties.transmissionMode,
        this.properties.startOfMessageBytes,
        this.properties.endOfMessageBytes
      );

      // Send the data
      await this.writeToSocket(socket, framedMessage);

      // Handle response
      if (!this.properties.ignoreResponse) {
        // CPC-STG-002: WAITING_FOR_RESPONSE state
        const waitInfo = `Waiting for response from ${socket.remoteAddress}:${socket.remotePort} (Timeout: ${this.properties.responseTimeout} ms)...`;
        this.dispatchConnectionEvent(ConnectionStatusEventType.WAITING_FOR_RESPONSE, waitInfo);

        try {
          const response = await this.readResponse(socket);

          // Set send date
          connectorMessage.setSendDate(new Date());

          if (response) {
            connectorMessage.setContent({
              contentType: ContentType.RESPONSE,
              content: response,
              dataType: this.properties.dataType,
              encrypted: false,
            });
          }

          connectorMessage.setStatus(Status.SENT);
        } catch (readError: unknown) {
          // CPC-MEH-003: Socket timeout handling with queueOnResponseTimeout
          const isTimeout = readError instanceof Error &&
            readError.message.includes('timeout');

          if (isTimeout) {
            if (this.properties.queueOnResponseTimeout) {
              // Leave status as QUEUED for retry (Java default behavior)
              connectorMessage.setStatus(Status.QUEUED);
              connectorMessage.setProcessingError('Timeout waiting for response');
            } else {
              connectorMessage.setStatus(Status.ERROR);
              connectorMessage.setProcessingError('Timeout waiting for response');
            }
          } else {
            connectorMessage.setStatus(Status.ERROR);
            connectorMessage.setProcessingError(
              readError instanceof Error ? readError.message : String(readError)
            );
          }

          const errMsg = readError instanceof Error ? readError.message : String(readError);
          // CPC-MCE-001: FAILURE event on read error
          this.dispatchConnectionEvent(
            ConnectionStatusEventType.FAILURE,
            `Error receiving response from ${socket.remoteAddress}:${socket.remotePort}: ${errMsg}`
          );

          // Close broken socket
          this.closeSocketQuietly(socketKey, socket);
          this.connectedSockets.delete(socketKey);
          return;
        }
      } else {
        // Ignoring response - always SENT
        connectorMessage.setSendDate(new Date());
        connectorMessage.setStatus(Status.SENT);
      }

      // Store connection info in connector map
      connectorMessage.getConnectorMap().set('remoteHost', this.properties.host);
      connectorMessage.getConnectorMap().set('remotePort', this.properties.port);

      // Handle connection lifecycle after send
      if (this.properties.keepConnectionOpen) {
        if (this.properties.sendTimeout > 0) {
          // Start a timer to close the connection after sendTimeout idle period
          this.startTimeoutTimer(socketKey);
        }
      } else {
        // Close immediately if not keeping alive
        this.closeSocketQuietly(socketKey, socket);
        this.connectedSockets.delete(socketKey);
      }

    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // CPC-MCE-001: FAILURE event on send error
      const failMsg = socket
        ? `Error sending message (${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}): ${errorMessage}`
        : `Error sending message: ${errorMessage}`;
      this.dispatchConnectionEvent(ConnectionStatusEventType.FAILURE, failMsg);

      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(errorMessage);

      // Clean up broken connection
      if (socket) {
        const timer = this.timeoutTimers.get(socketKey);
        if (timer) {
          clearTimeout(timer);
          this.timeoutTimers.delete(socketKey);
        }
        this.closeSocketQuietly(socketKey, socket);
        this.connectedSockets.delete(socketKey);
      }

      throw error;
    } finally {
      // CPC-MCE-001: IDLE event after send completes (matching Java's finally block)
      if (socket) {
        const addr = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
        this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE, addr);
      }
    }
  }

  /**
   * Get response from the last send
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Create and connect a new socket.
   */
  private async connectSocket(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, this.properties.socketTimeout);

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      const connectOptions: net.SocketConnectOpts = {
        host: this.properties.host,
        port: this.properties.port,
      };

      if (this.properties.localAddress) {
        connectOptions.localAddress = this.properties.localAddress;
      }
      if (this.properties.localPort) {
        connectOptions.localPort = this.properties.localPort;
      }

      socket.connect(connectOptions, () => {
        clearTimeout(timeout);

        // Configure socket options (matching Java initSocket)
        socket.setNoDelay(true);
        socket.setKeepAlive(this.properties.keepConnectionOpen);

        resolve(socket);
      });
    });
  }

  /**
   * Write data to socket.
   */
  private writeToSocket(socket: net.Socket, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Read response from socket with timeout.
   * CPC-MEH-003: Throws on timeout to trigger queueOnResponseTimeout logic.
   */
  private readResponse(socket: net.Socket): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let responseReceived = false;

      const timeout = setTimeout(() => {
        if (!responseReceived) {
          cleanup();
          // CPC-MEH-003: Throw timeout error instead of resolving null
          reject(new Error('Response timeout'));
        }
      }, this.properties.responseTimeout);

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (
          hasCompleteMessage(
            buffer,
            this.properties.transmissionMode,
            this.properties.endOfMessageBytes
          )
        ) {
          responseReceived = true;
          cleanup();

          const response = unframeMessage(
            buffer,
            this.properties.transmissionMode,
            this.properties.startOfMessageBytes,
            this.properties.endOfMessageBytes
          );

          resolve(response);
        }
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => {
        cleanup();
        if (!responseReceived) {
          resolve(null);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
    });
  }

  /**
   * Start a timeout timer for a persistent connection.
   * After sendTimeout ms of idle time, the socket is closed.
   * Matches Java's startThread() pattern.
   */
  private startTimeoutTimer(socketKey: string): void {
    // Clear any existing timer
    const existing = this.timeoutTimers.get(socketKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timeoutTimers.delete(socketKey);
      const socket = this.connectedSockets.get(socketKey);
      if (socket) {
        this.closeSocketQuietly(socketKey, socket);
        this.connectedSockets.delete(socketKey);
      }
    }, this.properties.sendTimeout);

    this.timeoutTimers.set(socketKey, timer);
  }

  /**
   * Close a socket quietly (no throw), dispatching DISCONNECTED event.
   */
  private closeSocketQuietly(_socketKey: string, socket: net.Socket): void {
    try {
      if (!socket.destroyed) {
        const addr = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
        socket.destroy();
        // CPC-MCE-001: DISCONNECTED + ConnectorCountEvent on socket close
        this.dispatchConnectorCountEvent(false, addr);
      }
    } catch {
      // Ignore close errors
    }
  }

  /**
   * Get content to send from connector message
   */
  private getContent(connectorMessage: ConnectorMessage): string {
    // Use template if provided
    if (this.properties.template && this.properties.template !== '${message.encodedData}') {
      return this.properties.template;
    }

    const encodedContent = connectorMessage.getEncodedContent();
    if (encodedContent) {
      return encodedContent.content;
    }

    const rawData = connectorMessage.getRawData();
    return rawData || '';
  }

  /**
   * Check if connected (any persistent connection exists)
   */
  isConnected(): boolean {
    return this.connectedSockets.size > 0;
  }

  /**
   * Get the number of persistent connections (for testing)
   */
  getConnectionCount(): number {
    return this.connectedSockets.size;
  }

  /**
   * Get the connection map (for testing)
   */
  getConnectedSockets(): Map<string, net.Socket> {
    return this.connectedSockets;
  }
}
