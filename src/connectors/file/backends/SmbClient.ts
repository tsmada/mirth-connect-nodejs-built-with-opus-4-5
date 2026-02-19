/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/filesystems/SmbFileConnection.java
 *
 * Purpose: SMB/CIFS file system backend using the '@marsaud/smb2' library.
 *
 * Key behaviors to replicate:
 * - NTLM authentication with domain\username parsing
 * - SMB protocol version negotiation (min/max version)
 * - Share-based path resolution (smb://host/share/path)
 * - Directory listing with glob/regex filtering
 * - canAppend() returns true
 * - canWrite() test by creating and deleting a temp file (matches Java MIRTH-1113 fix)
 * - isConnected() and isValid() always return true (stateless, like Java)
 */

import { FileInfo, matchesFilter } from '../FileConnectorProperties.js';
import { FileSystemClient } from './types.js';
import { SmbSchemeProperties, getDefaultSmbSchemeProperties } from './SmbSchemeProperties.js';
import { getLogger } from '../../../logging/index.js';

const logger = getLogger('file-connector');

/**
 * Options for creating an SMB connection.
 */
export interface SmbClientOptions {
  /** SMB share path (e.g., "server/share" or "server/share/path") */
  host: string;
  /**
   * Username for NTLM authentication.
   * Supports domain prefix: "DOMAIN\username" or "DOMAIN/username"
   */
  username: string;
  /** Password for NTLM authentication */
  password: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** SMB-specific scheme properties */
  schemeProperties?: Partial<SmbSchemeProperties>;
}

// smb2 library type shims (dynamic import)
interface SMB2Instance {
  readdir(path: string, callback: (err: Error | null, files?: string[]) => void): void;
  readFile(path: string, callback: (err: Error | null, data?: Buffer) => void): void;
  readFile(
    path: string,
    options: { encoding: string },
    callback: (err: Error | null, data?: string) => void
  ): void;
  writeFile(path: string, data: Buffer | string, callback: (err: Error | null) => void): void;
  writeFile(
    path: string,
    data: Buffer | string,
    options: Record<string, unknown>,
    callback: (err: Error | null) => void
  ): void;
  unlink(path: string, callback: (err: Error | null) => void): void;
  rename(oldPath: string, newPath: string, callback: (err: Error | null) => void): void;
  exists(path: string, callback: (err: Error | null, exists?: boolean) => void): void;
  mkdir(path: string, callback: (err: Error | null) => void): void;
  stat(path: string, callback: (err: Error | null, stats?: SmbStats) => void): void;
  close(): void;
}

interface SmbStats {
  isDirectory(): boolean;
  size: number;
  mtime: Date;
}

/**
 * SMB/CIFS file system client.
 *
 * Uses dynamic import of '@marsaud/smb2' to avoid requiring the dependency
 * unless SMB is actually used.
 *
 * Note: The Java implementation uses JCIFS (jcifs-ng) which supports
 * SMB v1-v3.1.1. The Node.js smb2 library supports SMB v2+. For SMB v1
 * support, a different library would be needed, but SMB v1 is deprecated
 * and disabled by default in modern systems.
 */
export class SmbClient implements FileSystemClient {
  private smb: SMB2Instance | null = null;
  private _connected = false;

  private host: string;
  private username: string;
  private password: string;
  private domain: string;
  private timeout: number;
  private schemeProperties: SmbSchemeProperties;

  constructor(options: SmbClientOptions) {
    this.host = options.host;
    this.password = options.password;
    this.timeout = options.timeout ?? 10000;
    this.schemeProperties = {
      ...getDefaultSmbSchemeProperties(),
      ...options.schemeProperties,
    };

    // Parse domain\username (matches Java SmbFileConnection constructor)
    const parts = options.username.split(/[\\/@:;]/);
    if (parts.length > 1) {
      this.domain = parts[0]!;
      this.username = parts[1]!;
    } else {
      this.domain = '';
      this.username = parts[0]!;
    }
  }

  async connect(): Promise<void> {
    if (this._connected && this.smb) {
      return;
    }

    // Dynamic import with actionable error message
    let SMB2Constructor: new (options: Record<string, unknown>) => SMB2Instance;
    try {
      const mod = await import('@marsaud/smb2');
      SMB2Constructor = (mod.default || mod) as unknown as new (
        options: Record<string, unknown>
      ) => SMB2Instance;
    } catch {
      throw new Error(
        'SMB support requires @marsaud/smb2. Install with: npm install @marsaud/smb2'
      );
    }

    try {
      // Build share path: \\host\share
      // The host field should be like "server/share" or just "server"
      const sharePath = `\\\\${this.host.replace(/\//g, '\\\\')}`;

      // Note: @marsaud/smb2 only supports SMB2/3. The smbMinVersion/smbMaxVersion
      // from schemeProperties are tracked for future dialect negotiation support
      // (Java JCIFS supports SMB1-3 dialect pinning via SmbSchemeProperties).
      const smbOptions: Record<string, unknown> = {
        share: sharePath,
        domain: this.domain,
        username: this.username,
        password: this.password,
        autoCloseTimeout: this.timeout,
      };

      // Pass dialect hints if the library version supports them
      if (this.schemeProperties.smbMinVersion) {
        smbOptions.minVersion = this.schemeProperties.smbMinVersion;
      }
      if (this.schemeProperties.smbMaxVersion) {
        smbOptions.maxVersion = this.schemeProperties.smbMaxVersion;
      }

      this.smb = new SMB2Constructor(smbOptions);

      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw new Error(
        `SMB connection failed to ${this.host}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.smb) {
      try {
        this.smb.close();
      } catch {
        // Ignore close errors
      }
    }
    this.smb = null;
    this._connected = false;
  }

  isConnected(): boolean {
    // Java: SmbFileConnection.isConnected() always returns true
    return this._connected && this.smb !== null;
  }

  async listFiles(
    fromDir: string,
    filenamePattern: string,
    isRegex: boolean,
    ignoreDot: boolean
  ): Promise<FileInfo[]> {
    this.ensureConnected();

    const dirPath = this.normalizePath(fromDir);
    const entries = await this.readdirAsync(dirPath);

    const files: FileInfo[] = [];
    for (const entryName of entries) {
      // Apply filename filter
      if (!matchesFilter(entryName, filenamePattern, isRegex)) {
        continue;
      }

      // Skip dot files if configured
      if (ignoreDot && entryName.startsWith('.')) {
        continue;
      }

      // Get file stats to determine if it's a file
      try {
        const fullPath = `${dirPath}\\${entryName}`;
        const stats = await this.statAsync(fullPath);

        if (stats.isDirectory()) {
          continue; // Skip directories
        }

        files.push({
          name: entryName,
          path: fullPath,
          directory: dirPath,
          size: stats.size,
          lastModified: stats.mtime,
          isDirectory: false,
        });
      } catch {
        // Skip files we can't stat
        logger.warn(`Unable to stat SMB file: ${dirPath}\\${entryName}`);
      }
    }

    return files;
  }

  async listDirectories(fromDir: string): Promise<string[]> {
    this.ensureConnected();

    const dirPath = this.normalizePath(fromDir);
    const entries = await this.readdirAsync(dirPath);

    const directories: string[] = [];
    for (const entryName of entries) {
      try {
        const fullPath = `${dirPath}\\${entryName}`;
        const stats = await this.statAsync(fullPath);
        if (stats.isDirectory()) {
          directories.push(fullPath);
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    return directories;
  }

  async exists(file: string, path: string): Promise<boolean> {
    this.ensureConnected();

    const fullPath = `${this.normalizePath(path)}\\${file}`;
    return this.existsAsync(fullPath);
  }

  async readFile(file: string, fromDir: string): Promise<Buffer> {
    this.ensureConnected();

    const fullPath = `${this.normalizePath(fromDir)}\\${file}`;
    return this.readFileAsync(fullPath);
  }

  async readFileAsString(
    file: string,
    fromDir: string,
    encoding: BufferEncoding = 'utf8'
  ): Promise<string> {
    const buffer = await this.readFile(file, fromDir);
    return buffer.toString(encoding);
  }

  canAppend(): boolean {
    // Java: SmbFileConnection.canAppend() returns true
    return true;
  }

  async writeFile(
    file: string,
    toDir: string,
    content: Buffer | string,
    append: boolean
  ): Promise<void> {
    this.ensureConnected();

    const dirPath = this.normalizePath(toDir);
    const fullPath = `${dirPath}\\${file}`;

    // Ensure directory exists (matches Java's mkdirs pattern)
    await this.ensureDirectory(dirPath);

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    if (append) {
      // SMB2 doesn't have native append. Read existing + concat + write.
      try {
        const existing = await this.readFileAsync(fullPath);
        const combined = Buffer.concat([existing, buffer]);
        await this.writeFileAsync(fullPath, combined);
      } catch {
        // File doesn't exist, just write new content
        await this.writeFileAsync(fullPath, buffer);
      }
    } else {
      await this.writeFileAsync(fullPath, buffer);
    }
  }

  async delete(file: string, fromDir: string, mayNotExist: boolean): Promise<void> {
    this.ensureConnected();

    const fullPath = `${this.normalizePath(fromDir)}\\${file}`;

    try {
      await this.unlinkAsync(fullPath);
    } catch (error) {
      if (!mayNotExist) {
        throw new Error(
          `Error deleting SMB file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  async move(fromName: string, fromDir: string, toName: string, toDir: string): Promise<void> {
    this.ensureConnected();

    const srcPath = `${this.normalizePath(fromDir)}\\${fromName}`;
    const dstDir = this.normalizePath(toDir);
    const dstPath = `${dstDir}\\${toName}`;

    // Ensure destination directory exists
    await this.ensureDirectory(dstDir);

    // Try to delete existing destination (matching Java behavior)
    try {
      await this.unlinkAsync(dstPath);
    } catch {
      // Destination doesn't exist, that's fine
    }

    await this.renameAsync(srcPath, dstPath);
  }

  async canRead(readDir: string): Promise<boolean> {
    this.ensureConnected();

    try {
      const dirPath = this.normalizePath(readDir);
      await this.readdirAsync(dirPath);
      return true;
    } catch {
      return false;
    }
  }

  async canWrite(writeDir: string): Promise<boolean> {
    // Java MIRTH-1113: Test write access by creating and deleting a temp file
    this.ensureConnected();

    const dirPath = this.normalizePath(writeDir);
    const tempName = `__mirth_write_test_${Date.now()}`;
    const tempPath = `${dirPath}\\${tempName}`;

    try {
      await this.writeFileAsync(tempPath, Buffer.from(''));
      try {
        await this.unlinkAsync(tempPath);
      } catch {
        logger.warn(`Failed to delete SMB write test file: ${tempPath}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Path utilities
  // -----------------------------------------------------------------------

  /**
   * Normalize a path for SMB use (backslash separators, no leading/trailing slashes).
   */
  private normalizePath(p: string): string {
    if (!p) return '';
    // Replace forward slashes with backslashes
    let normalized = p.replace(/\//g, '\\');
    // Remove trailing backslash
    while (normalized.endsWith('\\')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * Ensure a directory exists, creating parents as needed.
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    const dirExists = await this.existsAsync(dirPath);
    if (dirExists) return;

    // Build path components and create each level
    const parts = dirPath.split('\\').filter((p) => p.length > 0);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}\\${part}` : part;
      const exists = await this.existsAsync(currentPath);
      if (!exists) {
        try {
          await this.mkdirAsync(currentPath);
        } catch {
          // Directory might have been created concurrently
          const nowExists = await this.existsAsync(currentPath);
          if (!nowExists) {
            throw new Error(`Failed to create SMB directory: ${currentPath}`);
          }
        }
      }
    }
  }

  /**
   * Ensure the SMB client is connected, throwing if not.
   */
  private ensureConnected(): void {
    if (!this._connected || !this.smb) {
      throw new Error('SMB client is not connected');
    }
  }

  // -----------------------------------------------------------------------
  // Promise wrappers for callback-based smb2 API
  // -----------------------------------------------------------------------

  private readdirAsync(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.smb!.readdir(path, (err, files) => {
        if (err) reject(err);
        else resolve(files ?? []);
      });
    });
  }

  private readFileAsync(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.smb!.readFile(path, (err, data) => {
        if (err) reject(err);
        else resolve(data ?? Buffer.alloc(0));
      });
    });
  }

  private writeFileAsync(path: string, data: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.smb!.writeFile(path, data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private unlinkAsync(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.smb!.unlink(path, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private renameAsync(oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.smb!.rename(oldPath, newPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private existsAsync(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.smb!.exists(path, (err, exists) => {
        if (err) reject(err);
        else resolve(exists ?? false);
      });
    });
  }

  private mkdirAsync(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.smb!.mkdir(path, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private statAsync(path: string): Promise<SmbStats> {
    return new Promise((resolve, reject) => {
      this.smb!.stat(path, (err, stats) => {
        if (err) reject(err);
        else resolve(stats!);
      });
    });
  }
}
