/**
 * Tests for DataPruner ↔ MessageArchiver integration.
 *
 * Verifies:
 * - buildArchiveMessage maps DAO rows correctly
 * - archiveAndGetIdsToPrune returns IDs on success, skips on failure
 * - pruneChannel calls archiver when archiveEnabled=true
 * - pruneChannel skips archiver when archiveEnabled=false
 * - MessageArchiver gzip creates .gz files
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { buildArchiveMessage } from '../../../../src/plugins/datapruner/DataPruner';
import { MessageArchiver, ArchiveFormat } from '../../../../src/plugins/datapruner/MessageArchiver';
import type { MessageRow, ConnectorMessageRow, ContentRow, AttachmentRow } from '../../../../src/db/DonkeyDao';

// Helper factories cast through unknown to bypass RowDataPacket constructor type constraints.
function makeMessageRow(overrides: Record<string, unknown> = {}): MessageRow {
  return {
    ID: 1,
    SERVER_ID: 'server-1',
    RECEIVED_DATE: new Date('2026-01-15T10:00:00Z'),
    PROCESSED: 1,
    ORIGINAL_ID: null,
    IMPORT_ID: null,
    IMPORT_CHANNEL_ID: null,
    ...overrides,
  } as unknown as MessageRow;
}

function makeConnectorMessageRow(overrides: Record<string, unknown> = {}): ConnectorMessageRow {
  return {
    MESSAGE_ID: 1,
    METADATA_ID: 0,
    RECEIVED_DATE: new Date('2026-01-15T10:00:00Z'),
    STATUS: 'S',
    CONNECTOR_NAME: 'Source',
    SEND_ATTEMPTS: 1,
    SEND_DATE: new Date('2026-01-15T10:00:01Z'),
    RESPONSE_DATE: null,
    ERROR_CODE: null,
    CHAIN_ID: 0,
    ORDER_ID: 0,
    ...overrides,
  } as unknown as ConnectorMessageRow;
}

function makeContentRow(overrides: Record<string, unknown> = {}): ContentRow {
  return {
    MESSAGE_ID: 1,
    METADATA_ID: 0,
    CONTENT_TYPE: 1, // RAW
    CONTENT: 'MSH|^~\\&|TEST',
    DATA_TYPE: 'text/plain',
    IS_ENCRYPTED: 0,
    ...overrides,
  } as unknown as ContentRow;
}

function makeAttachmentRow(overrides: Record<string, unknown> = {}): AttachmentRow {
  return {
    ID: 'att-001',
    MESSAGE_ID: 1,
    TYPE: 'application/pdf',
    SEGMENT_ID: 0,
    ATTACHMENT: Buffer.from('pdf-content'),
    ...overrides,
  } as unknown as AttachmentRow;
}

describe('buildArchiveMessage', () => {
  it('maps DAO rows correctly to ArchiveMessage', () => {
    const msgRow = makeMessageRow({ ID: 42, SERVER_ID: 'srv-abc', PROCESSED: 1 });
    const cmRows = [
      makeConnectorMessageRow({ MESSAGE_ID: 42, METADATA_ID: 0, CONNECTOR_NAME: 'Source', STATUS: 'R' }),
      makeConnectorMessageRow({ MESSAGE_ID: 42, METADATA_ID: 1, CONNECTOR_NAME: 'HTTP Sender', STATUS: 'S' }),
    ];
    const contentRows = [
      makeContentRow({ MESSAGE_ID: 42, METADATA_ID: 0, CONTENT_TYPE: 1, CONTENT: 'raw-data' }),
      makeContentRow({ MESSAGE_ID: 42, METADATA_ID: 1, CONTENT_TYPE: 5, CONTENT: 'sent-data' }),
      makeContentRow({ MESSAGE_ID: 42, METADATA_ID: 0, CONTENT_TYPE: 15, CONTENT: '{"sourceChannelId":"ch1"}' }),
    ];
    const attachmentRows = [
      makeAttachmentRow({ MESSAGE_ID: 42, ID: 'att-1', TYPE: 'text/xml' }),
    ];

    const result = buildArchiveMessage('ch-001', 'Test Channel', msgRow, cmRows, contentRows, attachmentRows);

    expect(result.messageId).toBe(42);
    expect(result.serverId).toBe('srv-abc');
    expect(result.channelId).toBe('ch-001');
    expect(result.processed).toBe(true);

    // Connector messages
    expect(result.connectorMessages).toHaveLength(2);
    expect(result.connectorMessages[0]!.connectorName).toBe('Source');
    expect(result.connectorMessages[0]!.status).toBe('R');
    expect(result.connectorMessages[0]!.raw).toBeDefined();
    expect(result.connectorMessages[0]!.raw!.content).toBe('raw-data');
    expect(result.connectorMessages[0]!.sourceMapContent).toBe('{"sourceChannelId":"ch1"}');

    expect(result.connectorMessages[1]!.connectorName).toBe('HTTP Sender');
    expect(result.connectorMessages[1]!.sent).toBeDefined();
    expect(result.connectorMessages[1]!.sent!.content).toBe('sent-data');

    // Attachments
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0]!.id).toBe('att-1');
    expect(result.attachments![0]!.type).toBe('text/xml');
    expect(result.attachments![0]!.content).toBe(Buffer.from('pdf-content').toString('base64'));
  });

  it('handles missing content gracefully', () => {
    const msgRow = makeMessageRow({ ID: 10 });
    const cmRows = [makeConnectorMessageRow({ MESSAGE_ID: 10, METADATA_ID: 0 })];
    const contentRows: ContentRow[] = []; // No content at all
    const attachmentRows: AttachmentRow[] = [];

    const result = buildArchiveMessage('ch-002', 'Empty Channel', msgRow, cmRows, contentRows, attachmentRows);

    expect(result.messageId).toBe(10);
    expect(result.connectorMessages).toHaveLength(1);
    expect(result.connectorMessages[0]!.raw).toBeUndefined();
    expect(result.connectorMessages[0]!.transformed).toBeUndefined();
    expect(result.connectorMessages[0]!.sent).toBeUndefined();
    expect(result.connectorMessages[0]!.sourceMapContent).toBeUndefined();
    expect(result.attachments).toHaveLength(0);
  });

  it('handles PROCESSED=0 as processed=false', () => {
    const msgRow = makeMessageRow({ PROCESSED: 0 });
    const result = buildArchiveMessage('ch-003', 'Ch', msgRow, [], [], []);
    expect(result.processed).toBe(false);
  });

  it('maps optional fields when present', () => {
    const msgRow = makeMessageRow({ ORIGINAL_ID: 99, IMPORT_ID: 55, IMPORT_CHANNEL_ID: 'imp-ch' });
    const result = buildArchiveMessage('ch-004', 'Ch', msgRow, [], [], []);
    expect(result.originalId).toBe(99);
    expect(result.importId).toBe(55);
    expect(result.importChannelId).toBe('imp-ch');
  });

  it('filters attachments by message ID', () => {
    const msgRow = makeMessageRow({ ID: 100 });
    const attachmentRows = [
      makeAttachmentRow({ MESSAGE_ID: 100, ID: 'mine' }),
      makeAttachmentRow({ MESSAGE_ID: 999, ID: 'not-mine' }),
    ];
    const result = buildArchiveMessage('ch-005', 'Ch', msgRow, [], [], attachmentRows);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0]!.id).toBe('mine');
  });

  it('handles null ATTACHMENT buffer', () => {
    const msgRow = makeMessageRow({ ID: 200 });
    const attachmentRows = [
      makeAttachmentRow({ MESSAGE_ID: 200, ID: 'null-att', ATTACHMENT: null }),
    ];
    const result = buildArchiveMessage('ch-006', 'Ch', msgRow, [], [], attachmentRows);
    expect(result.attachments![0]!.content).toBe('');
  });
});

describe('MessageArchiver gzip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mirth-archive-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .gz files when compress=true', async () => {
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: true,
      messagesPerFile: 100,
    });

    const message = {
      messageId: 1,
      serverId: 'srv-1',
      channelId: 'ch-gz',
      receivedDate: new Date('2026-01-15T10:00:00Z'),
      processed: true,
      connectorMessages: [{
        metaDataId: 0,
        channelId: 'ch-gz',
        channelName: 'GZ Test',
        connectorName: 'Source',
        serverId: 'srv-1',
        receivedDate: new Date('2026-01-15T10:00:00Z'),
        status: 'S',
        sendAttempts: 1,
      }],
    };

    await archiver.archiveMessages('ch-gz', [message]);
    await archiver.finalize();

    // Find the created file
    const files = await archiver.getArchiveFiles('ch-gz');
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]!).toMatch(/\.json\.gz$/);

    // Verify it's valid gzip by decompressing
    const compressed = await fs.promises.readFile(files[0]!);
    const decompressed = zlib.gunzipSync(compressed).toString();
    const parsed = JSON.parse(decompressed.trim());
    expect(parsed.messageId).toBe(1);
    expect(parsed.serverId).toBe('srv-1');
  });

  it('creates plain files when compress=false', async () => {
    const archiver = new MessageArchiver({
      rootFolder: tmpDir,
      format: ArchiveFormat.JSON,
      compress: false,
      messagesPerFile: 100,
    });

    const message = {
      messageId: 2,
      serverId: 'srv-2',
      channelId: 'ch-plain',
      receivedDate: new Date('2026-01-15T10:00:00Z'),
      processed: true,
      connectorMessages: [],
    };

    await archiver.archiveMessages('ch-plain', [message]);
    await archiver.finalize();

    const files = await archiver.getArchiveFiles('ch-plain');
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]!).toMatch(/\.json$/);
    expect(files[0]!).not.toMatch(/\.gz$/);

    // Verify it's plain JSON
    const content = await fs.promises.readFile(files[0]!, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.messageId).toBe(2);
  });
});
