/**
 * Channel Builder
 *
 * Builds runtime Channel instances from channel configuration stored in the database.
 * Parses channel XML/JSON and creates appropriate connectors based on transport type.
 */

import { Channel, ChannelConfig } from './Channel.js';
import { SourceConnector } from './SourceConnector.js';
import { DestinationConnector } from './DestinationConnector.js';
import { FilterTransformerScripts } from './FilterTransformerExecutor.js';
import { DestinationFilterTransformerConfig } from './DestinationConnector.js';
import { getStorageSettings, parseMessageStorageMode } from './StorageSettings.js';
import { MetaDataColumnType } from '../../api/models/ServerSettings.js';
import {
  FilterRule as ScriptFilterRule,
  TransformerStep as ScriptTransformerStep,
  SerializationType,
} from '../../javascript/runtime/ScriptBuilder.js';
import { TcpReceiver } from '../../connectors/tcp/TcpReceiver.js';
import { TcpDispatcher } from '../../connectors/tcp/TcpDispatcher.js';
import {
  TcpReceiverProperties,
  TcpDispatcherProperties,
  ServerMode,
  TransmissionMode,
  ResponseMode,
} from '../../connectors/tcp/TcpConnectorProperties.js';
import { HttpReceiver } from '../../connectors/http/HttpReceiver.js';
import { HttpDispatcher } from '../../connectors/http/HttpDispatcher.js';
import {
  HttpReceiverProperties,
  HttpDispatcherProperties,
} from '../../connectors/http/HttpConnectorProperties.js';
import { FileReceiver } from '../../connectors/file/FileReceiver.js';
import { FileDispatcher } from '../../connectors/file/FileDispatcher.js';
import {
  FileReceiverProperties,
  FileDispatcherProperties,
  FileScheme,
  AfterProcessingAction,
  FileSortBy,
} from '../../connectors/file/FileConnectorProperties.js';
import { DatabaseDispatcher } from '../../connectors/jdbc/DatabaseDispatcher.js';
import { DatabaseReceiver } from '../../connectors/jdbc/DatabaseReceiver.js';
import { UpdateMode } from '../../connectors/jdbc/DatabaseConnectorProperties.js';
import { VmDispatcher } from '../../connectors/vm/VmDispatcher.js';
import { VmReceiver } from '../../connectors/vm/VmReceiver.js';
import { JmsReceiver } from '../../connectors/jms/JmsReceiver.js';
import { JmsDispatcher } from '../../connectors/jms/JmsDispatcher.js';
import { SmtpDispatcher } from '../../connectors/smtp/SmtpDispatcher.js';
import { WebServiceReceiver } from '../../connectors/ws/WebServiceReceiver.js';
import { WebServiceDispatcher } from '../../connectors/ws/WebServiceDispatcher.js';
import { DICOMReceiver } from '../../connectors/dicom/DICOMReceiver.js';
import { DICOMDispatcher } from '../../connectors/dicom/DICOMDispatcher.js';
import { JavaScriptReceiver } from '../../connectors/js/JavaScriptReceiver.js';
import { JavaScriptDispatcher } from '../../connectors/js/JavaScriptDispatcher.js';
import { Channel as ChannelModel, Connector } from '../../api/models/Channel.js';
import { DefaultResponseValidator } from '../message/ResponseValidator.js';
import { ResponseSelector } from './ResponseSelector.js';
import { compileTransformerStep, compileFilterRule } from '../../javascript/runtime/StepCompiler.js';
import type { BatchAdaptorFactory } from '../message/BatchAdaptor.js';
import { HL7BatchAdaptorFactory, HL7v2SplitType } from '../message/HL7BatchAdaptor.js';
import { XMLBatchAdaptorFactory, XMLSplitType } from '../../datatypes/xml/XMLBatchAdaptor.js';
import { DelimitedBatchAdaptorFactory, DelimitedSplitType } from '../../datatypes/delimited/DelimitedBatchAdaptor.js';
import { EDIBatchAdaptorFactory } from '../message/EDIBatchAdaptor.js';

export interface BuildChannelOptions {
  globalPreprocessorScript?: string;
  globalPostprocessorScript?: string;
}

/**
 * Build a runtime Channel from a channel configuration
 */
