import {
  extractMetaData,
  extractMetaDataFromXML,
} from '../../../../src/datatypes/hl7v2/HL7v2MetaData';

describe('HL7v2MetaData', () => {
  describe('extractMetaData', () => {
    it('should extract source from MSH-4', () => {
      const message = 'MSH|^~\\&|APP|SENDING_FACILITY|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('SENDING_FACILITY');
    });

    it('should extract type from MSH-9', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.type).toBe('ADT-A01');
    });

    it('should extract version from MSH-12', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.version).toBe('2.5');
    });

    it('should extract message control ID from MSH-10', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|MSG12345|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.messageControlId).toBe('MSG12345');
    });

    it('should extract processing ID from MSH-11', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.processingId).toBe('P');
    });

    it('should handle single segment message', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBe('ADT-A01');
      expect(metadata.version).toBe('2.5');
    });

    it('should handle newline segment delimiter', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\nPID|1||123\n';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBe('ADT-A01');
    });

    it('should handle CRLF segment delimiter', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r\nPID|1||123\r\n';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBe('ADT-A01');
    });

    it('should handle leading whitespace', () => {
      const message = '   MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
    });

    it('should handle component in source field', () => {
      const message = 'MSH|^~\\&|APP|FAC^SUB1^SUB2|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
    });

    it('should handle message type without trigger event', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC|20240115||ACK|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.type).toBe('ACK');
    });

    it('should return empty metadata for non-HL7 message', () => {
      const message = 'This is not an HL7 message';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBeUndefined();
      expect(metadata.type).toBeUndefined();
      expect(metadata.version).toBeUndefined();
    });

    it('should return empty metadata for PID segment', () => {
      const message = 'PID|1||123456||DOE^JOHN\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBeUndefined();
    });

    it('should handle FHS segment (batch)', () => {
      const message = 'FHS|^~\\&|APP|BATCH_FAC|RECV|RFAC|20240115||BATCH|123|P\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('BATCH_FAC');
      // Version not extracted for FHS
      expect(metadata.version).toBeUndefined();
    });

    it('should handle BHS segment (batch)', () => {
      const message = 'BHS|^~\\&|APP|BATCH_FAC|RECV|RFAC|20240115||BATCH|123|P\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('BATCH_FAC');
    });

    it('should handle custom encoding characters', () => {
      const message = 'MSH#!@%$#APP#FAC#RECV#RFAC#20240115##ADT!A01#123#P#2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBe('ADT-A01');
    });

    it('should handle subcomponents in source field', () => {
      const message = 'MSH|^~\\&|APP|FAC&SUB|RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message, { handleSubcomponents: true });

      expect(metadata.source).toBe('FAC');
    });

    it('should handle empty fields', () => {
      const message = 'MSH|^~\\&|||RECV|RFAC|20240115||ADT^A01|123|P|2.5\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('');
    });

    it('should return partial metadata for incomplete message', () => {
      const message = 'MSH|^~\\&|APP|FAC|RECV|RFAC\r';
      const metadata = extractMetaData(message);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBeUndefined();
    });
  });

  describe('extractMetaDataFromXML', () => {
    it('should extract source from MSH.4.1', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.4><MSH.4.1>SENDING_FACILITY</MSH.4.1></MSH.4>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.source).toBe('SENDING_FACILITY');
    });

    it('should extract source from MSH.4 without component', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.4>FACILITY</MSH.4>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.source).toBe('FACILITY');
    });

    it('should extract type from MSH.9.1 and MSH.9.2', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.9>
            <MSH.9.1>ADT</MSH.9.1>
            <MSH.9.2>A01</MSH.9.2>
          </MSH.9>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.type).toBe('ADT-A01');
    });

    it('should extract type from MSH.9.1 only', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.9>
            <MSH.9.1>ACK</MSH.9.1>
          </MSH.9>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.type).toBe('ACK');
    });

    it('should extract message control ID from MSH.10.1', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.10><MSH.10.1>MSG12345</MSH.10.1></MSH.10>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.messageControlId).toBe('MSG12345');
    });

    it('should extract version from MSH.12.1', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.12><MSH.12.1>2.5</MSH.12.1></MSH.12>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.version).toBe('2.5');
    });

    it('should handle complete XML message', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1>APP</MSH.3.1></MSH.3>
          <MSH.4><MSH.4.1>FAC</MSH.4.1></MSH.4>
          <MSH.5><MSH.5.1>RECV</MSH.5.1></MSH.5>
          <MSH.6><MSH.6.1>RFAC</MSH.6.1></MSH.6>
          <MSH.7><MSH.7.1>20240115</MSH.7.1></MSH.7>
          <MSH.9><MSH.9.1>ADT</MSH.9.1><MSH.9.2>A01</MSH.9.2></MSH.9>
          <MSH.10><MSH.10.1>12345</MSH.10.1></MSH.10>
          <MSH.11><MSH.11.1>P</MSH.11.1></MSH.11>
          <MSH.12><MSH.12.1>2.5</MSH.12.1></MSH.12>
        </MSH>
      </HL7Message>`;
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.source).toBe('FAC');
      expect(metadata.type).toBe('ADT-A01');
      expect(metadata.messageControlId).toBe('12345');
      expect(metadata.version).toBe('2.5');
    });

    it('should return empty metadata for invalid XML', () => {
      const xml = 'not xml';
      const metadata = extractMetaDataFromXML(xml);

      expect(metadata.source).toBeUndefined();
      expect(metadata.type).toBeUndefined();
    });
  });
});
