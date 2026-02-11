/**
 * Tests for JsonUtil - JSON utility functions for user scripts
 */
import { JsonUtil } from '../../../../src/javascript/userutil/JsonUtil';

describe('JsonUtil', () => {
  describe('prettyPrint', () => {
    it('should format JSON with indentation', () => {
      const input = '{"name":"test","value":42}';
      const result = JsonUtil.prettyPrint(input);
      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 42');
      expect(result.split('\n').length).toBeGreaterThan(1);
    });

    it('should return empty string for empty input', () => {
      expect(JsonUtil.prettyPrint('')).toBe('');
      expect(JsonUtil.prettyPrint('  ')).toBe('');
    });

    it('should handle invalid JSON gracefully', () => {
      const result = JsonUtil.prettyPrint('not json');
      expect(result).toBe('not json');
    });

    it('should handle arrays', () => {
      const input = '[1,2,3]';
      const result = JsonUtil.prettyPrint(input);
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });
  });

  describe('escape', () => {
    it('should escape double quotes', () => {
      expect(JsonUtil.escape('"hello"')).toBe('\\"hello\\"');
    });

    it('should escape backslashes', () => {
      expect(JsonUtil.escape('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should escape newlines', () => {
      expect(JsonUtil.escape('line1\nline2')).toBe('line1\\nline2');
    });

    it('should escape tabs', () => {
      expect(JsonUtil.escape('col1\tcol2')).toBe('col1\\tcol2');
    });

    it('should handle empty input', () => {
      expect(JsonUtil.escape('')).toBe('');
    });
  });

  describe('toXml', () => {
    it('should convert simple JSON to XML', () => {
      const json = '{"name":"test","value":"42"}';
      const xml = JsonUtil.toXml(json);
      expect(xml).toContain('<name>test</name>');
      expect(xml).toContain('<value>42</value>');
    });

    it('should handle arrays by repeating elements', () => {
      const json = '{"items":["a","b","c"]}';
      const xml = JsonUtil.toXml(json);
      expect(xml).toContain('<items>a</items>');
      expect(xml).toContain('<items>b</items>');
      expect(xml).toContain('<items>c</items>');
    });

    it('should handle nested objects', () => {
      const json = '{"parent":{"child":"value"}}';
      const xml = JsonUtil.toXml(json);
      expect(xml).toContain('<parent>');
      expect(xml).toContain('<child>value</child>');
      expect(xml).toContain('</parent>');
    });

    it('should return empty for empty input', () => {
      expect(JsonUtil.toXml('')).toBe('');
    });

    it('should escape XML special characters in values', () => {
      const json = '{"msg":"a & b < c"}';
      const xml = JsonUtil.toXml(json);
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;');
    });
  });

  describe('toXml with options (Fix 4.6)', () => {
    it('should accept prettyPrint option', () => {
      const json = '{"root":{"child":"value"}}';
      const compact = JsonUtil.toXml(json, { prettyPrint: false });
      const pretty = JsonUtil.toXml(json, { prettyPrint: true });
      // Pretty version should have more indentation/newlines
      expect(pretty).toContain('\n');
      // Both should contain the same elements
      expect(compact).toContain('<root>');
      expect(compact).toContain('<child>value</child>');
      expect(pretty).toContain('<root>');
      expect(pretty).toContain('<child>value</child>');
    });

    it('should accept multiplePI option', () => {
      // multiplePI controls whether multiple processing instructions are allowed
      const json = '{"name":"test"}';
      const xml = JsonUtil.toXml(json, { multiplePI: true });
      expect(xml).toContain('<name>test</name>');
    });

    it('should work with no options (backward compatible)', () => {
      const json = '{"a":"1"}';
      const xml1 = JsonUtil.toXml(json);
      const xml2 = JsonUtil.toXml(json, {});
      expect(xml1).toBe(xml2);
    });

    it('should handle empty input with options', () => {
      expect(JsonUtil.toXml('', { prettyPrint: true })).toBe('');
    });

    it('should handle nested objects with prettyPrint', () => {
      const json = '{"parent":{"child":{"grandchild":"val"}}}';
      const pretty = JsonUtil.toXml(json, { prettyPrint: true });
      expect(pretty).toContain('<parent>');
      expect(pretty).toContain('<child>');
      expect(pretty).toContain('<grandchild>val</grandchild>');
    });
  });
});
