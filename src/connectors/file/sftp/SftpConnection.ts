/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/filesystems/SftpConnection.java
 *
 * Purpose: SFTP connection management using ssh2-sftp-client
 *
 * Key behaviors to replicate:
 * - SSH/SFTP session management via ssh2-sftp-client (replacing JSch)
 * - Password and public key authentication
 * - Host key verification
 * - File operations: list, read, write, delete, move
 * - Directory creation (cdmake pattern)
 * - Wildcard and regex file filtering
 */

import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import { FileInfo } from '../FileConnectorProperties.js';
import {
  SftpSchemeProperties,
  getDefaultSftpSchemeProperties,
  validateSftpSchemeProperties,
} from './SftpSchemeProperties.js';

/**
 * Extended FileInfo for SFTP files
 */
export interface SftpFileInfo extends FileInfo {
  /** File permissions (Unix mode) */
  permissions?: number;
  /** Owner user ID */
  uid?: number;
  /** Owner group ID */
  gid?: number;
}

/**
 * Connection options for SFTP
 */
export interface SftpConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  schemeProperties?: Partial<SftpSchemeProperties>;
  timeout?: number;
}

/**
 * SFTP Connection class wrapping ssh2-sftp-client
 * Provides file system operations over SFTP protocol
 */
export class SftpConnection {
  private client: SftpClient;
  private connected = false;
  private lastDir: string | null = null;

  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private schemeProperties: SftpSchemeProperties;
  private timeout: number;

  constructor(options: SftpConnectionOptions) {
    this.client = new SftpClient();
    this.host = options.host;
    this.port = options.port ?? 22;
    this.username = options.username;
    this.password = options.password ?? '';
    this.schemeProperties = {
      ...getDefaultSftpSchemeProperties(),
      ...options.schemeProperties,
    };
    this.timeout = options.timeout ?? 10000;
  }

