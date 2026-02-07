import { ConnectorMessage } from '../../../src/model/ConnectorMessage.js';
import { Status } from '../../../src/model/Status.js';

function makeMessage(overrides: Partial<{ status: Status }> = {}): ConnectorMessage {
  return new ConnectorMessage({
    messageId: 1,
    metaDataId: 0,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'Source',
    serverId: 'node-1',
    receivedDate: new Date(),
    status: overrides.status ?? Status.RECEIVED,
  });
}

describe('ConnectorMessage', () => {
  describe('responseError getter/setter', () => {
    it('should return undefined when no response error is set', () => {
      const msg = makeMessage();
      expect(msg.getResponseError()).toBeUndefined();
    });

    it('should store and return the response error', () => {
      const msg = makeMessage();
      msg.setResponseError('Response timeout');
      expect(msg.getResponseError()).toBe('Response timeout');
    });
  });

  describe('updateErrorCode()', () => {
    it('should return 0 when no errors are set', () => {
      const msg = makeMessage();
      expect(msg.updateErrorCode()).toBe(0);
      expect(msg.getErrorCode()).toBe(0);
    });

    it('should return 1 (bit 0) for processing error only', () => {
      const msg = makeMessage();
      msg.setProcessingError('processing failed');
      expect(msg.updateErrorCode()).toBe(1);
      expect(msg.getErrorCode()).toBe(1);
    });

    it('should return 2 (bit 1) for postprocessor error only', () => {
      const msg = makeMessage();
      msg.setPostProcessorError('postprocessor failed');
      expect(msg.updateErrorCode()).toBe(2);
      expect(msg.getErrorCode()).toBe(2);
    });

    it('should return 4 (bit 2) for response error only', () => {
      const msg = makeMessage();
      msg.setResponseError('response failed');
      expect(msg.updateErrorCode()).toBe(4);
      expect(msg.getErrorCode()).toBe(4);
    });

    it('should return 3 (bits 0+1) for processing + postprocessor errors', () => {
      const msg = makeMessage();
      msg.setProcessingError('processing failed');
      msg.setPostProcessorError('postprocessor failed');
      expect(msg.updateErrorCode()).toBe(3);
    });

    it('should return 5 (bits 0+2) for processing + response errors', () => {
      const msg = makeMessage();
      msg.setProcessingError('processing failed');
      msg.setResponseError('response failed');
      expect(msg.updateErrorCode()).toBe(5);
    });

    it('should return 6 (bits 1+2) for postprocessor + response errors', () => {
      const msg = makeMessage();
      msg.setPostProcessorError('postprocessor failed');
      msg.setResponseError('response failed');
      expect(msg.updateErrorCode()).toBe(6);
    });

    it('should return 7 (bits 0+1+2) for all three errors', () => {
      const msg = makeMessage();
      msg.setProcessingError('processing failed');
      msg.setPostProcessorError('postprocessor failed');
      msg.setResponseError('response failed');
      expect(msg.updateErrorCode()).toBe(7);
    });

    it('should update the errorCode field accessible via getErrorCode()', () => {
      const msg = makeMessage();
      expect(msg.getErrorCode()).toBeUndefined();
      msg.setProcessingError('error');
      msg.updateErrorCode();
      expect(msg.getErrorCode()).toBe(1);
    });
  });

  describe('clone()', () => {
    it('should copy channelMap to clone', () => {
      const msg = makeMessage();
      msg.getChannelMap().set('key1', 'value1');
      const clone = msg.clone(1, 'Dest 1');
      expect(clone.getChannelMap().get('key1')).toBe('value1');
    });

    it('should copy sourceMap to clone', () => {
      const msg = makeMessage();
      msg.getSourceMap().set('sourceKey', 'sourceValue');
      const clone = msg.clone(1, 'Dest 1');
      expect(clone.getSourceMap().get('sourceKey')).toBe('sourceValue');
    });

    it('should copy responseMap to clone', () => {
      const msg = makeMessage();
      msg.getResponseMap().set('respKey', 'respValue');
      const clone = msg.clone(1, 'Dest 1');
      expect(clone.getResponseMap().get('respKey')).toBe('respValue');
    });

    it('should set correct metaDataId and connectorName', () => {
      const msg = makeMessage();
      const clone = msg.clone(3, 'My Destination');
      expect(clone.getMetaDataId()).toBe(3);
      expect(clone.getConnectorName()).toBe('My Destination');
    });

    it('should set status to RECEIVED', () => {
      const msg = makeMessage({ status: Status.SENT });
      const clone = msg.clone(1, 'Dest');
      expect(clone.getStatus()).toBe(Status.RECEIVED);
    });
  });
});
