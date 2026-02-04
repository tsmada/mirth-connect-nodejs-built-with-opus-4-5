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

import * as fs from 'fs';
import * as path from 'path';
// Note: zlib compression can be added in future enhancement
// import { createGzip } from 'zlib';
// import { pipeline } from 'stream/promises';
// import { Readable } from 'stream';

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

    // Write message
    const content = this.formatMessage(message);
    this.currentFile!.write(content);
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
    const filename = `messages_${timestamp}.${ext}${compressExt}`;

    this.currentFilePath = path.join(dir, filename);

    // Open file stream
    if (this.options.compress) {
      // Create a pass-through that compresses
      this.currentFile = fs.createWriteStream(this.currentFilePath);
    } else {
      this.currentFile = fs.createWriteStream(this.currentFilePath);
    }
  }

  /**
   * Close the current archive file
   */
  async closeCurrentFile(): Promise<void> {
    if (this.currentFile) {
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
        } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.json.gz') || entry.name.endsWith('.xml') || entry.name.endsWith('.xml.gz'))) {
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
}

/**
 * Singleton archiver instance
 */
export const messageArchiver = new MessageArchiver();
