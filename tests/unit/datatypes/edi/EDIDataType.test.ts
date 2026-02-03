/**
 * Unit tests for EDI/X12 DataType
 *
 * Tests parsing and serialization of healthcare EDI transactions.
 */

import {
  EDIDataType,
  EDIParser,
  EDISerializer,
  parseEDIToXML,
  serializeXMLToEDI,
  getDefaultEDISerializationProperties,
  getDefaultEDIDataTypeProperties,
  unescapeEDIDelimiter,
  detectX12Delimiters,
  extractEDIMetaData,
} from '../../../../src/datatypes/edi/index.js';

// Sample X12 837 Professional Claim (simplified)
const SAMPLE_X12 =
  'ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *210315*1200*^*00501*000000001*0*P*:~' +
  'GS*HC*SUBMITTER*RECEIVER*20210315*1200*1*X*005010X222A1~' +
  'ST*837*0001~' +
  'BHT*0019*00*123456*20210315*1200*CH~' +
  'SE*4*0001~' +
  'GE*1*1~' +
  'IEA*1*000000001~';

// Simple EDI message (not X12)
const SIMPLE_EDI = 'UNB*UNOA:4*SENDER*RECEIVER*210315:1200*1~' + 'UNH*1*ORDERS:D:96A:UN~';

describe('EDIProperties', () => {
  describe('Default Properties', () => {
    it('should return correct default serialization properties', () => {
      const props = getDefaultEDISerializationProperties();
      expect(props.segmentDelimiter).toBe('~');
      expect(props.elementDelimiter).toBe('*');
      expect(props.subelementDelimiter).toBe(':');
      expect(props.inferX12Delimiters).toBe(true);
    });

    it('should return correct default data type properties', () => {
      const props = getDefaultEDIDataTypeProperties();
      expect(props.serializationProperties).toBeDefined();
      expect(props.serializationProperties.segmentDelimiter).toBe('~');
    });
  });

  describe('unescapeEDIDelimiter', () => {
    it('should unescape newline', () => {
      expect(unescapeEDIDelimiter('\\n')).toBe('\n');
    });

    it('should unescape carriage return', () => {
      expect(unescapeEDIDelimiter('\\r')).toBe('\r');
    });

    it('should leave regular characters unchanged', () => {
      expect(unescapeEDIDelimiter('~')).toBe('~');
      expect(unescapeEDIDelimiter('*')).toBe('*');
    });
  });

  describe('detectX12Delimiters', () => {
    const defaults = {
      segmentDelimiter: '~',
      elementDelimiter: '*',
      subelementDelimiter: ':',
    };

    it('should detect delimiters from X12 ISA segment', () => {
      const delimiters = detectX12Delimiters(SAMPLE_X12, defaults);
      expect(delimiters.elementDelimiter).toBe('*');
      expect(delimiters.subelementDelimiter).toBe(':');
      expect(delimiters.segmentDelimiter).toBe('~');
    });

    it('should return defaults for non-X12 messages', () => {
      const delimiters = detectX12Delimiters(SIMPLE_EDI, defaults);
      expect(delimiters).toEqual(defaults);
    });

    it('should return defaults for short messages', () => {
      const delimiters = detectX12Delimiters('ISA*short', defaults);
      expect(delimiters).toEqual(defaults);
    });

    it('should handle newline after segment delimiter', () => {
      const x12WithNewline = SAMPLE_X12.replace(/~/g, '~\n');
      const delimiters = detectX12Delimiters(x12WithNewline, defaults);
      expect(delimiters.segmentDelimiter).toBe('~\n');
    });
  });
});

