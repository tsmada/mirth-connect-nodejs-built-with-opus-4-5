/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileReceiver.java
 *
 * Purpose: File source connector that polls for files
 *
 * Key behaviors to replicate:
 * - Poll-based file discovery
 * - Support local filesystem (FILE scheme)
 * - Support SFTP servers (SFTP scheme)
 * - File filtering (glob and regex patterns)
 * - After-processing actions (move, delete)
 * - Binary and text mode reading
 * - File age checking (checkFileAge + fileAge defaults: true/1000ms)
 * - Sorting options
 * - Connection event dispatching (IDLE, POLLING, READING)
 * - Connection retry with configurable backoff for SFTP/FTP
 * - pollId/pollSequenceId/pollComplete sourceMap entries
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  FileReceiverProperties,
  getDefaultFileReceiverProperties,
  matchesFilter,
  AfterProcessingAction,
  FileSortBy,
  FileScheme,
  FileInfo,
} from './FileConnectorProperties.js';
import { SftpConnection, SftpFileInfo } from './sftp/SftpConnection.js';
import { getDefaultSftpSchemeProperties } from './sftp/SftpSchemeProperties.js';

export interface FileReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<FileReceiverProperties>;
}

/**
 * File Source Connector that polls for files
 * Supports local filesystem (FILE) and SFTP schemes
 */
export class FileReceiver extends SourceConnector {
  private properties: FileReceiverProperties;
  private pollTimer: NodeJS.Timeout | null = null;
  private sftpConnection: SftpConnection | null = null;

  /** Monotonically increasing poll counter for generating unique pollIds */
  private pollCounter = 0;

