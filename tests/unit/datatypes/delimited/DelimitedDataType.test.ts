/**
 * Unit tests for Delimited DataType
 *
 * Tests CSV, pipe-delimited, tab-delimited, and fixed-width parsing.
 */

import {
  DelimitedDataType,
  DelimitedParser,
  DelimitedSerializer,
  parseDelimitedToXML,
  serializeXMLToDelimited,
  getDefaultDelimitedSerializationProperties,
  getDefaultDelimitedDeserializationProperties,
  getDefaultDelimitedDataTypeProperties,
  unescapeDelimiter,
  escapeDelimiter,
  isValidXMLElementName,
  parseColumnWidths,
  parseColumnNames,
  extractDelimitedMetaData,
} from '../../../../src/datatypes/delimited/index.js';

describe('DelimitedProperties', () => {
  describe('Default Properties', () => {
    it('should return correct default serialization properties', () => {
      const props = getDefaultDelimitedSerializationProperties();
      expect(props.columnDelimiter).toBe(',');
      expect(props.recordDelimiter).toBe('\\n');
      expect(props.columnWidths).toBeNull();
      expect(props.quoteToken).toBe('"');
      expect(props.escapeWithDoubleQuote).toBe(true);
      expect(props.quoteEscapeToken).toBe('\\');
      expect(props.columnNames).toBeNull();
      expect(props.numberedRows).toBe(false);
      expect(props.ignoreCR).toBe(true);
    });

    it('should return correct default deserialization properties', () => {
      const props = getDefaultDelimitedDeserializationProperties();
      expect(props.columnDelimiter).toBe(',');
      expect(props.recordDelimiter).toBe('\\n');
      expect(props.columnWidths).toBeNull();
      expect(props.quoteToken).toBe('"');
      expect(props.escapeWithDoubleQuote).toBe(true);
      expect(props.quoteEscapeToken).toBe('\\');
    });

    it('should return correct default data type properties', () => {
      const props = getDefaultDelimitedDataTypeProperties();
      expect(props.serializationProperties).toBeDefined();
      expect(props.deserializationProperties).toBeDefined();
    });
  });

  describe('unescapeDelimiter', () => {
    it('should unescape newline', () => {
      expect(unescapeDelimiter('\\n')).toBe('\n');
    });

    it('should unescape carriage return', () => {
      expect(unescapeDelimiter('\\r')).toBe('\r');
    });

    it('should unescape tab', () => {
      expect(unescapeDelimiter('\\t')).toBe('\t');
    });

    it('should unescape backslash', () => {
      expect(unescapeDelimiter('\\\\')).toBe('\\');
    });

    it('should handle combined escapes', () => {
      expect(unescapeDelimiter('\\r\\n')).toBe('\r\n');
    });

    it('should leave other characters unchanged', () => {
      expect(unescapeDelimiter(',')).toBe(',');
      expect(unescapeDelimiter('|')).toBe('|');
    });
  });

  describe('escapeDelimiter', () => {
    it('should escape newline', () => {
      expect(escapeDelimiter('\n')).toBe('\\n');
    });

    it('should escape carriage return', () => {
      expect(escapeDelimiter('\r')).toBe('\\r');
    });

    it('should escape tab', () => {
      expect(escapeDelimiter('\t')).toBe('\\t');
    });
  });

  describe('isValidXMLElementName', () => {
    it('should accept valid names', () => {
      expect(isValidXMLElementName('column1')).toBe(true);
      expect(isValidXMLElementName('firstName')).toBe(true);
      expect(isValidXMLElementName('_private')).toBe(true);
      expect(isValidXMLElementName(':prefix')).toBe(true);
      expect(isValidXMLElementName('name-with-dash')).toBe(true);
      expect(isValidXMLElementName('name.with.dots')).toBe(true);
    });

    it('should reject invalid names', () => {
      expect(isValidXMLElementName('')).toBe(false);
      expect(isValidXMLElementName('123column')).toBe(false);
      expect(isValidXMLElementName('-invalid')).toBe(false);
      expect(isValidXMLElementName('has space')).toBe(false);
      expect(isValidXMLElementName('has@symbol')).toBe(false);
    });
  });

  describe('parseColumnWidths', () => {
    it('should parse comma-separated widths', () => {
      expect(parseColumnWidths('10,20,30')).toEqual([10, 20, 30]);
    });

    it('should return null for empty string', () => {
      expect(parseColumnWidths('')).toBeNull();
      expect(parseColumnWidths('  ')).toBeNull();
    });

    it('should throw for invalid widths', () => {
      expect(() => parseColumnWidths('10,abc,30')).toThrow();
      expect(() => parseColumnWidths('10,-5,30')).toThrow();
      expect(() => parseColumnWidths('10,0,30')).toThrow();
    });
  });

  describe('parseColumnNames', () => {
    it('should parse comma-separated names', () => {
      expect(parseColumnNames('name,age,city')).toEqual([
        'name',
        'age',
        'city',
      ]);
    });

    it('should return null for empty string', () => {
      expect(parseColumnNames('')).toBeNull();
    });

    it('should throw for invalid names', () => {
      expect(() => parseColumnNames('valid,123invalid')).toThrow();
    });
  });
});