  /**
   * Establish SFTP connection
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Validate properties before connecting
    validateSftpSchemeProperties(this.schemeProperties);

    // Build connection configuration
    const connectConfig: SftpClient.ConnectOptions = {
      host: this.host,
      port: this.port,
      username: this.username,
      readyTimeout: this.timeout,
      retries: 1,
      retry_minTimeout: 2000,
    };

    // Configure authentication
    if (this.schemeProperties.keyAuth && this.schemeProperties.keyFile) {
      // Public key authentication
      try {
        connectConfig.privateKey = fs.readFileSync(this.schemeProperties.keyFile);
      } catch (error) {
        throw new Error(
          `Failed to read private key file: ${this.schemeProperties.keyFile} - ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (this.schemeProperties.passPhrase) {
        connectConfig.passphrase = this.schemeProperties.passPhrase;
      }
    }

    if (this.schemeProperties.passwordAuth && this.password) {
      // Password authentication
      connectConfig.password = this.password;
    }

    // Configure host key verification
    if (this.schemeProperties.hostKeyChecking === 'no') {
      // Disable strict host key checking (insecure but matches Java 'no' behavior)
      connectConfig.algorithms = {
        serverHostKey: [
          'ssh-rsa',
          'ssh-dss',
          'ecdsa-sha2-nistp256',
          'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp521',
          'ssh-ed25519',
          'rsa-sha2-256',
          'rsa-sha2-512',
        ],
      };
      // Skip host verification
      connectConfig.hostVerifier = () => true;
    } else if (this.schemeProperties.knownHostsFile) {
      // Use known hosts file for verification
      // Note: ssh2-sftp-client doesn't directly support known_hosts file parsing
      // For full compatibility, custom hostVerifier would need to parse the file
      // For now, we'll rely on ssh2's built-in host verification
      connectConfig.hostHash = 'sha256';
    }

    // Apply additional configuration settings
    if (Object.keys(this.schemeProperties.configurationSettings).length > 0) {
      // Map common JSch config options to ssh2 options
      const settings = this.schemeProperties.configurationSettings;

      if (settings['Compression'] === 'yes') {
        connectConfig.algorithms = {
          ...connectConfig.algorithms,
          compress: ['zlib', 'zlib@openssh.com', 'none'],
        };
      }
    }

    try {
      await this.client.connect(connectConfig);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(
        `SFTP connection failed to ${this.host}:${this.port} - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Disconnect from SFTP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.end();
    } finally {
      this.connected = false;
      this.lastDir = null;
    }
  }

  /**
   * Destroy the connection (alias for disconnect, matches Java interface)
   */
  async destroy(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Check if connection is active
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if connection is valid (connected and can access last directory)
   */
  async isValid(): Promise<boolean> {
    if (!this.connected) {
      return false;
    }

    if (this.lastDir) {
      return this.canRead(this.lastDir);
    }

    return true;
  }

  /**
   * Check if directory is readable
   */
  async canRead(path: string): Promise<boolean> {
    try {
      this.lastDir = path;
      await this.client.list(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if directory is writable
   */
  async canWrite(path: string): Promise<boolean> {
    try {
      this.lastDir = path;
      // Try to list the directory as a basic check
      await this.client.list(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files in a directory
   * @param fromDir Directory to list
   * @param filenamePattern Glob or regex pattern to filter files
   * @param isRegex Whether the pattern is a regex (vs glob)
   * @param ignoreDot Whether to ignore files starting with .
   */
  async listFiles(
    fromDir: string,
    filenamePattern = '*',
    isRegex = false,
    ignoreDot = true
  ): Promise<SftpFileInfo[]> {
    this.lastDir = fromDir;

    // Build the filter function
    const filter = this.buildFilenameFilter(filenamePattern, isRegex, ignoreDot);

    const entries = await this.client.list(fromDir);
    const files: SftpFileInfo[] = [];

    for (const entry of entries) {
      // Skip directories and symlinks (matching Java behavior)
      if (entry.type === 'd' || entry.type === 'l') {
        continue;
      }

      // Apply filename filter
      if (!filter(entry.name)) {
        continue;
      }

      files.push({
        name: entry.name,
        path: `${fromDir}/${entry.name}`.replace(/\/+/g, '/'),
        directory: fromDir,
        size: entry.size,
        lastModified: new Date(entry.modifyTime),
        isDirectory: false, // Already filtered out directories above
        permissions: entry.rights ? this.rightsToMode(entry.rights) : undefined,
        uid: typeof entry.owner === 'number' ? entry.owner : undefined,
        gid: typeof entry.group === 'number' ? entry.group : undefined,
      });
    }

    return files;
  }

  /**
   * List subdirectories in a directory
   */
  async listDirectories(fromDir: string): Promise<string[]> {
    const entries = await this.client.list(fromDir);
    const directories: string[] = [];

    for (const entry of entries) {
      if (entry.type === 'd' || entry.type === 'l') {
        directories.push(`${fromDir}/${entry.name}`.replace(/\/+/g, '/'));
      }
    }

    return directories;
  }

  /**
   * Check if a file exists
   */
  async exists(filename: string, path: string): Promise<boolean> {
    try {
      const fullPath = `${path}/${filename}`.replace(/\/+/g, '/');
      await this.client.stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read file content as Buffer
   */
  async readFile(
    filename: string,
    fromDir: string
  ): Promise<Buffer> {
    this.lastDir = fromDir;
    const fullPath = `${fromDir}/${filename}`.replace(/\/+/g, '/');

    // Use get() which returns a Buffer
    const result = await this.client.get(fullPath);

    // Handle both string and Buffer returns
    if (Buffer.isBuffer(result)) {
      return result;
    } else if (typeof result === 'string') {
      return Buffer.from(result);
    } else {
      throw new Error('Unexpected result type from SFTP get');
    }
  }

  /**
   * Read file content as string
   */
  async readFileAsString(
    filename: string,
    fromDir: string,
    encoding: BufferEncoding = 'utf8'
  ): Promise<string> {
    const buffer = await this.readFile(filename, fromDir);
    return buffer.toString(encoding);
  }

  /**
   * Write content to a file
   * @param filename Name of the file to write
   * @param toDir Directory to write to
   * @param content Content to write (Buffer or string)
   * @param append Whether to append to existing file
   */
  async writeFile(
    filename: string,
    toDir: string,
    content: Buffer | string,
    append = false
  ): Promise<void> {
    this.lastDir = toDir;

    // Ensure directory exists (cdmake pattern from Java)
    await this.ensureDirectory(toDir);

    const fullPath = `${toDir}/${filename}`.replace(/\/+/g, '/');

    // Convert string to Buffer if needed
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    if (append) {
      // For append mode, need to read existing content first
      // as ssh2-sftp-client doesn't support append directly
      try {
        const existing = await this.client.get(fullPath);
        const existingBuffer = Buffer.isBuffer(existing)
          ? existing
          : Buffer.from(existing as string);
        const combined = Buffer.concat([existingBuffer, buffer]);
        await this.client.put(combined, fullPath);
      } catch (error) {
        // File doesn't exist, just write new content
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
            (error as Error).message?.includes('No such file')) {
          await this.client.put(buffer, fullPath);
        } else {
          throw error;
        }
      }
    } else {
      await this.client.put(buffer, fullPath);
    }
  }

  /**
   * Delete a file
   * @param filename Name of file to delete
   * @param fromDir Directory containing the file
   * @param mayNotExist If true, don't throw error if file doesn't exist
   */
  async delete(
    filename: string,
    fromDir: string,
    mayNotExist = false
  ): Promise<void> {
    const fullPath = `${fromDir}/${filename}`.replace(/\/+/g, '/');

    try {
      await this.client.delete(fullPath);
    } catch (error) {
      if (!mayNotExist) {
        throw error;
      }
      // File doesn't exist and that's OK
    }
  }

  /**
   * Move/rename a file
   * @param fromName Source filename
   * @param fromDir Source directory
   * @param toName Destination filename
   * @param toDir Destination directory
   */
  async move(
    fromName: string,
    fromDir: string,
    toName: string,
    toDir: string
  ): Promise<void> {
    // Ensure destination directory exists
    await this.ensureDirectory(toDir);

    const sourcePath = `${fromDir}/${fromName}`.replace(/\/+/g, '/');
    const destPath = `${toDir}/${toName}`.replace(/\/+/g, '/');

    // Try to remove destination if it exists (matching Java behavior)
    try {
      await this.client.delete(destPath);
    } catch {
      // Destination doesn't exist, that's fine
    }

    // Rename the file
    await this.client.rename(sourcePath, destPath);
  }

  /**
   * Ensure directory exists, creating parent directories as needed
   * (Implements the cdmake pattern from Java)
   */
  async ensureDirectory(dir: string): Promise<void> {
    try {
      await this.client.stat(dir);
      // Directory exists
      return;
    } catch {
      // Directory doesn't exist, need to create it
    }

    // Build path components
    let currentPath = dir.startsWith('/') ? '/' : '';
    const parts = dir.split('/').filter((p) => p.length > 0);

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      try {
        const stat = await this.client.stat(currentPath);
        if (stat.isDirectory) {
          continue;
        }
        throw new Error(`Path exists but is not a directory: ${currentPath}`);
      } catch (error) {
        // Check if error is because it doesn't exist
        if ((error as Error).message?.includes('not a directory')) {
          throw error;
        }

        // Directory doesn't exist, create it
        try {
          await this.client.mkdir(currentPath);
        } catch (mkdirError) {
          // Directory might have been created concurrently, check again
          try {
            await this.client.stat(currentPath);
          } catch {
            throw mkdirError;
          }
        }
      }
    }
  }

  /**
   * Build a filename filter function from pattern
   */
  private buildFilenameFilter(
    pattern: string,
    isRegex: boolean,
    ignoreDot: boolean
  ): (filename: string) => boolean {
    // Build regex from pattern
    let regex: RegExp;

    if (!pattern || pattern === '*') {
      // Match all files
      regex = /.*/;
    } else if (isRegex) {
      // Use pattern as-is for regex
      regex = new RegExp(pattern);
    } else {
      // Convert glob pattern to regex
      // Handle comma-separated patterns (matching Java WildcardFileFilter behavior)
      const patterns = pattern.split(/\s*,\s*/);
      const regexParts = patterns.map((p) => {
        // Escape special regex chars except * and ?
        const escaped = p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return `^${escaped}$`;
      });
      regex = new RegExp(regexParts.join('|'), 'i');
    }

    return (filename: string): boolean => {
      // Check dot file filter
      if (ignoreDot && filename.startsWith('.')) {
        return false;
      }

      return regex.test(filename);
    };
  }

  /**
   * Convert rights object to Unix mode number
   */
  private rightsToMode(rights: { user: string; group: string; other: string }): number {
    let mode = 0;

    // Owner
    if (rights.user?.includes('r')) mode |= 0o400;
    if (rights.user?.includes('w')) mode |= 0o200;
    if (rights.user?.includes('x')) mode |= 0o100;

    // Group
    if (rights.group?.includes('r')) mode |= 0o040;
    if (rights.group?.includes('w')) mode |= 0o020;
    if (rights.group?.includes('x')) mode |= 0o010;

    // Other
    if (rights.other?.includes('r')) mode |= 0o004;
    if (rights.other?.includes('w')) mode |= 0o002;
    if (rights.other?.includes('x')) mode |= 0o001;

    return mode;
  }
}