export function buildChannel(channelConfig: ChannelModel, options?: BuildChannelOptions): Channel {
  // Build StorageSettings from channel properties' messageStorageMode
  const channelProps = channelConfig.properties;
  const storageMode = parseMessageStorageMode(channelProps?.messageStorageMode);
  const storageSettings = getStorageSettings(storageMode, {
    removeContentOnCompletion: channelProps?.removeContentOnCompletion,
    removeOnlyFilteredOnCompletion: channelProps?.removeOnlyFilteredOnCompletion,
    removeAttachmentsOnCompletion: channelProps?.removeAttachmentsOnCompletion,
    storeAttachments: channelProps?.storeAttachments,
  });

  // Extract custom metadata column definitions
  const metaDataColumns = (
    Array.isArray(channelProps?.metaDataColumns) ? channelProps.metaDataColumns : []
  ).map((col) => ({
    name: col.name,
    type: col.type as MetaDataColumnType,
    mappingName: col.mappingName,
  }));

  // Extract encryptData from channel properties
  const encryptData =
    channelProps?.encryptData === true || String(channelProps?.encryptData) === 'true';

  // Create channel with basic config
  const config: ChannelConfig = {
    id: channelConfig.id,
    name: channelConfig.name,
    description: channelConfig.description || '',
    enabled: channelConfig.enabled ?? true,
    preprocessorScript: channelConfig.preprocessingScript,
    postprocessorScript: channelConfig.postprocessingScript,
    globalPreprocessorScript: options?.globalPreprocessorScript,
    globalPostprocessorScript: options?.globalPostprocessorScript,
    deployScript: channelConfig.deployScript,
    undeployScript: channelConfig.undeployScript,
    storageSettings,
    metaDataColumns,
    encryptData,
  };

  const channel = new Channel(config);

  // Build source connector based on transport type
  const sourceConnector = buildSourceConnector(channelConfig);
  if (sourceConnector) {
    channel.setSourceConnector(sourceConnector);

    // Wire respondAfterProcessing from source connector properties.
    // In channel XML, this lives inside <sourceConnectorProperties>, NOT at the top level:
    //   <properties><sourceConnectorProperties><respondAfterProcessing>true</respondAfterProcessing>
    const sourceProps = channelConfig.sourceConnector?.properties;
    const sourceConnProps =
      (sourceProps?.sourceConnectorProperties as Record<string, unknown>) ?? sourceProps;
    if (
      sourceConnProps?.respondAfterProcessing === false ||
      String(sourceConnProps?.respondAfterProcessing) === 'false'
    ) {
      sourceConnector.setRespondAfterProcessing(false);
    }

    // Wire ResponseSelector from sourceConnectorProperties.responseVariable.
    // Java Mirth: Channel.responseSelector.respondFromName determines which response
    // is returned to the source connector (and ultimately to the HTTP/MLLP caller).
    // Values: "None", "d_postprocessor", "d1", "d2", "Auto-generate (...)", etc.
    const responseVariable = String(sourceConnProps?.responseVariable ?? 'None');
    if (responseVariable && responseVariable !== 'None') {
      const selector = new ResponseSelector();
      selector.setRespondFromName(responseVariable);
      channel.setResponseSelector(selector);
    }

    // Wire inboundDataType from source transformer config
    const sourceTransformer = channelConfig.sourceConnector?.transformer;
    if (sourceTransformer?.inboundDataType) {
      sourceConnector.setInboundDataType(sourceTransformer.inboundDataType);
    }

    // Wire processBatch and batch adaptor factory from sourceConnectorProperties.
    // Java Mirth: SourceConnector.handleRawMessage() checks isProcessBatch() and
    // routes to batchAdaptorFactory.createBatchAdaptor() when true.
    // The batch adaptor type depends on the inbound data type.
    const processBatchStr = String(sourceConnProps?.processBatch ?? 'false');
    if (processBatchStr === 'true') {
      sourceConnector.setProcessBatch(true);
      const batchFactory = createBatchAdaptorFactory(
        sourceTransformer?.inboundDataType ?? 'RAW',
        sourceConnProps
      );
      if (batchFactory) {
        sourceConnector.setBatchAdaptorFactory(batchFactory);
      }
    }

    // Wire source filter/transformer scripts from channel config
    const sourceFilter = channelConfig.sourceConnector?.filter;
    if (sourceFilter || sourceTransformer) {
      const scripts = buildFilterTransformerScripts(sourceFilter, sourceTransformer);
      if (scripts.filterRules?.length || scripts.transformerSteps?.length) {
        sourceConnector.setFilterTransformer(scripts);
      }
    }
  }

  // Build destination connectors
  for (const destConfig of channelConfig.destinationConnectors || []) {
    const dest = buildDestinationConnector(destConfig);
    if (dest) {
      dest.setResponseValidator(new DefaultResponseValidator());
      channel.addDestinationConnector(dest);

      // Wire destination filter/transformer/responseTransformer scripts
      const destFilter = destConfig.filter;
      const destTransformer = destConfig.transformer;
      const destResponseTransformer = destConfig.responseTransformer;
      if (destFilter || destTransformer || destResponseTransformer) {
        const scripts = buildFilterTransformerScripts(destFilter, destTransformer);
        const destScripts: DestinationFilterTransformerConfig = { ...scripts };
        if (destResponseTransformer) {
          destScripts.responseTransformerScripts = buildFilterTransformerScripts(
            undefined,
            destResponseTransformer
          );
        }
        if (
          destScripts.filterRules?.length ||
          destScripts.transformerSteps?.length ||
          destScripts.responseTransformerScripts
        ) {
          dest.setFilterTransformer(destScripts);
        }
      }
    }
  }

  return channel;
}

/**
 * Build source connector from configuration
 */
function buildSourceConnector(channelConfig: ChannelModel): SourceConnector | null {
  const sourceConfig = channelConfig.sourceConnector;
  if (!sourceConfig) {
    return null;
  }

  const transportName = sourceConfig.transportName;

  switch (transportName) {
    case 'TCP Listener':
    case 'MLLP Listener':
      return buildTcpReceiver(sourceConfig.properties);
    case 'HTTP Listener':
      return buildHttpReceiver(sourceConfig.properties);
    case 'Channel Reader':
      return buildVmReceiver(sourceConfig.properties);
    case 'File Reader':
      return buildFileReceiver(sourceConfig.properties);
    case 'Database Reader':
      return buildDatabaseReceiver(sourceConfig.properties);
    case 'JMS Listener':
      return buildJmsReceiver(sourceConfig.properties);
    case 'DICOM Listener':
      return buildDicomReceiver(sourceConfig.properties);
    case 'Web Service Listener':
      return buildWebServiceReceiver(sourceConfig.properties);
    case 'JavaScript Reader':
      return buildJavaScriptReceiver(sourceConfig.properties);
    default:
      throw new Error(`Unsupported source connector transport: ${transportName}`);
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
    responseMode: parseResponseMode(String(props?.responseMode || 'AUTO')),
  };

  return new TcpReceiver({
    name: 'sourceConnector',
    properties: tcpProperties,
  });
}

