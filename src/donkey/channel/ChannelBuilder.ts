/**
 * Channel Builder
 *
 * Builds runtime Channel instances from channel configuration stored in the database.
 * Parses channel XML/JSON and creates appropriate connectors based on transport type.
 */

import { Channel, ChannelConfig } from './Channel.js';
import { DestinationConnector } from './DestinationConnector.js';
import { TcpReceiver } from '../../connectors/tcp/TcpReceiver.js';
import { TcpDispatcher } from '../../connectors/tcp/TcpDispatcher.js';
import { TcpReceiverProperties, TcpDispatcherProperties, ServerMode, TransmissionMode, ResponseMode } from '../../connectors/tcp/TcpConnectorProperties.js';
import { HttpDispatcher } from '../../connectors/http/HttpDispatcher.js';
import { HttpDispatcherProperties } from '../../connectors/http/HttpConnectorProperties.js';
import { FileDispatcher } from '../../connectors/file/FileDispatcher.js';
import { FileDispatcherProperties } from '../../connectors/file/FileConnectorProperties.js';
import { DatabaseDispatcher } from '../../connectors/jdbc/DatabaseDispatcher.js';
import { Channel as ChannelModel, Connector } from '../../api/models/Channel.js';

/**
 * Build a runtime Channel from a channel configuration
 */
export function buildChannel(channelConfig: ChannelModel): Channel {
  // Create channel with basic config
  const config: ChannelConfig = {
    id: channelConfig.id,
    name: channelConfig.name,
    description: channelConfig.description || '',
    enabled: channelConfig.enabled ?? true,
    preprocessorScript: channelConfig.preprocessingScript,
    postprocessorScript: channelConfig.postprocessingScript,
    deployScript: channelConfig.deployScript,
    undeployScript: channelConfig.undeployScript,
  };

  const channel = new Channel(config);

  // Build source connector based on transport type
  const sourceConnector = buildSourceConnector(channelConfig);
  if (sourceConnector) {
    channel.setSourceConnector(sourceConnector);
  }

  // Build destination connectors
  for (const destConfig of channelConfig.destinationConnectors || []) {
    const dest = buildDestinationConnector(destConfig);
    if (dest) {
      channel.addDestinationConnector(dest);
    }
  }

  return channel;
}

/**
 * Build source connector from configuration
 */
function buildSourceConnector(channelConfig: ChannelModel): TcpReceiver | null {
  const sourceConfig = channelConfig.sourceConnector;
  if (!sourceConfig) {
    return null;
  }

  const transportName = sourceConfig.transportName;

  switch (transportName) {
    case 'TCP Listener':
    case 'MLLP Listener':
      return buildTcpReceiver(sourceConfig.properties);
    default:
      console.warn(`Unsupported source connector transport: ${transportName}`);
      return null;
  }
}

/**
 * Build TCP/MLLP receiver from properties
 */
