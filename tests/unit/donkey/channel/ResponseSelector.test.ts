import {
  ResponseSelector,
  DefaultAutoResponder,
  RESPONSE_NONE,
  RESPONSE_AUTO_BEFORE,
  RESPONSE_SOURCE_TRANSFORMED,
  RESPONSE_DESTINATIONS_COMPLETED,
  RESPONSE_STATUS_PRECEDENCE,
} from '../../../../src/donkey/channel/ResponseSelector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message, MessageData } from '../../../../src/model/Message';
import { Response } from '../../../../src/model/Response';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';

function createSourceMessage(messageId: number): ConnectorMessage {
  const message = new ConnectorMessage({
    messageId,
    metaDataId: 0,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Source',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.TRANSFORMED,
  });

  message.setContent({
    contentType: ContentType.RAW,
    content: '<test>message</test>',
    dataType: 'XML',
    encrypted: false,
  });

  return message;
}

function createDestinationMessage(messageId: number, metaDataId: number, status: Status): ConnectorMessage {
  return new ConnectorMessage({
    messageId,
    metaDataId,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: `Destination ${metaDataId}`,
    serverId: 'server-1',
    receivedDate: new Date(),
    status,
  });
}

function createMessage(messageId: number): Message {
  const messageData: MessageData = {
    messageId,
    serverId: 'server-1',
    channelId: 'test-channel',
    receivedDate: new Date(),
    processed: false,
  };

  return new Message(messageData);
}