/**
 * Parse response mode string into ResponseMode enum.
 * Channel XML may contain "DESTINATION", "AUTO", or "NONE".
 */
function parseResponseMode(mode: string): ResponseMode {
  switch (mode.toUpperCase()) {
    case 'DESTINATION':
      return ResponseMode.DESTINATION;
    case 'NONE':
      return ResponseMode.NONE;
    case 'AUTO':
    default:
      return ResponseMode.AUTO;
  }
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
 * Parse update mode string into UpdateMode enum.
 */
function parseUpdateMode(mode: string): UpdateMode {
  switch (mode.toUpperCase()) {
    case 'EACH':
      return UpdateMode.EACH;
    case 'ONCE':
      return UpdateMode.ONCE;
    case 'NEVER':
    default:
      return UpdateMode.NEVER;
  }
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
      return buildVmDispatcher(destConfig);
    case 'JMS Sender':
      return buildJmsDispatcher(destConfig);
    case 'SMTP Sender':
      return buildSmtpDispatcher(destConfig);
    case 'DICOM Sender':
      return buildDicomDispatcher(destConfig);
    case 'Web Service Sender':
      return buildWebServiceDispatcher(destConfig);
    case 'JavaScript Writer':
      return buildJavaScriptDispatcher(destConfig);
    default:
      throw new Error(`Unsupported destination connector transport: ${transportName}`);
  }
}

/**
 * Build TCP/MLLP dispatcher from configuration
 */
function buildTcpDispatcher(destConfig: Connector): TcpDispatcher {
  const props = destConfig.properties;
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
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: tcpProperties,
  });
}

/**
 * Build HTTP dispatcher from configuration
 */
function buildHttpDispatcher(destConfig: Connector): HttpDispatcher {
  const props = destConfig.properties;

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
    method: String(props?.method || 'POST').toUpperCase() as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'DELETE'
      | 'PATCH',
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
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: httpProperties,
  });
}

/**
 * Build File dispatcher from configuration
 *
 * Enhanced to support SFTP scheme properties alongside local FILE scheme.
 * When scheme is SFTP, parses host/port/credentials and sftpSchemeProperties.
 */
function buildFileDispatcher(destConfig: Connector): FileDispatcher {
  const props = destConfig.properties;
  const schemeProps = props?.schemeProperties as Record<string, unknown>;

  // Parse scheme
  const schemeStr = String(schemeProps?.scheme || props?.scheme || 'FILE').toUpperCase();
  const scheme =
    ((FileScheme as Record<string, string>)[schemeStr] as FileScheme) || FileScheme.FILE;

  // Parse directory — for SFTP, remote path is in schemeProperties.host
  let directory = String(schemeProps?.host || props?.host || '/tmp');
  const outputPattern = String(props?.outputPattern || 'output.txt');

  // Handle variable references
  if (directory.startsWith('${')) {
    directory = '/tmp';
  }

  // SFTP connection properties
  let host = '';
  let port: number | undefined;
  let username = '';
  let password = '';

  if (scheme === FileScheme.SFTP) {
    host = String(props?.host || schemeProps?.sftpHost || 'localhost');
    port = parseInt(String(props?.port || schemeProps?.port || '22'), 10);
    username = String(props?.username || '');
    password = String(props?.password || '');

    if (host.startsWith('${')) {
      host = 'localhost';
    }
    if (isNaN(port)) {
      port = 22;
    }
  }

  // Parse output append mode
  const outputAppend = String(props?.outputAppend) === 'true';

  // Parse SFTP-specific scheme properties
  let sftpSchemeProperties: Record<string, unknown> | undefined;
  if (scheme === FileScheme.SFTP) {
    const sftpProps =
      (schemeProps?.sftpSchemeProperties as Record<string, unknown>) ||
      (props?.sftpSchemeProperties as Record<string, unknown>);
    if (sftpProps) {
      sftpSchemeProperties = {
        passwordAuth: String(sftpProps.passwordAuth) !== 'false',
        keyAuth: String(sftpProps.keyAuth) === 'true',
        keyFile: String(sftpProps.keyFile || ''),
        passPhrase: String(sftpProps.passPhrase || ''),
        hostKeyChecking: String(sftpProps.hostKeyChecking || 'no'),
        knownHostsFile: String(sftpProps.knownHostsFile || ''),
      };
    }
  }

  const fileProperties: Partial<FileDispatcherProperties> = {
    scheme,
    host,
    port,
    username,
    password,
    directory,
    outputPattern,
    outputAppend,
    template: String(props?.template || ''),
    charsetEncoding: String(props?.charsetEncoding || 'UTF-8'),
    ...(sftpSchemeProperties ? { sftpSchemeProperties: sftpSchemeProperties as any } : {}),
  };

  return new FileDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: fileProperties,
  });
}

/**
 * Build Database dispatcher from configuration
 */
function buildDatabaseDispatcher(destConfig: Connector): DatabaseDispatcher {
  const props = destConfig.properties;

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
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      url,
      driver: String(props?.driver || 'com.mysql.cj.jdbc.Driver'),
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      query: String(props?.query || ''),
    },
  });
}

/**
 * Build HTTP receiver from properties
 */