function buildTcpReceiver(properties: unknown): TcpReceiver {
  const props = properties as Record<string, unknown>;
  const listenerProps = (props?.listenerConnectorProperties || props) as Record<string, unknown>;
  const transmissionProps = props?.transmissionModeProperties as Record<string, unknown>;

  // Parse host and port
  let host = String(listenerProps?.host || '0.0.0.0');
  let port = parseInt(String(listenerProps?.port || '6661'), 10);

  // Handle variable references like ${listenerAddress}
  if (host.startsWith('${')) {
    host = '0.0.0.0'; // Default to all interfaces
  }
  if (isNaN(port) || String(listenerProps?.port || '').startsWith('${')) {
    // Use environment variable for default port, falling back to 6662 for Node.js
    // This allows using a different port than Java Mirth (which typically uses 6661)
    port = parseInt(process.env['NODE_MLLP_PORT'] || '6662', 10);
  }

  // Determine transmission mode from transmissionModeProperties
  let transmissionMode = TransmissionMode.MLLP;
  let startOfMessageBytes: number[] = [0x0b];
  let endOfMessageBytes: number[] = [0x1c, 0x0d];

  if (transmissionProps) {
    const pluginPointName = String(transmissionProps.pluginPointName || 'MLLP');
    if (pluginPointName === 'MLLP') {
      transmissionMode = TransmissionMode.MLLP;
      // Parse hex bytes if provided
      const sobHex = String(transmissionProps.startOfMessageBytes || '0B');
      const eobHex = String(transmissionProps.endOfMessageBytes || '1C0D');
      startOfMessageBytes = hexToBytes(sobHex);
      endOfMessageBytes = hexToBytes(eobHex);
    } else if (pluginPointName === 'Frame') {
      transmissionMode = TransmissionMode.FRAME;
      startOfMessageBytes = hexToBytes(String(transmissionProps.startOfMessageBytes || ''));
      endOfMessageBytes = hexToBytes(String(transmissionProps.endOfMessageBytes || ''));
    } else {
      transmissionMode = TransmissionMode.RAW;
    }
  }

  const tcpProperties: Partial<TcpReceiverProperties> = {
    host,
    port,
    serverMode: ServerMode.SERVER,
    transmissionMode,
    startOfMessageBytes,
    endOfMessageBytes,
    maxConnections: parseInt(String(props?.maxConnections || '10'), 10),
    receiveTimeout: parseInt(String(props?.receiveTimeout || '0'), 10),
    reconnectInterval: parseInt(String(props?.reconnectInterval || '5000'), 10),
    bufferSize: parseInt(String(props?.bufferSize || '65536'), 10),
    keepConnectionOpen: String(props?.keepConnectionOpen) !== 'false',
    responseMode: ResponseMode.AUTO, // Auto-generate ACK for HL7
  };

  return new TcpReceiver({
    name: 'sourceConnector',
    properties: tcpProperties,
  });
}

/**
 * Convert hex string to byte array
 * e.g., "0B" -> [0x0b], "1C0D" -> [0x1c, 0x0d]
 */
function hexToBytes(hex: string): number[] {
  if (!hex) return [];
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (!isNaN(byte)) {
      bytes.push(byte);
    }
  }
  return bytes;
}

/**
 * Build destination connector from configuration
 */
function buildDestinationConnector(destConfig: Connector): DestinationConnector | null {
  if (!destConfig.enabled) {
    return null;
  }

  const transportName = destConfig.transportName;

  switch (transportName) {
    case 'TCP Sender':
    case 'MLLP Sender':
      return buildTcpDispatcher(destConfig);
    case 'HTTP Sender':
      return buildHttpDispatcher(destConfig);
    case 'File Writer':
      return buildFileDispatcher(destConfig);
    case 'Database Writer':
      return buildDatabaseDispatcher(destConfig);
    case 'Channel Writer':
      // Channel writer routes to another channel - log warning for now
      console.warn(`Channel Writer not yet implemented for destination: ${destConfig.name}`);
      return null;
    default:
      console.warn(`Unsupported destination connector transport: ${transportName}`);
      return null;
  }
}

/**
 * Build TCP/MLLP dispatcher from configuration
 */
function buildTcpDispatcher(destConfig: Connector): TcpDispatcher {
  const props = destConfig.properties as Record<string, unknown>;
  const transmissionProps = props?.transmissionModeProperties as Record<string, unknown>;

  // Parse host and port
  let host = String(props?.remoteAddress || props?.host || 'localhost');
  let port = parseInt(String(props?.remotePort || props?.port || '6661'), 10);

  // Handle variable references
  if (host.startsWith('${')) {
    host = 'localhost';
  }
  if (isNaN(port)) {
    port = 6661;
  }

  // Determine transmission mode
  let transmissionMode = TransmissionMode.MLLP;
  let startOfMessageBytes: number[] = [0x0b];
  let endOfMessageBytes: number[] = [0x1c, 0x0d];

  if (transmissionProps) {
    const pluginPointName = String(transmissionProps.pluginPointName || 'MLLP');
    if (pluginPointName === 'MLLP') {
      transmissionMode = TransmissionMode.MLLP;
      startOfMessageBytes = hexToBytes(String(transmissionProps.startOfMessageBytes || '0B'));
      endOfMessageBytes = hexToBytes(String(transmissionProps.endOfMessageBytes || '1C0D'));
    } else if (pluginPointName === 'Frame') {
      transmissionMode = TransmissionMode.FRAME;
      startOfMessageBytes = hexToBytes(String(transmissionProps.startOfMessageBytes || ''));
      endOfMessageBytes = hexToBytes(String(transmissionProps.endOfMessageBytes || ''));
    } else {
      transmissionMode = TransmissionMode.RAW;
    }
  }

  const tcpProperties: Partial<TcpDispatcherProperties> = {
    host,
    port,
    transmissionMode,
    startOfMessageBytes,
    endOfMessageBytes,
    keepConnectionOpen: String(props?.keepConnectionOpen) !== 'false',
    socketTimeout: parseInt(String(props?.sendTimeout || '30000'), 10),
    responseTimeout: parseInt(String(props?.responseTimeout || '30000'), 10),
    template: String(props?.template || ''),
  };

  return new TcpDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    properties: tcpProperties,
  });
}