describe('DelimitedParser', () => {
  describe('CSV Parsing', () => {
    it('should parse simple CSV', () => {
      const csv = 'a,b,c\n1,2,3';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      expect(xml).toContain('<delimited>');
      expect(xml).toContain('<row>');
      expect(xml).toContain('<column1>a</column1>');
      expect(xml).toContain('<column2>b</column2>');
      expect(xml).toContain('<column3>c</column3>');
      expect(xml).toContain('<column1>1</column1>');
      expect(xml).toContain('<column2>2</column2>');
      expect(xml).toContain('<column3>3</column3>');
      expect(xml).toContain('</delimited>');
    });

    it('should handle quoted values', () => {
      const csv = '"hello, world",test';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      expect(xml).toContain('<column1>hello, world</column1>');
      expect(xml).toContain('<column2>test</column2>');
    });

    it('should handle escaped quotes with double quote', () => {
      const csv = '"say ""hello""",test';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      // Quotes are XML-escaped in the output
      expect(xml).toContain('<column1>say &quot;hello&quot;</column1>');
    });

    it('should handle empty values', () => {
      const csv = 'a,,c';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      expect(xml).toContain('<column1>a</column1>');
      expect(xml).toContain('<column2></column2>');
      expect(xml).toContain('<column3>c</column3>');
    });

    it('should escape XML entities', () => {
      const csv = '<tag>,&amp';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      expect(xml).toContain('<column1>&lt;tag&gt;</column1>');
      expect(xml).toContain('<column2>&amp;amp</column2>');
    });
  });

  describe('Pipe-Delimited Parsing', () => {
    it('should parse pipe-delimited data', () => {
      const data = 'a|b|c\n1|2|3';
      const parser = new DelimitedParser({ columnDelimiter: '|' });
      const xml = parser.parse(data);

      expect(xml).toContain('<column1>a</column1>');
      expect(xml).toContain('<column2>b</column2>');
    });
  });

  describe('Tab-Delimited Parsing', () => {
    it('should parse tab-delimited data', () => {
      const data = 'a\tb\tc\n1\t2\t3';
      const parser = new DelimitedParser({ columnDelimiter: '\\t' });
      const xml = parser.parse(data);

      expect(xml).toContain('<column1>a</column1>');
      expect(xml).toContain('<column2>b</column2>');
    });
  });

  describe('Fixed-Width Parsing', () => {
    it('should parse fixed-width data', () => {
      const data = 'John     Smith    30\nJane     Doe      25';
      const parser = new DelimitedParser({ columnWidths: [9, 9, 2] });
      const xml = parser.parse(data);

      expect(xml).toContain('<column1>John</column1>');
      expect(xml).toContain('<column2>Smith</column2>');
      expect(xml).toContain('<column3>30</column3>');
      expect(xml).toContain('<column1>Jane</column1>');
    });
  });

  describe('Custom Column Names', () => {
    it('should use custom column names', () => {
      const csv = 'John,30';
      const parser = new DelimitedParser({ columnNames: ['name', 'age'] });
      const xml = parser.parse(csv);

      expect(xml).toContain('<name>John</name>');
      expect(xml).toContain('<age>30</age>');
    });
  });

  describe('Numbered Rows', () => {
    it('should number rows when enabled', () => {
      const csv = 'a\nb';
      const parser = new DelimitedParser({ numberedRows: true });
      const xml = parser.parse(csv);

      expect(xml).toContain('<row1>');
      expect(xml).toContain('</row1>');
      expect(xml).toContain('<row2>');
      expect(xml).toContain('</row2>');
    });
  });

  describe('Carriage Return Handling', () => {
    it('should ignore CR by default', () => {
      const csv = 'a,b\r\nc,d';
      const parser = new DelimitedParser();
      const xml = parser.parse(csv);

      expect(xml).toContain('<column1>a</column1>');
      expect(xml).toContain('<column1>c</column1>');
    });

    it('should preserve CR when ignoreCR is false', () => {
      const csv = 'a\rb';
      const parser = new DelimitedParser({
        ignoreCR: false,
        recordDelimiter: '\\r',
      });
      const xml = parser.parse(csv);

      expect(xml).toContain('<column1>a</column1>');
    });
  });
});

