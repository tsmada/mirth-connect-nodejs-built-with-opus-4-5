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
import * as tls from 'tls';
import * as fs from 'fs';
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
   * CPC-RCP-002: Resolve ${variable} placeholders in connector properties before each send.
   * Matches Java TcpDispatcher.replaceConnectorProperties() (line 88):
   * Resolves remoteAddress, remotePort, localAddress, localPort, template.
   * Returns a shallow clone — original properties are NOT modified.
   */
  replaceConnectorProperties(
    props: TcpDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): TcpDispatcherProperties {
    const resolved = { ...props };

    resolved.host = this.resolveVariables(resolved.host, connectorMessage);
    const resolvedPort = this.resolveVariables(String(resolved.port), connectorMessage);
    resolved.port = parseInt(resolvedPort, 10) || resolved.port;
    resolved.localAddress = resolved.localAddress
      ? this.resolveVariables(resolved.localAddress, connectorMessage)
      : undefined;
    if (resolved.localPort !== undefined) {
      const resolvedLocalPort = this.resolveVariables(String(resolved.localPort), connectorMessage);
      resolved.localPort = parseInt(resolvedLocalPort, 10) || resolved.localPort;
    }
    resolved.template = this.resolveVariables(resolved.template, connectorMessage);

    return resolved;
  }

  /**
   * Simple ${variable} resolution using connector message maps.
   * Checks channelMap, then sourceMap, then connectorMap.
   * Matches Java ValueReplacer.replaceValues() map lookup order.
   */
  private resolveVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template || !template.includes('${')) return template;

    return template.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // Built-in message variables (matches Java ValueReplacer)
      if (varName === 'message.encodedData') {
        const encoded = connectorMessage.getEncodedContent();
        if (encoded?.content) return encoded.content;
        return connectorMessage.getRawData() ?? match;
      }
      if (varName === 'message.rawData') {
        return connectorMessage.getRawData() ?? match;
      }

      // Check channel map
      const channelMap = connectorMessage.getChannelMap?.();
      if (channelMap) {
        const v = channelMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check source map
      const sourceMap = connectorMessage.getSourceMap?.();
      if (sourceMap) {
        const v = sourceMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      // Check connector map
      const connectorMap = connectorMessage.getConnectorMap?.();
      if (connectorMap) {
        const v = connectorMap.get(varName);
        if (v !== undefined && v !== null) return String(v);
      }

      return match; // Leave unresolved variables as-is
    });
  }

  /**
   * Build the socket key for the connection map.
   * Matches Java: dispatcherId + remoteAddress + remotePort [+ localAddress + localPort]
   * Uses resolved properties so dynamic routing creates distinct socket keys.
   */
  private getSocketKey(connectorMessage: ConnectorMessage, resolvedProps: TcpDispatcherProperties): string {
    let key = `${connectorMessage.getMetaDataId()}${resolvedProps.host}${resolvedProps.port}`;
    if (resolvedProps.localAddress) {
      key += `${resolvedProps.localAddress}${resolvedProps.localPort ?? 0}`;
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
    // CPC-RCP-002: Resolve ${variable} placeholders before each send
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);
    const socketKey = this.getSocketKey(connectorMessage, resolvedProps);
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
      if (!resolvedProps.keepConnectionOpen || !socket || socket.destroyed) {
        // Close existing stale socket
        if (socket) {
          this.closeSocketQuietly(socketKey, socket);
          this.connectedSockets.delete(socketKey);
        }

        // CPC-STG-002: CONNECTING state
        const connectInfo = `Trying to connect on ${resolvedProps.host}:${resolvedProps.port}...`;
        this.dispatchConnectionEvent(ConnectionStatusEventType.CONNECTING, connectInfo);

        socket = await this.connectSocket(resolvedProps);

        // CPC-CLG-002: Store in connection map
        this.connectedSockets.set(socketKey, socket);

        // CPC-MCE-001: CONNECTED + ConnectorCountEvent
        const connInfo = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
        this.dispatchConnectorCountEvent(true, connInfo);
      }

      // CPC-MCE-001: SENDING event
      const sendInfo = `${socket.localAddress}:${socket.localPort} -> ${socket.remoteAddress}:${socket.remotePort}`;
      this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING, sendInfo);

      // Get message content using resolved template
      const content = this.getContent(connectorMessage, resolvedProps);

      // Frame the message
      const framedMessage = frameMessage(
        content,
        resolvedProps.transmissionMode,
        resolvedProps.startOfMessageBytes,
        resolvedProps.endOfMessageBytes
      );

      // Send the data
      await this.writeToSocket(socket, framedMessage);

      // Handle response
      if (!resolvedProps.ignoreResponse) {
        // CPC-STG-002: WAITING_FOR_RESPONSE state
        const waitInfo = `Waiting for response from ${socket.remoteAddress}:${socket.remotePort} (Timeout: ${resolvedProps.responseTimeout} ms)...`;
        this.dispatchConnectionEvent(ConnectionStatusEventType.WAITING_FOR_RESPONSE, waitInfo);

        try {
          const response = await this.readResponse(socket, resolvedProps);

          // Set send date
          connectorMessage.setSendDate(new Date());

          if (response) {
            connectorMessage.setContent({
              contentType: ContentType.RESPONSE,
              content: response,
              dataType: resolvedProps.dataType,
              encrypted: false,
            });
          }

          connectorMessage.setStatus(Status.SENT);
        } catch (readError: unknown) {
          // CPC-MEH-003: Socket timeout handling with queueOnResponseTimeout
          const isTimeout = readError instanceof Error &&
            readError.message.includes('timeout');

          if (isTimeout) {
            if (resolvedProps.queueOnResponseTimeout) {
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

      // Store resolved connection info in connector map
      connectorMessage.getConnectorMap().set('remoteHost', resolvedProps.host);
      connectorMessage.getConnectorMap().set('remotePort', resolvedProps.port);

      // Handle connection lifecycle after send
      if (resolvedProps.keepConnectionOpen) {
        if (resolvedProps.sendTimeout > 0) {
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
   * Create and connect a new socket using resolved properties.
   */
  private async connectSocket(resolvedProps: TcpDispatcherProperties): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, resolvedProps.socketTimeout);

      if (this.properties.tls?.enabled) {
        const tlsProps = this.properties.tls;
        const tlsOptions: tls.ConnectionOptions = {
          host: resolvedProps.host,
          port: resolvedProps.port,
          rejectUnauthorized: tlsProps.rejectUnauthorized ?? true,
        };

        if (tlsProps.certStorePath) {
          tlsOptions.cert = fs.readFileSync(tlsProps.certStorePath);
        }
        if (tlsProps.keyStorePath) {
          tlsOptions.key = fs.readFileSync(tlsProps.keyStorePath);
        }
        if (tlsProps.trustStorePath) {
          tlsOptions.ca = fs.readFileSync(tlsProps.trustStorePath);
        }
        if (tlsProps.passphrase) {
          tlsOptions.passphrase = tlsProps.passphrase;
        }
        if (tlsProps.sniServerName) {
          tlsOptions.servername = tlsProps.sniServerName;
        }
        if (tlsProps.minVersion) {
          tlsOptions.minVersion = tlsProps.minVersion as tls.SecureVersion;
        }
        // localAddress/localPort are net.TcpSocketConnectOpts properties forwarded by tls.connect()
        const connectOpts = tlsOptions as tls.ConnectionOptions & { localAddress?: string; localPort?: number };
        if (resolvedProps.localAddress) {
          connectOpts.localAddress = resolvedProps.localAddress as string;
        }
        if (resolvedProps.localPort) {
          connectOpts.localPort = resolvedProps.localPort as number;
        }

        const socket = tls.connect(connectOpts, () => {
          clearTimeout(timeout);
          socket.setNoDelay(true);
          socket.setKeepAlive(resolvedProps.keepConnectionOpen);
          resolve(socket);
        });

        socket.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      } else {
        const socket = new net.Socket();

        socket.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        const connectOptions: net.SocketConnectOpts = {
          host: resolvedProps.host,
          port: resolvedProps.port,
        };

        if (resolvedProps.localAddress) {
          connectOptions.localAddress = resolvedProps.localAddress;
        }
        if (resolvedProps.localPort) {
          connectOptions.localPort = resolvedProps.localPort;
        }

        socket.connect(connectOptions, () => {
          clearTimeout(timeout);

          // Configure socket options (matching Java initSocket)
          socket.setNoDelay(true);
          socket.setKeepAlive(resolvedProps.keepConnectionOpen);

          resolve(socket);
        });
      }
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
  private readResponse(socket: net.Socket, resolvedProps?: TcpDispatcherProperties): Promise<string | null> {
    const props = resolvedProps ?? this.properties;
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let responseReceived = false;

      const timeout = setTimeout(() => {
        if (!responseReceived) {
          cleanup();
          // CPC-MEH-003: Throw timeout error instead of resolving null
          reject(new Error('Response timeout'));
        }
      }, props.responseTimeout);

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (
          hasCompleteMessage(
            buffer,
            props.transmissionMode,
            props.endOfMessageBytes
          )
        ) {
          responseReceived = true;
          cleanup();

          const response = unframeMessage(
            buffer,
            props.transmissionMode,
            props.startOfMessageBytes,
            props.endOfMessageBytes
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
   * Get content to send from connector message using resolved properties.
   */
  private getContent(connectorMessage: ConnectorMessage, resolvedProps: TcpDispatcherProperties): string {
    // Use resolved template if provided and not the default placeholder
    // Note: after replaceConnectorProperties, ${message.encodedData} is already resolved
    if (resolvedProps.template && resolvedProps.template !== '${message.encodedData}') {
      return resolvedProps.template;
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
