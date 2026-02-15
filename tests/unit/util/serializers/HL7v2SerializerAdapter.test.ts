import { HL7v2SerializerAdapter } from '../../../../src/util/serializers/HL7v2SerializerAdapter.js';

const SIMPLE_ADT = [
  'MSH|^~\\&|SENDING_APP|SENDING_FAC|RECEIVING_APP|RECEIVING_FAC|20230101120000||ADT^A01|MSG00001|P|2.5.1',
  'PID|1||123456^^^MRN||Doe^John||19800101|M',
  '',
].join('\r');

describe('HL7v2SerializerAdapter', () => {
  let serializer: HL7v2SerializerAdapter;

  beforeEach(() => {
    serializer = new HL7v2SerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns HL7V2', () => {
      expect(serializer.getDataType()).toBe('HL7V2');
    });
  });

  describe('isSerializationRequired', () => {
    it('returns false with default props (non-strict parser)', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
      expect(serializer.isSerializationRequired(true)).toBe(false);
      expect(serializer.isSerializationRequired(false)).toBe(false);
    });

    it('returns true when useStrictParser is enabled', () => {
      const strictSerializer = new HL7v2SerializerAdapter(
        { useStrictParser: true },
        { useStrictParser: true }
      );
      expect(strictSerializer.isSerializationRequired()).toBe(true);
      expect(strictSerializer.isSerializationRequired(true)).toBe(true);
      expect(strictSerializer.isSerializationRequired(false)).toBe(true);
    });
  });

  describe('toXML', () => {
    it('converts HL7 ER7 to XML', () => {
      const xml = serializer.toXML(SIMPLE_ADT);
      expect(xml).toContain('<HL7Message>');
      expect(xml).toContain('<MSH>');
      expect(xml).toContain('<MSH.1>|</MSH.1>');
      expect(xml).toContain('<MSH.2>^~\\&amp;</MSH.2>');
      expect(xml).toContain('<PID>');
      expect(xml).toContain('</HL7Message>');
    });

    it('returns empty HL7Message for empty input', () => {
      expect(serializer.toXML('')).toBe('<HL7Message/>');
    });

    it('handles components in fields', () => {
      const xml = serializer.toXML(SIMPLE_ADT);
      // MSH.9 = ADT^A01 should become nested components
      expect(xml).toContain('<MSH.9>');
      expect(xml).toContain('<MSH.9.1>ADT</MSH.9.1>');
      expect(xml).toContain('<MSH.9.2>A01</MSH.9.2>');
    });

    it('converts newlines to carriage returns by default', () => {
      const withNewlines = 'MSH|^~\\&|APP|FAC\nPID|1||123';
      const xml = serializer.toXML(withNewlines);
      expect(xml).toContain('<MSH>');
      expect(xml).toContain('<PID>');
    });
  });

  describe('fromXML', () => {
    it('converts XML back to HL7 ER7', () => {
      const xml = serializer.toXML(SIMPLE_ADT);
      const er7 = serializer.fromXML(xml);
      expect(er7).toContain('MSH|');
      expect(er7).toContain('PID|');
      expect(er7).toContain('ADT');
      expect(er7.endsWith('\r')).toBe(true);
    });
  });

  describe('round-trip preservation', () => {
    it('preserves message content through toXML->fromXML', () => {
      const xml = serializer.toXML(SIMPLE_ADT);
      const roundTrip = serializer.fromXML(xml);

      // Normalize: trim trailing \r for comparison
      const originalSegments = SIMPLE_ADT.split('\r').filter((s) => s.trim());
      const roundTripSegments = roundTrip.split('\r').filter((s) => s.trim());

      expect(roundTripSegments.length).toBe(originalSegments.length);
      // MSH segment reconstruction: the field separator is MSH.1, so MSH starts with MSH|
      expect(roundTripSegments[0]).toContain('MSH');
      expect(roundTripSegments[1]).toContain('PID');
    });
  });

  describe('populateMetaData', () => {
    it('populates map with mirth_source, mirth_type, mirth_version', () => {
      const map = new Map<string, unknown>();
      serializer.populateMetaData(SIMPLE_ADT, map);

      expect(map.get('mirth_source')).toBe('SENDING_FAC');
      expect(map.get('mirth_type')).toBe('ADT-A01');
      expect(map.get('mirth_version')).toBe('2.5.1');
    });

    it('handles message without version gracefully', () => {
      const shortMsg = 'MSH|^~\\&|APP|FAC|RAPP|RFAC|20230101||ADT^A04|ID1|P\r';
      const map = new Map<string, unknown>();
      serializer.populateMetaData(shortMsg, map);

      expect(map.get('mirth_source')).toBe('FAC');
      expect(map.get('mirth_type')).toBe('ADT-A04');
      // version may or may not be set depending on field count
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns Map<string, string> with mirth_ keys', () => {
      const result = serializer.getMetaDataFromMessage(SIMPLE_ADT);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('mirth_source')).toBe('SENDING_FAC');
      expect(result.get('mirth_type')).toBe('ADT-A01');
      expect(result.get('mirth_version')).toBe('2.5.1');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('toJSON returns null (inherited from BaseSerializer)', () => {
      expect(serializer.toJSON(SIMPLE_ADT)).toBeNull();
    });

    it('fromJSON returns null (inherited from BaseSerializer)', () => {
      expect(serializer.fromJSON('{}')).toBeNull();
    });
  });

  describe('transformWithoutSerializing', () => {
    it('returns null (inherited from BaseSerializer)', () => {
      expect(serializer.transformWithoutSerializing(SIMPLE_ADT)).toBeNull();
    });
  });
});