function buildHttpReceiver(properties: unknown): HttpReceiver {
  const props = properties as Record<string, unknown>;
  const listenerProps = (props?.listenerConnectorProperties || props) as Record<string, unknown>;

  // Parse host and port
  let host = String(listenerProps?.host || '0.0.0.0');
  let port = parseInt(String(listenerProps?.port || '8083'), 10);

  // Handle variable references
  if (host.startsWith('${')) {
    host = '0.0.0.0';
  }
  if (isNaN(port) || String(listenerProps?.port || '').startsWith('${')) {
    port = parseInt(process.env['NODE_HTTP_PORT'] || '8083', 10);
  }

  const httpProperties: Partial<HttpReceiverProperties> = {
    host,
    port,
    contextPath: String(props?.contextPath || '/'),
    timeout: parseInt(String(props?.timeout || '30000'), 10),
    charset: String(props?.charset || 'UTF-8'),
    xmlBody: String(props?.xmlBody) === 'true',
    parseMultipart: String(props?.parseMultipart) === 'true',
    includeMetadata: String(props?.includeMetadata) !== 'false',
  };

  return new HttpReceiver({
    name: 'sourceConnector',
    properties: httpProperties,
  });
}

/**
 * Build File receiver (File Reader) from properties
 *
 * Parses channel XML properties for both local FILE and remote SFTP schemes.
 * In Mirth's XML format, SFTP paths are stored in schemeProperties.host,
 * while the actual SFTP server hostname is in the top-level host property.
 */
function buildFileReceiver(properties: unknown): FileReceiver {
  const props = properties as Record<string, unknown>;
  const schemeProps = props?.schemeProperties as Record<string, unknown>;

  // Parse scheme — may be at top level or inside schemeProperties
  const schemeStr = String(schemeProps?.scheme || props?.scheme || 'FILE').toUpperCase();
  const scheme =
    ((FileScheme as Record<string, string>)[schemeStr] as FileScheme) || FileScheme.FILE;

  // For SFTP: the remote directory is in schemeProperties.host (Mirth convention)
  // For FILE: directory is in schemeProperties.host or props.host
  let directory = String(schemeProps?.host || props?.host || props?.directory || '');
  if (directory.startsWith('${')) {
    directory = '/tmp';
  }

  // SFTP connection properties
  let host = '';
  let port: number | undefined;
  let username = '';
  let password = '';

  if (scheme === FileScheme.SFTP) {
    // For SFTP, the server hostname is at the top-level properties
    host = String(props?.host || schemeProps?.sftpHost || 'localhost');
    port = parseInt(String(props?.port || schemeProps?.port || '22'), 10);
    username = String(props?.username || '');
    password = String(props?.password || '');

    if (host.startsWith('${')) {
      host = 'localhost';
    }
    if (isNaN(port)) {
      port = 22;
    }
  }

  // Parse file filter and processing options
  const fileFilter = String(props?.fileFilter || schemeProps?.fileFilter || '*');
  const regex = String(props?.regex || schemeProps?.regex) === 'true';
  const pollConnProps = props?.pollConnectorProperties as Record<string, unknown> | undefined;
  const pollInterval = parseInt(
    String(
      pollConnProps?.pollingFrequency ||
        pollConnProps?.pollFrequency ||
        props?.pollInterval ||
        '5000'
    ),
    10
  );

  // Parse after-processing action
  const afterProcStr = String(props?.afterProcessingAction || 'NONE').toUpperCase();
  const afterProcessingAction =
    ((AfterProcessingAction as Record<string, string>)[afterProcStr] as AfterProcessingAction) ||
    AfterProcessingAction.NONE;

  const moveToDirectory = String(props?.moveToDirectory || '');

  // Parse sort options
  const sortByStr = String(props?.sortBy || 'DATE').toUpperCase();
  const sortBy =
    ((FileSortBy as Record<string, string>)[sortByStr] as FileSortBy) || FileSortBy.DATE;

  // Parse SFTP-specific scheme properties
  let sftpSchemeProperties: Record<string, unknown> | undefined;
  if (scheme === FileScheme.SFTP) {
    const sftpProps =
      (schemeProps?.sftpSchemeProperties as Record<string, unknown>) ||
      (props?.sftpSchemeProperties as Record<string, unknown>);
    if (sftpProps) {
      sftpSchemeProperties = {
        passwordAuth: String(sftpProps.passwordAuth) !== 'false',
        keyAuth: String(sftpProps.keyAuth) === 'true',
        keyFile: String(sftpProps.keyFile || ''),
        passPhrase: String(sftpProps.passPhrase || ''),
        hostKeyChecking: String(sftpProps.hostKeyChecking || 'no'),
        knownHostsFile: String(sftpProps.knownHostsFile || ''),
      };
    }
  }

  const fileProperties: Partial<FileReceiverProperties> = {
    scheme,
    host,
    port,
    username,
    password,
    directory,
    fileFilter,
    regex,
    directoryRecursion: String(props?.directoryRecursion) === 'true',
    ignoreDot: String(props?.ignoreDot) !== 'false',
    binary: String(props?.binary) === 'true',
    charsetEncoding: String(props?.charsetEncoding || 'UTF-8'),
    afterProcessingAction,
    moveToDirectory,
    errorDirectory: String(props?.errorDirectory || ''),
    fileAge: parseInt(String(props?.fileAge || '0'), 10),
    pollInterval: isNaN(pollInterval) ? 5000 : pollInterval,
    sortBy,
    sortDescending: String(props?.sortDescending) === 'true',
    batchSize: parseInt(String(props?.batchSize || '0'), 10),
    timeout: parseInt(String(props?.timeout || '10000'), 10),
    ...(sftpSchemeProperties ? { sftpSchemeProperties: sftpSchemeProperties as any } : {}),
  };

  return new FileReceiver({
    name: 'sourceConnector',
    properties: fileProperties,
  });
}

/**
 * Build VM dispatcher (Channel Writer) from configuration
 */
function buildVmDispatcher(destConfig: Connector): VmDispatcher {
  const props = destConfig.properties;

  return new VmDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      channelId: String(props?.channelId || ''),
      channelTemplate: String(
        props?.channelTemplate || props?.template || '${message.encodedData}'
      ),
      mapVariables: parseMapVariables(props?.mapVariables),
    },
  });
}

