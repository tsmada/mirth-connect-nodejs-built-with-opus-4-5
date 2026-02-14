import {
  SerializerFactory,
  IMessageSerializer,
  getSerializer,
  getDefaultSerializationProperties,
  getDefaultDeserializationProperties,
} from '../../../src/util/SerializerFactory';

describe('SerializerFactory', () => {
  describe('getSerializer', () => {
    it('should return HL7V2 serializer', () => {
      const serializer = SerializerFactory.getSerializer('HL7V2');

      expect(serializer).not.toBeNull();
      expect(serializer!.getDataType()).toBe('HL7V2');
    });

    it('should return XML serializer', () => {
      const serializer = SerializerFactory.getSerializer('XML');

      expect(serializer).not.toBeNull();
      expect(serializer!.getDataType()).toBe('XML');
    });

    it('should return JSON serializer', () => {
      const serializer = SerializerFactory.getSerializer('JSON');

      expect(serializer).not.toBeNull();
      expect(serializer!.getDataType()).toBe('JSON');
    });

    it('should return RAW serializer', () => {
      const serializer = SerializerFactory.getSerializer('RAW');

      expect(serializer).not.toBeNull();
      expect(serializer!.getDataType()).toBe('RAW');
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
  });

  describe('JSON Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('JSON')!;
    });

    it('should convert JSON to XML', () => {
      const json = '{"name":"John","age":30}';
      const xml = serializer.toXML(json);

      expect(xml).toContain('<root>');
      expect(xml).toContain('<name>John</name>');
      expect(xml).toContain('<age>30</age>');
    });

    it('should convert XML to JSON', () => {
      const xml = '<root><name>John</name><age>30</age></root>';
      const json = serializer.fromXML(xml);
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);

      expect(parsed.name).toBe('John');
      expect(parsed.age).toBe(30);
    });
  });

  describe('RAW Serializer', () => {
    let serializer: IMessageSerializer;

    beforeEach(() => {
      serializer = SerializerFactory.getSerializer('RAW')!;
    });

    it('should wrap raw text in CDATA for toXML', () => {
      const raw = 'Plain text with <special> chars';
      const xml = serializer.toXML(raw);

      expect(xml).toContain('<raw>');
      expect(xml).toContain('<![CDATA[');
      expect(xml).toContain('Plain text with <special> chars');
    });

    it('should extract content from XML for fromXML', () => {
      const xml = '<raw><![CDATA[Plain text content]]></raw>';
      const raw = serializer.fromXML(xml);

      expect(raw).toBe('Plain text content');
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

    it('should return null for unknown data type', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('UNKNOWN');
      expect(props).toBeNull();
    });
  });

  describe('getSupportedDataTypes', () => {
    it('should return list of supported types', () => {
      const types = SerializerFactory.getSupportedDataTypes();

      expect(types).toContain('HL7V2');
      expect(types).toContain('XML');
      expect(types).toContain('JSON');
      expect(types).toContain('RAW');
    });
  });

  describe('isDataTypeSupported', () => {
    it('should return true for supported types', () => {
      expect(SerializerFactory.isDataTypeSupported('HL7V2')).toBe(true);
      expect(SerializerFactory.isDataTypeSupported('XML')).toBe(true);
      expect(SerializerFactory.isDataTypeSupported('JSON')).toBe(true);
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
