/**
 * Message Archiver
 *
 * Archives messages before pruning.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/util/messagewriter/
 *
 * Key behaviors:
 * - Export messages to files before deletion
 * - Support multiple archive formats (JSON, XML)
 * - Compress archives with gzip
 * - Organize by channel and date
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createGzip, gunzipSync, type Gzip } from 'zlib';

/**
 * Archive format options
 */
export enum ArchiveFormat {
  JSON = 'JSON',
  XML = 'XML',
}

/**
 * Archive writer options
 */
export interface MessageWriterOptions {
  /** Root directory for archives */
  rootFolder: string;
  /** Archive format */
  format: ArchiveFormat;
  /** Whether to compress with gzip */
  compress: boolean;
  /** Include message content */
  includeContent: boolean;
  /** Include attachments */
  includeAttachments: boolean;
  /** Max messages per file */
  messagesPerFile: number;
  /** Encrypt archives */
  encrypt: boolean;
  /** Encryption password (if encrypt is true) */
  encryptionPassword?: string;
}

/**
 * Default archive options
 */
export const DEFAULT_ARCHIVE_OPTIONS: MessageWriterOptions = {
  rootFolder: './archives',
  format: ArchiveFormat.JSON,
  compress: true,
  includeContent: true,
  includeAttachments: true,
  messagesPerFile: 1000,
  encrypt: false,
};

/**
 * Message data for archiving
 */
export interface ArchiveMessage {
  messageId: number;
  serverId: string;
  channelId: string;
  receivedDate: Date;
  processed: boolean;
  originalId?: number;
  importId?: number;
  importChannelId?: string;
  connectorMessages: ArchiveConnectorMessage[];
  attachments?: ArchiveAttachment[];
}

/**
 * Connector message data for archiving
 */
export interface ArchiveConnectorMessage {
  metaDataId: number;
  channelId: string;
  channelName: string;
  connectorName: string;
  serverId: string;
  receivedDate: Date;
  status: string;
  sendAttempts: number;
  sendDate?: Date;
  responseDate?: Date;
  errorCode?: number;
  raw?: ArchiveContent;
  processedRaw?: ArchiveContent;
  transformed?: ArchiveContent;
  encoded?: ArchiveContent;
  sent?: ArchiveContent;
  response?: ArchiveContent;
  responseTransformed?: ArchiveContent;
  processedResponse?: ArchiveContent;
  sourceMapContent?: string;
  connectorMapContent?: string;
  channelMapContent?: string;
  responseMapContent?: string;
  metaDataMapContent?: string;
  errors?: string;
}

/**
 * Content data for archiving
 */
export interface ArchiveContent {
  contentType: string;
  content: string;
  encrypted: boolean;
}

/**
 * Attachment data for archiving
 */
export interface ArchiveAttachment {
  id: string;
  type: string;
  content: string;
}

/**
 * Message Archiver
 */
export class MessageArchiver {
  private options: MessageWriterOptions;
  private currentFile: fs.WriteStream | null = null;
  private currentGzip: Gzip | null = null;
  private currentCipher: crypto.CipherGCM | null = null;
  private currentFilePath: string = '';
  private currentMessageCount: number = 0;
  private totalArchived: number = 0;
  private currentChannelId: string = '';

  constructor(options: Partial<MessageWriterOptions> = {}) {
    this.options = { ...DEFAULT_ARCHIVE_OPTIONS, ...options };
  }

  /**
   * Get options
   */
  getOptions(): MessageWriterOptions {
    return { ...this.options };
  }

