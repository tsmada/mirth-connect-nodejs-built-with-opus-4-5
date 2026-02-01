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

  describe('setProcessed', () => {
    it('should update processed status', () => {
      const message = createTestMessage();
      expect(message.isProcessed()).toBe(false);

      message.setProcessed(true);
      expect(message.isProcessed()).toBe(true);
    });
  });
});
