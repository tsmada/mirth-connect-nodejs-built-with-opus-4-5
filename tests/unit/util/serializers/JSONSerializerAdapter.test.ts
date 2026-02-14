import { JSONSerializerAdapter } from '../../../../src/util/serializers/JSONSerializerAdapter.js';

describe('JSONSerializerAdapter', () => {
  let serializer: JSONSerializerAdapter;

  beforeEach(() => {
    serializer = new JSONSerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns JSON', () => {
      expect(serializer.getDataType()).toBe('JSON');
    });
  });

  describe('toXML', () => {
    it('returns null (matches Java JSONSerializer)', () => {
      expect(serializer.toXML('{"key":"value"}')).toBeNull();
    });

    it('returns null even for valid JSON', () => {
      expect(serializer.toXML('[1, 2, 3]')).toBeNull();
    });

    it('returns null for empty JSON object', () => {
      expect(serializer.toXML('{}')).toBeNull();
    });
  });

  describe('fromXML', () => {
    it('returns null (matches Java JSONSerializer)', () => {
      expect(serializer.fromXML('<root><key>value</key></root>')).toBeNull();
    });

    it('returns null for any XML input', () => {
      expect(serializer.fromXML('<HL7Message><MSH/></HL7Message>')).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('is pass-through for JSON objects', () => {
      const json = '{"name":"test","value":42}';
      expect(serializer.toJSON(json)).toBe(json);
    });

    it('is pass-through for JSON arrays', () => {
      const json = '[1, 2, 3]';
      expect(serializer.toJSON(json)).toBe(json);
    });

    it('is pass-through for JSON primitives', () => {
      expect(serializer.toJSON('"hello"')).toBe('"hello"');
    });

    it('preserves exact string (no reformatting)', () => {
      const json = '{ "key" :   "value" }';
      expect(serializer.toJSON(json)).toBe(json);
    });
  });

  describe('fromJSON', () => {
    it('is pass-through for JSON objects', () => {
      const json = '{"name":"test"}';
      expect(serializer.fromJSON(json)).toBe(json);
    });

    it('is pass-through for JSON arrays', () => {
      const json = '[1, 2, 3]';
      expect(serializer.fromJSON(json)).toBe(json);
    });
  });

  describe('isSerializationRequired', () => {
    it('returns false', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
    });

    it('returns false for toXml=true', () => {
      expect(serializer.isSerializationRequired(true)).toBe(false);
    });

    it('returns false for toXml=false', () => {
      expect(serializer.isSerializationRequired(false)).toBe(false);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns map with mirth_type=JSON', () => {
      const meta = serializer.getMetaDataFromMessage('{"key":"value"}');
      expect(meta.get('mirth_type')).toBe('JSON');
    });

    it('returns mirth_type=JSON regardless of content', () => {
      const meta = serializer.getMetaDataFromMessage('invalid json');
      expect(meta.get('mirth_type')).toBe('JSON');
    });

    it('only contains mirth_type key', () => {
      const meta = serializer.getMetaDataFromMessage('{}');
      expect(meta.size).toBe(1);
      expect(meta.has('mirth_type')).toBe(true);
    });
  });

  describe('populateMetaData', () => {
    it('sets mirth_type to JSON in the provided map', () => {
      const map = new Map<string, unknown>();
      serializer.populateMetaData('{"key":"value"}', map);
      expect(map.get('mirth_type')).toBe('JSON');
    });
  });

  describe('transformWithoutSerializing', () => {
    it('returns null (inherited from BaseSerializer)', () => {
      expect(serializer.transformWithoutSerializing('test')).toBeNull();
    });
  });
});