  /**
   * Set options
   */
  setOptions(options: Partial<MessageWriterOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get total archived message count
   */
  getTotalArchived(): number {
    return this.totalArchived;
  }

  /**
   * Archive a batch of messages
   */
  async archiveMessages(channelId: string, messages: ArchiveMessage[]): Promise<number> {
    if (messages.length === 0) {
      return 0;
    }

    let archived = 0;

    for (const message of messages) {
      await this.archiveMessage(channelId, message);
      archived++;
    }

    return archived;
  }

  /**
   * Archive a single message
   */
  async archiveMessage(channelId: string, message: ArchiveMessage): Promise<void> {
    // Start new file if needed
    if (
      !this.currentFile ||
      this.currentChannelId !== channelId ||
      this.currentMessageCount >= this.options.messagesPerFile
    ) {
      await this.closeCurrentFile();
      await this.openNewFile(channelId);
    }

    // Write to the head of the stream chain: gzip → cipher → file
    const content = this.formatMessage(message);
    const writeTarget = this.currentGzip ?? this.currentCipher ?? this.currentFile!;
    writeTarget.write(content);
    this.currentMessageCount++;
    this.totalArchived++;
  }

  /**
   * Format a message for archiving
   */
  private formatMessage(message: ArchiveMessage): string {
    switch (this.options.format) {
      case ArchiveFormat.JSON:
        return JSON.stringify(message) + '\n';
      case ArchiveFormat.XML:
        return this.toXml(message) + '\n';
      default:
        return JSON.stringify(message) + '\n';
    }
  }

  /**
   * Convert message to XML format
   */
  private toXml(message: ArchiveMessage): string {
    const lines: string[] = [];
    lines.push('<message>');
    lines.push(`  <messageId>${message.messageId}</messageId>`);
    lines.push(`  <serverId>${this.escapeXml(message.serverId)}</serverId>`);
    lines.push(`  <channelId>${this.escapeXml(message.channelId)}</channelId>`);
    lines.push(`  <receivedDate>${message.receivedDate.toISOString()}</receivedDate>`);
    lines.push(`  <processed>${message.processed}</processed>`);

    if (message.originalId !== undefined) {
      lines.push(`  <originalId>${message.originalId}</originalId>`);
    }

    // Connector messages
    lines.push('  <connectorMessages>');
    for (const cm of message.connectorMessages) {
      lines.push('    <connectorMessage>');
      lines.push(`      <metaDataId>${cm.metaDataId}</metaDataId>`);
      lines.push(`      <status>${cm.status}</status>`);
      lines.push(`      <receivedDate>${cm.receivedDate.toISOString()}</receivedDate>`);

      if (this.options.includeContent && cm.raw) {
        lines.push(`      <raw><content>${this.escapeXml(cm.raw.content)}</content></raw>`);
      }

      lines.push('    </connectorMessage>');
    }
    lines.push('  </connectorMessages>');

    // Attachments
    if (this.options.includeAttachments && message.attachments?.length) {
      lines.push('  <attachments>');
      for (const att of message.attachments) {
        lines.push('    <attachment>');
        lines.push(`      <id>${this.escapeXml(att.id)}</id>`);
        lines.push(`      <type>${this.escapeXml(att.type)}</type>`);
        lines.push(`      <content>${att.content}</content>`);
        lines.push('    </attachment>');
      }
      lines.push('  </attachments>');
    }

    lines.push('</message>');
    return lines.join('\n');
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Open a new archive file
   */
  private async openNewFile(channelId: string): Promise<void> {
    this.currentChannelId = channelId;
    this.currentMessageCount = 0;

    // Create directory structure
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dir = path.join(this.options.rootFolder, channelId, dateStr);

    await fs.promises.mkdir(dir, { recursive: true });

    // Generate filename
    const timestamp = Date.now();
    const ext = this.options.format === ArchiveFormat.JSON ? 'json' : 'xml';
    const compressExt = this.options.compress ? '.gz' : '';
    const encryptExt = this.options.encrypt ? '.enc' : '';
    const filename = `messages_${timestamp}.${ext}${compressExt}${encryptExt}`;

    this.currentFilePath = path.join(dir, filename);

    // Open file stream
    this.currentFile = fs.createWriteStream(this.currentFilePath);

    // Setup encryption if enabled
    if (this.options.encrypt) {
      if (!this.options.encryptionPassword) {
        throw new Error('Encryption password is required when encrypt is true');
      }

      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = crypto.pbkdf2Sync(this.options.encryptionPassword, salt, 100000, 32, 'sha256');

      // Write 32-byte header: [16-byte salt][12-byte IV][4-byte reserved zeros]
      const header = Buffer.alloc(32);
      salt.copy(header, 0);
      iv.copy(header, 16);
      // bytes 28-31 are already zeros
      this.currentFile.write(header);

      this.currentCipher = crypto.createCipheriv('aes-256-gcm', key, iv) as crypto.CipherGCM;
      // Pipe with { end: false } so cipher.end() doesn't cascade to file stream.
      // This allows us to write the GCM auth tag after the cipher finishes.
      this.currentCipher.pipe(this.currentFile, { end: false });
    } else {
      this.currentCipher = null;
    }

    // Setup compression if enabled
    // Stream chain: data → [gzip] → [cipher] → file
    if (this.options.compress) {
      this.currentGzip = createGzip();
      if (this.currentCipher) {
        // Don't auto-end cipher when gzip ends — we control the close sequence manually
        this.currentGzip.pipe(this.currentCipher, { end: false });
      } else {
        this.currentGzip.pipe(this.currentFile);
      }
    } else {
      this.currentGzip = null;
    }
  }

  /**
   * Close the current archive file
   */
  async closeCurrentFile(): Promise<void> {
    if (!this.currentFile && !this.currentGzip && !this.currentCipher) {
      return;
    }

    // Wait for the file stream's 'finish' event to ensure all data is written to disk.
    const fileFinished = this.currentFile
      ? new Promise<void>((resolve, reject) => {
          this.currentFile!.on('finish', resolve);
          this.currentFile!.on('error', reject);
        })
      : Promise.resolve();

    if (this.currentGzip) {
      if (this.currentCipher) {
        // Compress + encrypt path. Sequence:
        // 1. End gzip → gzip flushes final compressed bytes to cipher (via pipe)
        // 2. Wait for gzip 'end' (readable side done — all data piped to cipher)
        // 3. End cipher → cipher flushes final encrypted block to file (via pipe { end: false })
        // 4. Write GCM auth tag directly to file
        // 5. End file stream

        await new Promise<void>((resolve, reject) => {
          this.currentGzip!.on('end', resolve);
          this.currentGzip!.on('error', reject);
          this.currentGzip!.end();
        });

        const cipherFinished = new Promise<void>((resolve, reject) => {
          this.currentCipher!.on('finish', resolve);
          this.currentCipher!.on('error', reject);
        });
        this.currentCipher.end();
        await cipherFinished;

        // Append GCM auth tag (16 bytes) directly to the file after cipher data
        const authTag = this.currentCipher.getAuthTag();
        this.currentFile!.write(authTag);
        this.currentFile!.end();
        await fileFinished;

        this.currentCipher = null;
      } else {
        // gzip.end() cascades via pipe to file when no cipher
        this.currentGzip.end();
        await fileFinished;
      }

      this.currentGzip = null;
      this.currentFile = null;
    } else if (this.currentCipher) {
      // Encrypt only (no compression)
      const cipherFinished = new Promise<void>((resolve, reject) => {
        this.currentCipher!.on('finish', resolve);
        this.currentCipher!.on('error', reject);
      });
      this.currentCipher.end();
      await cipherFinished;

      // Append GCM auth tag
      const authTag = this.currentCipher.getAuthTag();
      this.currentFile!.write(authTag);
      this.currentFile!.end();
      await fileFinished;

      this.currentCipher = null;
      this.currentFile = null;
    } else if (this.currentFile) {
      await new Promise<void>((resolve, reject) => {
        this.currentFile!.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.currentFile = null;
    }
  }

  /**
   * Finalize archiving (close all files)
   */
  async finalize(): Promise<void> {
    await this.closeCurrentFile();
  }

  /**
   * Get archive file paths for a channel
   */
  async getArchiveFiles(channelId: string): Promise<string[]> {
    const channelDir = path.join(this.options.rootFolder, channelId);

    if (!fs.existsSync(channelDir)) {
      return [];
    }

    const files: string[] = [];

    const walkDir = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.json') ||
            entry.name.endsWith('.json.gz') ||
            entry.name.endsWith('.xml') ||
            entry.name.endsWith('.xml.gz') ||
            entry.name.endsWith('.json.enc') ||
            entry.name.endsWith('.json.gz.enc') ||
            entry.name.endsWith('.xml.enc') ||
            entry.name.endsWith('.xml.gz.enc'))
        ) {
          files.push(fullPath);
        }
      }
    };

    await walkDir(channelDir);
    return files.sort();
  }

