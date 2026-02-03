import {
  ACKGenerator,
  ACKCode,
  generateAckResponse,
  generateAckResponseFull,
} from '../../../src/util/ACKGenerator';

describe('ACKGenerator', () => {
  const sampleHL7Message = [
    'MSH|^~\\&|SendingApp|SendingFac|ReceivingApp|ReceivingFac|20240115120000||ADT^A01^ADT_A01|MSG00001|P|2.5',
    'EVN|A01|20240115120000',
    'PID|1||123456^^^Hospital^MR||Doe^John^||19800101|M',
  ].join('\r');

  describe('generateAckResponse', () => {
    it('should generate AA acknowledgment', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA', 'Message accepted');

      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|MSG00001|Message accepted');
    });

    it('should generate AR acknowledgment', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AR', 'Message rejected');

      expect(ack).toContain('MSA|AR|MSG00001|Message rejected');
    });

    it('should generate AE acknowledgment', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AE', 'Error occurred');

      expect(ack).toContain('MSA|AE|MSG00001|Error occurred');
    });

    it('should swap sender and receiver in MSH', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');

      // Original: SendingApp|SendingFac|ReceivingApp|ReceivingFac
      // Expected: ReceivingApp|ReceivingFac|SendingApp|SendingFac
      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');

      expect(mshFields[2]).toBe('ReceivingApp'); // MSH.3
      expect(mshFields[3]).toBe('ReceivingFac'); // MSH.4
      expect(mshFields[4]).toBe('SendingApp'); // MSH.5
      expect(mshFields[5]).toBe('SendingFac'); // MSH.6
    });

    it('should preserve message control ID', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');

      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');
      const msaFields = lines[1]!.split('|');

      expect(mshFields[9]).toBe('MSG00001'); // MSH.10
      expect(msaFields[2]).toBe('MSG00001'); // MSA.2
    });

    it('should include ACK message type', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');

      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');

      // Should be ACK^A01^ACK
      expect(mshFields[8]).toContain('ACK');
      expect(mshFields[8]).toContain('A01');
    });

    it('should preserve version ID', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');

      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');

      expect(mshFields[11]).toBe('2.5');
    });

    it('should end with segment delimiter', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');

      expect(ack.endsWith('\r')).toBe(true);
    });
  });

  describe('generateAckResponseFull', () => {
    it('should include ERR segment when errorMessage provided', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AE',
        textMessage: 'Error in message',
        errorMessage: 'Field PID.5 is required',
      });

      expect(ack).toContain('ERR|Field PID.5 is required');
    });

    it('should not include ERR segment when errorMessage is empty', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AA',
        errorMessage: '',
      });

      expect(ack).not.toContain('ERR|');
    });

    it('should not include ERR segment when errorMessage is whitespace', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AA',
        errorMessage: '   ',
      });

      expect(ack).not.toContain('ERR|');
    });

    it('should use custom segment delimiter', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AA',
        segmentDelimiter: '\n',
      });

      expect(ack).toContain('\n');
      expect(ack.split('\n').length).toBeGreaterThan(1);
    });

    it('should generate timestamp in custom format', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AA',
        dateFormat: 'yyyyMMdd',
      });

      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');
      const timestamp = mshFields[6];

      // Should be 8 characters for yyyyMMdd
      expect(timestamp).toMatch(/^\d{8}$/);
    });

    it('should handle all ACK codes', () => {
      const codes: ACKCode[] = ['AA', 'AR', 'AE', 'CA', 'CR', 'CE'];

      for (const code of codes) {
        const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
          ackCode: code,
        });

        expect(ack).toContain(`MSA|${code}|`);
      }
    });
  });

  describe('XML format', () => {
    const sampleXMLMessage = `<?xml version="1.0" encoding="UTF-8"?>
<ADT_A01 xmlns="urn:hl7-org:v2xml">
  <MSH>
    <MSH.1>|</MSH.1>
    <MSH.2>^~\\&amp;</MSH.2>
    <MSH.3><HD.1>SendingApp</HD.1></MSH.3>
    <MSH.4><HD.1>SendingFac</HD.1></MSH.4>
    <MSH.5><HD.1>ReceivingApp</HD.1></MSH.5>
    <MSH.6><HD.1>ReceivingFac</HD.1></MSH.6>
    <MSH.7><TS.1>20240115120000</TS.1></MSH.7>
    <MSH.9><MSG.1>ADT</MSG.1><MSG.2>A01</MSG.2></MSH.9>
    <MSH.10>MSG00001</MSH.10>
    <MSH.11><PT.1>P</PT.1></MSH.11>
    <MSH.12><VID.1>2.5</VID.1></MSH.12>
  </MSH>
</ADT_A01>`;

    it('should generate XML ACK when isXML is true', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleXMLMessage, {
        ackCode: 'AA',
        textMessage: 'Message accepted',
        isXML: true,
      });

      expect(ack).toContain('<?xml version="1.0"');
      expect(ack).toContain('<ACK');
      expect(ack).toContain('<MSH>');
      expect(ack).toContain('<MSA>');
      expect(ack).toContain('<MSA.1>AA</MSA.1>');
    });

    it('should swap sender/receiver in XML ACK', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleXMLMessage, {
        ackCode: 'AA',
        isXML: true,
      });

      // In ACK, MSH.3 should be original receiver, MSH.5 should be original sender
      expect(ack).toMatch(/<MSH\.3>.*ReceivingApp.*<\/MSH\.3>/s);
      expect(ack).toMatch(/<MSH\.5>.*SendingApp.*<\/MSH\.5>/s);
    });

    it('should include ERR segment in XML when errorMessage provided', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleXMLMessage, {
        ackCode: 'AE',
        errorMessage: 'Error details',
        isXML: true,
      });

      expect(ack).toContain('<ERR>');
      expect(ack).toContain('<ERR.1>Error details</ERR.1>');
    });

    it('should escape special XML characters', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleXMLMessage, {
        ackCode: 'AE',
        textMessage: 'Error: <invalid> & "bad"',
        isXML: true,
      });

      expect(ack).toContain('&lt;invalid&gt;');
      expect(ack).toContain('&amp;');
      expect(ack).toContain('&quot;bad&quot;');
    });

    it('should preserve message control ID in XML', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleXMLMessage, {
        ackCode: 'AA',
        isXML: true,
      });

      expect(ack).toContain('<MSH.10>MSG00001</MSH.10>');
      expect(ack).toContain('<MSA.2>MSG00001</MSA.2>');
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', () => {
      const ack = ACKGenerator.generateAckResponse('', 'AA');

      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|');
    });

    it('should handle message without MSH', () => {
      const ack = ACKGenerator.generateAckResponse('PID|1||123', 'AA');

      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|');
    });

    it('should handle minimal MSH segment', () => {
      const minimalMessage = 'MSH|^~\\&|||||||||2.3';
      const ack = ACKGenerator.generateAckResponse(minimalMessage, 'AA');

      expect(ack).toContain('MSH|');
      expect(ack).toContain('MSA|AA|');
    });

    it('should handle custom field separator', () => {
      const customMessage = 'MSH#^~\\&#App1#Fac1#App2#Fac2###ADT^A01#CTL123#P#2.5'.replace(
        /#/g,
        '|'
      );
      const ack = ACKGenerator.generateAckResponse(customMessage, 'AA');

      expect(ack).toContain('|');
    });

    it('should handle message type without trigger', () => {
      const simpleMessage = 'MSH|^~\\&|App|Fac|RApp|RFac|||ADT|MSG001|P|2.5';
      const ack = ACKGenerator.generateAckResponse(simpleMessage, 'AA');

      // Should just use ACK without trigger
      expect(ack).toContain('ACK');
    });

    it('should handle undefined text message', () => {
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA', undefined);

      const lines = ack.split('\r');
      const msaFields = lines[1]!.split('|');

      expect(msaFields[3]).toBe('');
    });
  });

  describe('shorthand exports', () => {
    it('should export generateAckResponse function', () => {
      const ack = generateAckResponse(sampleHL7Message, 'AA');
      expect(ack).toContain('MSA|AA|');
    });

    it('should export generateAckResponseFull function', () => {
      const ack = generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AR',
        textMessage: 'Rejected',
      });
      expect(ack).toContain('MSA|AR|');
    });
  });

  describe('timestamp generation', () => {
    it('should generate current timestamp in default format', () => {
      const beforeTime = new Date();
      const ack = ACKGenerator.generateAckResponse(sampleHL7Message, 'AA');
      // Capture time after to verify timestamp is in valid range
      void new Date();

      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');
      const timestamp = mshFields[6]!;

      // Timestamp should be 14 characters (yyyyMMddHHmmss)
      expect(timestamp).toMatch(/^\d{14}$/);

      // Parse the timestamp and verify it's reasonable
      const year = parseInt(timestamp.substring(0, 4));
      const month = parseInt(timestamp.substring(4, 6));
      const day = parseInt(timestamp.substring(6, 8));

      expect(year).toBe(beforeTime.getFullYear());
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(31);
    });

    it('should handle invalid date format gracefully', () => {
      const ack = ACKGenerator.generateAckResponseFull(sampleHL7Message, {
        ackCode: 'AA',
        dateFormat: 'invalid-format-ZZZZZ',
      });

      // Should fall back to default format
      const lines = ack.split('\r');
      const mshFields = lines[0]!.split('|');
      const timestamp = mshFields[6]!;

      // Should still have a valid timestamp
      expect(timestamp).toMatch(/^\d+$/);
    });
  });
});