describe('DelimitedSerializer', () => {
  describe('XML to CSV', () => {
    it('should serialize simple XML to CSV', () => {
      const xml =
        '<delimited><row><column1>a</column1><column2>b</column2></row></delimited>';
      const serializer = new DelimitedSerializer();
      const csv = serializer.serialize(xml);

      expect(csv).toBe('a,b');
    });

    it('should serialize multiple rows', () => {
      const xml =
        '<delimited><row><column1>a</column1></row><row><column1>b</column1></row></delimited>';
      const serializer = new DelimitedSerializer();
      const csv = serializer.serialize(xml);

      expect(csv).toBe('a\nb');
    });

    it('should handle numbered rows', () => {
      const xml =
        '<delimited><row1><column1>a</column1></row1><row2><column1>b</column1></row2></delimited>';
      const serializer = new DelimitedSerializer();
      const csv = serializer.serialize(xml);

      expect(csv).toBe('a\nb');
    });
  });

  describe('Custom Delimiters', () => {
    it('should use pipe delimiter', () => {
      const xml =
        '<delimited><row><column1>a</column1><column2>b</column2></row></delimited>';
      const serializer = new DelimitedSerializer({ columnDelimiter: '|' });
      const csv = serializer.serialize(xml);

      expect(csv).toBe('a|b');
    });
  });
});

describe('DelimitedDataType', () => {
  describe('isSerializationRequired', () => {
    it('should return false for default properties', () => {
      const dataType = new DelimitedDataType();
      // Default properties match exactly, so no serialization needed
      expect(dataType.isSerializationRequired(true)).toBe(false);
      expect(dataType.isSerializationRequired(false)).toBe(false);
    });

    it('should return true for non-default properties', () => {
      const dataType = new DelimitedDataType({
        serializationProperties: { columnDelimiter: '|' },
      });
      expect(dataType.isSerializationRequired(true)).toBe(true);
    });
  });

  describe('toXML and fromXML', () => {
    it('should convert CSV to XML and back', () => {
      const dataType = new DelimitedDataType();
      const csv = 'a,b,c';
      const xml = dataType.toXML(csv);
      expect(xml).toContain('<column1>a</column1>');

      const result = dataType.fromXML(xml);
      expect(result).toBe('a,b,c');
    });
  });

  describe('Metadata', () => {
    it('should return correct metadata', () => {
      const dataType = new DelimitedDataType();
      const meta = dataType.getMetaData('a,b,c');

      expect(meta.type).toBe('delimited');
      expect(meta.version).toBe('');
    });

    it('should populate metadata map', () => {
      const dataType = new DelimitedDataType();
      const map: Record<string, unknown> = {};
      dataType.populateMetaData('a,b,c', map);

      expect(map['type']).toBe('delimited');
      expect(map['version']).toBe('');
    });
  });

  describe('JSON conversion', () => {
    it('should return null for toJSON', () => {
      const dataType = new DelimitedDataType();
      expect(dataType.toJSON('a,b')).toBeNull();
    });

    it('should return null for fromJSON', () => {
      const dataType = new DelimitedDataType();
      expect(dataType.fromJSON('{}')).toBeNull();
    });
  });

  describe('transformWithoutSerializing', () => {
    it('should return null', () => {
      const dataType = new DelimitedDataType();
      expect(dataType.transformWithoutSerializing('a,b')).toBeNull();
    });
  });

  describe('Purged Properties', () => {
    it('should return purged properties', () => {
      const dataType = new DelimitedDataType({
        serializationProperties: {
          columnNames: ['a', 'b', 'c'],
          numberedRows: true,
        },
      });
      const purged = dataType.getPurgedProperties();

      const serProps = purged.serializationProperties as Record<
        string,
        unknown
      >;
      expect(serProps.columnNameCount).toBe(3);
      expect(serProps.numberedRows).toBe(true);
    });
  });
});

describe('Convenience Functions', () => {
  describe('parseDelimitedToXML', () => {
    it('should parse CSV to XML', () => {
      const xml = parseDelimitedToXML('a,b,c');
      expect(xml).toContain('<column1>a</column1>');
    });
  });

  describe('serializeXMLToDelimited', () => {
    it('should serialize XML to CSV', () => {
      const xml =
        '<delimited><row><column1>a</column1><column2>b</column2></row></delimited>';
      const csv = serializeXMLToDelimited(xml);
      expect(csv).toBe('a,b');
    });
  });

  describe('extractDelimitedMetaData', () => {
    it('should return delimited metadata', () => {
      const meta = extractDelimitedMetaData('a,b,c');
      expect(meta.type).toBe('delimited');
      expect(meta.version).toBe('');
    });
  });
});
