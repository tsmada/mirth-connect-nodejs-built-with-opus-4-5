import { NoOpAttachmentHandler, AttachmentHandler } from '../../../../src/donkey/message/AttachmentHandler';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { ContentType } from '../../../../src/model/ContentType';
import { Status } from '../../../../src/model/Status';

// Helper to create a test ConnectorMessage
function createTestMessage(rawContent: string): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 0,
    channelId: 'test-channel',
    channelName: 'Test',
    connectorName: 'Source',
    serverId: 'node-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
  msg.setContent({
    contentType: ContentType.RAW,
    content: rawContent,
    dataType: 'HL7V2',
    encrypted: false,
  });
  return msg;
}

describe('NoOpAttachmentHandler', () => {
  test('returns content unchanged', async () => {
    const handler = new NoOpAttachmentHandler();
    const msg = createTestMessage('MSH|^~\\&|...');
    const result = await handler.extractAttachments('ch-1', 1, msg);
    expect(result).toBe('MSH|^~\\&|...');
  });

  test('returns empty string for message with no raw content', async () => {
    const handler = new NoOpAttachmentHandler();
    const msg = new ConnectorMessage({
      messageId: 1, metaDataId: 0, channelId: 'ch', channelName: 'T',
      connectorName: 'S', serverId: 's', receivedDate: new Date(), status: Status.RECEIVED,
    });
    const result = await handler.extractAttachments('ch', 1, msg);
    expect(result).toBe('');
  });

  test('custom handler can extract and replace attachments', async () => {
    const customHandler: AttachmentHandler = {
      async extractAttachments(_channelId, _messageId, connectorMessage) {
        const raw = connectorMessage.getRawContent();
        if (raw) {
          return raw.content.replace(/LARGE_BINARY_DATA/, '${ATTACH:att-001}');
        }
        return '';
      },
    };
    const msg = createTestMessage('Header|LARGE_BINARY_DATA|Footer');
    const result = await customHandler.extractAttachments('ch', 1, msg);
    expect(result).toBe('Header|${ATTACH:att-001}|Footer');
  });
});
