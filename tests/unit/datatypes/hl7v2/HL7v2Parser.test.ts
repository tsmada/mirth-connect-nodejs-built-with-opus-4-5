import {
  HL7v2Parser,
  parseER7ToXML,
  MESSAGE_ROOT_ID,
} from '../../../../src/datatypes/hl7v2/HL7v2Parser';

describe('HL7v2Parser', () => {
  describe('constructor', () => {
    it('should create parser with default properties', () => {
      const parser = new HL7v2Parser();
      expect(parser).toBeDefined();
    });

    it('should create parser with custom properties', () => {
      const parser = new HL7v2Parser({
        handleRepetitions: false,
        handleSubcomponents: false,
      });
      expect(parser).toBeDefined();
    });
  });

  describe('parse', () => {
    it('should parse simple MSH segment', () => {
      const message = 'MSH|^~\\&|SENDER|FACILITY|RECEIVER|RECFAC|20240115120000||ADT^A01|12345|P|2.5\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain(`<${MESSAGE_ROOT_ID}>`);
      expect(xml).toContain('<MSH>');
      expect(xml).toContain('<MSH.1>|</MSH.1>');
      expect(xml).toContain('<MSH.2>^~\\&amp;</MSH.2>');
      expect(xml).toContain('<MSH.3>');
      expect(xml).toContain('SENDER');
      expect(xml).toContain('</MSH>');
      expect(xml).toContain(`</${MESSAGE_ROOT_ID}>`);
    });

    it('should parse message with multiple segments', () => {
      const message =
        'MSH|^~\\&|SENDER|FACILITY|RECEIVER|RECFAC|20240115120000||ADT^A01|12345|P|2.5\r' +
        'PID|1||123456||DOE^JOHN||19800101|M\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<MSH>');
      expect(xml).toContain('</MSH>');
      expect(xml).toContain('<PID>');
      expect(xml).toContain('<PID.1>');
      expect(xml).toContain('123456');
      expect(xml).toContain('DOE');
      expect(xml).toContain('JOHN');
      expect(xml).toContain('</PID>');
    });

    it('should parse components with ^', () => {
      const message = 'MSH|^~\\&|SENDER|FAC\rPID|1||123||DOE^JOHN^Q||19800101|M\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<PID.5>');
      expect(xml).toContain('<PID.5.1>DOE</PID.5.1>');
      expect(xml).toContain('<PID.5.2>JOHN</PID.5.2>');
      expect(xml).toContain('<PID.5.3>Q</PID.5.3>');
      expect(xml).toContain('</PID.5>');
    });

    it('should parse subcomponents with &', () => {
      const message = 'MSH|^~\\&|SENDER|FAC\rPID|1||123||DOE&JR^JOHN||19800101\r';
      const parser = new HL7v2Parser({ handleSubcomponents: true });
      const xml = parser.parse(message);

      expect(xml).toContain('<PID.5.1>');
      expect(xml).toContain('<PID.5.1.1>DOE</PID.5.1.1>');
      expect(xml).toContain('<PID.5.1.2>JR</PID.5.1.2>');
      expect(xml).toContain('</PID.5.1>');
    });

    it('should parse repetitions with ~', () => {
      const message = 'MSH|^~\\&|SENDER|FAC\rPID|1||123~456~789||DOE||19800101\r';
      const parser = new HL7v2Parser({ handleRepetitions: true });
      const xml = parser.parse(message);

      // Each repetition should be a separate field element
      const pid3Matches = xml.match(/<PID\.3>/g);
      expect(pid3Matches).toHaveLength(3);
      expect(xml).toContain('123');
      expect(xml).toContain('456');
      expect(xml).toContain('789');
    });

    it('should handle empty fields', () => {
      const message = 'MSH|^~\\&|SENDER||RECEIVER||20240115\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<MSH.4>');
      expect(xml).toContain('</MSH.4>');
    });

    it('should escape XML special characters', () => {
      const message = 'MSH|^~\\&|TEST<>&"\'|FAC\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&quot;');
      expect(xml).toContain('&apos;');
    });

    it('should convert line breaks when configured', () => {
      const message = 'MSH|^~\\&|SENDER|FAC\nPID|1||123\r\nOBX|1||TEST\r';
      const parser = new HL7v2Parser({ convertLineBreaks: true });
      const xml = parser.parse(message);

      expect(xml).toContain('<MSH>');
      expect(xml).toContain('<PID>');
      expect(xml).toContain('<OBX>');
    });

    it('should throw for null message', () => {
      const parser = new HL7v2Parser();
      expect(() => parser.parse('')).toThrow('NULL or too short');
    });

    it('should throw for too short message', () => {
      const parser = new HL7v2Parser();
      expect(() => parser.parse('MSH|')).toThrow('NULL or too short');
    });

    it('should handle FHS header segment', () => {
      const message = 'FHS|^~\\&|SENDER|FAC|REC|RECFAC|20240115\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<FHS>');
      expect(xml).toContain('<FHS.1>|</FHS.1>');
      expect(xml).toContain('<FHS.2>^~\\&amp;</FHS.2>');
    });

    it('should handle BHS header segment', () => {
      const message = 'BHS|^~\\&|SENDER|FAC|REC|RECFAC|20240115\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<BHS>');
      expect(xml).toContain('<BHS.1>|</BHS.1>');
    });

    it('should handle custom field separator', () => {
      const message = 'MSH#^~\\&#SENDER#FAC\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<MSH.1>#</MSH.1>');
    });

    it('should parse complex ADT A01 message', () => {
      const message =
        'MSH|^~\\&|ADT|HOSP|SYS|FAC|20240115120000||ADT^A01^ADT_A01|MSG001|P|2.5\r' +
        'EVN|A01|20240115120000\r' +
        'PID|1||123456^^^HOSP^MR~987654^^^SSN^SS||DOE^JOHN^Q^JR^DR||19800101|M\r' +
        'PV1|1|I|ICU^101^A|||||||SMITH^JOHN^DR|||||||||||V001\r';
      const parser = new HL7v2Parser();
      const xml = parser.parse(message);

      expect(xml).toContain('<MSH>');
      expect(xml).toContain('<EVN>');
      expect(xml).toContain('<PID>');
      expect(xml).toContain('<PV1>');
      // MSH.9 is parsed into components
      expect(xml).toContain('<MSH.9.1>ADT</MSH.9.1>');
      expect(xml).toContain('<MSH.9.2>A01</MSH.9.2>');
      expect(xml).toContain('<MSH.9.3>ADT_A01</MSH.9.3>');
      expect(xml).toContain('ICU');
    });
  });

  describe('parseER7ToXML', () => {
    it('should be a convenience function', () => {
      const message = 'MSH|^~\\&|SENDER|FAC|REC|RF|20240115||ADT^A01|123|P|2.5\r';
      const xml = parseER7ToXML(message);

      expect(xml).toContain('<MSH>');
      expect(xml).toContain('SENDER');
    });

    it('should accept properties', () => {
      const message = 'MSH|^~\\&|S|F\rPID|1||A~B\r';
      const xml = parseER7ToXML(message, { handleRepetitions: false });

      // Without repetition handling, ~ is treated as part of the value
      expect(xml).toContain('A~B');
    });
  });

  describe('MESSAGE_ROOT_ID', () => {
    it('should be HL7Message', () => {
      expect(MESSAGE_ROOT_ID).toBe('HL7Message');
    });
  });
});
