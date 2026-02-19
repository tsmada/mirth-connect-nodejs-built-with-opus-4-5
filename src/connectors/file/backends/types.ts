/**
 * Common interface for all file system backends.
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/filesystems/FileSystemConnection.java
 *
 * Each backend (Local, SFTP, FTP, S3, SMB) implements this interface, allowing
 * FileReceiver and FileDispatcher to operate uniformly across file schemes.
 */

import { FileInfo } from '../FileConnectorProperties.js';

/**
 * Abstract file system connection interface matching Java's FileSystemConnection.
 *
 * All methods are async to accommodate network-based backends (FTP, S3, SMB).
 * The local filesystem backend wraps synchronous operations in promises for consistency.
 */
export interface FileSystemClient {
  /**
   * Establish the connection to the remote file system.
   * For local filesystem, this is a no-op (validates directory existence).
   */
  connect(): Promise<void>;

  /**
   * Disconnect and release resources.
   * Must be safe to call multiple times.
   */
  disconnect(): Promise<void>;

  /**
   * Check if the connection is currently active.
   */
  isConnected(): boolean;

  /**
   * List files in a directory matching a pattern.
   *
   * @param fromDir - Directory to list
   * @param filenamePattern - Glob or regex pattern to filter files
   * @param isRegex - Whether the pattern is a regex (vs glob)
   * @param ignoreDot - Whether to ignore files starting with '.'
   * @returns List of matching file info objects
   */
  listFiles(
    fromDir: string,
    filenamePattern: string,
    isRegex: boolean,
    ignoreDot: boolean
  ): Promise<FileInfo[]>;

  /**
   * List subdirectory paths in a directory.
   *
   * @param fromDir - Directory to list subdirectories of
   * @returns List of full directory paths
   */
  listDirectories(fromDir: string): Promise<string[]>;

  /**
   * Check if a file exists.
   *
   * @param file - Filename (no path)
   * @param path - Directory containing the file
   */
  exists(file: string, path: string): Promise<boolean>;

  /**
   * Read file contents as a Buffer.
   *
   * @param file - Filename (no path)
   * @param fromDir - Directory containing the file
   */
  readFile(file: string, fromDir: string): Promise<Buffer>;

  /**
   * Read file contents as a string with the specified encoding.
   *
   * @param file - Filename (no path)
   * @param fromDir - Directory containing the file
   * @param encoding - Character encoding (default: utf8)
   */
  readFileAsString(file: string, fromDir: string, encoding?: BufferEncoding): Promise<string>;

  /**
   * Whether this backend supports appending to files.
   * S3 returns false (objects are immutable). All others return true.
   */
  canAppend(): boolean;

  /**
   * Write content to a file.
   *
   * @param file - Filename (no path)
   * @param toDir - Destination directory
   * @param content - Content to write
   * @param append - Whether to append (if supported; ignored by S3)
   */
  writeFile(file: string, toDir: string, content: Buffer | string, append: boolean): Promise<void>;

  /**
   * Delete a file.
   *
   * @param file - Filename (no path)
   * @param fromDir - Directory containing the file
   * @param mayNotExist - If true, don't throw error if file doesn't exist
   */
  delete(file: string, fromDir: string, mayNotExist: boolean): Promise<void>;

  /**
   * Move/rename a file.
   *
   * @param fromName - Source filename
   * @param fromDir - Source directory
   * @param toName - Destination filename
   * @param toDir - Destination directory
   */
  move(fromName: string, fromDir: string, toName: string, toDir: string): Promise<void>;

  /**
   * Check if we can read from the specified directory.
   */
  canRead(readDir: string): Promise<boolean>;

  /**
   * Check if we can write to the specified directory.
   */
  canWrite(writeDir: string): Promise<boolean>;
}