  /**
   * Get total size of archives for a channel
   */
  async getArchiveSize(channelId: string): Promise<number> {
    const files = await this.getArchiveFiles(channelId);
    let totalSize = 0;

    for (const file of files) {
      const stats = await fs.promises.stat(file);
      totalSize += stats.size;
    }

    return totalSize;
  }

  /**
   * Delete archives older than a certain date
   */
  async deleteOldArchives(channelId: string, olderThan: Date): Promise<number> {
    const channelDir = path.join(this.options.rootFolder, channelId);

    if (!fs.existsSync(channelDir)) {
      return 0;
    }

    let deleted = 0;
    const entries = await fs.promises.readdir(channelDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if date directory is older than threshold
        const dateMatch = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
          const dirDate = new Date(
            parseInt(dateMatch[1]!),
            parseInt(dateMatch[2]!) - 1,
            parseInt(dateMatch[3]!)
          );

          if (dirDate < olderThan) {
            const dirPath = path.join(channelDir, entry.name);
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            deleted++;
          }
        }
      }
    }

    return deleted;
  }

  /**
   * Decrypt an encrypted archive file.
   *
   * File layout: [32-byte header][encrypted data][16-byte GCM auth tag]
   * Header: [16-byte salt][12-byte IV][4-byte reserved]
   *
   * If the file was compressed (.gz.enc), decompresses after decryption.
   */
  static async decryptArchiveFile(filePath: string, password: string): Promise<Buffer> {
    const data = await fs.promises.readFile(filePath);

    if (data.length < 32 + 16) {
      throw new Error('Encrypted archive file is too small to contain header and auth tag');
    }

    // Extract header
    const salt = data.subarray(0, 16);
    const iv = data.subarray(16, 28);
    // bytes 28-31 reserved

    // Extract auth tag (last 16 bytes)
    const authTag = data.subarray(data.length - 16);

    // Encrypted data is between header and auth tag
    const encryptedData = data.subarray(32, data.length - 16);

    // Derive key with same PBKDF2 parameters
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    // Decompress if the file was compressed (detect .gz.enc pattern)
    const basename = path.basename(filePath);
    if (basename.includes('.gz.enc') || basename.includes('.gz.')) {
      return gunzipSync(decrypted);
    }

    return decrypted;
  }
}

/**
 * Singleton archiver instance
 */
export const messageArchiver = new MessageArchiver();