  constructor(config: FileReceiverConfig) {
    super({
      name: config.name ?? 'File Reader',
      transportName: 'File',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultFileReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): FileReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<FileReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the file receiver
   * Matches Java FileReceiver.onDeploy() + onStart()
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('File Receiver is already running');
    }

    if (!this.properties.directory) {
      throw new Error('Directory is required');
    }

    // Initialize based on scheme
    switch (this.properties.scheme) {
      case FileScheme.FILE:
        await this.initializeLocalFileSystem();
        break;

      case FileScheme.SFTP:
        await this.initializeSftpConnectionWithRetry();
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

    // Set running before starting polling to avoid race condition
    // where the first poll() call sees running=false and exits immediately
    this.running = true;

    // Java: onDeploy() dispatches IDLE after initialization
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

    this.startPolling();
  }

  /**
   * Stop the file receiver
   * Matches Java FileReceiver.onStop()
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.stopPolling();

    // Clean up SFTP connection if active
    if (this.sftpConnection) {
      await this.sftpConnection.disconnect();
      this.sftpConnection = null;
    }

    this.running = false;

    // Java: onStop() dispatches IDLE after cleanup
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Initialize local file system access
   */
  private async initializeLocalFileSystem(): Promise<void> {
    // Verify directory exists
    try {
      const stats = await fs.stat(this.properties.directory);
      if (!stats.isDirectory()) {
        throw new Error(
          `Path is not a directory: ${this.properties.directory}`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found: ${this.properties.directory}`);
      }
      throw error;
    }
  }

  /**
   * Initialize SFTP connection with retry logic (CPC-MEH-004)
   * Java uses FileConnector connection pool which retries on borrow failure.
   */
  private async initializeSftpConnectionWithRetry(): Promise<void> {
    // Validate required config before entering retry loop — fail fast
    if (!this.properties.host) {
      throw new Error('Host is required for SFTP connections');
    }

    const maxRetries = this.properties.maxRetryCount;
    const retryDelay = this.properties.retryDelay;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.initializeSftpConnection();
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          // Wait before retrying with linear backoff
          const delay = retryDelay * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Failed to establish SFTP connection');
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

    // Verify we can read the directory
    const canRead = await this.sftpConnection.canRead(this.properties.directory);
    if (!canRead) {
      throw new Error(`Cannot read SFTP directory: ${this.properties.directory}`);
    }
  }

  /**
   * Ensure SFTP connection is active, reconnecting with retry if needed (CPC-MEH-004)
   */
  private async ensureSftpConnection(): Promise<SftpConnection> {
    if (!this.sftpConnection || !this.sftpConnection.isConnected()) {
      await this.initializeSftpConnectionWithRetry();
    }
    return this.sftpConnection!;
  }

  /**
   * Start polling timer
   */
  private startPolling(): void {
    // Execute first poll immediately
    this.poll().catch((err) => {
      console.error('Poll error:', err);
    });

    // Schedule subsequent polls
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error('Poll error:', err);
      });
    }, this.properties.pollInterval);
  }

  /**
   * Stop polling timer
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Execute poll to discover and process files
   * Matches Java FileReceiver.poll() event dispatch pattern:
   * - POLLING at start
   * - READING before each file
   * - IDLE after each file and after poll completes (in finally)
   */
  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Java: poll() dispatches POLLING at start
    this.dispatchConnectionEvent(ConnectionStatusEventType.POLLING);

    try {
      // Generate poll tracking IDs (CPC-MCP-027)
      // Java: String pollId = "" + System.nanoTime();
      this.pollCounter++;
      const pollId = String(Date.now()) + '-' + String(this.pollCounter);
      let pollSequenceId = 1;

      // List files based on scheme
      let files: FileInfo[];
      switch (this.properties.scheme) {
        case FileScheme.FILE:
          files = await this.listLocalFiles(this.properties.directory);
          break;

        case FileScheme.SFTP:
          files = await this.listSftpFiles(this.properties.directory);
          break;

        default:
          throw new Error(`Unsupported scheme: ${this.properties.scheme}`);
      }

      // Filter files
      const filteredFiles = this.filterFiles(files);

      // Sort files
      const sortedFiles = this.sortFiles(filteredFiles);

      // Apply batch size limit
      const filesToProcess =
        this.properties.batchSize > 0
          ? sortedFiles.slice(0, this.properties.batchSize)
          : sortedFiles;

      // Process each file with poll tracking
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i]!;
        const pollComplete = i === filesToProcess.length - 1;

        // Java: dispatches READING before processing each file
        this.dispatchConnectionEvent(ConnectionStatusEventType.READING);

        await this.processFile(file, pollId, pollSequenceId, pollComplete);
        pollSequenceId++;

        // Java: dispatches IDLE after each file
        this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
      }
    } catch (error) {
      console.error('File poll error:', error);
    } finally {
      // Java: poll() dispatches IDLE in finally block
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * List files from local filesystem
   */
  private async listLocalFiles(directory: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files if configured
      if (this.properties.ignoreDot && entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories if enabled
        if (this.properties.directoryRecursion) {
          const subFiles = await this.listLocalFiles(fullPath);
          files.push(...subFiles);
        }
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          directory: directory,
          size: stats.size,
          lastModified: stats.mtime,
          isDirectory: false,
        });
      }
    }

    return files;
  }

  /**
   * List files from SFTP server
   */
  private async listSftpFiles(directory: string): Promise<SftpFileInfo[]> {
    const sftp = await this.ensureSftpConnection();

    // Use SFTP's listFiles which handles filtering internally
    const files = await sftp.listFiles(
      directory,
      this.properties.fileFilter,
      this.properties.regex,
      this.properties.ignoreDot
    );

    // Handle directory recursion for SFTP
    if (this.properties.directoryRecursion) {
      const subdirs = await sftp.listDirectories(directory);
      for (const subdir of subdirs) {
        // Skip hidden directories if configured
        const dirName = subdir.split('/').pop() || '';
        if (this.properties.ignoreDot && dirName.startsWith('.')) {
          continue;
        }

        const subFiles = await this.listSftpFiles(subdir);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Filter files based on pattern and age
   * Matches Java FileReceiver.isFileValid() with checkFileAge/fileAge (CPC-DVM-005)
   */
  private filterFiles(files: FileInfo[]): FileInfo[] {
    const now = Date.now();

    return files.filter((file) => {
      // For SFTP, filtering is already done in listSftpFiles
      // For local files, check pattern match
      if (this.properties.scheme === FileScheme.FILE) {
        if (
          !matchesFilter(
            file.name,
            this.properties.fileFilter,
            this.properties.regex
          )
        ) {
          return false;
        }
      }

      // Check file age — Java has separate checkFileAge boolean + fileAge value
      if (this.properties.checkFileAge && this.properties.fileAge > 0) {
        const age = now - file.lastModified.getTime();
        if (age < this.properties.fileAge) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Sort files based on configured order
   */
  private sortFiles(files: FileInfo[]): FileInfo[] {
    const sorted = [...files];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (this.properties.sortBy) {
        case FileSortBy.NAME:
          comparison = a.name.localeCompare(b.name);
          break;
        case FileSortBy.SIZE:
          comparison = a.size - b.size;
          break;
        case FileSortBy.DATE:
          comparison = a.lastModified.getTime() - b.lastModified.getTime();
          break;
      }

      return this.properties.sortDescending ? -comparison : comparison;
    });

    return sorted;
  }

  /**
   * Process a single file
   * Matches Java FileReceiver.processFile() sourceMap entries (CPC-MCP-027)
   */
  private async processFile(
    file: FileInfo,
    pollId: string,
    pollSequenceId: number,
    pollComplete: boolean
  ): Promise<void> {
    try {
      // Read file content
      const content = await this.readFile(file);

      // Build source map — matches Java's sourceMap entries exactly
      const sourceMapData = new Map<string, unknown>();
      sourceMapData.set('originalFilename', file.name);
      sourceMapData.set('fileDirectory', file.directory);
      sourceMapData.set('fileSize', file.size);
      sourceMapData.set('fileLastModified', file.lastModified.toISOString());
      // Java: sourceMap.put("pollId", pollId)
      sourceMapData.set('pollId', pollId);
      // Java: sourceMap.put("pollSequenceId", pollSequenceId.get())
      sourceMapData.set('pollSequenceId', pollSequenceId);
      // Java: if (pollComplete) { sourceMap.put("pollComplete", true); }
      if (pollComplete) {
        sourceMapData.set('pollComplete', true);
      }

      // Dispatch message
      await this.dispatchRawMessage(content, sourceMapData);

      // Execute after-processing action
      await this.executeAfterProcessingAction(file);
    } catch (error) {
      console.error(`Error processing file ${file.path}:`, error);

      // Execute error action
      await this.executeErrorAction(file);
    }
  }

  /**
   * Read file content
   */
  private async readFile(file: FileInfo): Promise<string> {
    switch (this.properties.scheme) {
      case FileScheme.FILE:
        return this.readLocalFile(file);

      case FileScheme.SFTP:
        return this.readSftpFile(file);

      default:
        throw new Error(`Unsupported scheme: ${this.properties.scheme}`);
    }
  }

  /**
   * Read local file content
   */
  private async readLocalFile(file: FileInfo): Promise<string> {
    if (this.properties.binary) {
      const buffer = await fs.readFile(file.path);
      return buffer.toString('base64');
    } else {
      return await fs.readFile(file.path, {
        encoding: this.properties.charsetEncoding as BufferEncoding,
      });
    }
  }

  /**
   * Read SFTP file content
   */
  private async readSftpFile(file: FileInfo): Promise<string> {
    const sftp = await this.ensureSftpConnection();

    if (this.properties.binary) {
      const buffer = await sftp.readFile(file.name, file.directory);
      return buffer.toString('base64');
    } else {
      return await sftp.readFileAsString(
        file.name,
        file.directory,
        this.properties.charsetEncoding as BufferEncoding
      );
    }
  }

  /**
   * Execute after-processing action
   */
  private async executeAfterProcessingAction(file: FileInfo): Promise<void> {
    switch (this.properties.afterProcessingAction) {
      case AfterProcessingAction.DELETE:
        await this.deleteFile(file);
        break;

      case AfterProcessingAction.MOVE:
        if (this.properties.moveToDirectory) {
          await this.moveFile(file, this.properties.moveToDirectory);
        }
        break;

      case AfterProcessingAction.NONE:
      default:
        // No action needed
        break;
    }
  }

  /**
   * Execute error action
   */
  private async executeErrorAction(file: FileInfo): Promise<void> {
    switch (this.properties.errorAction) {
      case AfterProcessingAction.DELETE:
        await this.deleteFile(file);
        break;

      case AfterProcessingAction.MOVE:
        if (this.properties.errorDirectory) {
          await this.moveFile(file, this.properties.errorDirectory);
        }
        break;

      case AfterProcessingAction.NONE:
      default:
        // No action needed
        break;
    }
  }

  /**
   * Delete a file
   */
  private async deleteFile(file: FileInfo): Promise<void> {
    switch (this.properties.scheme) {
      case FileScheme.FILE:
        await fs.unlink(file.path);
        break;

      case FileScheme.SFTP: {
        const sftp = await this.ensureSftpConnection();
        await sftp.delete(file.name, file.directory, false);
        break;
      }

      default:
        throw new Error(`Unsupported scheme: ${this.properties.scheme}`);
    }
  }

  /**
   * Move a file to a new directory
   */
  private async moveFile(file: FileInfo, toDirectory: string): Promise<void> {
    switch (this.properties.scheme) {
      case FileScheme.FILE: {
        const destPath = path.join(toDirectory, file.name);
        // Ensure destination directory exists
        await fs.mkdir(toDirectory, { recursive: true });
        // Move file
        await fs.rename(file.path, destPath);
        break;
      }

      case FileScheme.SFTP: {
        const sftp = await this.ensureSftpConnection();
        await sftp.move(file.name, file.directory, file.name, toDirectory);
        break;
      }

      default:
        throw new Error(`Unsupported scheme: ${this.properties.scheme}`);
    }
  }
}
