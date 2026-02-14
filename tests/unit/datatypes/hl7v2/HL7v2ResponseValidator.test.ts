import { HL7v2ResponseValidator } from '../../../../src/datatypes/hl7v2/HL7v2ResponseValidator';
import {
  getDefaultHL7v2ResponseValidationProperties,
} from '../../../../src/datatypes/hl7v2/HL7v2ResponseValidationProperties';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';

function createConnectorMessage(overrides?: Partial<{ status: Status }>): ConnectorMessage {
  return new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel-id',
    channelName: 'Test Channel',
    connectorName: 'Test Destination',
    serverId: 'test-server',
    receivedDate: new Date(),
    status: overrides?.status ?? Status.PENDING,
  });
}

function buildACKMessage(ackCode: string, messageControlId: string = 'MSG001'): string {
  return (
    'MSH|^~\\&|RECEIVING_APP|RECEIVING_FAC|SENDING_APP|SENDING_FAC|20240115120000||ACK|ACK001|P|2.5\r' +
    `MSA|${ackCode}|${messageControlId}\r`
  );
}

describe('HL7v2ResponseValidator', () => {
  describe('default properties', () => {
    it('should have correct defaults', () => {
      const defaults = getDefaultHL7v2ResponseValidationProperties();
      expect(defaults.successfulACKCode).toBe('AA,CA');
      expect(defaults.errorACKCode).toBe('AE,CE');
      expect(defaults.rejectedACKCode).toBe('AR,CR');
      expect(defaults.validateMessageControlId).toBe(false);
      expect(defaults.originalMessageControlId).toBe('');
      expect(defaults.originalIdMapVariable).toBe('');
    });
  });

  describe('successful ACK codes', () => {
    it('AA response should set status to SENT', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('AA');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('CA response should set status to SENT', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('CA');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });
  });

  describe('error ACK codes', () => {
    it('AE response should set status to ERROR', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('AE');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response);
    });

    it('CE response should set status to ERROR', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('CE');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response);
    });
  });

  describe('rejected ACK codes (retry)', () => {
    it('AR response should set status to QUEUED', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('AR');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
      expect(result).toBe(response);
    });

    it('CR response should set status to QUEUED', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('CR');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
      expect(result).toBe(response);
    });
  });

  describe('null and empty responses', () => {
    it('null response should not change status and return null', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();

      const result = validator.validate(null, msg);

      expect(msg.getStatus()).toBe(Status.PENDING);
      expect(result).toBeNull();
    });

    it('empty response should not change status and return empty string', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();

      const result = validator.validate('', msg);

      expect(msg.getStatus()).toBe(Status.PENDING);
      expect(result).toBe('');
    });
  });

  describe('no MSA segment', () => {
    it('response without MSA should not change status', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = 'MSH|^~\\&|APP|FAC||FAC|20240115||ACK|ACK001|P|2.5\r';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.PENDING);
      expect(result).toBe(response);
    });

    it('non-HL7 response should not change status', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = 'HTTP 200 OK';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.PENDING);
      expect(result).toBe(response);
    });
  });

  describe('message control ID validation', () => {
    it('matching message control ID should keep status SENT', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalMessageControlId: 'MSG001',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('AA', 'MSG001');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('mismatched message control ID should set status to ERROR', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalMessageControlId: 'MSG001',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('AA', 'MSG999');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toContain("Expected message control ID 'MSG001'");
      expect(result).toContain("received 'MSG999'");
    });

    it('should look up original ID from map variable', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalIdMapVariable: 'originalControlId',
      });
      const msg = createConnectorMessage();
      msg.getConnectorMap().set('originalControlId', 'MSG001');
      const response = buildACKMessage('AA', 'MSG001');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('should check channelMap for original ID if not in connectorMap', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalIdMapVariable: 'originalControlId',
      });
      const msg = createConnectorMessage();
      msg.getChannelMap().set('originalControlId', 'MSG001');
      const response = buildACKMessage('AA', 'MSG999');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toContain("Expected message control ID 'MSG001'");
    });

    it('should check sourceMap for original ID as last fallback', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalIdMapVariable: 'originalControlId',
      });
      const msg = createConnectorMessage();
      msg.getSourceMap().set('originalControlId', 'MSG001');
      const response = buildACKMessage('AA', 'MSG001');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('should not validate control ID for non-success ACK codes', () => {
      const validator = new HL7v2ResponseValidator({
        validateMessageControlId: true,
        originalMessageControlId: 'MSG001',
      });
      const msg = createConnectorMessage();
      // AE with mismatched ID -- should still be ERROR from ACK code, not control ID check
      const response = buildACKMessage('AE', 'MSG999');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response); // Returns raw response, not control ID error message
    });
  });

  describe('custom ACK codes configuration', () => {
    it('should support custom success codes', () => {
      const validator = new HL7v2ResponseValidator({
        successfulACKCode: 'AA,CA,OK',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('OK');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('should support custom error codes', () => {
      const validator = new HL7v2ResponseValidator({
        errorACKCode: 'AE,CE,FAIL',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('FAIL');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response);
    });

    it('should support custom rejected codes', () => {
      const validator = new HL7v2ResponseValidator({
        rejectedACKCode: 'AR,CR,BUSY',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('BUSY');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
      expect(result).toBe(response);
    });
  });

  describe('case-insensitive ACK code matching', () => {
    it('lowercase ack code should be matched', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('aa');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('mixed case ack code should be matched', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('Ae');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response);
    });

    it('lowercase configured codes should match uppercase response', () => {
      const validator = new HL7v2ResponseValidator({
        successfulACKCode: 'aa,ca',
      });
      const msg = createConnectorMessage();
      const response = buildACKMessage('AA');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });
  });

  describe('edge cases', () => {
    it('ACK code with leading/trailing whitespace should be trimmed', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      // Simulate whitespace around ACK code
      const response =
        'MSH|^~\\&|APP|FAC|APP|FAC|20240115||ACK|ACK001|P|2.5\r' +
        'MSA| AA |MSG001\r';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('unknown ACK code should not change status', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response = buildACKMessage('XX');

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.PENDING);
      expect(result).toBe(response);
    });

    it('response with LF line endings should be parsed', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response =
        'MSH|^~\\&|APP|FAC|APP|FAC|20240115||ACK|ACK001|P|2.5\n' +
        'MSA|AA|MSG001\n';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('response with CRLF line endings should be parsed', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response =
        'MSH|^~\\&|APP|FAC|APP|FAC|20240115||ACK|ACK001|P|2.5\r\n' +
        'MSA|AA|MSG001\r\n';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(result).toBe(response);
    });

    it('MSA segment without message control ID should still validate', () => {
      const validator = new HL7v2ResponseValidator();
      const msg = createConnectorMessage();
      const response =
        'MSH|^~\\&|APP|FAC|APP|FAC|20240115||ACK|ACK001|P|2.5\r' +
        'MSA|AE\r';

      const result = validator.validate(response, msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(result).toBe(response);
    });
  });
});
