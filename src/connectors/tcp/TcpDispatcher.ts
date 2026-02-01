/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/tcp/TcpDispatcher.java
 *
 * Purpose: TCP destination connector that sends messages over TCP/MLLP
 *
 * Key behaviors to replicate:
 * - Connect to remote TCP server
 * - MLLP message framing
 * - Wait for ACK response
 * - Connection pooling/keep-alive
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
  private socket: net.Socket | null = null;
  private connected: boolean = false;

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

    // Connect immediately if keep-alive is enabled
    if (this.properties.keepConnectionOpen) {
      await this.connect();
    }

    this.running = true;
  }

  /**
   * Stop the TCP dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await this.disconnect();
    this.running = false;
  }

  /**
   * Connect to the remote host
   */
  private async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('Connection timeout'));
      }, this.properties.socketTimeout);

      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(error);
      });

      this.socket.on('close', () => {
        this.connected = false;
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

      this.socket.connect(connectOptions, () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });
    });
  }

  /**
   * Disconnect from the remote host
   */
  private async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Send message to the TCP destination
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    try {
      // Ensure connection
      if (!this.connected || !this.socket) {
        await this.connect();
      }

      // Get message content
      const content = this.getContent(connectorMessage);

      // Frame the message
      const framedMessage = frameMessage(
        content,
        this.properties.transmissionMode,
        this.properties.startOfMessageBytes,
        this.properties.endOfMessageBytes
      );

      // Send message and wait for response
      const response = await this.sendAndWaitForResponse(framedMessage);

      // Set send date
      connectorMessage.setSendDate(new Date());

      // Set response
      if (response) {
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: response,
          dataType: this.properties.dataType,
          encrypted: false,
        });
      }

      // Update status
      connectorMessage.setStatus(Status.SENT);

      // Store in connector map
      connectorMessage.getConnectorMap().set('remoteHost', this.properties.host);
      connectorMessage.getConnectorMap().set('remotePort', this.properties.port);

      // Close connection if not keeping alive
      if (!this.properties.keepConnectionOpen) {
        await this.disconnect();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(errorMessage);

      // Close broken connection
      await this.disconnect();
      throw error;
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
   * Get content to send from connector message
   */
  private getContent(connectorMessage: ConnectorMessage): string {
    // Use template if provided
    if (this.properties.template) {
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
   * Send data and wait for response
   */
  private async sendAndWaitForResponse(data: Buffer): Promise<string | null> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    // Capture socket reference - we've verified it's not null above
    const socket = this.socket;

    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let responseReceived = false;

      const timeout = setTimeout(() => {
        if (!responseReceived) {
          cleanup();
          // If no response within timeout, resolve with null (may be one-way)
          resolve(null);
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
        socket?.removeListener('data', onData);
        socket?.removeListener('error', onError);
        socket?.removeListener('close', onClose);
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);

      // Send the data
      socket.write(data, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the socket (for testing)
   */
  getSocket(): net.Socket | null {
    return this.socket;
  }
}