describe('EDIParser', () => {
  describe('X12 Parsing', () => {
    it('should parse X12 message to XML', () => {
      const parser = new EDIParser();
      const xml = parser.parse(SAMPLE_X12);

      expect(xml).toContain('<X12Transaction');
      expect(xml).toContain('segmentDelimiter=');
      expect(xml).toContain('<ISA>');
      expect(xml).toContain('<GS>');
      expect(xml).toContain('<ST>');
      expect(xml).toContain('</X12Transaction>');
    });

    it('should create proper element naming', () => {
      const parser = new EDIParser();
      const xml = parser.parse(SAMPLE_X12);

      // Check for ISA elements with proper naming
      expect(xml).toContain('<ISA.01>');
      expect(xml).toContain('<ISA.01.1>');
      expect(xml).toContain('</ISA.01>');
    });

    it('should handle empty elements', () => {
      const edi = 'ISA*00*          *00*          *ZZ*SENDER*ZZ*RECEIVER*210315*1200*^*00501*000000001*0*P*:~';
      const parser = new EDIParser();
      const xml = parser.parse(edi);

      expect(xml).toContain('<ISA>');
    });
  });

  describe('Generic EDI Parsing', () => {
    it('should parse non-X12 EDI as EDIMessage', () => {
      const parser = new EDIParser();
      const xml = parser.parse(SIMPLE_EDI);

      expect(xml).toContain('<EDIMessage');
      expect(xml).toContain('<UNB>');
      expect(xml).toContain('</EDIMessage>');
    });
  });

  describe('Custom Delimiters', () => {
    it('should use custom delimiters when inference disabled', () => {
      const edi = 'SEG|elem1|elem2\nSEG2|elem3';
      const parser = new EDIParser({
        segmentDelimiter: '\\n',
        elementDelimiter: '|',
        subelementDelimiter: '^',
        inferX12Delimiters: false,
      });
      const xml = parser.parse(edi);

      expect(xml).toContain('<SEG>');
      expect(xml).toContain('<SEG2>');
    });
  });

  describe('Subelements', () => {
    it('should parse subelements correctly', () => {
      const edi = 'TST*one:two:three~';
      const parser = new EDIParser();
      const xml = parser.parse(edi);

      expect(xml).toContain('<TST.01>');
      expect(xml).toContain('<TST.01.1>one</TST.01.1>');
      expect(xml).toContain('<TST.01.2>two</TST.01.2>');
      expect(xml).toContain('<TST.01.3>three</TST.01.3>');
    });
  });

  describe('Error Handling', () => {
    it('should throw for empty message', () => {
      const parser = new EDIParser();
      expect(() => parser.parse('')).toThrow();
    });

    it('should throw for very short message', () => {
      const parser = new EDIParser();
      expect(() => parser.parse('AB')).toThrow();
    });
  });

  describe('XML Entity Escaping', () => {
    it('should escape XML entities in values', () => {
      const edi = 'TST*<value>&test~';
      const parser = new EDIParser();
      const xml = parser.parse(edi);

      expect(xml).toContain('&lt;value&gt;');
      expect(xml).toContain('&amp;test');
    });
  });
});

describe('EDISerializer', () => {
  describe('XML to EDI', () => {
    it('should serialize XML to EDI', () => {
      const xml = `<X12Transaction segmentDelimiter="~" elementDelimiter="*" subelementDelimiter=":">
        <ISA>
          <ISA.01><ISA.01.1>00</ISA.01.1></ISA.01>
          <ISA.02><ISA.02.1>TEST</ISA.02.1></ISA.02>
        </ISA>
      </X12Transaction>`;

      const serializer = new EDISerializer();
      const edi = serializer.serialize(xml);

      expect(edi).toContain('ISA*00*TEST~');
    });

    it('should handle EDIMessage root', () => {
      const xml = `<EDIMessage segmentDelimiter="~" elementDelimiter="*" subelementDelimiter=":">
        <UNB><UNB.01><UNB.01.1>UNOA</UNB.01.1></UNB.01></UNB>
      </EDIMessage>`;

      const serializer = new EDISerializer();
      const edi = serializer.serialize(xml);

      expect(edi).toContain('UNB*UNOA~');
    });
  });

  describe('Round-trip', () => {
    it('should round-trip simple EDI', () => {
      const originalEdi = 'TST*value1*value2~';
      const parser = new EDIParser();
      const xml = parser.parse(originalEdi);

      const serializer = new EDISerializer();
      const resultEdi = serializer.serialize(xml);

      expect(resultEdi).toBe(originalEdi);
    });

    it('should round-trip EDI with subelements', () => {
      const originalEdi = 'TST*a:b:c*d~';
      const parser = new EDIParser();
      const xml = parser.parse(originalEdi);

      const serializer = new EDISerializer();
      const resultEdi = serializer.serialize(xml);

      expect(resultEdi).toBe(originalEdi);
    });
  });
});