/**
 * Build HTTP dispatcher from configuration
 */
function buildHttpDispatcher(destConfig: Connector): HttpDispatcher {
  const props = destConfig.properties as Record<string, unknown>;

  // Parse URL
  let url = String(props?.host || props?.url || 'http://localhost');
  if (url.startsWith('${')) {
    url = 'http://localhost';
  }

  // Parse headers
  const headers = new Map<string, string[]>();
  const headerProps = props?.headers as Record<string, unknown>;
  if (headerProps && typeof headerProps === 'object') {
    const entries = (headerProps.entry || []) as Array<{ string?: string[] }>;
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (entry?.string && Array.isArray(entry.string) && entry.string.length >= 2) {
        const key = entry.string[0];
        const value = entry.string[1];
        if (key && value) {
          headers.set(key, [value]);
        }
      }
    }
  }

  // Parse parameters
  const parameters = new Map<string, string[]>();
  const paramProps = props?.parameters as Record<string, unknown>;
  if (paramProps && typeof paramProps === 'object') {
    const entries = (paramProps.entry || []) as Array<{ string?: string[] }>;
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (entry?.string && Array.isArray(entry.string) && entry.string.length >= 2) {
        const key = entry.string[0];
        const value = entry.string[1];
        if (key && value) {
          parameters.set(key, [value]);
        }
      }
    }
  }

  const httpProperties: Partial<HttpDispatcherProperties> = {
    host: url,
    method: String(props?.method || 'POST').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    headers,
    parameters,
    content: String(props?.content || ''),
    contentType: String(props?.contentType || 'text/plain'),
    charset: String(props?.charset || 'UTF-8'),
    useAuthentication: String(props?.useAuthentication) === 'true',
    authenticationType: String(props?.authenticationType || 'Basic') as 'Basic' | 'Digest',
    username: String(props?.username || ''),
    password: String(props?.password || ''),
    socketTimeout: parseInt(String(props?.socketTimeout || '30000'), 10),
  };

  return new HttpDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    properties: httpProperties,
  });
}

/**
 * Build File dispatcher from configuration
 */
function buildFileDispatcher(destConfig: Connector): FileDispatcher {
  const props = destConfig.properties as Record<string, unknown>;
  const schemeProps = props?.schemeProperties as Record<string, unknown>;

  // Parse directory and filename
  let directory = String(schemeProps?.host || props?.host || '/tmp');
  const outputPattern = String(props?.outputPattern || 'output.txt');

  // Handle variable references
  if (directory.startsWith('${')) {
    directory = '/tmp';
  }

  // Parse output append mode
  const outputAppend = String(props?.outputAppend) === 'true';

  const fileProperties: Partial<FileDispatcherProperties> = {
    directory,
    outputPattern,
    outputAppend,
    template: String(props?.template || ''),
    charsetEncoding: String(props?.charsetEncoding || 'UTF-8'),
  };

  return new FileDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    properties: fileProperties,
  });
}

/**
 * Build Database dispatcher from configuration
 */
function buildDatabaseDispatcher(destConfig: Connector): DatabaseDispatcher {
  const props = destConfig.properties as Record<string, unknown>;

  // Parse JDBC URL
  let url = String(props?.url || 'jdbc:mysql://localhost:3306/test');

  // Handle variable references
  if (url.startsWith('${')) {
    url = 'jdbc:mysql://localhost:3306/test';
  }

  return new DatabaseDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    properties: {
      url,
      driver: String(props?.driver || 'com.mysql.cj.jdbc.Driver'),
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      query: String(props?.query || ''),
    },
  });
}
