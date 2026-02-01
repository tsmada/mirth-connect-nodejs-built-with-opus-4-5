/**
 * Channel Builder
 *
 * Builds runtime Channel instances from channel configuration stored in the database.
 * Parses channel XML/JSON and creates appropriate connectors based on transport type.
 */

import { Channel, ChannelConfig } from './Channel.js';
import { TcpReceiver } from '../../connectors/tcp/TcpReceiver.js';
import { TcpReceiverProperties, ServerMode, TransmissionMode, ResponseMode } from '../../connectors/tcp/TcpConnectorProperties.js';
import { Channel as ChannelModel } from '../../api/models/Channel.js';

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

  // TODO: Build destination connectors
  // for (const destConfig of channelConfig.destinationConnectors) {
  //   const dest = buildDestinationConnector(destConfig);
  //   if (dest) {
  //     channel.addDestinationConnector(dest);
  //   }
  // }

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
