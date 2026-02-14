import { RawSerializerAdapter } from '../../../../src/util/serializers/RawSerializerAdapter.js';

describe('RawSerializerAdapter', () => {
  let serializer: RawSerializerAdapter;

  beforeEach(() => {
    serializer = new RawSerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns RAW', () => {
      expect(serializer.getDataType()).toBe('RAW');
    });
  });

  describe('toXML', () => {
    it('returns null (NOT CDATA wrapping, matches Java RawSerializer)', () => {
      expect(serializer.toXML('raw text data')).toBeNull();
    });

    it('returns null for any input', () => {
      expect(serializer.toXML('<xml>data</xml>')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(serializer.toXML('')).toBeNull();
    });
  });

  describe('fromXML', () => {
    it('returns null (matches Java RawSerializer)', () => {
      expect(serializer.fromXML('<raw>data</raw>')).toBeNull();
    });

    it('returns null for any XML input', () => {
      expect(serializer.fromXML('<root><child/></root>')).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('returns null (inherited from BaseSerializer)', () => {
      expect(serializer.toJSON('raw text')).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('returns null (inherited from BaseSerializer)', () => {
      expect(serializer.fromJSON('{"key":"value"}')).toBeNull();
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
    it('returns empty Map (Raw has no metadata)', () => {
      const meta = serializer.getMetaDataFromMessage('raw text data');
      expect(meta.size).toBe(0);
    });

    it('returns empty Map for any input', () => {
      const meta = serializer.getMetaDataFromMessage('');
      expect(meta.size).toBe(0);
    });
  });

  describe('populateMetaData', () => {
    it('does not add any entries to the map', () => {
      const map = new Map<string, unknown>();
      serializer.populateMetaData('raw text', map);
      expect(map.size).toBe(0);
    });
  });

  describe('transformWithoutSerializing', () => {
    it('returns null (inherited from BaseSerializer)', () => {
      expect(serializer.transformWithoutSerializing('test')).toBeNull();
    });
  });
});
