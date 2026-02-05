/**
 * SFTP Client for Validation Framework
 *
 * Provides SFTP upload/download operations for testing file-based connectors
 * that use SFTP protocol.
 */

import SftpClient from 'ssh2-sftp-client';

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SftpFileInfo {
  name: string;
  type: 'd' | '-' | 'l';  // directory, file, link
  size: number;
  modifyTime: Date;
}

export class ValidationSftpClient {
  private client: SftpClient;
  private config: SftpConfig;
  private connected: boolean = false;

  constructor(config: SftpConfig) {
    this.client = new SftpClient();
    this.config = config;
  }

  /**
   * Connect to the SFTP server
   */
  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
      });
      this.connected = true;
    }
  }

  /**
   * Disconnect from the SFTP server
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
    }
  }

  /**
   * Upload a local file to the SFTP server
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.connect();
    await this.client.put(localPath, remotePath);
  }

  /**
   * Upload content directly to a remote file
   */
  async uploadContent(content: string | Buffer, remotePath: string): Promise<void> {
    await this.connect();
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    await this.client.put(buffer, remotePath);
  }

  /**
   * Download a file from the SFTP server and return its contents
   */
  async downloadFile(remotePath: string): Promise<string> {
    await this.connect();
    const buffer = await this.client.get(remotePath) as Buffer;
    return buffer.toString('utf-8');
  }

  /**
   * Download a file as a Buffer (for binary files)
   */
  async downloadFileBuffer(remotePath: string): Promise<Buffer> {
    await this.connect();
    return await this.client.get(remotePath) as Buffer;
  }

  /**
   * Wait for a file to appear on the SFTP server
   *
   * @param remotePath Path to the file to wait for
   * @param timeout Maximum time to wait in milliseconds
   * @param pollInterval Time between checks in milliseconds
   * @returns true if file was found, false if timeout expired
   */
  async waitForFile(
    remotePath: string,
    timeout: number = 30000,
    pollInterval: number = 500
  ): Promise<boolean> {
    await this.connect();
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const exists = await this.client.exists(remotePath);
        if (exists) {
          return true;
        }
      } catch {
        // File not found or error, continue waiting
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    return false;
  }

  /**
   * List files in a directory
   */
  async listFiles(directory: string): Promise<SftpFileInfo[]> {
    await this.connect();
    const files = await this.client.list(directory);
    return files.map(f => ({
      name: f.name,
      type: f.type as 'd' | '-' | 'l',
      size: f.size,
      modifyTime: new Date(f.modifyTime),
    }));
  }

  /**
   * List file names only in a directory
   */
  async listFileNames(directory: string): Promise<string[]> {
    const files = await this.listFiles(directory);
    return files.map(f => f.name);
  }

  /**
   * Delete a file from the SFTP server
   */
  async deleteFile(remotePath: string): Promise<void> {
    await this.connect();
    await this.client.delete(remotePath);
  }

  /**
   * Delete multiple files matching a pattern
   */
  async deleteFiles(directory: string, pattern?: RegExp): Promise<number> {
    await this.connect();
    const files = await this.listFiles(directory);
    let deleted = 0;

    for (const file of files) {
      if (file.type === '-') {
        if (!pattern || pattern.test(file.name)) {
          await this.client.delete(`${directory}/${file.name}`);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Ensure a directory exists (create if not)
   */
  async ensureDirectory(remotePath: string): Promise<void> {
    await this.connect();
    await this.client.mkdir(remotePath, true);
  }

  /**
   * Check if a file exists
   */
  async exists(remotePath: string): Promise<boolean> {
    await this.connect();
    const result = await this.client.exists(remotePath);
    return result !== false;
  }

  /**
   * Get file statistics
   */
  async stat(remotePath: string): Promise<SftpFileInfo | null> {
    await this.connect();
    try {
      const stats = await this.client.stat(remotePath);
      return {
        name: remotePath.split('/').pop() || '',
        type: stats.isDirectory ? 'd' : '-',
        size: stats.size,
        modifyTime: new Date(stats.modifyTime),
      };
    } catch {
      return null;
    }
  }

  /**
   * Move/rename a file
   */
  async move(srcPath: string, destPath: string): Promise<void> {
    await this.connect();
    await this.client.rename(srcPath, destPath);
  }

  /**
   * Watch for new files in a directory
   *
   * @param directory Directory to watch
   * @param callback Function to call when new files appear
   * @param pollInterval Time between checks
   * @returns A function to stop watching
   */
  watchDirectory(
    directory: string,
    callback: (files: SftpFileInfo[]) => void,
    pollInterval: number = 1000
  ): () => void {
    let running = true;
    let knownFiles = new Set<string>();

    const poll = async () => {
      while (running) {
        try {
          const files = await this.listFiles(directory);
          const newFiles = files.filter(f => !knownFiles.has(f.name));

          if (newFiles.length > 0) {
            callback(newFiles);
            newFiles.forEach(f => knownFiles.add(f.name));
          }
        } catch {
          // Directory may not exist yet, continue watching
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    };

    poll();

    return () => {
      running = false;
    };
  }
}

/**
 * Create SFTP clients for both Java and Node.js Mirth engines
 */
export function createSftpClients(config: {
  java: SftpConfig;
  node: SftpConfig;
}): { java: ValidationSftpClient; node: ValidationSftpClient } {
  return {
    java: new ValidationSftpClient(config.java),
    node: new ValidationSftpClient(config.node),
  };
}

/**
 * Default SFTP configuration for local Docker testing
 */
export const DEFAULT_SFTP_CONFIG = {
  java: {
    host: 'localhost',
    port: 2222,
    username: 'javauser',
    password: 'javapass',
  },
  node: {
    host: 'localhost',
    port: 2222,
    username: 'nodeuser',
    password: 'nodepass',
  },
};
