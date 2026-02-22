/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpReceiver.java
 *
 * Purpose: TCP source connector that receives messages over TCP/MLLP
 *
 * Key behaviors to replicate:
 * - Server mode: Listen for incoming connections with bind retry
 * - Client mode: Connect to remote host with reconnect
 * - MLLP message framing
 * - ACK response generation
 * - Multiple simultaneous connections with maxConnections enforcement
 * - Connection event dispatching for dashboard status
 * - Per-socket state tracking
 * - respondOnNewConnection support
 */

import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { ListenerInfo } from '../../api/models/DashboardStatus.js';
import {
  TcpReceiverProperties,
  getDefaultTcpReceiverProperties,
  ServerMode,
  TransmissionMode,
  ResponseMode,
  NEW_CONNECTION,
  hasCompleteMessage,
  unframeMessage,
  frameMessage,
} from './TcpConnectorProperties.js';
import { ACKGenerator } from '../../util/ACKGenerator.js';
import type { Message } from '../../model/Message.js';
import { Status } from '../../model/Status.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';

/**
 * Per-socket state tracking.
 * Matches Java's TcpReader state variables.
 */
interface SocketState {
  socket: net.Socket;
  reading: boolean;
  canRead: boolean;
}

export interface TcpReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<TcpReceiverProperties>;
}

/**
 * TCP Source Connector that receives messages
 */
