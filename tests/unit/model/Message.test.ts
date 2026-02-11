import { Message } from '../../../src/model/Message';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { Status } from '../../../src/model/Status';

describe('Message', () => {
  const createTestMessage = (): Message => {
    return new Message({
      messageId: 1,
      serverId: 'test-server',
      channelId: 'test-channel',
      receivedDate: new Date('2024-01-15T10:00:00Z'),
      processed: false,
    });
  };

  const createConnectorMessage = (
    metaDataId: number,
    status: Status = Status.RECEIVED
  ): ConnectorMessage => {
    return new ConnectorMessage({
      messageId: 1,
      metaDataId,
      channelId: 'test-channel',
      channelName: 'Test Channel',
      connectorName: metaDataId === 0 ? 'Source' : `Destination ${metaDataId}`,
      serverId: 'test-server',
      receivedDate: new Date(),
      status,
    });
  };

  describe('constructor', () => {
    it('should create a message with required fields', () => {
      const message = createTestMessage();

      expect(message.getMessageId()).toBe(1);
      expect(message.getServerId()).toBe('test-server');
      expect(message.getChannelId()).toBe('test-channel');
      expect(message.isProcessed()).toBe(false);
    });

    it('should create a message with optional fields', () => {
      const message = new Message({
        messageId: 2,
        serverId: 'test-server',
        channelId: 'test-channel',
        receivedDate: new Date(),
        processed: true,
        originalId: 1,
        importId: 100,
        importChannelId: 'import-channel',
      });

      expect(message.getOriginalId()).toBe(1);
      expect(message.getImportId()).toBe(100);
      expect(message.getImportChannelId()).toBe('import-channel');
    });
  });

  describe('connector messages', () => {
    it('should add and retrieve connector messages', () => {
      const message = createTestMessage();
      const sourceMessage = createConnectorMessage(0);
      const destMessage = createConnectorMessage(1);

      message.setConnectorMessage(0, sourceMessage);
      message.setConnectorMessage(1, destMessage);

      expect(message.getConnectorMessage(0)).toBe(sourceMessage);
      expect(message.getConnectorMessage(1)).toBe(destMessage);
      expect(message.getConnectorMessage(2)).toBeUndefined();
    });

    it('should return source connector message', () => {
      const message = createTestMessage();
      const sourceMessage = createConnectorMessage(0);

      message.setConnectorMessage(0, sourceMessage);

      expect(message.getSourceConnectorMessage()).toBe(sourceMessage);
    });

    it('should return destination connector messages', () => {
      const message = createTestMessage();
      const sourceMessage = createConnectorMessage(0);
      const dest1 = createConnectorMessage(1);
      const dest2 = createConnectorMessage(2);

      message.setConnectorMessage(0, sourceMessage);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const destinations = message.getDestinationConnectorMessages();
      expect(destinations.length).toBe(2);
      expect(destinations).toContain(dest1);
      expect(destinations).toContain(dest2);
    });
  });

  describe('getMergedStatus', () => {
    it('should return RECEIVED when no connector messages', () => {
      const message = createTestMessage();
      expect(message.getMergedStatus()).toBe(Status.RECEIVED);
    });

    it('should return source status when no destinations', () => {
      const message = createTestMessage();
      const sourceMessage = createConnectorMessage(0, Status.TRANSFORMED);
      message.setConnectorMessage(0, sourceMessage);

      expect(message.getMergedStatus()).toBe(Status.TRANSFORMED);
    });

    it('should return ERROR if any destination has ERROR', () => {
      const message = createTestMessage();
      message.setConnectorMessage(0, createConnectorMessage(0, Status.TRANSFORMED));
      message.setConnectorMessage(1, createConnectorMessage(1, Status.SENT));
      message.setConnectorMessage(2, createConnectorMessage(2, Status.ERROR));

      expect(message.getMergedStatus()).toBe(Status.ERROR);
    });

    it('should return SENT if all destinations are SENT', () => {
      const message = createTestMessage();
      message.setConnectorMessage(0, createConnectorMessage(0, Status.TRANSFORMED));
      message.setConnectorMessage(1, createConnectorMessage(1, Status.SENT));
      message.setConnectorMessage(2, createConnectorMessage(2, Status.SENT));

      expect(message.getMergedStatus()).toBe(Status.SENT);
    });

    it('should return QUEUED if any destination is QUEUED', () => {
      const message = createTestMessage();
      message.setConnectorMessage(0, createConnectorMessage(0, Status.TRANSFORMED));
      message.setConnectorMessage(1, createConnectorMessage(1, Status.SENT));
      message.setConnectorMessage(2, createConnectorMessage(2, Status.QUEUED));

      expect(message.getMergedStatus()).toBe(Status.QUEUED);
    });

    it('should return FILTERED if all destinations are FILTERED', () => {
      const message = createTestMessage();
      message.setConnectorMessage(0, createConnectorMessage(0, Status.TRANSFORMED));
      message.setConnectorMessage(1, createConnectorMessage(1, Status.FILTERED));
      message.setConnectorMessage(2, createConnectorMessage(2, Status.FILTERED));

      expect(message.getMergedStatus()).toBe(Status.FILTERED);
    });
  });

  describe('getMergedConnectorMessage', () => {
    it('should merge channelMap from source + all destinations', () => {
      const message = createTestMessage();
      const source = createConnectorMessage(0, Status.TRANSFORMED);
      source.getChannelMap().set('srcKey', 'srcVal');
      source.getChannelMap().set('shared', 'fromSrc');

      const dest1 = createConnectorMessage(1, Status.SENT);
      dest1.getChannelMap().set('d1Key', 'd1Val');
      dest1.getChannelMap().set('shared', 'fromDest1');

      const dest2 = createConnectorMessage(2, Status.SENT);
      dest2.getChannelMap().set('d2Key', 'd2Val');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const merged = message.getMergedConnectorMessage();
      expect(merged.getChannelMap().get('srcKey')).toBe('srcVal');
      expect(merged.getChannelMap().get('d1Key')).toBe('d1Val');
      expect(merged.getChannelMap().get('d2Key')).toBe('d2Val');
      // Later destination overwrites earlier values
      expect(merged.getChannelMap().get('shared')).toBe('fromDest1');
    });

    it('should merge responseMap from source + all destinations', () => {
      const message = createTestMessage();
      const source = createConnectorMessage(0, Status.TRANSFORMED);
      source.getResponseMap().set('Source', 'ack');

      const dest1 = createConnectorMessage(1, Status.SENT);
      dest1.getResponseMap().set('d1', 'http-resp');

      const dest2 = createConnectorMessage(2, Status.SENT);
      dest2.getResponseMap().set('d2', 'file-resp');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const merged = message.getMergedConnectorMessage();
      expect(merged.getResponseMap().get('Source')).toBe('ack');
      expect(merged.getResponseMap().get('d1')).toBe('http-resp');
      expect(merged.getResponseMap().get('d2')).toBe('file-resp');
    });

    it('should use sourceMap from source connector only', () => {
      const message = createTestMessage();
      const source = createConnectorMessage(0, Status.TRANSFORMED);
      source.getSourceMap().set('srcMapKey', 'srcMapVal');

      const dest1 = createConnectorMessage(1, Status.SENT);
      dest1.getSourceMap().set('destSrcKey', 'shouldNotAppear');

      message.setConnectorMessage(0, source);
      message.setConnectorMessage(1, dest1);

      const merged = message.getMergedConnectorMessage();
      expect(merged.getSourceMap().get('srcMapKey')).toBe('srcMapVal');
      expect(merged.getSourceMap().get('destSrcKey')).toBeUndefined();
    });

    it('should build destinationIdMap from connector names', () => {
      const message = createTestMessage();
      message.setConnectorMessage(0, createConnectorMessage(0, Status.TRANSFORMED));

      const dest1 = new ConnectorMessage({
        messageId: 1, metaDataId: 1, channelId: 'test-channel',
        channelName: 'Test Channel', connectorName: 'HTTP Sender',
        serverId: 'test-server', receivedDate: new Date(), status: Status.SENT,
      });
      const dest2 = new ConnectorMessage({
        messageId: 1, metaDataId: 2, channelId: 'test-channel',
        channelName: 'Test Channel', connectorName: 'File Writer',
        serverId: 'test-server', receivedDate: new Date(), status: Status.SENT,
      });

      message.setConnectorMessage(1, dest1);
      message.setConnectorMessage(2, dest2);

      const merged = message.getMergedConnectorMessage();
      const destIdMap = merged.getDestinationIdMap();
      expect(destIdMap).toBeDefined();
      expect(destIdMap!.get('HTTP Sender')).toBe(1);
      expect(destIdMap!.get('File Writer')).toBe(2);
    });

    it('should handle message with no connector messages', () => {
      const message = createTestMessage();
      const merged = message.getMergedConnectorMessage();
      expect(merged.getChannelId()).toBe('test-channel');
      expect(merged.getSourceMap().size).toBe(0);
      expect(merged.getChannelMap().size).toBe(0);
      expect(merged.getResponseMap().size).toBe(0);
    });

    it('should handle message with source only (no destinations)', () => {
      const message = createTestMessage();
      const source = createConnectorMessage(0, Status.TRANSFORMED);
      source.getChannelMap().set('key', 'val');
      message.setConnectorMessage(0, source);

      const merged = message.getMergedConnectorMessage();
      expect(merged.getChannelMap().get('key')).toBe('val');
      expect(merged.getDestinationIdMap()?.size).toBe(0);
    });

    it('should use sourceMap from first destination if no source', () => {
      const message = createTestMessage();
      const dest1 = createConnectorMessage(1, Status.SENT);
      dest1.getSourceMap().set('fromDest', 'val');
      message.setConnectorMessage(1, dest1);

      const merged = message.getMergedConnectorMessage();
      expect(merged.getSourceMap().get('fromDest')).toBe('val');
    });

    it('should merge destinations in metaDataId order', () => {
      const message = createTestMessage();
      const source = createConnectorMessage(0, Status.TRANSFORMED);
      message.setConnectorMessage(0, source);

      // Add in reverse order to verify sorting
      const dest3 = createConnectorMessage(3, Status.SENT);
      dest3.getChannelMap().set('order', 'third');
      message.setConnectorMessage(3, dest3);

      const dest1 = createConnectorMessage(1, Status.SENT);
      dest1.getChannelMap().set('order', 'first');
      message.setConnectorMessage(1, dest1);

      const dest2 = createConnectorMessage(2, Status.SENT);
      dest2.getChannelMap().set('order', 'second');
      message.setConnectorMessage(2, dest2);

      const merged = message.getMergedConnectorMessage();
      // Last writer wins — dest3 (metaDataId 3) writes last
      expect(merged.getChannelMap().get('order')).toBe('third');
    });
  });

  describe('setProcessed', () => {
    it('should update processed status', () => {
      const message = createTestMessage();
      expect(message.isProcessed()).toBe(false);

      message.setProcessed(true);
      expect(message.isProcessed()).toBe(true);
    });
  });
});
