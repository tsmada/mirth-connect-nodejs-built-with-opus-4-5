import {
  HL7v2ACKGenerator,
  AckCode,
  generateAck,
  generateNak,
} from '../../../../src/datatypes/hl7v2/HL7v2ACKGenerator';

describe('HL7v2ACKGenerator', () => {
  const sampleMessage =
    'MSH|^~\\&|SENDING_APP|SENDING_FAC|RECEIVING_APP|RECEIVING_FAC|20240115120000||ADT^A01|MSG001|P|2.5\r' +
    'PID|1||123456||DOE^JOHN||19800101|M\r';

  describe('AckCode enum', () => {
    it('should have correct values', () => {
      expect(AckCode.AA).toBe('AA');
      expect(AckCode.AE).toBe('AE');
      expect(AckCode.AR).toBe('AR');
      expect(AckCode.CA).toBe('CA');
      expect(AckCode.CE).toBe('CE');
      expect(AckCode.CR).toBe('CR');
    });
  });

  describe('generateAck static method', () => {
    it('should generate ACK with AA code by default', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage);

      expect(ack).toContain('MSH|^~\\&|');
      expect(ack).toContain('MSA|AA|MSG001');
      expect(ack).toContain('|ACK');
    });

    it('should swap sending and receiving applications', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage);

      // In ACK, the original receiving app becomes the sending app
      expect(ack).toContain('|RECEIVING_APP|RECEIVING_FAC|SENDING_APP|SENDING_FAC|');
    });

    it('should include original message control ID', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage);

      expect(ack).toContain('|MSG001');
    });

    it('should support custom ACK code', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage, {
        ackCode: AckCode.AE,
      });

      expect(ack).toContain('MSA|AE|MSG001');
    });

    it('should support text message', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage, {
        textMessage: 'Message accepted',
      });

      expect(ack).toContain('MSA|AA|MSG001|Message accepted');
    });

    it('should support error message (ERR segment)', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage, {
        ackCode: AckCode.AE,
        errorMessage: 'Invalid patient ID',
      });

      expect(ack).toContain('ERR|Invalid patient ID');
    });

    it('should support custom segment delimiter', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage, {
        segmentDelimiter: '\n',
      });

      expect(ack).toContain('MSH|');
      expect(ack).toContain('\nMSA|');
    });

    it('should preserve version from original message', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage);

      expect(ack).toContain('|2.5\r');
    });

    it('should include event type for HL7 2.4+', () => {
      const ack = HL7v2ACKGenerator.generateAck(sampleMessage);

      // For 2.4+, ACK^event^ACK format
      expect(ack).toContain('|ACK^A01^ACK|');
    });

    it('should not include event type for HL7 2.3', () => {
      const v23Message =
        'MSH|^~\\&|SEND|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.3\r';
      const ack = HL7v2ACKGenerator.generateAck(v23Message);

      // For 2.3, just ACK
      expect(ack).toMatch(/\|ACK\|/);
    });

    it('should throw for null/empty message', () => {
      expect(() => HL7v2ACKGenerator.generateAck('')).toThrow('NULL or too short');
    });

    it('should throw for too short message', () => {
      expect(() => HL7v2ACKGenerator.generateAck('MSH|^')).toThrow('NULL or too short');
    });

    it('should use default values for missing fields', () => {
      const minimalMessage = 'MSH|^~\\&|SEND||RECV|||ADT^A01\r';
      const ack = HL7v2ACKGenerator.generateAck(minimalMessage);

      // Should use defaults
      expect(ack).toContain('MSA|AA|');
      expect(ack).toContain('|P|'); // Default processing ID
      expect(ack).toContain('|2.4'); // Default version
    });

    it('should handle processing ID mode', () => {
      const message = 'MSH|^~\\&|S|F|R|RF|20240115||ADT^A01|123|P^T|2.5\r';
      const ack = HL7v2ACKGenerator.generateAck(message);

      expect(ack).toContain('|P^T|');
    });

    it('should handle custom encoding characters', () => {
      const customMessage = 'MSH#!@%$#SEND#FAC#RECV#RFAC#20240115##ADT!A01#123#P#2.5\r';
      const ack = HL7v2ACKGenerator.generateAck(customMessage);

      expect(ack).toContain('MSH#!@%$#');
      expect(ack).toContain('MSA#AA#123');
    });

    it('should handle message without segment delimiter', () => {
      const singleLine = 'MSH|^~\\&|SEND|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5';
      const ack = HL7v2ACKGenerator.generateAck(singleLine);

      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|123');
    });
  });

  describe('generateAck convenience function', () => {
    it('should generate ACK with default AA code', () => {
      const ack = generateAck(sampleMessage);

      expect(ack).toContain('MSA|AA|MSG001');
    });

    it('should accept custom ACK code', () => {
      const ack = generateAck(sampleMessage, AckCode.AE);

      expect(ack).toContain('MSA|AE|MSG001');
    });

    it('should accept text message', () => {
      const ack = generateAck(sampleMessage, AckCode.AA, 'Success');

      expect(ack).toContain('MSA|AA|MSG001|Success');
    });
  });

  describe('generateNak convenience function', () => {
    it('should generate NAK with AE code', () => {
      const nak = generateNak(sampleMessage);

      expect(nak).toContain('MSA|AE|MSG001');
    });

    it('should include error message', () => {
      const nak = generateNak(sampleMessage, 'Validation failed');

      expect(nak).toContain('ERR|Validation failed');
    });

    it('should include text message', () => {
      const nak = generateNak(sampleMessage, 'Error', 'Processing error');

      expect(nak).toContain('MSA|AE|MSG001|Processing error');
      expect(nak).toContain('ERR|Error');
    });
  });
});
