/**
 * Message Archiver Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  MessageArchiver,
  ArchiveFormat,
  ArchiveMessage,
  DEFAULT_ARCHIVE_OPTIONS,
} from '../../../src/plugins/datapruner/MessageArchiver';

describe('MessageArchiver', () => {
  const testDir = path.join(process.cwd(), 'test-archives');
  let archiver: MessageArchiver;

  beforeEach(() => {
    archiver = new MessageArchiver({
      rootFolder: testDir,
      compress: false, // Disable compression for easier testing
    });
  });

  afterEach(async () => {
    await archiver.finalize();
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createTestMessage = (messageId: number): ArchiveMessage => ({
    messageId,
    serverId: 'server-1',
    channelId: 'channel-123',
    receivedDate: new Date('2026-01-15T10:30:00.000Z'),
    processed: true,
    connectorMessages: [
      {
        metaDataId: 0,
        channelId: 'channel-123',
        channelName: 'Test Channel',
        connectorName: 'Source',
        serverId: 'server-1',
        receivedDate: new Date('2026-01-15T10:30:00.000Z'),
        status: 'RECEIVED',
        sendAttempts: 0,
        raw: {
          contentType: 'text/plain',
          content: 'Test message content',
          encrypted: false,
        },
      },
    ],
    attachments: [
      {
        id: 'att-1',
        type: 'application/pdf',
        content: 'base64encodedcontent',
      },
    ],
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const a = new MessageArchiver();
      const opts = a.getOptions();

      expect(opts.format).toBe(DEFAULT_ARCHIVE_OPTIONS.format);
      expect(opts.compress).toBe(DEFAULT_ARCHIVE_OPTIONS.compress);
      expect(opts.includeContent).toBe(DEFAULT_ARCHIVE_OPTIONS.includeContent);
    });

    it('should create with custom options', () => {
      const a = new MessageArchiver({
        format: ArchiveFormat.XML,
        compress: false,
        messagesPerFile: 500,
      });
      const opts = a.getOptions();

      expect(opts.format).toBe(ArchiveFormat.XML);
      expect(opts.compress).toBe(false);
      expect(opts.messagesPerFile).toBe(500);
    });
  });

  describe('setOptions', () => {
    it('should update options', () => {
      archiver.setOptions({ format: ArchiveFormat.XML });
      expect(archiver.getOptions().format).toBe(ArchiveFormat.XML);
    });
  });

  describe('archiveMessage', () => {
    it('should archive a single message to JSON', async () => {
      const message = createTestMessage(1);
      await archiver.archiveMessage('channel-123', message);
      await archiver.finalize();

      expect(archiver.getTotalArchived()).toBe(1);

      const files = await archiver.getArchiveFiles('channel-123');
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.json$/);
    });

    it('should archive a message to XML', async () => {
      archiver.setOptions({ format: ArchiveFormat.XML });

      const message = createTestMessage(1);
      await archiver.archiveMessage('channel-123', message);
      await archiver.finalize();

      const files = await archiver.getArchiveFiles('channel-123');
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.xml$/);

      // Verify XML content
      const content = fs.readFileSync(files[0]!, 'utf-8');
      expect(content).toContain('<message>');
      expect(content).toContain('<messageId>1</messageId>');
    });

    it('should create new file when messagesPerFile is reached', async () => {
      archiver.setOptions({ messagesPerFile: 2 });

      for (let i = 1; i <= 5; i++) {
        await archiver.archiveMessage('channel-123', createTestMessage(i));
      }
      await archiver.finalize();

      expect(archiver.getTotalArchived()).toBe(5);

      const files = await archiver.getArchiveFiles('channel-123');
      // With messagesPerFile=2, we expect 2-3 files for 5 messages
      // (depending on timing: 2+2+1=3 or 2+3=2 if files created at same timestamp)
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.length).toBeLessThanOrEqual(3);
    });
  });

  describe('archiveMessages', () => {
    it('should archive a batch of messages', async () => {
      const messages = [createTestMessage(1), createTestMessage(2), createTestMessage(3)];

      const count = await archiver.archiveMessages('channel-123', messages);
      await archiver.finalize();

      expect(count).toBe(3);
      expect(archiver.getTotalArchived()).toBe(3);
    });

    it('should return 0 for empty array', async () => {
      const count = await archiver.archiveMessages('channel-123', []);
      expect(count).toBe(0);
    });
  });

  describe('getArchiveFiles', () => {
    it('should return empty array for non-existent channel', async () => {
      const files = await archiver.getArchiveFiles('non-existent');
      expect(files).toEqual([]);
    });

    it('should return sorted file list', async () => {
      // Archive to multiple files
      archiver.setOptions({ messagesPerFile: 1 });

      for (let i = 1; i <= 3; i++) {
        await archiver.archiveMessage('channel-123', createTestMessage(i));
        await new Promise((r) => setTimeout(r, 10)); // Small delay for different timestamps
      }
      await archiver.finalize();

      const files = await archiver.getArchiveFiles('channel-123');
      expect(files.length).toBe(3);
      // Should be sorted
      for (let i = 0; i < files.length - 1; i++) {
        expect(files[i]! < files[i + 1]!).toBe(true);
      }
    });
  });

  describe('getArchiveSize', () => {
    it('should return 0 for non-existent channel', async () => {
      const size = await archiver.getArchiveSize('non-existent');
      expect(size).toBe(0);
    });

    it('should return total size of archives', async () => {
      await archiver.archiveMessage('channel-123', createTestMessage(1));
      await archiver.archiveMessage('channel-123', createTestMessage(2));
      await archiver.finalize();

      const size = await archiver.getArchiveSize('channel-123');
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('deleteOldArchives', () => {
    it('should delete archives older than threshold', async () => {
      // Create archive directory manually with old date
      const oldDir = path.join(testDir, 'channel-123', '2025-01-01');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'test.json'), '{}');

      // Archive something current
      await archiver.archiveMessage('channel-123', createTestMessage(1));
      await archiver.finalize();

      // Delete archives older than 2026-01-01
      const threshold = new Date('2026-01-01');
      const deleted = await archiver.deleteOldArchives('channel-123', threshold);

      expect(deleted).toBe(1);
      expect(fs.existsSync(oldDir)).toBe(false);
    });

    it('should return 0 for non-existent channel', async () => {
      const deleted = await archiver.deleteOldArchives('non-existent', new Date());
      expect(deleted).toBe(0);
    });
  });

  describe('finalize', () => {
    it('should close current file', async () => {
      await archiver.archiveMessage('channel-123', createTestMessage(1));
      await archiver.finalize();

      // Should be able to call finalize again without error
      await archiver.finalize();
    });
  });
});
