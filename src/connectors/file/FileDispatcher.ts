/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileDispatcher.java
 *
 * Purpose: File destination connector that writes files
 *
 * Key behaviors to replicate:
 * - Write files to local filesystem
 * - Support output filename patterns
 * - Append vs overwrite modes
 * - Binary and text mode writing
 * - Temporary file usage for atomic writes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import {
  FileDispatcherProperties,
  getDefaultFileDispatcherProperties,
  generateOutputFilename,
  FileScheme,
} from './FileConnectorProperties.js';

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
 */
export class FileDispatcher extends DestinationConnector {
  private properties: FileDispatcherProperties;

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
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Validate configuration
    if (this.properties.scheme !== FileScheme.FILE) {
      throw new Error(
        `File scheme ${this.properties.scheme} not yet implemented`
      );
    }

    if (!this.properties.directory) {
      throw new Error('Directory is required');
    }

    // Ensure directory exists
    await fs.mkdir(this.properties.directory, { recursive: true });

    this.running = true;
  }

  /**
   * Stop the file dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
  }

  /**
   * Send a message to the file destination
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (!this.running) {
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError('File Dispatcher is not running');
      return;
    }

    try {
      // Get content to write
      const content = this.getContent(connectorMessage);

      // Generate output filename
      const filename = this.generateFilename(connectorMessage);
      const filePath = path.join(this.properties.directory, filename);

      // Check if file exists and errorOnExists is set
      if (this.properties.errorOnExists) {
        try {
          await fs.access(filePath);
          connectorMessage.setStatus(Status.ERROR);
          connectorMessage.setProcessingError(`File already exists: ${filePath}`);
          return;
        } catch {
          // File doesn't exist, continue
        }
      }

      // Write file (potentially using temp file)
      await this.writeFile(filePath, content);

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
   * Write content to file
   */
  private async writeFile(
    filePath: string,
    content: string | Buffer
  ): Promise<void> {
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