describe('ResponseSelector', () => {
  let selector: ResponseSelector;

  beforeEach(() => {
    selector = new ResponseSelector();
  });

  describe('constructor', () => {
    it('should create with default auto responder', () => {
      expect(selector.getAutoResponder()).toBeInstanceOf(DefaultAutoResponder);
    });

    it('should accept custom auto responder', () => {
      const customResponder = new DefaultAutoResponder();
      const customSelector = new ResponseSelector(customResponder);
      expect(customSelector.getAutoResponder()).toBe(customResponder);
    });
  });

  describe('setNumDestinations', () => {
    it('should set number of destinations', () => {
      selector.setNumDestinations(3);
      // Used for DESTINATIONS_COMPLETED response
    });
  });

  describe('respondFromName', () => {
    it('should get and set respond from name', () => {
      selector.setRespondFromName('d1');
      expect(selector.getRespondFromName()).toBe('d1');
    });
  });

  describe('canRespond', () => {
    it('should return false when respondFromName is null', () => {
      expect(selector.canRespond()).toBe(false);
    });

    it('should return false when respondFromName is RESPONSE_NONE', () => {
      selector.setRespondFromName(RESPONSE_NONE);
      expect(selector.canRespond()).toBe(false);
    });

    it('should return true for valid response modes', () => {
      selector.setRespondFromName(RESPONSE_AUTO_BEFORE);
      expect(selector.canRespond()).toBe(true);
    });
  });

  describe('getResponse', () => {
    it('should return null when respondFromName is null', () => {
      const sourceMessage = createSourceMessage(1);
      const message = createMessage(1);
      message.setConnectorMessage(0, sourceMessage);

      const response = selector.getResponse(sourceMessage, message);
      expect(response).toBeNull();
    });

    describe('RESPONSE_AUTO_BEFORE', () => {
      it('should return RECEIVED status response', () => {
        selector.setRespondFromName(RESPONSE_AUTO_BEFORE);

        const sourceMessage = createSourceMessage(1);
        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);

        expect(response).toBeDefined();
        expect(response?.getStatus()).toBe(Status.RECEIVED);
      });
    });

    describe('RESPONSE_SOURCE_TRANSFORMED', () => {
      it('should return response based on source status', () => {
        selector.setRespondFromName(RESPONSE_SOURCE_TRANSFORMED);

        const sourceMessage = createSourceMessage(1);
        sourceMessage.setStatus(Status.TRANSFORMED);
        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);

        expect(response).toBeDefined();
        expect(response?.getStatus()).toBe(Status.TRANSFORMED);
      });

      it('should return ERROR status when source has error', () => {
        selector.setRespondFromName(RESPONSE_SOURCE_TRANSFORMED);

        const sourceMessage = createSourceMessage(1);
        sourceMessage.setStatus(Status.ERROR);
        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);

        expect(response?.getStatus()).toBe(Status.ERROR);
      });
    });

    describe('RESPONSE_DESTINATIONS_COMPLETED', () => {
      it('should return SENT when all destinations successful', () => {
        selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
        selector.setNumDestinations(2);

        const sourceMessage = createSourceMessage(1);
        const destMessage1 = createDestinationMessage(1, 1, Status.SENT);
        const destMessage2 = createDestinationMessage(1, 2, Status.SENT);

        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);
        message.setConnectorMessage(1, destMessage1);
        message.setConnectorMessage(2, destMessage2);

        const response = selector.getResponse(sourceMessage, message);

        expect(response?.getStatus()).toBe(Status.SENT);
      });

      it('should return ERROR when not all destinations processed', () => {
        selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
        selector.setNumDestinations(3);

        const sourceMessage = createSourceMessage(1);
        const destMessage1 = createDestinationMessage(1, 1, Status.SENT);
        // Only 1 destination message but expecting 3

        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);
        message.setConnectorMessage(1, destMessage1);

        const response = selector.getResponse(sourceMessage, message);

        expect(response?.getStatus()).toBe(Status.ERROR);
      });

      it('should return highest precedence status from destinations', () => {
        selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
        selector.setNumDestinations(2);

        const sourceMessage = createSourceMessage(1);
        const destMessage1 = createDestinationMessage(1, 1, Status.SENT);
        const destMessage2 = createDestinationMessage(1, 2, Status.ERROR); // ERROR has higher precedence

        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);
        message.setConnectorMessage(1, destMessage1);
        message.setConnectorMessage(2, destMessage2);

        const response = selector.getResponse(sourceMessage, message);

        expect(response?.getStatus()).toBe(Status.ERROR);
      });
    });

    describe('named response from response map', () => {
      it('should return Response object from response map', () => {
        selector.setRespondFromName('customResponse');

        const sourceMessage = createSourceMessage(1);
        const expectedResponse = Response.sent('Custom ACK');
        sourceMessage.getResponseMap().set('customResponse', expectedResponse);

        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);

        expect(response).toBe(expectedResponse);
      });

      it('should convert non-Response to Response', () => {
        selector.setRespondFromName('stringResponse');

        const sourceMessage = createSourceMessage(1);
        sourceMessage.getResponseMap().set('stringResponse', 'Just a string');

        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);

        expect(response?.getStatus()).toBe(Status.SENT);
        expect(response?.getMessage()).toBe('Just a string');
      });

      it('should return null when response not in map', () => {
        selector.setRespondFromName('nonexistent');

        const sourceMessage = createSourceMessage(1);
        const message = createMessage(1);
        message.setConnectorMessage(0, sourceMessage);

        const response = selector.getResponse(sourceMessage, message);
        expect(response).toBeNull();
      });
    });
  });

  describe('RESPONSE_STATUS_PRECEDENCE', () => {
    it('should have ERROR as highest precedence', () => {
      const errorIndex = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.ERROR);
      const sentIndex = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.SENT);
      expect(errorIndex).toBeGreaterThan(sentIndex);
    });

    it('should include FILTERED, QUEUED, SENT, ERROR', () => {
      expect(RESPONSE_STATUS_PRECEDENCE).toContain(Status.FILTERED);
      expect(RESPONSE_STATUS_PRECEDENCE).toContain(Status.QUEUED);
      expect(RESPONSE_STATUS_PRECEDENCE).toContain(Status.SENT);
      expect(RESPONSE_STATUS_PRECEDENCE).toContain(Status.ERROR);
    });
  });

  describe('getStatusPrecedence', () => {
    it('should return higher value for higher precedence status', () => {
      const errorPrecedence = ResponseSelector.getStatusPrecedence(Status.ERROR);
      const sentPrecedence = ResponseSelector.getStatusPrecedence(Status.SENT);

      expect(errorPrecedence).toBeDefined();
      expect(sentPrecedence).toBeDefined();
      expect(errorPrecedence!).toBeGreaterThan(sentPrecedence!);
    });

    it('should return undefined for untracked status', () => {
      const precedence = ResponseSelector.getStatusPrecedence(Status.RECEIVED);
      expect(precedence).toBeUndefined();
    });
  });
});

describe('DefaultAutoResponder', () => {
  let responder: DefaultAutoResponder;
  let message: ConnectorMessage;

  beforeEach(() => {
    responder = new DefaultAutoResponder();
    message = createSourceMessage(1);
  });

  it('should generate RECEIVED response', () => {
    const response = responder.getResponse(Status.RECEIVED, 'raw', message);
    expect(response.getStatus()).toBe(Status.RECEIVED);
  });

  it('should generate FILTERED response', () => {
    const response = responder.getResponse(Status.FILTERED, 'raw', message);
    expect(response.getStatus()).toBe(Status.FILTERED);
  });

  it('should generate SENT response', () => {
    const response = responder.getResponse(Status.SENT, 'raw', message);
    expect(response.getStatus()).toBe(Status.SENT);
  });

  it('should generate ERROR response', () => {
    const response = responder.getResponse(Status.ERROR, 'raw', message);
    expect(response.getStatus()).toBe(Status.ERROR);
  });

  it('should generate QUEUED response', () => {
    const response = responder.getResponse(Status.QUEUED, 'raw', message);
    expect(response.getStatus()).toBe(Status.QUEUED);
  });
});