/**
 * Build VM receiver (Channel Reader) from properties
 */
function buildVmReceiver(properties: unknown): VmReceiver {
  const props = properties as Record<string, unknown>;
  return new VmReceiver({
    name: 'sourceConnector',
    properties: {
      canBatch: String(props?.canBatch) === 'true',
    },
  });
}

/**
 * Build Database Receiver (Database Reader) from properties
 */
function buildDatabaseReceiver(properties: unknown): DatabaseReceiver {
  const props = properties as Record<string, unknown>;
  const pollConnProps = props?.pollConnectorProperties as Record<string, unknown> | undefined;
  const pollInterval = parseInt(
    String(
      pollConnProps?.pollingFrequency ||
        pollConnProps?.pollFrequency ||
        props?.pollInterval ||
        '5000'
    ),
    10
  );

  let url = String(props?.url || 'jdbc:mysql://localhost:3306/test');
  if (url.startsWith('${')) {
    url = 'jdbc:mysql://localhost:3306/test';
  }

  return new DatabaseReceiver({
    name: 'sourceConnector',
    properties: {
      url,
      driver: String(props?.driver || 'com.mysql.cj.jdbc.Driver'),
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      select: String(props?.select || ''),
      update: String(props?.update || ''),
      useScript: String(props?.useScript) === 'true',
      aggregateResults: String(props?.aggregateResults) === 'true',
      cacheResults: String(props?.cacheResults) !== 'false',
      keepConnectionOpen: String(props?.keepConnectionOpen) === 'true',
      updateMode: parseUpdateMode(String(props?.updateMode || 'NEVER')),
      retryCount: parseInt(String(props?.retryCount ?? '3'), 10),
      retryInterval: parseInt(String(props?.retryInterval ?? '10000'), 10),
      fetchSize: parseInt(String(props?.fetchSize ?? '1000'), 10),
      encoding: String(props?.encoding || 'UTF-8'),
      pollInterval: isNaN(pollInterval) ? 5000 : pollInterval,
    },
  });
}

/**
 * Build JMS Receiver (JMS Listener) from properties
 */
function buildJmsReceiver(properties: unknown): JmsReceiver {
  const props = properties as Record<string, unknown>;
  // processBatch lives inside sourceConnectorProperties in channel XML
  const srcConnProps = (props?.sourceConnectorProperties as Record<string, unknown>) ?? props;

  let host = String(props?.host || 'localhost');
  let port = parseInt(String(props?.port || '61613'), 10);
  if (host.startsWith('${')) host = 'localhost';
  if (isNaN(port)) port = 61613;

  return new JmsReceiver({
    name: 'sourceConnector',
    processBatch: String(srcConnProps?.processBatch) === 'true',
    properties: {
      host,
      port,
      destinationName: String(props?.destinationName || ''),
      topic: String(props?.topic) === 'true',
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      selector: String(props?.selector || ''),
      durableTopic: String(props?.durableTopic) === 'true',
      subscriptionName: String(props?.subscriptionName || ''),
      clientId: String(props?.clientId || ''),
      useJndi: String(props?.useJndi) === 'true',
      jndiProviderUrl: String(props?.jndiProviderUrl || ''),
      jndiInitialContextFactory: String(props?.jndiInitialContextFactory || ''),
      jndiConnectionFactoryName: String(props?.jndiConnectionFactoryName || ''),
      connectionProperties: (props?.connectionProperties as Record<string, string>) || {},
      useSsl: String(props?.useSsl) === 'true',
    },
  });
}

/**
 * Build JMS Dispatcher (JMS Sender) from configuration
 */
function buildJmsDispatcher(destConfig: Connector): JmsDispatcher {
  const props = destConfig.properties;

  let host = String(props?.host || 'localhost');
  let port = parseInt(String(props?.port || '61613'), 10);
  if (host.startsWith('${')) host = 'localhost';
  if (isNaN(port)) port = 61613;

  return new JmsDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      host,
      port,
      destinationName: String(props?.destinationName || ''),
      topic: String(props?.topic) === 'true',
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      template: String(props?.template || '${message.encodedData}'),
      clientId: String(props?.clientId || ''),
      useJndi: String(props?.useJndi) === 'true',
      jndiProviderUrl: String(props?.jndiProviderUrl || ''),
      jndiInitialContextFactory: String(props?.jndiInitialContextFactory || ''),
      jndiConnectionFactoryName: String(props?.jndiConnectionFactoryName || ''),
      connectionProperties: (props?.connectionProperties as Record<string, string>) || {},
      useSsl: String(props?.useSsl) === 'true',
    },
  });
}

/**
 * Build SMTP Dispatcher (SMTP Sender) from configuration
 */
