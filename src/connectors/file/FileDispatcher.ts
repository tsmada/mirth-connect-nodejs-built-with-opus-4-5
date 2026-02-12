/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileDispatcher.java
 *
 * Purpose: File destination connector that writes files
 *
 * Key behaviors to replicate:
 * - Write files to local filesystem (FILE scheme)
 * - Write files to SFTP server (SFTP scheme)
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
 * Supports local filesystem (FILE) and SFTP schemes
 */
export class FileDispatcher extends DestinationConnector {
  private properties: FileDispatcherProperties;
  private sftpConnection: SftpConnection | null = null;

  /** Timer for idle connection eviction (CPC-RCG-003) */
  private idleTimer: NodeJS.Timeout | null = null;
  /** Timestamp of last SFTP operation */
  private lastSftpActivityTime = 0;

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
        throw new Error(
          `File scheme ${this.properties.scheme} not yet implemented`
        );

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

    // Generate output filename first for the WRITING event info
    const filename = this.generateFilename(connectorMessage);
    const info = `${this.properties.host || this.properties.directory}/${filename}`;

    // Java: dispatches WRITING with info before write
    this.dispatchConnectionEvent(
      ConnectionStatusEventType.WRITING,
      `Writing file to: ${info}`
    );

    try {
      // Get content to write
      const content = this.getContent(connectorMessage);

      // Dispatch based on scheme
      let filePath: string;
      switch (this.properties.scheme) {
        case FileScheme.FILE:
          filePath = await this.writeLocalFile(filename, content);
          break;

        case FileScheme.SFTP:
          filePath = await this.writeSftpFile(filename, content);
          this.lastSftpActivityTime = Date.now();
          break;

        default:
          throw new Error(`Unsupported scheme: ${this.properties.scheme}`);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(errorMessage);
      throw error;
    } finally {
      // Java: dispatches IDLE in finally block after each write
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

      // If keepConnectionOpen is false, destroy the SFTP connection after each send
      // Java: fileConnector.destroyConnection() vs releaseConnection()
      if (!this.properties.keepConnectionOpen && this.sftpConnection) {
        await this.sftpConnection.disconnect();
        this.sftpConnection = null;
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

    this.lastSftpActivityTime = Date.now();
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
   * Start idle connection eviction timer (CPC-RCG-003)
   * Matches Java FileConnector connection pool eviction with maxIdleTime.
   * When keepConnectionOpen=true and maxIdleTime>0, periodically check
   * if the SFTP connection has been idle too long and close it.
   */
  private startIdleEviction(): void {
    if (
      this.properties.scheme !== FileScheme.SFTP &&
      this.properties.scheme !== FileScheme.FTP
    ) {
      return; // Only applies to remote connections
    }

    if (!this.properties.keepConnectionOpen) {
      return; // Connections are destroyed after each send, no eviction needed
    }

    if (this.properties.maxIdleTime <= 0) {
      return; // 0 = no eviction
    }

    // Check every second (Java: timeBetweenEvictionRunsMillis = 1000)
    this.idleTimer = setInterval(() => {
      if (this.sftpConnection && this.sftpConnection.isConnected()) {
        const idleTime = Date.now() - this.lastSftpActivityTime;
        if (idleTime > this.properties.maxIdleTime) {
          this.sftpConnection.disconnect().catch(() => {
            // Ignore disconnect errors during eviction
          });
          this.sftpConnection = null;
        }
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
  private getContent(connectorMessage: ConnectorMessage): string | Buffer {
    // Use template if provided, otherwise use encoded data
    if (this.properties.template) {
      // In a real implementation, template would be processed
      // For now, just use the template directly
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
   * Generate output filename
   */
  private generateFilename(connectorMessage: ConnectorMessage): string {
    // Build variables from connector message
    const variables: Record<string, string> = {
      messageId: String(connectorMessage.getMessageId() ?? ''),
      channelId: String(connectorMessage.getChannelId() ?? ''),
    };

    return generateOutputFilename(this.properties.outputPattern, variables);
  }

  /**
   * Write file to local filesystem
   */
  private async writeLocalFile(
    filename: string,
    content: string | Buffer
  ): Promise<string> {
    const filePath = path.join(this.properties.directory, filename);

    // Check if file exists and errorOnExists is set
    if (this.properties.errorOnExists) {
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

    // Determine if we should use a temp file
    const useTempFile = !!this.properties.tempFilename;
    const tempPath = useTempFile
      ? `${filePath}${this.properties.tempFilename}`
      : filePath;

    // Convert content to buffer if binary mode
    let dataToWrite: string | Buffer;
    if (this.properties.binary && typeof content === 'string') {
      // Assume content is base64 encoded in binary mode
      dataToWrite = Buffer.from(content, 'base64');
    } else {
      dataToWrite = content;
    }

    // Write to file (append or overwrite)
    if (this.properties.outputAppend) {
      await fs.appendFile(tempPath, dataToWrite, {
        encoding: this.properties.binary
          ? undefined
          : (this.properties.charsetEncoding as BufferEncoding),
      });
    } else {
      await fs.writeFile(tempPath, dataToWrite, {
        encoding: this.properties.binary
          ? undefined
          : (this.properties.charsetEncoding as BufferEncoding),
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
    content: string | Buffer
  ): Promise<string> {
    const sftp = await this.ensureSftpConnection();
    const remotePath = `${this.properties.directory}/${filename}`.replace(/\/+/g, '/');

    // Check if file exists and errorOnExists is set
    if (this.properties.errorOnExists) {
      const exists = await sftp.exists(filename, this.properties.directory);
      if (exists) {
        throw new Error(`File already exists: ${remotePath}`);
      }
    }

    // Convert content to buffer if binary mode
    let dataToWrite: Buffer;
    if (this.properties.binary && typeof content === 'string') {
      // Assume content is base64 encoded in binary mode
      dataToWrite = Buffer.from(content, 'base64');
    } else if (typeof content === 'string') {
      dataToWrite = Buffer.from(content, this.properties.charsetEncoding as BufferEncoding);
    } else {
      dataToWrite = content;
    }

    // Handle temp file pattern for atomic writes
    if (this.properties.tempFilename) {
      const tempFilename = `${filename}${this.properties.tempFilename}`;

      // Write to temp file
      await sftp.writeFile(
        tempFilename,
        this.properties.directory,
        dataToWrite,
        false // Don't append to temp file
      );

      // Rename temp file to final name
      await sftp.move(
        tempFilename,
        this.properties.directory,
        filename,
        this.properties.directory
      );
    } else {
      // Direct write (with append support)
      await sftp.writeFile(
        filename,
        this.properties.directory,
        dataToWrite,
        this.properties.outputAppend
      );
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
