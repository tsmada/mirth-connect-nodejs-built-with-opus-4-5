import {
  HL7v2Serializer,
  serializeXMLToER7,
} from '../../../../src/datatypes/hl7v2/HL7v2Serializer';

describe('HL7v2Serializer', () => {
  describe('constructor', () => {
    it('should create serializer with default properties', () => {
      const serializer = new HL7v2Serializer();
      expect(serializer).toBeDefined();
    });

    it('should create serializer with custom properties', () => {
      const serializer = new HL7v2Serializer({
        segmentDelimiter: '\n',
      });
      expect(serializer).toBeDefined();
    });
  });

  describe('serialize', () => {
    it('should serialize simple MSH segment', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1>SENDER</MSH.3.1></MSH.3>
          <MSH.4><MSH.4.1>FACILITY</MSH.4.1></MSH.4>
          <MSH.5><MSH.5.1>RECEIVER</MSH.5.1></MSH.5>
          <MSH.6><MSH.6.1>RECFAC</MSH.6.1></MSH.6>
          <MSH.7><MSH.7.1>20240115120000</MSH.7.1></MSH.7>
          <MSH.9><MSH.9.1>ADT</MSH.9.1><MSH.9.2>A01</MSH.9.2></MSH.9>
          <MSH.10><MSH.10.1>12345</MSH.10.1></MSH.10>
          <MSH.11><MSH.11.1>P</MSH.11.1></MSH.11>
          <MSH.12><MSH.12.1>2.5</MSH.12.1></MSH.12>
        </MSH>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('MSH|^~\\&|');
      expect(er7).toContain('SENDER');
      expect(er7).toContain('FACILITY');
      expect(er7).toContain('ADT^A01');
      expect(er7).toContain('12345');
      expect(er7).toContain('|P|');
      expect(er7).toContain('2.5');
    });

    it('should serialize multiple segments', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1>SENDER</MSH.3.1></MSH.3>
        </MSH>
        <PID>
          <PID.1><PID.1.1>1</PID.1.1></PID.1>
          <PID.3><PID.3.1>123456</PID.3.1></PID.3>
          <PID.5><PID.5.1>DOE</PID.5.1><PID.5.2>JOHN</PID.5.2></PID.5>
        </PID>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('MSH|');
      expect(er7).toContain('\rPID|');
      expect(er7).toContain('|DOE^JOHN');
    });

    it('should handle components', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
        </MSH>
        <PID>
          <PID.5>
            <PID.5.1>DOE</PID.5.1>
            <PID.5.2>JOHN</PID.5.2>
            <PID.5.3>Q</PID.5.3>
          </PID.5>
        </PID>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('DOE^JOHN^Q');
    });

    it('should handle subcomponents', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
        </MSH>
        <PID>
          <PID.5>
            <PID.5.1>
              <PID.5.1.1>DOE</PID.5.1.1>
              <PID.5.1.2>JR</PID.5.1.2>
            </PID.5.1>
            <PID.5.2>JOHN</PID.5.2>
          </PID.5>
        </PID>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('DOE&JR^JOHN');
    });

    it('should unescape XML entities', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1>TEST&lt;&gt;&amp;</MSH.3.1></MSH.3>
        </MSH>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('TEST<>&');
    });

    it('should handle custom segment delimiter', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
        </MSH>
        <PID>
          <PID.1><PID.1.1>1</PID.1.1></PID.1>
        </PID>
      </HL7Message>`;

      const serializer = new HL7v2Serializer({ segmentDelimiter: '\n' });
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('MSH|');
      expect(er7).toContain('\nPID|');
    });

    it('should handle pretty-printed XML', () => {
      const xml = `
        <HL7Message>
          <MSH>
            <MSH.1>|</MSH.1>
            <MSH.2>^~\\&amp;</MSH.2>
            <MSH.3>
              <MSH.3.1>SENDER</MSH.3.1>
            </MSH.3>
          </MSH>
        </HL7Message>
      `;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('MSH|^~\\&|SENDER');
    });

    it('should handle FHS segment', () => {
      const xml = `<HL7Message>
        <FHS>
          <FHS.1>|</FHS.1>
          <FHS.2>^~\\&amp;</FHS.2>
          <FHS.3><FHS.3.1>SENDER</FHS.3.1></FHS.3>
        </FHS>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('FHS|^~\\&|SENDER');
    });

    it('should handle BHS segment', () => {
      const xml = `<HL7Message>
        <BHS>
          <BHS.1>|</BHS.1>
          <BHS.2>^~\\&amp;</BHS.2>
          <BHS.3><BHS.3.1>SENDER</BHS.3.1></BHS.3>
        </BHS>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('BHS|^~\\&|SENDER');
    });

    it('should handle empty components', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1></MSH.3.1></MSH.3>
          <MSH.4><MSH.4.1>FAC</MSH.4.1></MSH.4>
        </MSH>
      </HL7Message>`;

      const serializer = new HL7v2Serializer();
      const er7 = serializer.serialize(xml);

      expect(er7).toContain('MSH|^~\\&||FAC');
    });
  });

  describe('serializeXMLToER7', () => {
    it('should be a convenience function', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
          <MSH.3><MSH.3.1>TEST</MSH.3.1></MSH.3>
        </MSH>
      </HL7Message>`;

      const er7 = serializeXMLToER7(xml);

      expect(er7).toContain('MSH|');
      expect(er7).toContain('TEST');
    });

    it('should accept custom properties', () => {
      const xml = `<HL7Message>
        <MSH>
          <MSH.1>|</MSH.1>
          <MSH.2>^~\\&amp;</MSH.2>
        </MSH>
        <PID>
          <PID.1><PID.1.1>1</PID.1.1></PID.1>
        </PID>
      </HL7Message>`;

      const er7 = serializeXMLToER7(xml, { segmentDelimiter: '\n' });

      expect(er7).toContain('\nPID');
    });
  });

  describe('round-trip', () => {
    it('should round-trip simple message', () => {
      // This test imports the parser to test round-trip
      const { HL7v2Parser } = require('../../../../src/datatypes/hl7v2/HL7v2Parser');

      const original = 'MSH|^~\\&|SENDER|FACILITY|RECEIVER|RECFAC|20240115120000||ADT^A01|12345|P|2.5\r';
      const parser = new HL7v2Parser();
      const serializer = new HL7v2Serializer();

      const xml = parser.parse(original);
      const result = serializer.serialize(xml);

      // Normalize for comparison
      expect(result.replace(/\r/g, '')).toContain('MSH|^~\\&|SENDER|FACILITY|RECEIVER|RECFAC|20240115120000||ADT^A01|12345|P|2.5');
    });
  });
});