function buildSmtpDispatcher(destConfig: Connector): SmtpDispatcher {
  const props = destConfig.properties;

  // Parse headers map from Mirth XML format
  const headers = new Map<string, string>();
  const headerProps = props?.headers as Record<string, unknown>;
  if (headerProps && typeof headerProps === 'object') {
    const entries = (headerProps.entry || []) as Array<{ string?: string[] }>;
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (entry?.string && Array.isArray(entry.string) && entry.string.length >= 2) {
        const key = entry.string[0];
        const value = entry.string[1];
        if (key && value) {
          headers.set(key, value);
        }
      }
    }
  }

  // Parse attachments array from Mirth XML format
  const attachments: Array<{ name: string; content: string; mimeType: string }> = [];
  const attachmentList = props?.attachments as unknown[];
  if (Array.isArray(attachmentList)) {
    for (const att of attachmentList) {
      if (att && typeof att === 'object') {
        const a = att as Record<string, unknown>;
        attachments.push({
          name: String(a.name || ''),
          content: String(a.content || ''),
          mimeType: String(a.mimeType || 'text/plain'),
        });
      }
    }
  }

  return new SmtpDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      smtpHost: String(props?.smtpHost || 'localhost'),
      smtpPort: String(props?.smtpPort || '25'),
      overrideLocalBinding: String(props?.overrideLocalBinding) === 'true',
      localAddress: String(props?.localAddress || ''),
      localPort: String(props?.localPort || '0'),
      timeout: String(props?.timeout || '5000'),
      encryption: String(props?.encryption || 'none') as 'none' | 'tls' | 'ssl',
      authentication: String(props?.authentication || props?.useAuthentication) === 'true',
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      to: String(props?.to || ''),
      from: String(props?.from || ''),
      cc: String(props?.cc || ''),
      bcc: String(props?.bcc || ''),
      replyTo: String(props?.replyTo || ''),
      headers,
      headersVariable: String(props?.headersVariable || ''),
      useHeadersVariable: String(props?.useHeadersVariable) === 'true',
      subject: String(props?.subject || ''),
      charsetEncoding: String(props?.charsetEncoding || 'UTF-8'),
      html: String(props?.html) === 'true',
      body: String(props?.body || props?.template || ''),
      attachments,
      attachmentsVariable: String(props?.attachmentsVariable || ''),
      useAttachmentsVariable: String(props?.useAttachmentsVariable) === 'true',
      dataType: String(props?.dataType || 'RAW'),
    },
  });
}

/**
 * Build Web Service Receiver (Web Service Listener) from properties
 */
function buildWebServiceReceiver(properties: unknown): WebServiceReceiver {
  const props = properties as Record<string, unknown>;
  const listenerProps = (props?.listenerConnectorProperties || props) as Record<string, unknown>;

  let host = String(listenerProps?.host || '0.0.0.0');
  let port = parseInt(String(listenerProps?.port || '8081'), 10);

  if (host.startsWith('${')) host = '0.0.0.0';
  if (isNaN(port) || String(listenerProps?.port || '').startsWith('${')) {
    port = 8081;
  }

  return new WebServiceReceiver({
    name: 'sourceConnector',
    properties: {
      host,
      port,
      serviceName: String(props?.serviceName || 'Mirth'),
    },
  });
}

/**
 * Build Web Service Dispatcher (Web Service Sender) from configuration
 */
function buildWebServiceDispatcher(destConfig: Connector): WebServiceDispatcher {
  const props = destConfig.properties;

  // Parse headers from Mirth XML format
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

  return new WebServiceDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      wsdlUrl: String(props?.wsdlUrl || ''),
      service: String(props?.service || ''),
      port: String(props?.port || ''),
      operation: String(props?.operation || ''),
      locationURI: String(props?.locationURI || ''),
      socketTimeout: parseInt(String(props?.socketTimeout || '30000'), 10),
      useAuthentication: String(props?.useAuthentication) === 'true',
      username: String(props?.username || ''),
      password: String(props?.password || ''),
      envelope: String(props?.envelope || props?.template || ''),
      oneWay: String(props?.oneWay) === 'true',
      headers,
      useHeadersVariable: String(props?.useHeadersVariable) === 'true',
      headersVariable: String(props?.headersVariable || ''),
      useMtom: String(props?.useMtom) === 'true',
      attachmentNames: Array.isArray(props?.attachmentNames)
        ? (props.attachmentNames as string[])
        : [],
      attachmentContents: Array.isArray(props?.attachmentContents)
        ? (props.attachmentContents as string[])
        : [],
      attachmentTypes: Array.isArray(props?.attachmentTypes)
        ? (props.attachmentTypes as string[])
        : [],
      useAttachmentsVariable: String(props?.useAttachmentsVariable) === 'true',
      attachmentsVariable: String(props?.attachmentsVariable || ''),
      soapAction: String(props?.soapAction || ''),
    },
  });
}

/**
 * Build DICOM Receiver (DICOM Listener) from properties
 */
function buildDicomReceiver(properties: unknown): DICOMReceiver {
  const props = properties as Record<string, unknown>;
  const listenerProps = (props?.listenerConnectorProperties || props) as Record<string, unknown>;

  let host = String(listenerProps?.host || '0.0.0.0');
  let port = String(listenerProps?.port || '104');

  if (host.startsWith('${')) host = '0.0.0.0';
  if (port.startsWith('${')) port = '104';

  return new DICOMReceiver({
    name: 'sourceConnector',
    properties: {
      listenerConnectorProperties: { host, port },
      applicationEntity: String(props?.applicationEntity || ''),
      localApplicationEntity: String(props?.localApplicationEntity || ''),
      localHost: String(props?.localHost || ''),
      localPort: String(props?.localPort || ''),
    },
  });
}

/**
 * Build DICOM Dispatcher (DICOM Sender) from configuration
 */
function buildDicomDispatcher(destConfig: Connector): DICOMDispatcher {
  const props = destConfig.properties;

  let host = String(props?.host || 'localhost');
  let port = String(props?.port || '104');
  if (host.startsWith('${')) host = 'localhost';
  if (port.startsWith('${')) port = '104';

  return new DICOMDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    properties: {
      host,
      port,
      applicationEntity: String(props?.applicationEntity || 'DCMRCV'),
      localHost: String(props?.localHost || ''),
      localPort: String(props?.localPort || ''),
      localApplicationEntity: String(props?.localApplicationEntity || 'MIRTH'),
      template: String(props?.template || ''),
    },
  });
}

