/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/filesystems/FtpConnection.java
 *
 * Purpose: FTP/FTPS file system backend using the 'basic-ftp' library.
 *
 * Key behaviors to replicate:
 * - FTP and FTPS (secure=true) connections via Apache Commons Net FTPClient
 * - Active vs passive mode (Java default: passive)
 * - Binary transfer mode (Java: FTP.BINARY_FILE_TYPE)
 * - Directory listing with glob/regex pattern matching
 * - cdmake pattern (create directory tree recursively)
 * - Initial commands support (FTPSchemeProperties.initialCommands)
 * - Connection timeout, data timeout, socket timeout
 * - isValid() via sendNoOp()
 */

import { FileInfo, matchesFilter } from '../FileConnectorProperties.js';
import { FileSystemClient } from './types.js';
import { FtpSchemeProperties, getDefaultFtpSchemeProperties } from './FtpSchemeProperties.js';
import { getLogger } from '../../../logging/index.js';

const logger = getLogger('file-connector');

/**
 * Options for creating an FTP connection.
 */
export interface FtpClientOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** Use passive mode (Java default: true) */
  passive?: boolean;
  /** Use FTPS (TLS). Maps to Java's 'secure' property */
  secure?: boolean;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** FTP-specific scheme properties */
  schemeProperties?: Partial<FtpSchemeProperties>;
}

// basic-ftp type definitions (dynamic import avoids hard dependency)
interface BasicFtpClient {
  access(options: Record<string, unknown>): Promise<{ code: number; message: string }>;
  close(): void;
  list(path?: string): Promise<BasicFtpFileInfo[]>;
  cd(path: string): Promise<{ code: number; message: string }>;
  pwd(): Promise<string>;
  downloadTo(writable: NodeJS.WritableStream, remotePath: string): Promise<{ code: number; message: string }>;
  uploadFrom(readable: NodeJS.ReadableStream | string, remotePath: string): Promise<{ code: number; message: string }>;
  appendFrom(readable: NodeJS.ReadableStream | string, remotePath: string): Promise<{ code: number; message: string }>;
  remove(path: string): Promise<{ code: number; message: string }>;
  rename(srcPath: string, destPath: string): Promise<{ code: number; message: string }>;
  ensureDir(path: string): Promise<void>;
  send(command: string): Promise<{ code: number; message: string }>;
  size(path: string): Promise<number>;
  lastMod(path: string): Promise<Date>;
  closed: boolean;
  ftp: { socket: { remoteAddress?: string } };
}

interface BasicFtpFileInfo {
  name: string;
  size: number;
  date: Date | null;
  type: number; // 1 = file, 2 = directory, 3 = symlink, 0 = unknown
  rawModifiedAt: string;
}

/**
 * FTP/FTPS file system client.
 *
 * Uses dynamic import of 'basic-ftp' to avoid requiring the dependency
 * unless FTP is actually used.
 */
export class FtpClient implements FileSystemClient {
  private client: BasicFtpClient | null = null;
  private connected = false;

  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private passive: boolean;
  private secure: boolean;
  private timeout: number;
  private schemeProperties: FtpSchemeProperties;

  constructor(options: FtpClientOptions) {
    this.host = options.host;
    this.port = options.port ?? 21;
    this.username = options.username;
    this.password = options.password;
    this.passive = options.passive ?? true;
    this.secure = options.secure ?? false;
    this.timeout = options.timeout ?? 10000;
    this.schemeProperties = {
      ...getDefaultFtpSchemeProperties(),
      ...options.schemeProperties,
    };
  }

  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    // Dynamic import with actionable error message
    let ClientClass: new () => BasicFtpClient;
    try {
      const mod = await import('basic-ftp');
      ClientClass = mod.Client as unknown as new () => BasicFtpClient;
    } catch {
      throw new Error(
        'FTP support requires the basic-ftp package. Install with: npm install basic-ftp'
      );
    }

    this.client = new ClientClass();

