import {
  XMLDataType,
  getDefaultXMLSerializationProperties,
  parseXML,
  extractXMLMetaData,
  stripNamespaces,
} from '../../../../src/datatypes/xml/XMLDataType';

describe('XMLDataType', () => {
  describe('getDefaultXMLSerializationProperties', () => {
    it('should return correct defaults', () => {
      const props = getDefaultXMLSerializationProperties();

      expect(props.stripNamespaces).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should create XMLDataType with default properties', () => {
      const dataType = new XMLDataType();
      expect(dataType).toBeDefined();
    });

    it('should create XMLDataType with custom properties', () => {
      const dataType = new XMLDataType({ stripNamespaces: true });
      expect(dataType).toBeDefined();
    });
  });

  describe('toXML', () => {
    it('should pass through XML', () => {
      const dataType = new XMLDataType();
      const xml = '<root><child>value</child></root>';
      const result = dataType.toXML(xml);

      expect(result).toBe(xml);
    });

    it('should trim whitespace', () => {
      const dataType = new XMLDataType();
      const xml = '  <root><child>value</child></root>  ';
      const result = dataType.toXML(xml);

      expect(result).toBe('<root><child>value</child></root>');
    });

    it('should strip namespaces when configured', () => {
      const dataType = new XMLDataType({ stripNamespaces: true });
      const xml = '<ns:root xmlns:ns="http://example.com"><ns:child>value</ns:child></ns:root>';
      const result = dataType.toXML(xml);

      expect(result).not.toContain('xmlns');
      expect(result).not.toContain('ns:');
      expect(result).toContain('<root>');
      expect(result).toContain('<child>');
    });

    it('should strip default namespace', () => {
      const dataType = new XMLDataType({ stripNamespaces: true });
      const xml = '<root xmlns="http://example.com"><child>value</child></root>';
      const result = dataType.toXML(xml);

      expect(result).not.toContain('xmlns');
    });

    it('should not strip namespaces by default', () => {
      const dataType = new XMLDataType();
      const xml = '<ns:root xmlns:ns="http://example.com"><ns:child>value</ns:child></ns:root>';
      const result = dataType.toXML(xml);

      expect(result).toContain('xmlns');
      expect(result).toContain('ns:');
    });
  });

  describe('fromXML', () => {
    it('should pass through XML', () => {
      const dataType = new XMLDataType();
      const xml = '<root><child>value</child></root>';
      const result = dataType.fromXML(xml);

      expect(result).toBe(xml);
    });
  });

  describe('isSerializationRequired', () => {
    it('should return false', () => {
      const dataType = new XMLDataType();
      expect(dataType.isSerializationRequired()).toBe(false);
    });
  });

  describe('transformWithoutSerializing', () => {
    it('should return null when namespace stripping disabled', () => {
      const dataType = new XMLDataType({ stripNamespaces: false });
      const result = dataType.transformWithoutSerializing('<root/>');

      expect(result).toBeNull();
    });

    it('should strip namespaces when enabled', () => {
      const dataType = new XMLDataType({ stripNamespaces: true });
      const xml = '<ns:root xmlns:ns="http://example.com"/>';
      const result = dataType.transformWithoutSerializing(xml);

      expect(result).not.toContain('xmlns');
      expect(result).not.toContain('ns:');
    });
  });

  describe('getMetaData', () => {
    it('should return default metadata', () => {
      const dataType = new XMLDataType();
      const metadata = dataType.getMetaData('<root/>');

      expect(metadata.version).toBe('1.0');
      expect(metadata.type).toBe('root');
    });

    it('should extract version from XML declaration', () => {
      const dataType = new XMLDataType();
      const xml = '<?xml version="1.1"?><root/>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.version).toBe('1.1');
    });

    it('should extract encoding from XML declaration', () => {
      const dataType = new XMLDataType();
      const xml = '<?xml version="1.0" encoding="UTF-16"?><root/>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.encoding).toBe('UTF-16');
    });

    it('should extract root element name', () => {
      const dataType = new XMLDataType();
      const xml = '<MyDocument><child/></MyDocument>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.rootElement).toBe('MyDocument');
      expect(metadata.type).toBe('MyDocument');
    });

    it('should strip namespace prefix from root element', () => {
      const dataType = new XMLDataType();
      const xml = '<ns:MyDocument xmlns:ns="http://example.com"/>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.rootElement).toBe('MyDocument');
    });

    it('should handle self-closing root element', () => {
      const dataType = new XMLDataType();
      const xml = '<root/>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.rootElement).toBe('root');
    });

    it('should handle root element with attributes', () => {
      const dataType = new XMLDataType();
      const xml = '<root attr="value"><child/></root>';
      const metadata = dataType.getMetaData(xml);

      expect(metadata.rootElement).toBe('root');
    });
  });

  describe('parseXML convenience function', () => {
    it('should parse XML', () => {
      const xml = '<root><child>value</child></root>';
      const result = parseXML(xml);

      expect(result).toBe(xml);
    });

    it('should accept properties', () => {
      const xml = '<ns:root xmlns:ns="http://example.com"/>';
      const result = parseXML(xml, { stripNamespaces: true });

      expect(result).not.toContain('xmlns');
    });
  });

  describe('extractXMLMetaData convenience function', () => {
    it('should extract metadata', () => {
      const xml = '<Document><child/></Document>';
      const metadata = extractXMLMetaData(xml);

      expect(metadata.type).toBe('Document');
    });
  });

  describe('stripNamespaces convenience function', () => {
    it('should strip namespaces', () => {
      const xml = '<ns:root xmlns:ns="http://example.com"><ns:child/></ns:root>';
      const result = stripNamespaces(xml);

      expect(result).not.toContain('xmlns');
      expect(result).not.toContain('ns:');
      expect(result).toContain('<root>');
    });

    it('should handle multiple namespace prefixes', () => {
      const xml = '<a:root xmlns:a="http://a.com" xmlns:b="http://b.com"><a:child b:attr="val"/></a:root>';
      const result = stripNamespaces(xml);

      expect(result).not.toContain('xmlns');
      expect(result).not.toContain('a:');
      expect(result).not.toContain('b:');
    });
  });
});