export class TcpReceiver extends SourceConnector {
  private properties: TcpReceiverProperties;
  private server: net.Server | null = null;
  private clientSocket: net.Socket | null = null;
  private connections: Set<net.Socket> = new Set();
  private socketStates: Map<net.Socket, SocketState> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: TcpReceiverConfig) {
    super({
      name: config.name ?? 'TCP Listener',
      transportName: 'TCP',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultTcpReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): TcpReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<TcpReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the TCP receiver
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('TCP Receiver is already running');
    }

    // CPC-MCE-001: Dispatch IDLE + ConnectorCountEvent on deploy (matching Java onDeploy)
    this.dispatchConnectorCountEvent(false, undefined, this.properties.maxConnections);
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

    if (this.properties.serverMode === ServerMode.SERVER) {
      await this.startServer();
    } else {
      await this.startClient();
    }

    this.running = true;
  }

  /**
   * Stop the TCP receiver
   * CPC-RCG-001: Complete socket cleanup on stop
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Mark all readers as unable to read (matching Java's onStop logic)
    for (const [, state] of this.socketStates) {
      state.canRead = false;
      // If the reader is currently blocking on read, close the socket to unblock it
      if (state.reading) {
        state.socket.destroy();
      }
    }

    // Close all client connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    this.socketStates.clear();

    // Close client socket
    if (this.clientSocket) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.running = false;
  }

  /**
   * Start in server mode (listen for connections)
   * CPC-CLG-003: Bind retry on EADDRINUSE matching Java (10 attempts, 1s interval)
   */
  private async startServer(): Promise<void> {
    const maxAttempts = this.properties.bindRetryAttempts;
    const retryInterval = this.properties.bindRetryInterval;
    let bindAttempts = 0;

    while (true) {
      try {
        bindAttempts++;
        await this.attemptBind();
        return; // Success
      } catch (error: unknown) {
        const isAddressInUse =
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'EADDRINUSE';

        if (isAddressInUse && bindAttempts < maxAttempts) {
          // Retry after interval, matching Java's createServerSocket() behavior
          await new Promise<void>((resolve) => setTimeout(resolve, retryInterval));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Attempt to bind the server socket once.
   */
  private attemptBind(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionHandler = (socket: net.Socket) => {
        this.handleConnection(socket);
      };

      if (this.properties.tls?.enabled) {
        const tlsOptions: tls.TlsOptions = {};
        const tlsProps = this.properties.tls;

        if (tlsProps.keyStorePath) {
          tlsOptions.key = fs.readFileSync(tlsProps.keyStorePath);
        }
        if (tlsProps.certStorePath) {
          tlsOptions.cert = fs.readFileSync(tlsProps.certStorePath);
        }
        if (tlsProps.trustStorePath) {
          tlsOptions.ca = fs.readFileSync(tlsProps.trustStorePath);
        }
        if (tlsProps.requireClientCert || tlsProps.requireClientAuth) {
          tlsOptions.requestCert = true;
          tlsOptions.rejectUnauthorized = true;
        }
        if (tlsProps.passphrase) {
          tlsOptions.passphrase = tlsProps.passphrase;
        }
        if (tlsProps.minVersion) {
          tlsOptions.minVersion = tlsProps.minVersion as tls.SecureVersion;
        }

        this.server = tls.createServer(tlsOptions, connectionHandler);
      } else {
        this.server = net.createServer(connectionHandler);
      }

      this.server.on('error', (error) => {
        if (!this.running) {
          reject(error);
        } else {
          // CPC-MCE-001: FAILURE event on server error
          this.dispatchConnectionEvent(
            ConnectionStatusEventType.FAILURE,
            `Server error: ${error.message}`
          );
        }
      });

      this.server.listen(this.properties.port, this.properties.host, () => {
        resolve();
      });
    });
  }

  /**
   * Start in client mode (connect to remote host)
   */
  private async startClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.clientSocket = new net.Socket();

      this.clientSocket.on('error', (error) => {
        // CPC-MCE-001: FAILURE event on client error
        this.dispatchConnectionEvent(
          ConnectionStatusEventType.FAILURE,
          `Client error: ${error.message}`
        );
        this.scheduleReconnect();
      });

      this.clientSocket.on('close', () => {
        if (this.running) {
          // CPC-MCE-001: INFO event on client reconnect wait
          this.dispatchConnectionEvent(
            ConnectionStatusEventType.INFO,
            `Client socket finished, waiting ${this.properties.reconnectInterval} ms...`
          );
          this.scheduleReconnect();
        }
      });

      this.clientSocket.connect(this.properties.port, this.properties.host, () => {
        this.handleConnection(this.clientSocket!);
        resolve();
      });

      this.clientSocket.on('error', (error) => {
        if (!this.running) {
          reject(error);
        }
      });
    });
  }

  /**
   * Schedule reconnection for client mode
   */
  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) {
        this.startClient().catch(() => {
          this.scheduleReconnect();
        });
      }
    }, this.properties.reconnectInterval);
  }

  /**
   * Handle incoming connection
   * CPC-CLG-004: maxConnections enforcement
   * CPC-MCE-001: Connection event dispatching
   * CPC-STG-001: Per-socket state tracking
   */
  private handleConnection(socket: net.Socket): void {
    // CPC-CLG-004: Enforce maxConnections
    if (this.connections.size >= this.properties.maxConnections) {
      socket.destroy();
      return;
    }

    this.connections.add(socket);

    // CPC-STG-001: Track per-socket state
    const state: SocketState = {
      socket,
      reading: false,
      canRead: true,
    };
    this.socketStates.set(socket, state);

    // CPC-MCE-001: CONNECTED + ConnectorCountEvent on new connection
    const addr = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
    this.dispatchConnectorCountEvent(true, addr);

    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
      buffer = Buffer.concat([buffer, data]);

      // Check for complete messages
      while (
        hasCompleteMessage(
          buffer,
          this.properties.transmissionMode,
          this.properties.endOfMessageBytes
        )
      ) {
        // CPC-MCE-001: RECEIVING event
        this.dispatchConnectionEvent(
          ConnectionStatusEventType.RECEIVING,
          `Message received from ${socket.localAddress}:${socket.localPort}, processing...`
        );

        // Mark as reading
        const socketState = this.socketStates.get(socket);
        if (socketState) socketState.reading = true;

        const message = unframeMessage(
          buffer,
          this.properties.transmissionMode,
          this.properties.startOfMessageBytes,
          this.properties.endOfMessageBytes
        );

        if (socketState) socketState.reading = false;

        if (message) {
          // Calculate message length for buffer advancement
          const messageLength = this.calculateFramedLength(message);
          buffer = buffer.subarray(messageLength);

          // Process the message
          await this.processMessage(socket, message);

          // CPC-MCE-001: IDLE event after processing
          this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE, addr);
        } else {
          break;
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.socketStates.delete(socket);
      // CPC-MCE-001: DISCONNECTED + ConnectorCountEvent on socket close
      this.dispatchConnectorCountEvent(false, addr);
    });

    socket.on('error', (error) => {
      // CPC-MCE-001: FAILURE event on socket error
      this.dispatchConnectionEvent(
        ConnectionStatusEventType.FAILURE,
        `Error receiving message from ${socket.localAddress}:${socket.localPort}: ${error.message}`
      );
      this.connections.delete(socket);
      this.socketStates.delete(socket);
    });

    // Set timeout if configured
    if (this.properties.receiveTimeout > 0) {
      socket.setTimeout(this.properties.receiveTimeout, () => {
        if (!this.properties.keepConnectionOpen) {
          // CPC-MCE-001: FAILURE event on timeout (non-keepalive)
          this.dispatchConnectionEvent(
            ConnectionStatusEventType.FAILURE,
            `Timeout waiting for message from ${socket.localAddress}:${socket.localPort}.`
          );
          socket.destroy();
        } else {
          // CPC-MCE-001: INFO event on timeout (keepalive)
          this.dispatchConnectionEvent(
            ConnectionStatusEventType.INFO,
            `Timeout waiting for message from ${socket.localAddress}:${socket.localPort}.`
          );
        }
      });
    }
  }

  /**
   * Calculate the length of a framed message in the buffer
   */
  private calculateFramedLength(message: string): number {
    const messageLength = Buffer.from(message, 'utf-8').length;

    switch (this.properties.transmissionMode) {
      case TransmissionMode.MLLP:
        // Start block + message + end block + CR
        return 1 + messageLength + 2;

      case TransmissionMode.FRAME:
        return (
          this.properties.startOfMessageBytes.length +
          messageLength +
          this.properties.endOfMessageBytes.length
        );

      case TransmissionMode.RAW:
      default:
        return messageLength;
    }
  }

  /**
   * Process a received message
   */
  private async processMessage(socket: net.Socket, message: string): Promise<void> {
    try {
      // Build source map
      const sourceMapData = new Map<string, unknown>();
      sourceMapData.set('remoteAddress', socket.remoteAddress);
      sourceMapData.set('remotePort', socket.remotePort);
      sourceMapData.set('localAddress', socket.localAddress);
      sourceMapData.set('localPort', socket.localPort);

      // Dispatch message and capture result for response generation
      const dispatchResult = await this.dispatchRawMessageWithResult(message, sourceMapData);

      // Send response if configured
      await this.sendResponse(socket, message, dispatchResult);
    } catch (error) {
      // CPC-MCE-001: FAILURE event on processing error
      const errMsg = error instanceof Error ? error.message : String(error);
      this.dispatchConnectionEvent(
        ConnectionStatusEventType.FAILURE,
        `Error processing message: ${errMsg}`
      );
      // Send error ACK if response is configured
      try {
        await this.sendResponse(socket, message, null);
      } catch {
        // Ignore response send errors
      }
    }
  }

  /**
   * Dispatch raw message and return the Message result.
   * Uses handleRawMessage() which checks processBatch and routes to
   * batch adaptor when enabled (matching Java Mirth SourceConnector.handleRawMessage).
   */
  private async dispatchRawMessageWithResult(
    rawData: string,
    sourceMap?: Map<string, unknown>
  ): Promise<Message | null> {
    return this.handleRawMessage(rawData, sourceMap);
  }

  /**
   * Send response to client.
   * Uses the full ACKGenerator which properly swaps sender/receiver from the
   * incoming message MSH fields, matching Java Mirth behavior.
   *
   * Supports respondOnNewConnection modes (matching Java TcpReceiver):
   * - SAME_CONNECTION (0): Write response on the same socket (default)
   * - NEW_CONNECTION (1): Open new TCP connection to responseAddress:responsePort
   * - NEW_CONNECTION_ON_RECOVERY (2): Same as SAME_CONNECTION for normal flow,
   *   but allows recovered responses to be sent on a new connection
   */
  private async sendResponse(
    socket: net.Socket,
    message: string,
    dispatchResult: Message | null
  ): Promise<void> {
    if (this.properties.responseMode === ResponseMode.NONE) {
      return;
    }

    // Determine the response data
    let responseData: string | null = null;

    if (this.properties.responseMode === ResponseMode.AUTO) {
      const ackCode = this.determineAckCode(dispatchResult);
      responseData = ACKGenerator.generateAckResponse(message, ackCode);
    } else if (this.properties.responseMode === ResponseMode.DESTINATION) {
      responseData = this.getDestinationResponse(dispatchResult);
    }

    if (!responseData) {
      return;
    }

    const framedResponse = frameMessage(
      responseData,
      this.properties.transmissionMode,
      this.properties.startOfMessageBytes,
      this.properties.endOfMessageBytes
    );

    // Determine which socket to write the response to
    if (this.properties.respondOnNewConnection === NEW_CONNECTION) {
      // Open a new TCP connection to responseAddress:responsePort
      await this.sendResponseOnNewConnection(framedResponse);
    } else {
      // Write response on the same socket that received the message
      // (covers both SAME_CONNECTION=0 and NEW_CONNECTION_ON_RECOVERY=2 during normal flow)
      this.dispatchConnectionEvent(
        ConnectionStatusEventType.INFO,
        `Sending response to ${socket.localAddress}:${socket.localPort}...`
      );
      socket.write(framedResponse);
    }
  }

  /**
   * Send response on a new outbound TCP connection.
   * Matches Java's createResponseSocket() + connectResponseSocket() + sendResponse() pattern.
   * Opens a connection to responseAddress:responsePort, writes the framed response, then closes.
   */
  private async sendResponseOnNewConnection(framedResponse: Buffer): Promise<void> {
    const responseAddress = this.properties.responseAddress;
    const responsePort = parseInt(this.properties.responsePort, 10);

    if (!responseAddress || !responsePort || isNaN(responsePort)) {
      throw new Error(
        'respondOnNewConnection is enabled but responseAddress or responsePort is not configured'
      );
    }

    this.dispatchConnectionEvent(
      ConnectionStatusEventType.INFO,
      `Sending response to ${responseAddress}:${responsePort} (new connection)...`
    );

    return new Promise<void>((resolve, reject) => {
      const responseSocket = new net.Socket();

      responseSocket.on('error', (error) => {
        this.dispatchConnectionEvent(
          ConnectionStatusEventType.FAILURE,
          `Error sending response to ${responseAddress}:${responsePort}: ${error.message}`
        );
        reject(error);
      });

      responseSocket.connect(responsePort, responseAddress, () => {
        responseSocket.write(framedResponse, (writeError) => {
          // Always close the response socket after writing (matching Java's finally block)
          responseSocket.destroy();

          if (writeError) {
            this.dispatchConnectionEvent(
              ConnectionStatusEventType.FAILURE,
              `Error sending response to ${responseAddress}:${responsePort}: ${writeError.message}`
            );
            reject(writeError);
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Determine the ACK code based on message processing result.
   * AA = all destinations succeeded, AE = any had errors, AR = filtered at source.
   */
  private determineAckCode(dispatchResult: Message | null): 'AA' | 'AE' | 'AR' {
    if (!dispatchResult) {
      return 'AE'; // No result means processing failed
    }

    // Check source connector message (metaDataId 0)
    const sourceMsg = dispatchResult.getConnectorMessage(0);
    if (sourceMsg) {
      if (sourceMsg.getStatus() === Status.ERROR) return 'AE';
      if (sourceMsg.getStatus() === Status.FILTERED) return 'AR';
    }

    // Check all destination connector messages for errors
    const connectorMessages = dispatchResult.getConnectorMessages();
    for (const [metaDataId, connMsg] of connectorMessages) {
      if (metaDataId === 0) continue; // Skip source
      if (connMsg.getStatus() === Status.ERROR) return 'AE';
    }

    return 'AA';
  }

  /**
   * Extract the response data from a destination connector message.
   * Used for ResponseMode.DESTINATION to return the destination's actual response.
   */
  private getDestinationResponse(dispatchResult: Message | null): string | null {
    if (!dispatchResult) return null;

    const connectorMessages = dispatchResult.getConnectorMessages();
    for (const [metaDataId, connMsg] of connectorMessages) {
      if (metaDataId === 0) continue; // Skip source
      // Return the first destination's response content
      const responseContent = connMsg.getResponseContent();
      if (responseContent) {
        return responseContent.content;
      }
    }

    return null;
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): net.Server | null {
    return this.server;
  }

  /**
   * Get the number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get socket states (for testing)
   */
  getSocketStates(): Map<net.Socket, SocketState> {
    return this.socketStates;
  }

  /**
   * Get listener information for dashboard display.
   * Returns null if the connector is not in server mode or not running.
   */
  getListenerInfo(): ListenerInfo | null {
    // Only provide listener info for server mode connectors that are running
    if (this.properties.serverMode !== ServerMode.SERVER) {
      return null;
    }

    if (!this.running || !this.server) {
      return null;
    }

    return {
      port: this.properties.port,
      host: this.properties.host || '0.0.0.0',
      connectionCount: this.connections.size,
      maxConnections: this.properties.maxConnections,
      transportType: this.properties.tls?.enabled
        ? this.properties.transmissionMode === TransmissionMode.MLLP
          ? 'MLLPS'
          : 'TCP+TLS'
        : this.properties.transmissionMode === TransmissionMode.MLLP
          ? 'MLLP'
          : 'TCP',
      listening: this.server.listening,
    };
  }
}