/**
 * Build JavaScript Receiver (JavaScript Reader) from properties
 */
function buildJavaScriptReceiver(properties: unknown): JavaScriptReceiver {
  const props = properties as Record<string, unknown>;
  // processBatch lives inside sourceConnectorProperties in channel XML
  const srcConnProps = (props?.sourceConnectorProperties as Record<string, unknown>) ?? props;
  const pollConnProps = (props?.pollConnectorProperties ??
    srcConnProps?.pollConnectorProperties) as Record<string, unknown> | undefined;
  const pollInterval = parseInt(
    String(
      pollConnProps?.pollingFrequency ||
        pollConnProps?.pollFrequency ||
        props?.pollInterval ||
        '5000'
    ),
    10
  );

  return new JavaScriptReceiver({
    name: 'sourceConnector',
    properties: {
      script: String(props?.script || ''),
      pollInterval: isNaN(pollInterval) ? 5000 : pollInterval,
      processBatch: String(srcConnProps?.processBatch) === 'true',
    },
  });
}

/**
 * Build JavaScript Dispatcher (JavaScript Writer) from configuration
 */
function buildJavaScriptDispatcher(destConfig: Connector): JavaScriptDispatcher {
  const props = destConfig.properties;

  return new JavaScriptDispatcher({
    name: destConfig.name,
    metaDataId: destConfig.metaDataId,
    enabled: destConfig.enabled,
    waitForPrevious: destConfig.waitForPrevious,
    queueEnabled: destConfig.queueEnabled,
    queueSendFirst: String(props?.queueSendFirst) === 'true',
    retryCount: parseInt(String(props?.retryCount ?? '0'), 10),
    retryIntervalMillis: parseInt(
      String(props?.retryIntervalMillis ?? props?.retryInterval ?? '10000'),
      10
    ),
    properties: {
      script: String(props?.script || ''),
    },
  });
}

/**
 * Parse mapVariables from either API format (string[]) or XML-parsed format
 * ({string: string | string[]}).
 *
 * fast-xml-parser parses <mapVariables><string>a</string><string>b</string></mapVariables>
 * as { string: ['a', 'b'] }, and <mapVariables/> as "" or undefined.
 */
function parseMapVariables(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.string) {
      return Array.isArray(obj.string) ? (obj.string as string[]) : [String(obj.string)];
    }
  }
  return [];
}

// ─── Filter/Transformer Wiring Helpers ──────────────────────────────────────

/**
 * Map a Mirth data type string to SerializationType for script execution.
 *
 * Most Mirth data types (HL7V2, HL7V3, NCPDP, EDI/X12, Delimited, DICOM)
 * use XML-based representation in the script context (via E4X/XMLProxy).
 * Only RAW and JSON have distinct serialization modes.
 */
/**
 * Create a BatchAdaptorFactory based on the inbound data type.
 * Matches Java Mirth: each DataType class provides getBatchAdaptor(batchProperties).
 * The factory creates adaptors that split incoming messages into individual sub-messages.
 */
function createBatchAdaptorFactory(
  dataType: string,
  sourceConnProps?: Record<string, unknown>
): BatchAdaptorFactory | null {
  const dt = (dataType || 'RAW').toUpperCase();

  // Parse batch properties from sourceConnectorProperties if available
  const batchProps = sourceConnProps?.batchProperties as Record<string, unknown> | undefined;

  switch (dt) {
    case 'HL7V2': {
      // HL7v2 batch: split on MSH segment boundaries
      const splitType = String(batchProps?.splitType || 'MSH_Segment');
      return new HL7BatchAdaptorFactory({
        splitType: splitType === 'JavaScript' ? HL7v2SplitType.JavaScript : HL7v2SplitType.MSH_Segment,
        batchScript: batchProps?.batchScript as string | undefined,
      });
    }
    case 'XML': {
      const xmlSplitType = String(batchProps?.splitType || 'Element_Name') as XMLSplitType;
      return new XMLBatchAdaptorFactory({
        splitType: xmlSplitType,
        elementName: batchProps?.elementName as string | undefined,
        level: batchProps?.level != null ? parseInt(String(batchProps.level), 10) : undefined,
        xpathQuery: batchProps?.query as string | undefined,
        batchScript: batchProps?.batchScript as string | undefined,
      });
    }
    case 'DELIMITED': {
      const delimSplitType = String(batchProps?.splitType || 'Record') as DelimitedSplitType;
      return new DelimitedBatchAdaptorFactory({
        splitType: delimSplitType,
        recordDelimiter: String(batchProps?.recordDelimiter || '\\n'),
        columnDelimiter: String(batchProps?.columnDelimiter || ','),
        messageDelimiter: batchProps?.messageDelimiter as string | undefined,
        messageDelimiterIncluded: String(batchProps?.messageDelimiterIncluded) === 'true',
        groupingColumn: batchProps?.groupingColumn as string | undefined,
        batchScript: batchProps?.batchScript as string | undefined,
      });
    }
    case 'JSON':
    case 'RAW':
      // JSON and Raw batch adaptors require a compiled batch script function
      // which is only available for JMS/JavaScript receivers that parse it from channel XML.
      // For TCP/HTTP receivers with processBatch=true, the data type's default
      // split behavior is used — but JSON/Raw have no structural split point,
      // so they return null (no batch splitting).
      return null;
    case 'EDI':
    case 'X12':
    case 'EDI/X12':
      return new EDIBatchAdaptorFactory();
    default:
      // Unknown data type — no batch adaptor available
      return null;
  }
}