    try {
      // Set timeout (maps to Java's setConnectTimeout + setDataTimeout + setSoTimeout)
      (this.client as unknown as Record<string, number>).ftp = this.timeout as unknown as number;

      await this.client.access({
        host: this.host,
        port: this.port,
        user: this.username,
        password: this.password,
        secure: this.secure,
        secureOptions: this.secure ? { rejectUnauthorized: false } : undefined,
      });

      // Java: client.setFileType(FTP.BINARY_FILE_TYPE) — basic-ftp defaults to binary

      // basic-ftp defaults to passive mode. If active mode is requested, send PORT command.
      // Note: basic-ftp doesn't have an explicit passive toggle, but passive is its default.
      // Active mode would require client.useDefaultPort() — currently not exposed via basic-ftp.
      void this.passive; // Tracked for future active mode support

      // Execute initial commands (matches Java FtpConnection.initialize())
      if (this.schemeProperties.initialCommands.length > 0) {
        for (const command of this.schemeProperties.initialCommands) {
          try {
            await this.client.send(command);
          } catch (err) {
            logger.error(`Failed to execute FTP initial command: ${command}`, err instanceof Error ? err : undefined);
          }
        }
      }

      this.connected = true;
    } catch (error) {
      this.connected = false;
      if (this.client) {
        this.client.close();
        this.client = null;
      }
      throw new Error(
        `FTP connection failed to ${this.host}:${this.port} - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      this.client.close();
    } finally {
      this.connected = false;
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null && !this.client.closed;
  }

  async listFiles(fromDir: string, filenamePattern: string, isRegex: boolean, ignoreDot: boolean): Promise<FileInfo[]> {
    this.ensureConnected();

    // Java: cwd(fromDir) then client.listFiles()
    await this.client!.cd(fromDir);
    const entries = await this.client!.list();

    const files: FileInfo[] = [];
    for (const entry of entries) {
      // Skip non-files (type 1 = file in basic-ftp)
      if (entry.type !== 1) {
        continue;
      }

      // Apply filename filter
      if (!matchesFilter(entry.name, filenamePattern, isRegex)) {
        continue;
      }

      // Skip dot files if configured
      if (ignoreDot && entry.name.startsWith('.')) {
        continue;
      }

      files.push({
        name: entry.name,
        path: `${fromDir}/${entry.name}`.replace(/\/+/g, '/'),
        directory: fromDir,
        size: entry.size,
        lastModified: entry.date ?? new Date(0),
        isDirectory: false,
      });
    }

    return files;
  }

  async listDirectories(fromDir: string): Promise<string[]> {
    this.ensureConnected();

    await this.client!.cd(fromDir);
    const entries = await this.client!.list();

    const directories: string[] = [];
    for (const entry of entries) {
      // type 2 = directory in basic-ftp
      if (entry.type === 2) {
        directories.push(`${fromDir}/${entry.name}`.replace(/\/+/g, '/'));
      }
    }

    return directories;
  }

  async exists(file: string, path: string): Promise<boolean> {
    this.ensureConnected();

    try {
      // Java: client.listFiles(path + "/" + file) and checks length == 1
      await this.client!.size(`${path}/${file}`.replace(/\/+/g, '/'));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(file: string, fromDir: string): Promise<Buffer> {
    this.ensureConnected();

    // Java: cwd(fromDir), then client.retrieveFileStream(file)
    // basic-ftp uses downloadTo() with a Writable stream
    const { Writable } = await import('stream');

    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    await this.client!.cd(fromDir);
    await this.client!.downloadTo(writable, file);

    return Buffer.concat(chunks);
  }

  async readFileAsString(file: string, fromDir: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const buffer = await this.readFile(file, fromDir);
    return buffer.toString(encoding);
  }

  canAppend(): boolean {
    // Java: FtpConnection.canAppend() returns true
    return true;
  }

  async writeFile(file: string, toDir: string, content: Buffer | string, append: boolean): Promise<void> {
    this.ensureConnected();

    // Java: cdmake(toDir) — ensure directory exists
    await this.client!.ensureDir(toDir);
    await this.client!.cd(toDir);

    // Convert content to a Readable stream
    const { Readable } = await import('stream');
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const readable = Readable.from(buffer);

    // Java: append ? client.appendFile(file, is) : client.storeFile(file, is)
    if (append) {
      await this.client!.appendFrom(readable, file);
    } else {
      await this.client!.uploadFrom(readable, file);
    }
  }

  async delete(file: string, fromDir: string, mayNotExist: boolean): Promise<void> {
    this.ensureConnected();

    try {
      // Java: cwd(fromDir) then client.deleteFile(file)
      await this.client!.cd(fromDir);
      await this.client!.remove(file);
    } catch (error) {
      if (!mayNotExist) {
        throw new Error(
          `Error deleting FTP file ${fromDir}/${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  async move(fromName: string, fromDir: string, toName: string, toDir: string): Promise<void> {
    this.ensureConnected();

    // Java: cwd(fromDir), cdmake(toDir), delete dest, cwd(fromDir), rename
    await this.client!.ensureDir(toDir);

    // Try to delete existing destination (matching Java behavior)
    try {
      await this.client!.remove(`${toDir}/${toName}`.replace(/\/+/g, '/'));
    } catch {
      // Destination doesn't exist, that's fine
    }

    const sourcePath = `${fromDir}/${fromName}`.replace(/\/+/g, '/');
    const destPath = `${toDir}/${toName}`.replace(/\/+/g, '/');

    await this.client!.rename(sourcePath, destPath);
  }

  async canRead(readDir: string): Promise<boolean> {
    this.ensureConnected();

    try {
      await this.client!.cd(readDir);
      return true;
    } catch {
      return false;
    }
  }

  async canWrite(writeDir: string): Promise<boolean> {
    // Java: same as canRead for FTP (just checks cwd)
    return this.canRead(writeDir);
  }

  /**
   * Ensure the FTP client is connected, throwing if not.
   */
  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('FTP client is not connected');
    }
  }
}
