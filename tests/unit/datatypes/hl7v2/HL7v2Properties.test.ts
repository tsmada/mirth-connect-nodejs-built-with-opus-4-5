import {
  HL7V2_DEFAULTS,
  getDefaultSerializationProperties,
  getDefaultDeserializationProperties,
  extractEncodingCharacters,
  unescapeSegmentDelimiter,
  escapeSegmentDelimiter,
} from '../../../../src/datatypes/hl7v2/HL7v2Properties';

describe('HL7v2Properties', () => {
  describe('HL7V2_DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(HL7V2_DEFAULTS.FIELD_SEPARATOR).toBe('|');
      expect(HL7V2_DEFAULTS.COMPONENT_SEPARATOR).toBe('^');
      expect(HL7V2_DEFAULTS.REPETITION_SEPARATOR).toBe('~');
      expect(HL7V2_DEFAULTS.ESCAPE_CHARACTER).toBe('\\');
      expect(HL7V2_DEFAULTS.SUBCOMPONENT_SEPARATOR).toBe('&');
      expect(HL7V2_DEFAULTS.SEGMENT_DELIMITER).toBe('\r');
    });
  });

  describe('getDefaultSerializationProperties', () => {
    it('should return correct defaults', () => {
      const props = getDefaultSerializationProperties();

      expect(props.handleRepetitions).toBe(true);
      expect(props.handleSubcomponents).toBe(true);
      expect(props.useStrictParser).toBe(false);
      expect(props.useStrictValidation).toBe(false);
      expect(props.segmentDelimiter).toBe('\r');
      expect(props.convertLineBreaks).toBe(true);
      expect(props.stripNamespaces).toBe(false);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultSerializationProperties();
      const props2 = getDefaultSerializationProperties();

      props1.handleRepetitions = false;
      expect(props2.handleRepetitions).toBe(true);
    });
  });

  describe('getDefaultDeserializationProperties', () => {
    it('should return correct defaults', () => {
      const props = getDefaultDeserializationProperties();

      expect(props.useStrictParser).toBe(false);
      expect(props.useStrictValidation).toBe(false);
      expect(props.segmentDelimiter).toBe('\r');
    });
  });

  describe('extractEncodingCharacters', () => {
    it('should extract standard encoding characters', () => {
      const message = 'MSH|^~\\&|SENDER|FACILITY||';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
      expect(encoding.repetitionSeparator).toBe('~');
      expect(encoding.escapeCharacter).toBe('\\');
      expect(encoding.subcomponentSeparator).toBe('&');
    });

    it('should handle custom encoding characters', () => {
      const message = 'MSH#!@%$#SENDER#FACILITY##';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('#');
      expect(encoding.componentSeparator).toBe('!');
      expect(encoding.repetitionSeparator).toBe('@');
      expect(encoding.escapeCharacter).toBe('%');
      expect(encoding.subcomponentSeparator).toBe('$');
    });

    it('should handle FHS segment', () => {
      const message = 'FHS|^~\\&|SENDER|';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
    });

    it('should handle BHS segment', () => {
      const message = 'BHS|^~\\&|SENDER|';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
    });

    it('should return defaults for non-header segments', () => {
      const message = 'PID|1||123456||DOE^JOHN||';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
    });

    it('should return defaults for empty message', () => {
      const encoding = extractEncodingCharacters('');

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
    });

    it('should return defaults for short message', () => {
      const encoding = extractEncodingCharacters('MS');

      expect(encoding.fieldSeparator).toBe('|');
    });

    it('should handle message with missing encoding chars', () => {
      const message = 'MSH|^|SENDER|';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
      expect(encoding.repetitionSeparator).toBe('~'); // default
    });

    it('should handle special case ^~& (missing escape)', () => {
      const message = 'MSH|^~&|SENDER|';
      const encoding = extractEncodingCharacters(message);

      expect(encoding.fieldSeparator).toBe('|');
      expect(encoding.componentSeparator).toBe('^');
      expect(encoding.repetitionSeparator).toBe('~');
      expect(encoding.escapeCharacter).toBe('\\');
      expect(encoding.subcomponentSeparator).toBe('&');
    });
  });

  describe('unescapeSegmentDelimiter', () => {
    it('should convert \\r to carriage return', () => {
      expect(unescapeSegmentDelimiter('\\r')).toBe('\r');
    });

    it('should convert \\n to newline', () => {
      expect(unescapeSegmentDelimiter('\\n')).toBe('\n');
    });

    it('should convert \\t to tab', () => {
      expect(unescapeSegmentDelimiter('\\t')).toBe('\t');
    });

    it('should convert \\r\\n to CRLF', () => {
      expect(unescapeSegmentDelimiter('\\r\\n')).toBe('\r\n');
    });

    it('should leave other characters unchanged', () => {
      expect(unescapeSegmentDelimiter('|')).toBe('|');
    });
  });

  describe('escapeSegmentDelimiter', () => {
    it('should escape carriage return', () => {
      expect(escapeSegmentDelimiter('\r')).toBe('\\r');
    });

    it('should escape newline', () => {
      expect(escapeSegmentDelimiter('\n')).toBe('\\n');
    });

    it('should escape tab', () => {
      expect(escapeSegmentDelimiter('\t')).toBe('\\t');
    });

    it('should escape CRLF', () => {
      expect(escapeSegmentDelimiter('\r\n')).toBe('\\r\\n');
    });
  });
});
