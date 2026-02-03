/**
 * Tests for AttachmentUtil class
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/AttachmentUtil.java
 */

import {
  AttachmentUtil,
  Attachment,
  ImmutableConnectorMessage,
} from '../../../../src/javascript/userutil/index.js';

// Mock the database module
jest.mock('../../../../src/db/DonkeyDao.js', () => ({
  getAttachmentIds: jest.fn(),
  getAttachments: jest.fn(),
  getAttachment: jest.fn(),
  insertAttachment: jest.fn(),
  updateAttachment: jest.fn(),
}));

import * as DonkeyDao from '../../../../src/db/DonkeyDao.js';

const mockGetAttachmentIds = DonkeyDao.getAttachmentIds as jest.MockedFunction<
  typeof DonkeyDao.getAttachmentIds
>;
const mockGetAttachments = DonkeyDao.getAttachments as jest.MockedFunction<
  typeof DonkeyDao.getAttachments
>;
const mockGetAttachment = DonkeyDao.getAttachment as jest.MockedFunction<
  typeof DonkeyDao.getAttachment
>;
const mockInsertAttachment = DonkeyDao.insertAttachment as jest.MockedFunction<
  typeof DonkeyDao.insertAttachment
>;
const mockUpdateAttachment = DonkeyDao.updateAttachment as jest.MockedFunction<
  typeof DonkeyDao.updateAttachment
>;

/**
 * Helper to create a mock ConnectorMessage
 */
function createMockConnectorMessage(
  channelId: string,
  messageId: number,
  sourceMapData: Record<string, unknown> = {}
): ImmutableConnectorMessage {
  const sourceMap = new Map(Object.entries(sourceMapData));
  return {
    getChannelId: () => channelId,
    getMessageId: () => messageId,
    getSourceMap: () => sourceMap,
    getRawData: () => null,
    getEncodedData: () => null,
  };
}

/**
 * Helper to create mock attachment rows
 */
function createMockAttachmentRow(
  id: string,
  messageId: number,
  type: string | null,
  content: Buffer | null,
  segmentId: number = 0
): DonkeyDao.AttachmentRow {
  return {
    ID: id,
    MESSAGE_ID: messageId,
    TYPE: type,
    SEGMENT_ID: segmentId,
    ATTACHMENT: content,
    constructor: { name: 'RowDataPacket' },
  } as DonkeyDao.AttachmentRow;
}

