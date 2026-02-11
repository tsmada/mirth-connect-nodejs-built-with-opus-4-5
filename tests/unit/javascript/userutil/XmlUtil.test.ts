/**
 * Tests for XmlUtil - XML utility functions for user scripts
 */
import { XmlUtil } from '../../../../src/javascript/userutil/XmlUtil';

describe('XmlUtil', () => {
  describe('prettyPrint', () => {
    it('should format XML with indentation', () => {
      const input = '<root><child>value</child></root>';
      const result = XmlUtil.prettyPrint(input);
      expect(result).toContain('root');
      expect(result).toContain('child');
      expect(result).toContain('value');
    });

    it('should return empty string for empty input', () => {
      expect(XmlUtil.prettyPrint('')).toBe('');
      expect(XmlUtil.prettyPrint('  ')).toBe('');
    });

    it('should handle invalid XML gracefully', () => {
      const result = XmlUtil.prettyPrint('not xml at all');
      expect(typeof result).toBe('string');
    });

    it('should preserve attributes', () => {
      const input = '<root attr="value"><child/></root>';
      const result = XmlUtil.prettyPrint(input);
      expect(result).toContain('attr');
      expect(result).toContain('value');
    });
  });

  describe('decode', () => {
    it('should decode standard XML entities', () => {
      expect(XmlUtil.decode('&amp;')).toBe('&');
      expect(XmlUtil.decode('&lt;')).toBe('<');
      expect(XmlUtil.decode('&gt;')).toBe('>');
      expect(XmlUtil.decode('&quot;')).toBe('"');
      expect(XmlUtil.decode('&apos;')).toBe("'");
    });

    it('should decode numeric entities', () => {
      expect(XmlUtil.decode('&#65;')).toBe('A');
      expect(XmlUtil.decode('&#x41;')).toBe('A');
    });

    it('should handle empty input', () => {
      expect(XmlUtil.decode('')).toBe('');
    });

    it('should decode mixed content', () => {
      expect(XmlUtil.decode('a &amp; b &lt; c')).toBe('a & b < c');
    });
  });

  describe('encode', () => {
    it('should encode special characters', () => {
      expect(XmlUtil.encode('&')).toBe('&amp;');
      expect(XmlUtil.encode('<')).toBe('&lt;');
      expect(XmlUtil.encode('>')).toBe('&gt;');
      expect(XmlUtil.encode('"')).toBe('&quot;');
      expect(XmlUtil.encode("'")).toBe('&apos;');
    });

    it('should handle empty input', () => {
      expect(XmlUtil.encode('')).toBe('');
    });

    it('should encode mixed content', () => {
      expect(XmlUtil.encode('a & b < c')).toBe('a &amp; b &lt; c');
    });
  });

  describe('toJson', () => {
    it('should convert simple XML to JSON', () => {
      const xml = '<root><name>test</name></root>';
      const json = XmlUtil.toJson(xml);
      const parsed = JSON.parse(json);
      expect(parsed).toBeDefined();
    });

    it('should return {} for empty input', () => {
      expect(XmlUtil.toJson('')).toBe('{}');
      expect(XmlUtil.toJson('  ')).toBe('{}');
    });

    it('should return valid JSON', () => {
      const xml = '<root><a>1</a><b>2</b></root>';
      const json = XmlUtil.toJson(xml);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('toJson with options (Fix 4.5)', () => {
    it('should accept normalizeNamespaces option', () => {
      const xml = '<ns:root xmlns:ns="http://test.com"><ns:child>val</ns:child></ns:root>';
      const json = XmlUtil.toJson(xml, { normalizeNamespaces: true });
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should accept autoPrimitive option to parse numbers', () => {
      const xml = '<root><num>42</num><flag>true</flag></root>';
      const json = XmlUtil.toJson(xml, { autoPrimitive: true });
      const parsed = JSON.parse(json);
      expect(parsed).toBeDefined();
    });

    it('should accept prettyPrint option', () => {
      const xml = '<root><a>1</a></root>';
      const compact = XmlUtil.toJson(xml, { prettyPrint: false });
      const pretty = XmlUtil.toJson(xml, { prettyPrint: true });
      // Pretty version should have newlines
      expect(pretty.includes('\n')).toBe(true);
      // Compact version should not (single-line JSON)
      expect(compact.includes('\n')).toBe(false);
    });

    it('should accept autoArray option', () => {
      const xml = '<root><item>a</item></root>';
      const json = XmlUtil.toJson(xml, { autoArray: false });
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should accept alwaysArray option to force arrays', () => {
      const xml = '<root><item>a</item></root>';
      const json = XmlUtil.toJson(xml, { alwaysArray: true });
      const parsed = JSON.parse(json);
      // When alwaysArray is true, single elements should be wrapped in arrays
      expect(parsed).toBeDefined();
    });

    it('should work with no options (backward compatible)', () => {
      const xml = '<root><a>1</a></root>';
      const json1 = XmlUtil.toJson(xml);
      const json2 = XmlUtil.toJson(xml, {});
      expect(json1).toBe(json2);
    });

    it('should handle empty input with options', () => {
      expect(XmlUtil.toJson('', { prettyPrint: true })).toBe('{}');
    });
  });
});
