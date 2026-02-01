/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FileReceiver.java
 *
 * Purpose: File source connector that polls for files
 *
 * Key behaviors to replicate:
 * - Poll-based file discovery
 * - Support local filesystem (FILE scheme)
 * - File filtering (glob and regex patterns)
 * - After-processing actions (move, delete)
 * - Binary and text mode reading
 * - File age checking
 * - Sorting options
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import {
  FileReceiverProperties,
  getDefaultFileReceiverProperties,
  matchesFilter,
  AfterProcessingAction,
  FileSortBy,
  FileScheme,
  FileInfo,
} from './FileConnectorProperties.js';

export interface FileReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<FileReceiverProperties>;
}

/**
 * File Source Connector that polls for files
 */
export class FileReceiver extends SourceConnector {
  private properties: FileReceiverProperties;
  private pollTimer: NodeJS.Timeout | null = null;

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
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('File Receiver is already running');
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

    // Start polling
    this.startPolling();
    this.running = true;
  }

  /**
   * Stop the file receiver
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.stopPolling();
    this.running = false;
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
   */
  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      // List files in directory
      const files = await this.listFiles(this.properties.directory);

      // Filter files
      const filteredFiles = this.filterFiles(files);

      // Sort files
      const sortedFiles = this.sortFiles(filteredFiles);

      // Apply batch size limit
      const filesToProcess =
        this.properties.batchSize > 0
          ? sortedFiles.slice(0, this.properties.batchSize)
          : sortedFiles;

      // Process each file
      for (const file of filesToProcess) {
        await this.processFile(file);
      }
    } catch (error) {
      console.error('File poll error:', error);
    }
  }

  /**
   * List files in directory
   */
  private async listFiles(directory: string): Promise<FileInfo[]> {
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
          const subFiles = await this.listFiles(fullPath);
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
   * Filter files based on pattern and age
   */
  private filterFiles(files: FileInfo[]): FileInfo[] {
    const now = Date.now();

    return files.filter((file) => {
      // Check pattern match
      if (
        !matchesFilter(
          file.name,
          this.properties.fileFilter,
          this.properties.regex
        )
      ) {
        return false;
      }

      // Check file age
      if (this.properties.fileAge > 0) {
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
   */
  private async processFile(file: FileInfo): Promise<void> {
    try {
      // Read file content
      const content = await this.readFile(file);

      // Build source map
      const sourceMapData = new Map<string, unknown>();
      sourceMapData.set('originalFilename', file.name);
      sourceMapData.set('fileDirectory', file.directory);
      sourceMapData.set('fileSize', file.size);
      sourceMapData.set('fileLastModified', file.lastModified.toISOString());

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
   * Execute after-processing action
   */
  private async executeAfterProcessingAction(file: FileInfo): Promise<void> {
    switch (this.properties.afterProcessingAction) {
      case AfterProcessingAction.DELETE:
        await fs.unlink(file.path);
        break;

      case AfterProcessingAction.MOVE:
        if (this.properties.moveToDirectory) {
          const destPath = path.join(
            this.properties.moveToDirectory,
            file.name
          );

          // Ensure destination directory exists
          await fs.mkdir(this.properties.moveToDirectory, { recursive: true });

          // Move file
          await fs.rename(file.path, destPath);
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
        await fs.unlink(file.path);
        break;

      case AfterProcessingAction.MOVE:
        if (this.properties.errorDirectory) {
          const destPath = path.join(this.properties.errorDirectory, file.name);

          // Ensure error directory exists
          await fs.mkdir(this.properties.errorDirectory, { recursive: true });

          // Move file
          await fs.rename(file.path, destPath);
        }
        break;

      case AfterProcessingAction.NONE:
      default:
        // No action needed
        break;
    }
  }
}
