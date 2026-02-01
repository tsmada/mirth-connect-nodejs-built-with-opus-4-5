/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpReceiver.java
 *
 * Purpose: TCP source connector that receives messages over TCP/MLLP
 *
 * Key behaviors to replicate:
 * - Server mode: Listen for incoming connections
 * - Client mode: Connect to remote host
 * - MLLP message framing
 * - ACK response generation
 * - Multiple simultaneous connections
 */

import * as net from 'net';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  TcpReceiverProperties,
  getDefaultTcpReceiverProperties,
  ServerMode,
  TransmissionMode,
  ResponseMode,
  hasCompleteMessage,
  unframeMessage,
  frameMessage,
  generateAck,
  extractControlId,
} from './TcpConnectorProperties.js';

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

    if (this.properties.serverMode === ServerMode.SERVER) {
      await this.startServer();
    } else {
      await this.startClient();
    }

    this.running = true;
  }

  /**
   * Stop the TCP receiver
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

    // Close all client connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

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
   */
  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        if (!this.running) {
          reject(error);
        } else {
          console.error('TCP Server error:', error);
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
        console.error('TCP Client error:', error);
        this.scheduleReconnect();
      });

      this.clientSocket.on('close', () => {
        if (this.running) {
          this.scheduleReconnect();
        }
      });

      this.clientSocket.connect(
        this.properties.port,
        this.properties.host,
        () => {
          this.handleConnection(this.clientSocket!);
          resolve();
        }
      );

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
        this.startClient().catch((err) => {
          console.error('Reconnect failed:', err);
          this.scheduleReconnect();
        });
      }
    }, this.properties.reconnectInterval);
  }

  /**
   * Handle incoming connection
   */
  private handleConnection(socket: net.Socket): void {
    // Check connection limit
    if (this.connections.size >= this.properties.maxConnections) {
      socket.destroy();
      return;
    }

    this.connections.add(socket);
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
        const message = unframeMessage(
          buffer,
          this.properties.transmissionMode,
          this.properties.startOfMessageBytes,
          this.properties.endOfMessageBytes
        );

        if (message) {
          // Calculate message length for buffer advancement
          const messageLength = this.calculateFramedLength(message);
          buffer = buffer.subarray(messageLength);

          // Process the message
          await this.processMessage(socket, message);
        } else {
          break;
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.connections.delete(socket);
    });

    // Set timeout if configured
    if (this.properties.receiveTimeout > 0) {
      socket.setTimeout(this.properties.receiveTimeout, () => {
        socket.destroy();
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
  private async processMessage(
    socket: net.Socket,
    message: string
  ): Promise<void> {
    try {
      // Build source map
      const sourceMapData = new Map<string, unknown>();
      sourceMapData.set('remoteAddress', socket.remoteAddress);
      sourceMapData.set('remotePort', socket.remotePort);
      sourceMapData.set('localAddress', socket.localAddress);
      sourceMapData.set('localPort', socket.localPort);

      // Dispatch message
      await this.dispatchRawMessage(message, sourceMapData);

      // Send response if configured
      await this.sendResponse(socket, message);
    } catch (error) {
      console.error('Error processing TCP message:', error);
    }
  }

  /**
   * Send response to client
   */
  private async sendResponse(
    socket: net.Socket,
    message: string
  ): Promise<void> {
    if (this.properties.responseMode === ResponseMode.NONE) {
      return;
    }

    if (this.properties.responseMode === ResponseMode.AUTO) {
      // Generate automatic ACK for HL7 messages
      const controlId = extractControlId(message) || 'UNKNOWN';
      const ack = generateAck(controlId, 'AA');
      const framedAck = frameMessage(
        ack,
        this.properties.transmissionMode,
        this.properties.startOfMessageBytes,
        this.properties.endOfMessageBytes
      );
      socket.write(framedAck);
    }

    // For DESTINATION mode, the channel pipeline would send the response
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
}
