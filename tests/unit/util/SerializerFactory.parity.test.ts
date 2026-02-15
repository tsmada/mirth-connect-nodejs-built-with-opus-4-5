/**
 * Parity tests for SerializerFactory default properties.
 *
 * Validates that factory defaults match Java Mirth source:
 * - DelimitedSerializationProperties.java (9 fields)
 * - DelimitedDeserializationProperties.java (6 fields)
 * - HL7V3SerializationProperties.java (stripNamespaces = false)
 */

import { SerializerFactory } from '../../../src/util/SerializerFactory.js';

describe('SerializerFactory parity tests', () => {
  describe('SPC-W3-004: DELIMITED serialization defaults (9 Java fields)', () => {
    const props = SerializerFactory.getDefaultSerializationProperties('DELIMITED');

    it('should return non-null properties for DELIMITED', () => {
      expect(props).not.toBeNull();
    });

    it('should have columnDelimiter = ","', () => {
      expect(props!.columnDelimiter).toBe(',');
    });

    it('should have recordDelimiter = "\\n"', () => {
      expect(props!.recordDelimiter).toBe('\\n');
    });

    it('should have columnWidths = null', () => {
      expect(props!.columnWidths).toBeNull();
    });

    it('should have quoteToken = \'"\' ', () => {
      expect(props!.quoteToken).toBe('"');
    });

    it('should have escapeWithDoubleQuote = true', () => {
      expect(props!.escapeWithDoubleQuote).toBe(true);
    });

    it('should have quoteEscapeToken = "\\"', () => {
      expect(props!.quoteEscapeToken).toBe('\\');
    });

    it('should have columnNames = null', () => {
      expect(props!.columnNames).toBeNull();
    });

    it('should have numberedRows = false', () => {
      expect(props!.numberedRows).toBe(false);
    });

    it('should have ignoreCR = true', () => {
      expect(props!.ignoreCR).toBe(true);
    });

    it('should have exactly 9 defined properties', () => {
      const keys = Object.keys(props!);
      expect(keys).toHaveLength(9);
    });
  });

  describe('SPC-W3-005: DELIMITED deserialization defaults (6 Java fields)', () => {
    const props = SerializerFactory.getDefaultDeserializationProperties('DELIMITED');

    it('should return non-null properties for DELIMITED', () => {
      expect(props).not.toBeNull();
    });

    it('should have columnDelimiter = ","', () => {
      expect(props!.columnDelimiter).toBe(',');
    });

    it('should have recordDelimiter = "\\n"', () => {
      expect(props!.recordDelimiter).toBe('\\n');
    });

    it('should have columnWidths = null', () => {
      expect(props!.columnWidths).toBeNull();
    });

    it('should have quoteToken = \'"\' ', () => {
      expect(props!.quoteToken).toBe('"');
    });

    it('should have escapeWithDoubleQuote = true', () => {
      expect(props!.escapeWithDoubleQuote).toBe(true);
    });

    it('should have quoteEscapeToken = "\\"', () => {
      expect(props!.quoteEscapeToken).toBe('\\');
    });

    it('should have exactly 6 defined properties', () => {
      const keys = Object.keys(props!);
      expect(keys).toHaveLength(6);
    });
  });

  describe('SPC-W3-007: HL7V3 serialization stripNamespaces default', () => {
    const props = SerializerFactory.getDefaultSerializationProperties('HL7V3');

    it('should return non-null properties for HL7V3', () => {
      expect(props).not.toBeNull();
    });

    it('should have stripNamespaces = false (matching Java HL7V3SerializationProperties.java:23)', () => {
      expect(props!.stripNamespaces).toBe(false);
    });
  });

  describe('DELIMITED vs RAW serialization defaults are distinct', () => {
    it('RAW serialization should return empty object', () => {
      const rawProps = SerializerFactory.getDefaultSerializationProperties('RAW');
      expect(rawProps).not.toBeNull();
      expect(Object.keys(rawProps!)).toHaveLength(0);
    });

    it('DELIMITED serialization should have properties while RAW does not', () => {
      const rawProps = SerializerFactory.getDefaultSerializationProperties('RAW');
      const delimitedProps = SerializerFactory.getDefaultSerializationProperties('DELIMITED');
      expect(Object.keys(rawProps!)).toHaveLength(0);
      expect(Object.keys(delimitedProps!).length).toBeGreaterThan(0);
    });

    it('RAW deserialization should return empty object', () => {
      const rawProps = SerializerFactory.getDefaultDeserializationProperties('RAW');
      expect(rawProps).not.toBeNull();
      expect(Object.keys(rawProps!)).toHaveLength(0);
    });

    it('DELIMITED deserialization should have properties while RAW does not', () => {
      const rawProps = SerializerFactory.getDefaultDeserializationProperties('RAW');
      const delimitedProps = SerializerFactory.getDefaultDeserializationProperties('DELIMITED');
      expect(Object.keys(rawProps!)).toHaveLength(0);
      expect(Object.keys(delimitedProps!).length).toBeGreaterThan(0);
    });
  });
});
