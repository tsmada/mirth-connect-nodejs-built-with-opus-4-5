import { XMLSerializerAdapter } from '../../../../src/util/serializers/XMLSerializerAdapter.js';

const SIMPLE_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Patient><Name>John Doe</Name><ID>123</ID></Patient>';

const NAMESPACED_XML = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns1:PatientQuery xmlns:ns1="urn:hl7-org:v3"><ns1:id>123</ns1:id></ns1:PatientQuery></soap:Body></soap:Envelope>';

describe('XMLSerializerAdapter', () => {
  let serializer: XMLSerializerAdapter;

  beforeEach(() => {
    serializer = new XMLSerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns XML', () => {
      expect(serializer.getDataType()).toBe('XML');
    });
  });

  describe('isSerializationRequired', () => {
    it('returns false (XML is already XML)', () => {
      expect(serializer.isSerializationRequired()).toBe(false);
      expect(serializer.isSerializationRequired(true)).toBe(false);
      expect(serializer.isSerializationRequired(false)).toBe(false);
    });
  });

  describe('toXML', () => {
    it('is pass-through for plain XML', () => {
      const result = serializer.toXML(SIMPLE_XML);
      expect(result).toContain('<Patient>');
      expect(result).toContain('<Name>John Doe</Name>');
    });

    it('strips namespaces by default (adapter default)', () => {
      const result = serializer.toXML(NAMESPACED_XML);
      expect(result).not.toContain('xmlns:soap');
      expect(result).not.toContain('soap:');
      expect(result).toContain('<Envelope>');
      expect(result).toContain('<Body>');
    });

    it('preserves namespaces when stripNamespaces=false', () => {
      const noStrip = new XMLSerializerAdapter({ stripNamespaces: false });
      const result = noStrip.toXML(NAMESPACED_XML);
      expect(result).toContain('xmlns:soap');
      expect(result).toContain('soap:Envelope');
    });
  });

  describe('fromXML', () => {
    it('is pass-through', () => {
      const result = serializer.fromXML(SIMPLE_XML);
      expect(result).toBe(SIMPLE_XML);
    });
  });

  describe('populateMetaData', () => {
    it('sets mirth_version to 1.0 and mirth_type to XML-Message', () => {
      const map = new Map<string, unknown>();
      serializer.populateMetaData(SIMPLE_XML, map);

      expect(map.get('mirth_version')).toBe('1.0');
      expect(map.get('mirth_type')).toBe('XML-Message');
    });

    it('does not set mirth_source (XML has no source concept)', () => {
      const map = new Map<string, unknown>();
      serializer.populateMetaData(SIMPLE_XML, map);

      expect(map.has('mirth_source')).toBe(false);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns Map with mirth_version and mirth_type', () => {
      const result = serializer.getMetaDataFromMessage(SIMPLE_XML);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('mirth_version')).toBe('1.0');
      expect(result.get('mirth_type')).toBe('XML-Message');
      expect(result.size).toBe(2);
    });
  });

  describe('transformWithoutSerializing', () => {
    it('strips namespaces when enabled (default)', () => {
      const result = serializer.transformWithoutSerializing(NAMESPACED_XML);
      expect(result).not.toBeNull();
      expect(result).not.toContain('xmlns:');
      expect(result).toContain('<Envelope>');
    });

    it('returns null when namespace stripping is disabled', () => {
      const noStrip = new XMLSerializerAdapter({ stripNamespaces: false });
      const result = noStrip.transformWithoutSerializing(NAMESPACED_XML);
      expect(result).toBeNull();
    });
  });

  describe('toJSON / fromJSON', () => {
    it('toJSON returns null (inherited from BaseSerializer)', () => {
      expect(serializer.toJSON(SIMPLE_XML)).toBeNull();
    });

    it('fromJSON returns null (inherited from BaseSerializer)', () => {
      expect(serializer.fromJSON('{}')).toBeNull();
    });
  });
});
