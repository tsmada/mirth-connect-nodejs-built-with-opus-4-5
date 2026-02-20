import {
  SerializerFactory,
  IMessageSerializer,
  getSerializer,
  getDefaultSerializationProperties,
  getDefaultDeserializationProperties,
} from '../../../src/util/SerializerFactory';
import {
  SOURCE_VARIABLE_MAPPING,
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../../src/model/DefaultMetaData';

describe('SerializerFactory', () => {
  describe('getSerializer', () => {
    it('should return serializers for all 9 data types', () => {
      const types = ['HL7V2', 'XML', 'JSON', 'RAW', 'DELIMITED', 'EDI/X12', 'HL7V3', 'NCPDP', 'DICOM'];
      for (const type of types) {
        const serializer = SerializerFactory.getSerializer(type);
        expect(serializer).not.toBeNull();
        expect(serializer!.getDataType()).toBe(type);
      }
    });

    it('should return null for unknown data type', () => {
      const serializer = SerializerFactory.getSerializer('UNKNOWN');
      expect(serializer).toBeNull();
    });

    it('should be case-insensitive', () => {
      const s1 = SerializerFactory.getSerializer('hl7v2');
      const s2 = SerializerFactory.getSerializer('HL7v2');
      const s3 = SerializerFactory.getSerializer('HL7V2');

      expect(s1).not.toBeNull();
      expect(s2).not.toBeNull();
      expect(s3).not.toBeNull();
    });

    it('should accept custom serialization properties', () => {
      const serializer = SerializerFactory.getSerializer(
        'HL7V2',
        { handleRepetitions: false },
        null
      );

      expect(serializer).not.toBeNull();
    });

    it('should accept custom deserialization properties', () => {
      const serializer = SerializerFactory.getSerializer(
        'HL7V2',
        null,
        { useStrictParser: true }
      );

      expect(serializer).not.toBeNull();
    });
  });

  describe('HL7V2 Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('HL7V2')!;
    });

    describe('toXML', () => {
      it('should convert simple HL7 message to XML', () => {
        const hl7 = 'MSH|^~\\&|SendApp|SendFac|RecvApp|RecvFac|20240115||ADT^A01|MSG001|P|2.5';
        const xml = serializer.toXML(hl7);

        expect(xml).toContain('<HL7Message>');
        expect(xml).toContain('<MSH>');
        expect(xml).toContain('<MSH.1>|</MSH.1>');
        expect(xml).toContain('<MSH.2>^~\\&amp;</MSH.2>');
        expect(xml).toContain('</HL7Message>');
      });

      it('should handle multiple segments', () => {
        const hl7 = [
          'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5',
          'PID|1||123^^^Hospital^MR||Doe^John^||19800101|M',
        ].join('\r');

        const xml = serializer.toXML(hl7);

        expect(xml).toContain('<MSH>');
        expect(xml).toContain('<PID>');
        expect(xml).toContain('<PID.3>');
      });

      it('should handle field repetitions', () => {
        const hl7 = 'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5\rPID|1||123~456||Doe^John';
        const xml = serializer.toXML(hl7);

        // Should have multiple PID.3 elements
        expect(xml!.match(/<PID\.3>/g)?.length).toBeGreaterThan(1);
      });

      it('should handle components', () => {
        const hl7 = 'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5\rPID|1||||Doe^John^Middle';
        const xml = serializer.toXML(hl7);

        expect(xml).toContain('<PID.5.1>Doe</PID.5.1>');
        expect(xml).toContain('<PID.5.2>John</PID.5.2>');
        expect(xml).toContain('<PID.5.3>Middle</PID.5.3>');
      });

      it('should handle empty fields', () => {
        const hl7 = 'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5\rPID|1||';
        const xml = serializer.toXML(hl7);

        expect(xml).toContain('<PID.3/>');
      });

      it('should escape special XML characters', () => {
        const hl7 = 'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5\rOBX|1||<test>&value';
        const xml = serializer.toXML(hl7);

        expect(xml).toContain('&lt;test&gt;');
        expect(xml).toContain('&amp;value');
      });

      it('should handle empty message', () => {
        const xml = serializer.toXML('');
        expect(xml).toBe('<HL7Message/>');
      });

      it('should convert line feeds to carriage returns', () => {
        const hl7 = 'MSH|^~\\&|||||||ADT^A01|MSG001|P|2.5\nPID|1||123';
        const xml = serializer.toXML(hl7);

        expect(xml).toContain('<MSH>');
        expect(xml).toContain('<PID>');
      });
    });

    describe('fromXML', () => {
      it('should convert XML back to HL7', () => {
        const xml = `
          <HL7Message>
            <MSH>
              <MSH.1>|</MSH.1>
              <MSH.2>^~\\&amp;</MSH.2>
              <MSH.3>SendApp</MSH.3>
              <MSH.4>SendFac</MSH.4>
            </MSH>
          </HL7Message>
        `;

        const hl7 = serializer.fromXML(xml);

        expect(hl7).not.toBeNull();
        expect(hl7).toContain('MSH|');
        expect(hl7).toContain('SendApp');
        expect(hl7!.endsWith('\r')).toBe(true);
      });

      it('should handle multiple segments', () => {
        const xml = `
          <HL7Message>
            <MSH><MSH.1>|</MSH.1></MSH>
            <PID><PID.1>1</PID.1></PID>
          </HL7Message>
        `;

        const hl7 = serializer.fromXML(xml);

        expect(hl7).toContain('MSH|');
        expect(hl7).toContain('\rPID|1');
      });
    });

    describe('round-trip', () => {
      it('should preserve simple message through round-trip', () => {
        const original = 'MSH|^~\\&|App|Fac|||20240115||ADT^A01|MSG001|P|2.5';
        const xml = serializer.toXML(original);
        expect(xml).not.toBeNull();
        const result = serializer.fromXML(xml!);

        expect(result).toContain('MSH|');
        expect(result).toContain('App');
        expect(result).toContain('Fac');
      });
    });

    describe('metadata', () => {
      it('should return mirth_ prefixed metadata keys', () => {
        const hl7 = 'MSH|^~\\&|App|Fac|||20240115||ADT^A01|MSG001|P|2.5';
        const metadata = serializer.getMetaDataFromMessage(hl7);

        expect(metadata).toBeInstanceOf(Map);
        expect(metadata.has(SOURCE_VARIABLE_MAPPING)).toBe(true);
        expect(metadata.has(TYPE_VARIABLE_MAPPING)).toBe(true);
        expect(metadata.has(VERSION_VARIABLE_MAPPING)).toBe(true);
      });
    });

    describe('isSerializationRequired', () => {
      it('returns false with default props (non-strict parser)', () => {
        expect(serializer.isSerializationRequired()).toBe(false);
      });
    });
  });

  describe('XML Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('XML')!;
    });

    it('should pass through XML unchanged for toXML', () => {
      const xml = '<root><child>value</child></root>';
      expect(serializer.toXML(xml)).toBe(xml);
    });

    it('should pass through XML unchanged for fromXML', () => {
      const xml = '<root><child>value</child></root>';
      expect(serializer.fromXML(xml)).toBe(xml);
    });

    it('should return empty metadata (Java XMLSerializer.populateMetaData is a no-op)', () => {
      const metadata = serializer.getMetaDataFromMessage('<root/>');
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.size).toBe(0);
    });
  });

  describe('JSON Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('JSON')!;
    });

    it('should return null from toXML (matches Java)', () => {
      const json = '{"name":"John","age":30}';
      expect(serializer.toXML(json)).toBeNull();
    });

    it('should return null from fromXML (matches Java)', () => {
      const xml = '<root><name>John</name></root>';
      expect(serializer.fromXML(xml)).toBeNull();
    });

    it('should pass through toJSON', () => {
      const json = '{"name":"John"}';
      expect(serializer.toJSON(json)).toBe(json);
    });

    it('should pass through fromJSON', () => {
      const json = '{"name":"John"}';
      expect(serializer.fromJSON(json)).toBe(json);
    });

    it('should not require serialization', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
    });

    it('should return empty metadata (Java JSONSerializer.populateMetaData is a no-op)', () => {
      const metadata = serializer.getMetaDataFromMessage('{}');
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.size).toBe(0);
    });
  });

  describe('RAW Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('RAW')!;
    });

    it('should return null from toXML (matches Java)', () => {
      expect(serializer.toXML('Plain text')).toBeNull();
    });

    it('should return null from fromXML (matches Java)', () => {
      expect(serializer.fromXML('<raw>text</raw>')).toBeNull();
    });

    it('should not require serialization', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
    });
  });

  describe('DELIMITED Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('DELIMITED')!;
    });

    it('should return non-null from toXML', () => {
      const csv = 'name,age\nJohn,30';
      const xml = serializer.toXML(csv);
      expect(xml).not.toBeNull();
      expect(typeof xml).toBe('string');
    });
  });

  describe('EDI/X12 Serializer', () => {
    let serializer: IMessageSerializer;
    const sampleEdi =
      'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *210101*1200*^*00501*000000001*0*P*:~' +
      'GS*HP*SENDER*RECEIVER*20210101*1200*1*X*005010X279A1~' +
      'ST*270*0001~' +
      'SE*2*0001~' +
      'GE*1*1~' +
      'IEA*1*000000001~';

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('EDI/X12')!;
    });

    it('should return non-null from toXML', () => {
      const xml = serializer.toXML(sampleEdi);
      expect(xml).not.toBeNull();
    });

    it('should return mirth_ prefixed metadata', () => {
      const metadata = serializer.getMetaDataFromMessage(sampleEdi);
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.has(VERSION_VARIABLE_MAPPING)).toBe(true);
      expect(metadata.get(VERSION_VARIABLE_MAPPING)).toBe('005010X279A1');
    });
  });

  describe('HL7V3 Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('HL7V3')!;
    });

    it('should return non-null from toXML', () => {
      const xml = serializer.toXML('<ClinicalDocument/>');
      expect(xml).not.toBeNull();
    });

    it('should return empty metadata (Java HL7V3Serializer.populateMetaData is a no-op)', () => {
      const metadata = serializer.getMetaDataFromMessage('<ClinicalDocument/>');
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.size).toBe(0);
    });
  });

  describe('NCPDP Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('NCPDP')!;
    });

    it('should not require serialization (matches Java)', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
    });

    it('should return mirth_ prefixed metadata', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const metadata = serializer.getMetaDataFromMessage(message);
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.has(VERSION_VARIABLE_MAPPING)).toBe(true);
    });
  });

  describe('DICOM Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('DICOM')!;
    });

    it('should not require serialization (matches Java DICOMSerializer)', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
    });

    it('should return empty metadata (Java DICOMSerializer.populateMetaData is a no-op)', () => {
      const metadata = serializer.getMetaDataFromMessage('');
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.size).toBe(0);
    });
  });

  describe('getDefaultSerializationProperties', () => {
    it('should return HL7V2 default properties', () => {
      const props = SerializerFactory.getDefaultSerializationProperties('HL7V2');

      expect(props).not.toBeNull();
      expect(props!.handleRepetitions).toBe(true);
      expect(props!.handleSubcomponents).toBe(true);
      expect(props!.convertLineBreaks).toBe(true);
    });

    it('should return XML default properties', () => {
      const props = SerializerFactory.getDefaultSerializationProperties('XML');

      expect(props).not.toBeNull();
      expect(props!.stripNamespaces).toBe(false);
    });

    it('should return EDI/X12 default properties', () => {
      const props = SerializerFactory.getDefaultSerializationProperties('EDI/X12');

      expect(props).not.toBeNull();
      expect(props!.segmentDelimiter).toBe('~');
      expect(props!.elementDelimiter).toBe('*');
      expect(props!.inferX12Delimiters).toBe(true);
    });

    it('should return NCPDP default properties', () => {
      const props = SerializerFactory.getDefaultSerializationProperties('NCPDP');

      expect(props).not.toBeNull();
      expect(props!.segmentDelimiter).toBe('0x1E');
      expect(props!.fieldDelimiter).toBe('0x1C');
    });

    it('should return null for unknown data type', () => {
      const props = SerializerFactory.getDefaultSerializationProperties('UNKNOWN');
      expect(props).toBeNull();
    });

    it('should be case-insensitive', () => {
      const p1 = SerializerFactory.getDefaultSerializationProperties('hl7v2');
      const p2 = SerializerFactory.getDefaultSerializationProperties('HL7V2');

      expect(p1).toEqual(p2);
    });
  });

  describe('getDefaultDeserializationProperties', () => {
    it('should return HL7V2 default properties', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('HL7V2');

      expect(props).not.toBeNull();
      expect(props!.useStrictParser).toBe(false);
      expect(props!.useStrictValidation).toBe(false);
    });

    it('should return NCPDP default properties', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('NCPDP');

      expect(props).not.toBeNull();
      expect(props!.useStrictValidation).toBe(false);
    });

    it('should return null for unknown data type', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('UNKNOWN');
      expect(props).toBeNull();
    });
  });

  describe('getSupportedDataTypes', () => {
    it('should return all 9 supported types', () => {
      const types = SerializerFactory.getSupportedDataTypes();

      expect(types).toHaveLength(9);
      expect(types).toContain('HL7V2');
      expect(types).toContain('XML');
      expect(types).toContain('JSON');
      expect(types).toContain('RAW');
      expect(types).toContain('DELIMITED');
      expect(types).toContain('EDI/X12');
      expect(types).toContain('HL7V3');
      expect(types).toContain('NCPDP');
      expect(types).toContain('DICOM');
    });
  });

  describe('isDataTypeSupported', () => {
    it('should return true for all 9 supported types', () => {
      const types = ['HL7V2', 'XML', 'JSON', 'RAW', 'DELIMITED', 'EDI/X12', 'HL7V3', 'NCPDP', 'DICOM'];
      for (const type of types) {
        expect(SerializerFactory.isDataTypeSupported(type)).toBe(true);
      }
    });

    it('should return false for unsupported types', () => {
      expect(SerializerFactory.isDataTypeSupported('UNKNOWN')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(SerializerFactory.isDataTypeSupported('hl7v2')).toBe(true);
      expect(SerializerFactory.isDataTypeSupported('Xml')).toBe(true);
    });
  });

  describe('shorthand exports', () => {
    it('should export getSerializer function', () => {
      const serializer = getSerializer('HL7V2');
      expect(serializer).not.toBeNull();
    });

    it('should export getDefaultSerializationProperties function', () => {
      const props = getDefaultSerializationProperties('HL7V2');
      expect(props).not.toBeNull();
    });

    it('should export getDefaultDeserializationProperties function', () => {
      const props = getDefaultDeserializationProperties('HL7V2');
      expect(props).not.toBeNull();
    });
  });
});