describe('EDIDataType', () => {
  describe('isSerializationRequired', () => {
    it('should return false (as per Java implementation)', () => {
      const dataType = new EDIDataType();
      expect(dataType.isSerializationRequired()).toBe(false);
      expect(dataType.isSerializationRequired(true)).toBe(false);
      expect(dataType.isSerializationRequired(false)).toBe(false);
    });
  });

  describe('toXML and fromXML', () => {
    it('should convert EDI to XML', () => {
      const dataType = new EDIDataType();
      const xml = dataType.toXML(SAMPLE_X12);

      expect(xml).toContain('<X12Transaction');
      expect(xml).toContain('<ISA>');
    });

    it('should convert XML back to EDI', () => {
      const dataType = new EDIDataType();
      const xml = dataType.toXML('TST*value~');
      const edi = dataType.fromXML(xml);

      expect(edi).toBe('TST*value~');
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract source from ISA segment', () => {
      const dataType = new EDIDataType();
      const meta = dataType.getMetaData(SAMPLE_X12);

      expect(meta.source).toBe('SUBMITTER');
    });

    it('should extract type from ST segment', () => {
      const dataType = new EDIDataType();
      const meta = dataType.getMetaData(SAMPLE_X12);

      expect(meta.type).toBe('837');
    });

    it('should extract version from GS segment', () => {
      const dataType = new EDIDataType();
      const meta = dataType.getMetaData(SAMPLE_X12);

      expect(meta.version).toBe('005010X222A1');
    });

    it('should populate metadata map', () => {
      const dataType = new EDIDataType();
      const map: Record<string, unknown> = {};
      dataType.populateMetaData(SAMPLE_X12, map);

      expect(map['source']).toBe('SUBMITTER');
      expect(map['type']).toBe('837');
      expect(map['version']).toBe('005010X222A1');
    });

    it('should handle messages without metadata', () => {
      const dataType = new EDIDataType();
      const meta = dataType.getMetaData('TST*value~');

      expect(meta.source).toBeUndefined();
      expect(meta.type).toBeUndefined();
      expect(meta.version).toBeUndefined();
    });
  });

  describe('JSON conversion', () => {
    it('should return null for toJSON', () => {
      const dataType = new EDIDataType();
      expect(dataType.toJSON(SAMPLE_X12)).toBeNull();
    });

    it('should return null for fromJSON', () => {
      const dataType = new EDIDataType();
      expect(dataType.fromJSON('{}')).toBeNull();
    });
  });

  describe('transformWithoutSerializing', () => {
    it('should return null', () => {
      const dataType = new EDIDataType();
      expect(dataType.transformWithoutSerializing(SAMPLE_X12)).toBeNull();
    });
  });

  describe('Properties', () => {
    it('should return serialization properties', () => {
      const dataType = new EDIDataType({
        serializationProperties: { inferX12Delimiters: false },
      });
      const props = dataType.getSerializationProperties();

      expect(props.inferX12Delimiters).toBe(false);
    });

    it('should return purged properties', () => {
      const dataType = new EDIDataType();
      const purged = dataType.getPurgedProperties();

      expect(purged.inferX12Delimiters).toBe(true);
    });
  });
});

describe('Convenience Functions', () => {
  describe('parseEDIToXML', () => {
    it('should parse EDI to XML', () => {
      const xml = parseEDIToXML('TST*value~');
      expect(xml).toContain('<TST>');
    });
  });

  describe('serializeXMLToEDI', () => {
    it('should serialize XML to EDI', () => {
      const xml =
        '<EDIMessage segmentDelimiter="~" elementDelimiter="*" subelementDelimiter=":"><TST><TST.01><TST.01.1>val</TST.01.1></TST.01></TST></EDIMessage>';
      const edi = serializeXMLToEDI(xml);
      expect(edi).toContain('TST*val~');
    });
  });

  describe('extractEDIMetaData', () => {
    it('should extract metadata', () => {
      const meta = extractEDIMetaData(SAMPLE_X12);
      expect(meta.type).toBe('837');
    });
  });
});