function mapDataTypeToSerialization(dataType?: string): SerializationType {
  if (!dataType) return SerializationType.RAW;
  switch (dataType.toUpperCase()) {
    case 'JSON':
      return SerializationType.JSON;
    case 'RAW':
      return SerializationType.RAW;
    default:
      // HL7V2, HL7V3, XML, NCPDP, EDI/X12, Delimited, DICOM all use XML representation
      return SerializationType.XML;
  }
}

/**
 * Extract filter rules from a channel config filter object.
 *
 * Handles two shapes:
 * 1. TypeScript interface: { rules: [{ name, script, operator, enabled }] }
 *    (from API/JSON-created channels)
 * 2. XML-parsed: { elements: { 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': {...} } }
 *    (from database channel XML via fast-xml-parser)
 *
 * For XML-parsed elements, multiple Java plugin types are supported:
 * - JavaScriptRule: has inline `script` field
 * - RuleBuilderRule: has `field`, `condition`, `values` — script is generated by the plugin
 */
function extractFilterRules(filter: unknown): ScriptFilterRule[] {
  if (!filter || typeof filter !== 'object') return [];
  const filterObj = filter as Record<string, unknown>;

  // Shape 1: TypeScript interface { rules: FilterRule[] }
  if (Array.isArray(filterObj.rules)) {
    return (filterObj.rules as Array<Record<string, unknown>>)
      .filter((r) => r.enabled !== false && r.script)
      .map((r) => ({
        name: String(r.name || ''),
        script: String(r.script),
        operator: (String(r.operator) === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
        enabled: true,
      }));
  }

  // Shape 2: XML-parsed { elements: { 'com.mirth...JavaScriptRule': ruleOrArray } }
  const elements = filterObj.elements as Record<string, unknown>;
  if (!elements || typeof elements !== 'object') return [];

  const rules: ScriptFilterRule[] = [];
  for (const [className, ruleData] of Object.entries(elements)) {
    if (className.startsWith('@_')) continue; // Skip XML attributes
    const items = Array.isArray(ruleData) ? ruleData : [ruleData];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rule = item as Record<string, unknown>;
      if (rule.enabled === false || String(rule.enabled) === 'false') continue;

      // Try inline script first (JavaScriptRule), then compile structured rules (RuleBuilderRule)
      let script: string | undefined;
      if (rule.script) {
        script = String(rule.script);
      } else {
        const compiled = compileFilterRule(className, rule);
        if (compiled) {
          script = compiled;
        }
      }
      if (!script) continue; // Unknown rule type without script — skip

      rules.push({
        name: String(rule.name || ''),
        script,
        operator: (String(rule.operator) === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
        enabled: true,
      });
    }
  }
  return rules;
}

/**
 * Extract transformer steps from a channel config transformer object.
 *
 * Handles two shapes:
 * 1. TypeScript interface: { steps: [{ name, script, enabled }] }
 *    (from API/JSON-created channels)
 * 2. XML-parsed: { elements: { 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {...} } }
 *    (from database channel XML via fast-xml-parser)
 *
 * Supported step types: JavaScriptStep, MapperStep, MessageBuilderStep, XsltStep
 * All compile to JavaScript — the `script` field contains the compiled output.
 */
function extractTransformerSteps(transformer: unknown): ScriptTransformerStep[] {
  if (!transformer || typeof transformer !== 'object') return [];
  const transformerObj = transformer as Record<string, unknown>;

  // Shape 1: TypeScript interface { steps: TransformerStep[] }
  if (Array.isArray(transformerObj.steps)) {
    return (transformerObj.steps as Array<Record<string, unknown>>)
      .filter((s) => s.enabled !== false && s.script)
      .map((s) => ({
        name: String(s.name || ''),
        script: String(s.script),
        enabled: true,
      }));
  }

  // Shape 2: XML-parsed { elements: { 'com.mirth...JavaScriptStep': stepOrArray } }
  const elements = transformerObj.elements as Record<string, unknown>;
  if (!elements || typeof elements !== 'object') return [];

  const steps: ScriptTransformerStep[] = [];
  for (const [className, stepData] of Object.entries(elements)) {
    if (className.startsWith('@_')) continue; // Skip XML attributes
    const items = Array.isArray(stepData) ? stepData : [stepData];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const step = item as Record<string, unknown>;
      if (step.enabled === false || String(step.enabled) === 'false') continue;

      // Try inline script first (JavaScriptStep), then compile structured steps (Mapper, MessageBuilder, XSLT)
      let script: string | undefined;
      if (step.script) {
        script = String(step.script);
      } else {
        const compiled = compileTransformerStep(className, step);
        if (compiled) {
          script = compiled;
        }
      }
      if (!script) continue; // Unknown step type without script — skip

      steps.push({
        name: String(step.name || ''),
        script,
        enabled: true,
      });
    }
  }
  return steps;
}

/**
 * Build FilterTransformerScripts from channel config filter and transformer objects.
 *
 * This bridges the gap between the channel model (XML-parsed or API) and the
 * FilterTransformerExecutor which needs ScriptBuilder-compatible types.
 */
function buildFilterTransformerScripts(
  filter: unknown,
  transformer: unknown
): FilterTransformerScripts {
  const transformerObj = transformer as Record<string, unknown> | undefined;

  return {
    filterRules: extractFilterRules(filter),
    transformerSteps: extractTransformerSteps(transformer),
    inboundDataType: mapDataTypeToSerialization(transformerObj?.inboundDataType as string),
    outboundDataType: mapDataTypeToSerialization(transformerObj?.outboundDataType as string),
    inboundDataTypeName: (transformerObj?.inboundDataType as string) || 'RAW',
    outboundDataTypeName: (transformerObj?.outboundDataType as string) || 'RAW',
    template: (transformerObj?.outboundTemplate as string) || '',
  };
}
