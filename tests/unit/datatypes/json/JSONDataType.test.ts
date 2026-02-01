import {
  JSONDataType,
  getDefaultJSONSerializationProperties,
  parseJSON,
  extractJSONMetaData,
  validateJSON,
  minifyJSON,
  prettifyJSON,
} from '../../../../src/datatypes/json/JSONDataType';

describe('JSONDataType', () => {
  describe('getDefaultJSONSerializationProperties', () => {
    it('should return correct defaults', () => {
      const props = getDefaultJSONSerializationProperties();

      expect(props.prettyPrint).toBe(false);
      expect(props.indentation).toBe(2);
    });
  });

  describe('constructor', () => {
    it('should create JSONDataType with default properties', () => {
      const dataType = new JSONDataType();
      expect(dataType).toBeDefined();
    });

    it('should create JSONDataType with custom properties', () => {
      const dataType = new JSONDataType({ prettyPrint: true, indentation: 4 });
      expect(dataType).toBeDefined();
    });
  });

  describe('toJSON', () => {
    it('should pass through JSON', () => {
      const dataType = new JSONDataType();
      const json = '{"key":"value"}';
      const result = dataType.toJSON(json);

      expect(result).toBe(json);
    });

    it('should pretty print when configured', () => {
      const dataType = new JSONDataType({ prettyPrint: true });
      const json = '{"key":"value","nested":{"a":1}}';
      const result = dataType.toJSON(json);

      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('should use custom indentation', () => {
      const dataType = new JSONDataType({ prettyPrint: true, indentation: 4 });
      const json = '{"key":"value"}';
      const result = dataType.toJSON(json);

      expect(result).toContain('    ');
    });

    it('should return invalid JSON as-is', () => {
      const dataType = new JSONDataType({ prettyPrint: true });
      const invalid = 'not json';
      const result = dataType.toJSON(invalid);

      expect(result).toBe(invalid);
    });
  });

  describe('fromJSON', () => {
    it('should pass through JSON', () => {
      const dataType = new JSONDataType();
      const json = '{"key":"value"}';
      const result = dataType.fromJSON(json);

      expect(result).toBe(json);
    });
  });

  describe('toXML', () => {
    it('should convert simple JSON object to XML', () => {
      const dataType = new JSONDataType();
      const json = '{"name":"John","age":30}';
      const xml = dataType.toXML(json, 'person');
      expect(xml).toBe('<person><name>John</name><age>30</age></person>');
    });

    it('should convert JSON array to XML', () => {
      const dataType = new JSONDataType();
      const json = '[{"id":1},{"id":2}]';
      const xml = dataType.toXML(json, 'item');
      expect(xml).toBe('<item><id>1</id></item><item><id>2</id></item>');
    });

    it('should return null for invalid JSON', () => {
      const dataType = new JSONDataType();
      expect(dataType.toXML('invalid json', 'root')).toBeNull();
    });

    it('should escape special XML characters', () => {
      const dataType = new JSONDataType();
      const json = '{"text":"<test>&value</test>"}';
      const xml = dataType.toXML(json, 'root');
      expect(xml).toBe('<root><text>&lt;test&gt;&amp;value&lt;/test&gt;</text></root>');
    });
  });

  describe('fromXML', () => {
    it('should convert simple XML to JSON', () => {
      const dataType = new JSONDataType();
      const xml = '<person><name>John</name><age>30</age></person>';
      const json = dataType.fromXML(xml);
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed).toEqual({ name: 'John', age: '30' });
    });

    it('should handle repeated elements as arrays', () => {
      const dataType = new JSONDataType();
      const xml = '<root><item>a</item><item>b</item></root>';
      const json = dataType.fromXML(xml);
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed).toEqual({ item: ['a', 'b'] });
    });

    it('should return null for invalid XML', () => {
      const dataType = new JSONDataType();
      expect(dataType.fromXML('not xml at all {')).toBeNull();
    });
  });

  describe('isSerializationRequired', () => {
    it('should return false', () => {
      const dataType = new JSONDataType();
      expect(dataType.isSerializationRequired()).toBe(false);
    });
  });

  describe('transformWithoutSerializing', () => {
    it('should return null', () => {
      const dataType = new JSONDataType();
      expect(dataType.transformWithoutSerializing()).toBeNull();
    });
  });

  describe('getMetaData', () => {
    it('should return default metadata', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('{"key":"value"}');

      expect(metadata.type).toBe('key');
      expect(metadata.rootType).toBe('object');
    });

    it('should identify object root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('{"a":1,"b":2}');

      expect(metadata.rootType).toBe('object');
      expect(metadata.topLevelKeys).toEqual(['a', 'b']);
    });

    it('should identify array root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('[1,2,3]');

      expect(metadata.rootType).toBe('array');
      expect(metadata.type).toBe('JSON');
    });

    it('should identify null root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('null');

      expect(metadata.rootType).toBe('null');
    });

    it('should identify string root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('"hello"');

      expect(metadata.rootType).toBe('string');
    });

    it('should identify number root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('42');

      expect(metadata.rootType).toBe('number');
    });

    it('should identify boolean root type', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('true');

      expect(metadata.rootType).toBe('boolean');
    });

    it('should use first key as type for objects', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('{"Patient":{"name":"John"}}');

      expect(metadata.type).toBe('Patient');
    });

    it('should return default metadata for invalid JSON', () => {
      const dataType = new JSONDataType();
      const metadata = dataType.getMetaData('not json');

      expect(metadata.type).toBe('JSON');
      expect(metadata.rootType).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('should validate valid JSON', () => {
      const dataType = new JSONDataType();
      const result = dataType.validate('{"key":"value"}');

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate valid array JSON', () => {
      const dataType = new JSONDataType();
      const result = dataType.validate('[1,2,3]');

      expect(result.valid).toBe(true);
    });

    it('should validate valid primitive JSON', () => {
      const dataType = new JSONDataType();

      expect(dataType.validate('"string"').valid).toBe(true);
      expect(dataType.validate('42').valid).toBe(true);
      expect(dataType.validate('true').valid).toBe(true);
      expect(dataType.validate('null').valid).toBe(true);
    });

    it('should invalidate invalid JSON', () => {
      const dataType = new JSONDataType();
      const result = dataType.validate('not json');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should invalidate unclosed object', () => {
      const dataType = new JSONDataType();
      const result = dataType.validate('{"key":"value"');

      expect(result.valid).toBe(false);
    });

    it('should invalidate trailing comma', () => {
      const dataType = new JSONDataType();
      const result = dataType.validate('{"key":"value",}');

      expect(result.valid).toBe(false);
    });
  });

  describe('minify', () => {
    it('should minify pretty-printed JSON', () => {
      const dataType = new JSONDataType();
      const json = `{
        "key": "value",
        "nested": {
          "a": 1
        }
      }`;
      const result = dataType.minify(json);

      expect(result).toBe('{"key":"value","nested":{"a":1}}');
    });

    it('should return invalid JSON as-is', () => {
      const dataType = new JSONDataType();
      const invalid = 'not json';
      const result = dataType.minify(invalid);

      expect(result).toBe(invalid);
    });
  });

  describe('prettify', () => {
    it('should prettify minified JSON', () => {
      const dataType = new JSONDataType();
      const json = '{"key":"value","nested":{"a":1}}';
      const result = dataType.prettify(json);

      expect(result).toContain('\n');
      expect(result).toContain('  "key"');
    });

    it('should use custom indentation', () => {
      const dataType = new JSONDataType();
      const json = '{"key":"value"}';
      const result = dataType.prettify(json, 4);

      expect(result).toContain('    "key"');
    });

    it('should return invalid JSON as-is', () => {
      const dataType = new JSONDataType();
      const invalid = 'not json';
      const result = dataType.prettify(invalid);

      expect(result).toBe(invalid);
    });
  });

  describe('parseJSON convenience function', () => {
    it('should parse JSON', () => {
      const json = '{"key":"value"}';
      const result = parseJSON(json);

      expect(result).toBe(json);
    });

    it('should accept properties', () => {
      const json = '{"key":"value"}';
      const result = parseJSON(json, { prettyPrint: true });

      expect(result).toContain('\n');
    });
  });

  describe('extractJSONMetaData convenience function', () => {
    it('should extract metadata', () => {
      const json = '{"Document":{"id":1}}';
      const metadata = extractJSONMetaData(json);

      expect(metadata.type).toBe('Document');
      expect(metadata.rootType).toBe('object');
    });
  });

  describe('validateJSON convenience function', () => {
    it('should validate JSON', () => {
      expect(validateJSON('{"valid":true}').valid).toBe(true);
      expect(validateJSON('invalid').valid).toBe(false);
    });
  });

  describe('minifyJSON convenience function', () => {
    it('should minify JSON', () => {
      const json = '{ "key": "value" }';
      const result = minifyJSON(json);

      expect(result).toBe('{"key":"value"}');
    });
  });

  describe('prettifyJSON convenience function', () => {
    it('should prettify JSON', () => {
      const json = '{"key":"value"}';
      const result = prettifyJSON(json);

      expect(result).toContain('\n');
    });

    it('should accept custom indentation', () => {
      const json = '{"key":"value"}';
      const result = prettifyJSON(json, 4);

      expect(result).toContain('    ');
    });
  });
});