describe('AttachmentUtil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessageAttachmentIds', () => {
    it('should get attachment IDs using connector message', async () => {
      const channelId = 'channel-123';
      const messageId = 456;
      const mockIds = ['att-1', 'att-2', 'att-3'];

      mockGetAttachmentIds.mockResolvedValue(mockIds);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);

      const result = await AttachmentUtil.getMessageAttachmentIds(connectorMessage);

      expect(mockGetAttachmentIds).toHaveBeenCalledWith(channelId, messageId);
      expect(result).toEqual(mockIds);
    });

    it('should get attachment IDs using channel ID and message ID', async () => {
      const channelId = 'channel-789';
      const messageId = 123;
      const mockIds = ['att-a', 'att-b'];

      mockGetAttachmentIds.mockResolvedValue(mockIds);

      const result = await AttachmentUtil.getMessageAttachmentIds(channelId, messageId);

      expect(mockGetAttachmentIds).toHaveBeenCalledWith(channelId, messageId);
      expect(result).toEqual(mockIds);
    });

    it('should return empty array when no attachments exist', async () => {
      mockGetAttachmentIds.mockResolvedValue([]);
      const connectorMessage = createMockConnectorMessage('channel-1', 1);

      const result = await AttachmentUtil.getMessageAttachmentIds(connectorMessage);

      expect(result).toEqual([]);
    });
  });

  describe('getMessageAttachments', () => {
    it('should get all attachments using connector message', async () => {
      const channelId = 'channel-123';
      const messageId = 456;
      const mockRows = [
        createMockAttachmentRow('att-1', messageId, 'text/plain', Buffer.from('content 1')),
        createMockAttachmentRow('att-2', messageId, 'application/json', Buffer.from('content 2')),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);

      const result = await AttachmentUtil.getMessageAttachments(connectorMessage);

      expect(mockGetAttachments).toHaveBeenCalledWith(channelId, messageId);
      expect(result).toHaveLength(2);
      expect(result[0]!.getId()).toBe('att-1');
      expect(result[0]!.getType()).toBe('text/plain');
      expect(result[0]!.getContentString()).toBe('content 1');
      expect(result[1]!.getId()).toBe('att-2');
      expect(result[1]!.getType()).toBe('application/json');
    });

    it('should get attachments using channel ID and message ID', async () => {
      const channelId = 'channel-789';
      const messageId = 123;
      const mockRows = [
        createMockAttachmentRow('att-x', messageId, 'image/png', Buffer.from('binary data')),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachments(channelId, messageId);

      expect(mockGetAttachments).toHaveBeenCalledWith(channelId, messageId);
      expect(result).toHaveLength(1);
      expect(result[0]!.getId()).toBe('att-x');
    });

    it('should handle base64 decoding when requested', async () => {
      const originalContent = 'Hello, World!';
      const base64Content = Buffer.from(originalContent).toString('base64');
      const mockRows = [
        createMockAttachmentRow('att-1', 1, 'text/plain', Buffer.from(base64Content)),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachments('channel', 1, true);

      expect(result[0]!.getContentString()).toBe(originalContent);
    });

    it('should handle segmented attachments', async () => {
      const messageId = 1;
      const segment1 = Buffer.from('Part 1 ');
      const segment2 = Buffer.from('Part 2 ');
      const segment3 = Buffer.from('Part 3');
      const mockRows = [
        createMockAttachmentRow('att-1', messageId, 'text/plain', segment1, 0),
        createMockAttachmentRow('att-1', messageId, 'text/plain', segment2, 1),
        createMockAttachmentRow('att-1', messageId, 'text/plain', segment3, 2),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachments('channel', messageId);

      expect(result).toHaveLength(1);
      expect(result[0]!.getContentString()).toBe('Part 1 Part 2 Part 3');
    });

    it('should return empty array when no attachments exist', async () => {
      mockGetAttachments.mockResolvedValue([]);

      const result = await AttachmentUtil.getMessageAttachments('channel', 1);

      expect(result).toEqual([]);
    });
  });

  describe('getMessageAttachment', () => {
    it('should get single attachment using connector message', async () => {
      const channelId = 'channel-123';
      const messageId = 456;
      const attachmentId = 'att-specific';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/xml', Buffer.from('<data/>')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);

      const result = await AttachmentUtil.getMessageAttachment(connectorMessage, attachmentId);

      expect(mockGetAttachment).toHaveBeenCalledWith(channelId, messageId, attachmentId);
      expect(result).not.toBeNull();
      expect(result?.getId()).toBe(attachmentId);
      expect(result?.getContentString()).toBe('<data/>');
    });

    it('should get single attachment using channel ID, message ID, and attachment ID', async () => {
      const channelId = 'channel-789';
      const messageId = 123;
      const attachmentId = 'att-direct';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'application/pdf', Buffer.from('PDF content')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachment(
        channelId,
        messageId,
        attachmentId
      );

      expect(mockGetAttachment).toHaveBeenCalledWith(channelId, messageId, attachmentId);
      expect(result).not.toBeNull();
      expect(result?.getId()).toBe(attachmentId);
    });

    it('should return null when attachment not found', async () => {
      mockGetAttachment.mockResolvedValue([]);

      const result = await AttachmentUtil.getMessageAttachment('channel', 1, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle base64 decoding for single attachment', async () => {
      const originalContent = 'Decoded content';
      const base64Content = Buffer.from(originalContent).toString('base64');
      const mockRows = [
        createMockAttachmentRow('att-1', 1, 'text/plain', Buffer.from(base64Content)),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachment('channel', 1, 'att-1', true);

      expect(result?.getContentString()).toBe(originalContent);
    });
  });

  describe('getMessageAttachmentsFromSourceChannel', () => {
    it('should get attachments from source channel', async () => {
      const sourceChannelId = 'source-channel';
      const sourceMessageId = 999;
      const mockRows = [
        createMockAttachmentRow('att-source', sourceMessageId, 'text/plain', Buffer.from('source content')),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage('current-channel', 1, {
        sourceChannelId,
        sourceMessageId,
      });

      const result = await AttachmentUtil.getMessageAttachmentsFromSourceChannel(connectorMessage);

      expect(mockGetAttachments).toHaveBeenCalledWith(sourceChannelId, sourceMessageId);
      expect(result).toHaveLength(1);
      expect(result[0]!.getId()).toBe('att-source');
    });

    it('should use sourceChannelIds/sourceMessageIds lists if available', async () => {
      const sourceChannelId = 'source-channel-list';
      const sourceMessageId = 888;
      const mockRows = [
        createMockAttachmentRow('att-list', sourceMessageId, 'text/plain', Buffer.from('list content')),
      ];

      mockGetAttachments.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage('current-channel', 1, {
        sourceChannelIds: [sourceChannelId, 'other-channel'],
        sourceMessageIds: [sourceMessageId, 777],
      });

      const result = await AttachmentUtil.getMessageAttachmentsFromSourceChannel(connectorMessage);

      expect(mockGetAttachments).toHaveBeenCalledWith(sourceChannelId, sourceMessageId);
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no source info in sourceMap', async () => {
      const connectorMessage = createMockConnectorMessage('channel', 1, {});

      const result = await AttachmentUtil.getMessageAttachmentsFromSourceChannel(connectorMessage);

      expect(result).toEqual([]);
      expect(mockGetAttachments).not.toHaveBeenCalled();
    });

    it('should return empty array and not throw on errors', async () => {
      mockGetAttachments.mockRejectedValue(new Error('Database error'));
      const connectorMessage = createMockConnectorMessage('channel', 1, {
        sourceChannelId: 'source',
        sourceMessageId: 1,
      });

      const result = await AttachmentUtil.getMessageAttachmentsFromSourceChannel(connectorMessage);

      expect(result).toEqual([]);
    });
  });

  describe('addAttachment', () => {
    it('should add attachment to list with string content', () => {
      const attachments: Attachment[] = [];
      const content = 'Test content';
      const type = 'text/plain';

      const result = AttachmentUtil.addAttachment(attachments, content, type);

      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toBe(result);
      expect(result.getId()).toBeDefined();
      expect(result.getContentString()).toBe(content);
      expect(result.getType()).toBe(type);
    });

    it('should add attachment to list with Buffer content', () => {
      const attachments: Attachment[] = [];
      const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
      const type = 'image/png';

      const result = AttachmentUtil.addAttachment(attachments, content, type);

      expect(attachments).toHaveLength(1);
      expect(result.getContent()).toEqual(content);
      expect(result.getType()).toBe(type);
    });

    it('should base64 encode content when requested', () => {
      const attachments: Attachment[] = [];
      const content = 'Hello, World!';
      const type = 'text/plain';

      const result = AttachmentUtil.addAttachment(attachments, content, type, true);

      const expectedBase64 = Buffer.from(content).toString('base64');
      expect(result.getContentString()).toBe(expectedBase64);
    });

    it('should add multiple attachments to list', () => {
      const attachments: Attachment[] = [];

      AttachmentUtil.addAttachment(attachments, 'content 1', 'text/plain');
      AttachmentUtil.addAttachment(attachments, 'content 2', 'text/html');
      AttachmentUtil.addAttachment(attachments, 'content 3', 'application/json');

      expect(attachments).toHaveLength(3);
      expect(attachments.map((a) => a.getType())).toEqual([
        'text/plain',
        'text/html',
        'application/json',
      ]);
    });
  });

  describe('createAttachment', () => {
    it('should create and insert attachment into database', async () => {
      mockInsertAttachment.mockResolvedValue();
      const connectorMessage = createMockConnectorMessage('channel-123', 456);
      const content = 'Database content';
      const type = 'text/plain';

      const result = await AttachmentUtil.createAttachment(connectorMessage, content, type);

      expect(mockInsertAttachment).toHaveBeenCalledWith(
        'channel-123',
        456,
        expect.any(String), // UUID
        type,
        Buffer.from(content)
      );
      expect(result.getId()).toBeDefined();
      expect(result.getContentString()).toBe(content);
      expect(result.getType()).toBe(type);
    });

    it('should base64 encode content when requested', async () => {
      mockInsertAttachment.mockResolvedValue();
      const connectorMessage = createMockConnectorMessage('channel', 1);
      const content = 'Encode me';
      const type = 'text/plain';

      const result = await AttachmentUtil.createAttachment(connectorMessage, content, type, true);

      const expectedBase64 = Buffer.from(content).toString('base64');
      expect(mockInsertAttachment).toHaveBeenCalledWith(
        'channel',
        1,
        expect.any(String),
        type,
        Buffer.from(expectedBase64)
      );
      expect(result.getContentString()).toBe(expectedBase64);
    });
  });

  describe('updateAttachment', () => {
    it('should update attachment using connector message and attachment ID', async () => {
      mockUpdateAttachment.mockResolvedValue();
      const connectorMessage = createMockConnectorMessage('channel-123', 456);
      const attachmentId = 'existing-att';
      const content = 'Updated content';
      const type = 'text/plain';

      const result = await AttachmentUtil.updateAttachment(
        connectorMessage,
        attachmentId,
        content,
        type
      );

      expect(mockUpdateAttachment).toHaveBeenCalledWith(
        'channel-123',
        456,
        attachmentId,
        type,
        Buffer.from(content)
      );
      expect(result.getId()).toBe(attachmentId);
      expect(result.getContentString()).toBe(content);
    });

    it('should update attachment using Attachment object', async () => {
      mockUpdateAttachment.mockResolvedValue();
      const connectorMessage = createMockConnectorMessage('channel-123', 456);
      const attachment = new Attachment('att-obj', Buffer.from('Object content'), 'application/xml');

      const result = await AttachmentUtil.updateAttachment(connectorMessage, attachment);

      expect(mockUpdateAttachment).toHaveBeenCalledWith(
        'channel-123',
        456,
        'att-obj',
        'application/xml',
        Buffer.from('Object content')
      );
      expect(result.getId()).toBe('att-obj');
    });

    it('should update attachment using channel ID and message ID', async () => {
      mockUpdateAttachment.mockResolvedValue();
      const channelId = 'channel-direct';
      const messageId = 789;
      const attachment = new Attachment('att-direct', Buffer.from('Direct content'), 'text/html');

      await AttachmentUtil.updateAttachment(channelId, messageId, attachment);

      expect(mockUpdateAttachment).toHaveBeenCalledWith(
        channelId,
        messageId,
        'att-direct',
        'text/html',
        Buffer.from('Direct content')
      );
    });
  });

  describe('reAttachMessage', () => {
    it('should replace attachment tokens with content', async () => {
      const channelId = 'channel-123';
      const messageId = 456;
      const attachmentId = 'att-embed';
      const attachmentContent = '<embedded>data</embedded>';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/xml', Buffer.from(attachmentContent)),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);
      const raw = `<message>Header ${`\${ATTACH:${attachmentId}}`} Footer</message>`;

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe(`<message>Header ${attachmentContent} Footer</message>`);
    });

    it('should replace multiple attachment tokens', async () => {
      const channelId = 'channel-multi';
      const messageId = 1;
      const mockRows1 = [
        createMockAttachmentRow('att-1', messageId, 'text/plain', Buffer.from('FIRST')),
      ];
      const mockRows2 = [
        createMockAttachmentRow('att-2', messageId, 'text/plain', Buffer.from('SECOND')),
      ];

      mockGetAttachment
        .mockResolvedValueOnce(mockRows1)
        .mockResolvedValueOnce(mockRows2);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);
      const raw = 'Start ${ATTACH:att-1} Middle ${ATTACH:att-2} End';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe('Start FIRST Middle SECOND End');
    });

    it('should leave tokens intact when attachment not found', async () => {
      mockGetAttachment.mockResolvedValue([]);
      const connectorMessage = createMockConnectorMessage('channel', 1);
      const raw = 'Data: ${ATTACH:nonexistent}';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe(raw);
    });

    it('should get message content from connector message when no raw provided', async () => {
      const channelId = 'channel-auto';
      const messageId = 2;
      const attachmentId = 'att-auto';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/plain', Buffer.from('AUTO')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage: ImmutableConnectorMessage = {
        getChannelId: () => channelId,
        getMessageId: () => messageId,
        getSourceMap: () => new Map(),
        getRawData: () => `Raw ${`\${ATTACH:${attachmentId}}`} Data`,
        getEncodedData: () => null,
      };

      const result = await AttachmentUtil.reAttachMessage(connectorMessage);

      expect(result).toBe('Raw AUTO Data');
    });
  });

  describe('reAttachMessageBytes', () => {
    it('should return Buffer with replaced content', async () => {
      const channelId = 'channel-bytes';
      const messageId = 3;
      const attachmentId = 'att-bytes';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/plain', Buffer.from('BYTES')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);
      const raw = `Content ${`\${ATTACH:${attachmentId}}`}`;

      const result = await AttachmentUtil.reAttachMessageBytes(
        raw,
        connectorMessage,
        'utf-8',
        false
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf-8')).toBe('Content BYTES');
    });

    it('should handle binary mode with base64 input', async () => {
      const channelId = 'channel-binary';
      const messageId = 4;
      const attachmentId = 'att-binary';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/plain', Buffer.from('BINARY')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);
      // Base64 encode the raw message that contains a token
      const rawPlain = `Data ${`\${ATTACH:${attachmentId}}`}`;
      const rawBase64 = Buffer.from(rawPlain).toString('base64');

      const result = await AttachmentUtil.reAttachMessageBytes(
        rawBase64,
        connectorMessage,
        'utf-8',
        true
      );

      expect(result.toString('utf-8')).toBe('Data BINARY');
    });
  });

  describe('edge cases', () => {
    it('should handle null attachment content', async () => {
      const mockRows = [createMockAttachmentRow('att-null', 1, 'text/plain', null)];

      mockGetAttachments.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachments('channel', 1);

      expect(result).toHaveLength(1);
      expect(result[0]!.getContent()?.length).toBe(0);
    });

    it('should handle undefined type', async () => {
      const mockRows = [createMockAttachmentRow('att-no-type', 1, null, Buffer.from('content'))];

      mockGetAttachments.mockResolvedValue(mockRows);

      const result = await AttachmentUtil.getMessageAttachments('channel', 1);

      expect(result).toHaveLength(1);
      expect(result[0]!.getType()).toBe('');
    });

    it('should handle attachment token pattern case insensitivity', async () => {
      const channelId = 'channel-case';
      const messageId = 5;
      const attachmentId = 'ABC-123';
      const mockRows = [
        createMockAttachmentRow(attachmentId, messageId, 'text/plain', Buffer.from('CASE')),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage(channelId, messageId);
      // Token with uppercase ATTACH
      const raw = '${ATTACH:ABC-123}';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe('CASE');
    });

    it('should handle empty message', async () => {
      const connectorMessage = createMockConnectorMessage('channel', 1);
      const raw = '';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe('');
    });

    it('should handle message with no tokens', async () => {
      const connectorMessage = createMockConnectorMessage('channel', 1);
      const raw = 'Just a regular message with no attachment tokens';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe(raw);
      expect(mockGetAttachment).not.toHaveBeenCalled();
    });
  });

  describe('attachment token format', () => {
    it('should match standard UUID format', async () => {
      const mockRows = [
        createMockAttachmentRow(
          '550e8400-e29b-41d4-a716-446655440000',
          1,
          'text/plain',
          Buffer.from('UUID')
        ),
      ];

      mockGetAttachment.mockResolvedValue(mockRows);
      const connectorMessage = createMockConnectorMessage('channel', 1);
      const raw = '${ATTACH:550e8400-e29b-41d4-a716-446655440000}';

      const result = await AttachmentUtil.reAttachMessage(raw, connectorMessage);

      expect(result).toBe('UUID');
    });
  });
});
