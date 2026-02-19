/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileDispatcher.java
 *
 * Purpose: File destination connector that writes files
 *
 * Key behaviors to replicate:
 * - Write files to local filesystem (FILE scheme)
 * - Write files to SFTP server (SFTP scheme)
 * - Write files to FTP/FTPS server (FTP scheme)
 * - Write files to S3 bucket (S3 scheme)
 * - Write files to SMB/CIFS share (SMB scheme)
 * - Support output filename patterns
 * - Append vs overwrite modes (Java default: append=true)
 * - Binary and text mode writing
 * - Temporary file usage for atomic writes
 * - Connection event dispatching (IDLE on deploy, WRITING before write, IDLE after)
 * - keepConnectionOpen / maxIdleTime for SFTP/FTP connection reuse
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  FileDispatcherProperties,
  getDefaultFileDispatcherProperties,
  generateOutputFilename,
  FileScheme,
} from './FileConnectorProperties.js';
import { SftpConnection } from './sftp/SftpConnection.js';
import { getDefaultSftpSchemeProperties } from './sftp/SftpSchemeProperties.js';
import { FileSystemClient } from './backends/types.js';
import { createFileSystemClient } from './backends/factory.js';
import { getLogger } from '../../logging/index.js';

const logger = getLogger('file-connector');

/**
 * Normalize Java Mirth charset encoding names to Node.js BufferEncoding.
 * Java Mirth uses 'DEFAULT_ENCODING' to mean JVM default (UTF-8).
 */
function normalizeEncoding(encoding: string): BufferEncoding {
  if (!encoding || encoding === 'DEFAULT_ENCODING') return 'utf-8';
  const lower = encoding.toLowerCase().replace(/[_-]/g, '');
  const map: Record<string, BufferEncoding> = {
    'utf8': 'utf-8',
    'utf16le': 'utf16le',
    'utf16be': 'utf16le', // Node.js doesn't natively support utf16be; best-effort
    'latin1': 'latin1',
    'iso88591': 'latin1',
    'ascii': 'ascii',
    'usascii': 'ascii',
    'base64': 'base64',
    'hex': 'hex',
    'binary': 'binary',
  };
  return map[lower] ?? 'utf-8';
}

export interface FileDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<FileDispatcherProperties>;
}

/**
 * File Destination Connector that writes files
 * Supports local filesystem (FILE), SFTP, FTP, S3, and SMB schemes
 */
export class FileDispatcher extends DestinationConnector {
  private properties: FileDispatcherProperties;
  private sftpConnection: SftpConnection | null = null;
  /** Generic backend client for FTP, S3, SMB schemes */
  private backendClient: FileSystemClient | null = null;

  /** Timer for idle connection eviction (CPC-RCG-003) */
  private idleTimer: NodeJS.Timeout | null = null;
  /** Timestamp of last remote operation (SFTP or backend) */
  private lastRemoteActivityTime = 0;

