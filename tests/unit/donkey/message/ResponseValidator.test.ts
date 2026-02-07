import { describe, it, expect } from '@jest/globals';
import { DefaultResponseValidator } from '../../../../src/donkey/message/ResponseValidator.js';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage.js';
import { Status } from '../../../../src/model/Status.js';

/**
 * Minimal concrete subclass for testing DestinationConnector's
 * responseValidator getter/setter.
 */
class TestDestinationConnector extends DestinationConnector {
  async send(_msg: ConnectorMessage): Promise<void> {}
  async getResponse(_msg: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

function createConnectorMessage(status: Status = Status.RECEIVED): ConnectorMessage {
  return new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Test Destination',
    serverId: 'test-server',
    receivedDate: new Date(),
    status,
  });
}

describe('DefaultResponseValidator', () => {
  const validator = new DefaultResponseValidator();

  it('should return null when given null response', () => {
    const msg = createConnectorMessage();
    const result = validator.validate(null, msg);
    expect(result).toBeNull();
  });

  it('should return the response string unchanged', () => {
    const msg = createConnectorMessage();
    const response = 'MSH|^~\\&|ACK|FACILITY||';
    const result = validator.validate(response, msg);
    expect(result).toBe(response);
  });

  it('should not modify connector message status', () => {
    const msg = createConnectorMessage(Status.SENT);
    validator.validate('some response', msg);
    expect(msg.getStatus()).toBe(Status.SENT);
  });

  it('should handle empty string response', () => {
    const msg = createConnectorMessage();
    const result = validator.validate('', msg);
    expect(result).toBe('');
  });
});

describe('DestinationConnector responseValidator', () => {
  it('should default to null', () => {
    const connector = new TestDestinationConnector({
      name: 'Test',
      metaDataId: 1,
      transportName: 'Test',
    });
    expect(connector.getResponseValidator()).toBeNull();
  });

  it('should store and return responseValidator via getter/setter', () => {
    const connector = new TestDestinationConnector({
      name: 'Test',
      metaDataId: 1,
      transportName: 'Test',
    });
    const validator = new DefaultResponseValidator();
    connector.setResponseValidator(validator);
    expect(connector.getResponseValidator()).toBe(validator);
  });
});