  constructor(config: FileDispatcherConfig) {
    super({
      name: config.name ?? 'File Writer',
      transportName: 'File',
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultFileDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * CPC-W18-001: Resolve ${variable} placeholders in connector properties before each send.
   * Matches Java FileDispatcher.replaceConnectorProperties() (line 97):
   * Resolves host, outputPattern, username, password, template.
   * Also resolves SFTP scheme properties (keyFile, passPhrase, knownHostsFile).
   * Returns a shallow clone — original properties are NOT modified.
   */
  replaceConnectorProperties(
    props: FileDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): FileDispatcherProperties {
    const resolved = { ...props };

    resolved.host = this.resolveVariables(resolved.host, connectorMessage);
    resolved.directory = this.resolveVariables(resolved.directory, connectorMessage);
    resolved.outputPattern = this.resolveVariables(resolved.outputPattern, connectorMessage);
    resolved.username = this.resolveVariables(resolved.username, connectorMessage);
    resolved.password = this.resolveVariables(resolved.password, connectorMessage);
    resolved.template = this.resolveVariables(resolved.template, connectorMessage);

    // Java: also resolves SFTP scheme properties (keyFile, passPhrase, knownHostsFile)
    if (resolved.sftpSchemeProperties) {
      resolved.sftpSchemeProperties = { ...resolved.sftpSchemeProperties };
      if (resolved.sftpSchemeProperties.keyFile) {
        resolved.sftpSchemeProperties.keyFile = this.resolveVariables(
          resolved.sftpSchemeProperties.keyFile,
          connectorMessage
        );
      }
      if (resolved.sftpSchemeProperties.passPhrase) {
        resolved.sftpSchemeProperties.passPhrase = this.resolveVariables(
          resolved.sftpSchemeProperties.passPhrase,
          connectorMessage
        );
      }
      if (resolved.sftpSchemeProperties.knownHostsFile) {
        resolved.sftpSchemeProperties.knownHostsFile = this.resolveVariables(
          resolved.sftpSchemeProperties.knownHostsFile,
          connectorMessage
        );
      }
    }

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
   * Get the connector properties
   */
  getProperties(): FileDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<FileDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the file dispatcher
   * Matches Java FileDispatcher.onDeploy()
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    if (!this.properties.directory) {
      throw new Error('Directory is required');
    }

    // Initialize based on scheme
    switch (this.properties.scheme) {
      case FileScheme.FILE:
        // Ensure local directory exists
        await fs.mkdir(this.properties.directory, { recursive: true });
        break;

      case FileScheme.SFTP:
        await this.initializeSftpConnection();
        break;

      case FileScheme.FTP:
      case FileScheme.S3:
      case FileScheme.SMB:
        await this.initializeBackendClient();
        break;

      default:
        throw new Error(`Unknown file scheme: ${this.properties.scheme}`);
    }

    this.running = true;

    // Start idle eviction timer for keepConnectionOpen with maxIdleTime (CPC-RCG-003)
    this.startIdleEviction();

    // Java: onDeploy() dispatches IDLE after initialization
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Stop the file dispatcher
   * Matches Java FileDispatcher.onStop()
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.stopIdleEviction();

    // Clean up SFTP connection if active
    if (this.sftpConnection) {
      await this.sftpConnection.disconnect();
      this.sftpConnection = null;
    }

    // Clean up backend client (FTP/S3/SMB) if active
    if (this.backendClient) {
      try {
        await this.backendClient.disconnect();
      } catch {
        // Ignore disconnect errors during shutdown
      }
      this.backendClient = null;
    }

    this.running = false;
  }

  /**
   * Send a message to the file destination
   * Matches Java FileDispatcher.send() event dispatch pattern:
   * - WRITING (with info message) before write
   * - IDLE after write (in finally)
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.running) {
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError('File Dispatcher is not running');
      return;
    }

    // CPC-W18-001: Resolve ${variable} placeholders before each send
    const resolvedProps = this.replaceConnectorProperties(this.properties, connectorMessage);

    // Generate output filename first for the WRITING event info
    const filename = this.generateFilename(connectorMessage, resolvedProps);
    const info = `${resolvedProps.host || resolvedProps.directory}/${filename}`;

    // Java: dispatches WRITING with info before write
    this.dispatchConnectionEvent(ConnectionStatusEventType.WRITING, `Writing file to: ${info}`);

    try {
      // Get content to write
      const content = this.getContent(connectorMessage, resolvedProps);

      // Dispatch based on scheme
      let filePath: string;
      switch (resolvedProps.scheme) {
        case FileScheme.FILE:
          filePath = await this.writeLocalFile(filename, content, resolvedProps);
          break;

        case FileScheme.SFTP:
          filePath = await this.writeSftpFile(filename, content, resolvedProps);
          this.lastRemoteActivityTime = Date.now();
          break;

        case FileScheme.FTP:
        case FileScheme.S3:
        case FileScheme.SMB:
          filePath = await this.writeBackendFile(filename, content, resolvedProps);
          this.lastRemoteActivityTime = Date.now();
          break;

        default:
          throw new Error(`Unsupported scheme: ${resolvedProps.scheme}`);
      }

      // Set send date
      connectorMessage.setSendDate(new Date());

      // Set response with filename
      const response = this.buildResponse(filename, filePath);
      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: response,
        dataType: 'XML',
        encrypted: false,
      });

      // Update status
      connectorMessage.setStatus(Status.SENT);

      // Store result in connector map
      connectorMessage.getConnectorMap().set('filename', filename);
      connectorMessage.getConnectorMap().set('filePath', filePath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(errorMessage);
      throw error;
    } finally {
      // Java: dispatches IDLE in finally block after each write
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

      // If keepConnectionOpen is false, destroy the remote connection after each send
      // Java: fileConnector.destroyConnection() vs releaseConnection()
      if (!resolvedProps.keepConnectionOpen) {
        if (this.sftpConnection) {
          await this.sftpConnection.disconnect();
          this.sftpConnection = null;
        }
        if (this.backendClient) {
          try {
            await this.backendClient.disconnect();
          } catch {
            /* ignore */
          }
          this.backendClient = null;
        }
      }
    }
  }

  /**
   * Get response from the last write
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Initialize SFTP connection
   */
  private async initializeSftpConnection(): Promise<void> {
    if (!this.properties.host) {
      throw new Error('Host is required for SFTP connections');
    }

    const schemeProps = this.properties.sftpSchemeProperties ?? getDefaultSftpSchemeProperties();

    this.sftpConnection = new SftpConnection({
      host: this.properties.host,
      port: this.properties.port,
      username: this.properties.username,
      password: this.properties.password,
      schemeProperties: schemeProps,
      timeout: this.properties.timeout,
    });

    await this.sftpConnection.connect();

    // Verify we can write to the directory
    const canWrite = await this.sftpConnection.canWrite(this.properties.directory);
    if (!canWrite) {
      throw new Error(`Cannot write to SFTP directory: ${this.properties.directory}`);
    }

    this.lastRemoteActivityTime = Date.now();
  }

  /**
   * Ensure SFTP connection is active, reconnecting if needed
   */
  private async ensureSftpConnection(): Promise<SftpConnection> {
    if (!this.sftpConnection || !this.sftpConnection.isConnected()) {
      await this.initializeSftpConnection();
    }
    return this.sftpConnection!;
  }

  /**
   * Initialize backend client (FTP/S3/SMB) for writing.
   * Matches the pattern in FileReceiver.initializeBackendClientWithRetry()
   * but without retry logic (dispatcher retries are handled at the send level).
   */
  private async initializeBackendClient(): Promise<void> {
    if (!this.properties.host && this.properties.scheme !== FileScheme.S3) {
      throw new Error(`Host is required for ${this.properties.scheme} connections`);
    }

    logger.info(
      `Initializing ${this.properties.scheme} connection to ${this.properties.host || 'S3'}...`
    );

    this.backendClient = createFileSystemClient(this.properties.scheme, this.properties);
    await this.backendClient.connect();

    // Verify we can write to the directory
    const canWrite = await this.backendClient.canWrite(this.properties.directory);
    if (!canWrite) {
      throw new Error(
        `Cannot write to ${this.properties.scheme} directory: ${this.properties.directory}`
      );
    }

    this.lastRemoteActivityTime = Date.now();
    logger.info(`${this.properties.scheme} connection established`);
  }

  /**
   * Ensure backend client is active, reconnecting if needed.
   */
  private async ensureBackendClient(): Promise<FileSystemClient> {
    if (!this.backendClient || !this.backendClient.isConnected()) {
      await this.initializeBackendClient();
    }
    return this.backendClient!;
  }

  /**
   * Start idle connection eviction timer (CPC-RCG-003)
   * Matches Java FileConnector connection pool eviction with maxIdleTime.
   * When keepConnectionOpen=true and maxIdleTime>0, periodically check
   * if the SFTP connection has been idle too long and close it.
   */
  private startIdleEviction(): void {
    // Only applies to remote connections (SFTP, FTP, S3, SMB)
    if (this.properties.scheme === FileScheme.FILE) {
      return;
    }

    if (!this.properties.keepConnectionOpen) {
      return; // Connections are destroyed after each send, no eviction needed
    }

    if (this.properties.maxIdleTime <= 0) {
      return; // 0 = no eviction
    }

    // Check every second (Java: timeBetweenEvictionRunsMillis = 1000)
    this.idleTimer = setInterval(() => {
      const idleTime = Date.now() - this.lastRemoteActivityTime;
      if (idleTime <= this.properties.maxIdleTime) {
        return;
      }

      // Evict SFTP connection if idle
      if (this.sftpConnection && this.sftpConnection.isConnected()) {
        this.sftpConnection.disconnect().catch(() => {
          // Ignore disconnect errors during eviction
        });
        this.sftpConnection = null;
        logger.debug(`SFTP connection evicted after ${idleTime}ms idle`);
      }

      // Evict backend client (FTP/S3/SMB) if idle
      if (this.backendClient && this.backendClient.isConnected()) {
        this.backendClient.disconnect().catch(() => {
          // Ignore disconnect errors during eviction
        });
        this.backendClient = null;
        logger.debug(`${this.properties.scheme} connection evicted after ${idleTime}ms idle`);
      }
    }, 1000);
  }

  /**
   * Stop idle eviction timer
   */
  private stopIdleEviction(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Get content to write from connector message
   */
  private getContent(
    connectorMessage: ConnectorMessage,
    resolvedProps: FileDispatcherProperties
  ): string | Buffer {
    // Use template if provided, otherwise use encoded data
    if (resolvedProps.template) {
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
   * Generate output filename
   */
  private generateFilename(
    connectorMessage: ConnectorMessage,
    resolvedProps: FileDispatcherProperties
  ): string {
    // Build variables from connector message
    const variables: Record<string, string> = {
      messageId: String(connectorMessage.getMessageId() ?? ''),
      channelId: String(connectorMessage.getChannelId() ?? ''),
    };

    return generateOutputFilename(resolvedProps.outputPattern, variables);
  }

  /**
   * Write file to local filesystem
   */
  private async writeLocalFile(
    filename: string,
    content: string | Buffer,
    resolvedProps: FileDispatcherProperties
  ): Promise<string> {
    const filePath = path.join(resolvedProps.directory, filename);

    // Check if file exists and errorOnExists is set
    if (resolvedProps.errorOnExists) {
      try {
        await fs.access(filePath);
        throw new Error(`File already exists: ${filePath}`);
      } catch (error) {
        // File doesn't exist, continue (unless it's our error)
        if ((error as Error).message?.startsWith('File already exists')) {
          throw error;
        }
      }
    }

    // CPC-W18-007: Determine if we should use a temp file
    // Java: temporary flag OR explicit tempFilename — either triggers temp-then-rename
    const useTempFile = resolvedProps.temporary || !!resolvedProps.tempFilename;
    const tempSuffix = resolvedProps.tempFilename || '.tmp';
    const tempPath = useTempFile ? `${filePath}${tempSuffix}` : filePath;

    // Convert content to buffer if binary mode
    let dataToWrite: string | Buffer;
    if (resolvedProps.binary && typeof content === 'string') {
      // Assume content is base64 encoded in binary mode
      dataToWrite = Buffer.from(content, 'base64');
    } else {
      dataToWrite = content;
    }

    // Write to file (append or overwrite)
    if (resolvedProps.outputAppend) {
      await fs.appendFile(tempPath, dataToWrite, {
        encoding: resolvedProps.binary
          ? undefined
          : normalizeEncoding(resolvedProps.charsetEncoding),
      });
    } else {
      await fs.writeFile(tempPath, dataToWrite, {
        encoding: resolvedProps.binary
          ? undefined
          : normalizeEncoding(resolvedProps.charsetEncoding),
      });
    }

    // Rename temp file to final name if using temp file
    if (useTempFile) {
      await fs.rename(tempPath, filePath);
    }

    return filePath;
  }

  /**
   * Write file to SFTP server
   */
  private async writeSftpFile(
    filename: string,
    content: string | Buffer,
    resolvedProps: FileDispatcherProperties
  ): Promise<string> {
    const sftp = await this.ensureSftpConnection();
    const remotePath = `${resolvedProps.directory}/${filename}`.replace(/\/+/g, '/');

    // Check if file exists and errorOnExists is set
    if (resolvedProps.errorOnExists) {
      const exists = await sftp.exists(filename, resolvedProps.directory);
      if (exists) {
        throw new Error(`File already exists: ${remotePath}`);
      }
    }

    // Convert content to buffer if binary mode
    let dataToWrite: Buffer;
    if (resolvedProps.binary && typeof content === 'string') {
      // Assume content is base64 encoded in binary mode
      dataToWrite = Buffer.from(content, 'base64');
    } else if (typeof content === 'string') {
      dataToWrite = Buffer.from(content, resolvedProps.charsetEncoding as BufferEncoding);
    } else {
      dataToWrite = content;
    }

    // CPC-W18-007: Handle temp file pattern for atomic writes
    // Java: temporary flag OR explicit tempFilename
    const useTempFile = resolvedProps.temporary || !!resolvedProps.tempFilename;
    if (useTempFile) {
      const tempSuffix = resolvedProps.tempFilename || '.tmp';
      const tempFilename = `${filename}${tempSuffix}`;

      // Write to temp file
      await sftp.writeFile(
        tempFilename,
        resolvedProps.directory,
        dataToWrite,
        false // Don't append to temp file
      );

      // Rename temp file to final name
      await sftp.move(tempFilename, resolvedProps.directory, filename, resolvedProps.directory);
    } else {
      // Direct write (with append support)
      await sftp.writeFile(
        filename,
        resolvedProps.directory,
        dataToWrite,
        resolvedProps.outputAppend
      );
    }

    return remotePath;
  }

  /**
   * Write file via backend client (FTP/S3/SMB)
   * Matches Java FileDispatcher.send() for remote schemes.
   */
  private async writeBackendFile(
    filename: string,
    content: string | Buffer,
    resolvedProps: FileDispatcherProperties
  ): Promise<string> {
    const client = await this.ensureBackendClient();
    const remotePath = `${resolvedProps.directory}/${filename}`.replace(/\/+/g, '/');

    // Check if file exists and errorOnExists is set
    if (resolvedProps.errorOnExists) {
      const exists = await client.exists(filename, resolvedProps.directory);
      if (exists) {
        throw new Error(`File already exists: ${remotePath}`);
      }
    }

    // Convert content to buffer
    let dataToWrite: Buffer;
    if (resolvedProps.binary && typeof content === 'string') {
      dataToWrite = Buffer.from(content, 'base64');
    } else if (typeof content === 'string') {
      dataToWrite = Buffer.from(content, resolvedProps.charsetEncoding as BufferEncoding);
    } else {
      dataToWrite = content;
    }

    // Handle temp file pattern for atomic writes
    // Java: temporary flag OR explicit tempFilename
    const useTempFile = resolvedProps.temporary || !!resolvedProps.tempFilename;
    if (useTempFile) {
      const tempSuffix = resolvedProps.tempFilename || '.tmp';
      const tempFilename = `${filename}${tempSuffix}`;

      // Write to temp file (no append for temp files)
      await client.writeFile(tempFilename, resolvedProps.directory, dataToWrite, false);

      // Rename temp file to final name
      await client.move(tempFilename, resolvedProps.directory, filename, resolvedProps.directory);
    } else {
      // Direct write with append support
      // Note: S3 canAppend() returns false; writeFile with append=true
      // on S3 will download-concat-reupload (handled by S3Client)
      const shouldAppend = resolvedProps.outputAppend && client.canAppend();
      await client.writeFile(filename, resolvedProps.directory, dataToWrite, shouldAppend);
    }

    return remotePath;
  }

  /**
   * Build response XML from write result
   */
  private buildResponse(filename: string, filePath: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <filename>${filename}</filename>
  <filePath>${filePath}</filePath>
  <success>true</success>
</result>`;
  }
}
