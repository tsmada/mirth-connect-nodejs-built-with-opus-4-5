/**
 * Ported from:
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2SerializationProperties.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2DeserializationProperties.java
 *
 * Purpose: Configuration properties for HL7v2 serialization and deserialization
 */

/**
 * Default HL7v2 delimiters
 */
export const HL7V2_DEFAULTS = {
  FIELD_SEPARATOR: '|',
  COMPONENT_SEPARATOR: '^',
  REPETITION_SEPARATOR: '~',
  ESCAPE_CHARACTER: '\\',
  SUBCOMPONENT_SEPARATOR: '&',
  SEGMENT_DELIMITER: '\r',
};

/**
 * Properties for HL7v2 serialization (ER7 -> XML)
 */
export interface HL7v2SerializationProperties {
  /** Handle field repetitions (e.g., PID-3 repeated with ~) */
  handleRepetitions: boolean;
  /** Handle subcomponents (e.g., CX.4 with &) */
  handleSubcomponents: boolean;
  /** Use strict HL7 parser (HAPI) */
  useStrictParser: boolean;
  /** Use strict validation */
  useStrictValidation: boolean;
  /** Segment delimiter character(s) */
  segmentDelimiter: string;
  /** Convert line breaks to segment delimiter */
  convertLineBreaks: boolean;
  /** Strip XML namespaces */
  stripNamespaces: boolean;
}

/**
 * Properties for HL7v2 deserialization (XML -> ER7)
 */
export interface HL7v2DeserializationProperties {
  /** Use strict HL7 parser (HAPI) */
  useStrictParser: boolean;
  /** Use strict validation */
  useStrictValidation: boolean;
  /** Segment delimiter character(s) */
  segmentDelimiter: string;
}

/**
 * Get default serialization properties
 */
export function getDefaultSerializationProperties(): HL7v2SerializationProperties {
  return {
    handleRepetitions: true,
    handleSubcomponents: true,
    useStrictParser: false,
    useStrictValidation: false,
    segmentDelimiter: '\r',
    convertLineBreaks: true,
    stripNamespaces: false,
  };
}

/**
 * Get default deserialization properties
 */
export function getDefaultDeserializationProperties(): HL7v2DeserializationProperties {
  return {
    useStrictParser: false,
    useStrictValidation: false,
    segmentDelimiter: '\r',
  };
}

/**
 * Encoding characters extracted from MSH-2
 */
export interface HL7v2EncodingCharacters {
  fieldSeparator: string;
  componentSeparator: string;
  repetitionSeparator: string;
  escapeCharacter: string;
  subcomponentSeparator: string;
}

/**
 * Extract encoding characters from an HL7 message
 */
export function extractEncodingCharacters(message: string): HL7v2EncodingCharacters {
  const result: HL7v2EncodingCharacters = {
    fieldSeparator: HL7V2_DEFAULTS.FIELD_SEPARATOR,
    componentSeparator: HL7V2_DEFAULTS.COMPONENT_SEPARATOR,
    repetitionSeparator: HL7V2_DEFAULTS.REPETITION_SEPARATOR,
    escapeCharacter: HL7V2_DEFAULTS.ESCAPE_CHARACTER,
    subcomponentSeparator: HL7V2_DEFAULTS.SUBCOMPONENT_SEPARATOR,
  };

  if (!message || message.length < 4) {
    return result;
  }

  const firstSegment = message.substring(0, 3).toUpperCase();
  if (firstSegment !== 'MSH' && firstSegment !== 'FHS' && firstSegment !== 'BHS') {
    return result;
  }

  // Field separator is at position 3
  result.fieldSeparator = message.charAt(3);

  // Find the next field separator to determine the extent of encoding chars
  let nextDelimiter = message.indexOf(result.fieldSeparator, 4);
  if (nextDelimiter === -1) {
    nextDelimiter = message.length;
  }

  if (nextDelimiter > 4) {
    result.componentSeparator = message.charAt(4);
  }
  if (nextDelimiter > 5) {
    result.repetitionSeparator = message.charAt(5);
  }
  if (nextDelimiter > 6) {
    result.escapeCharacter = message.charAt(6);
  }
  if (nextDelimiter > 7) {
    result.subcomponentSeparator = message.charAt(7);
  }

  // Handle special case of ^~& with missing escape character (MIRTH-1544)
  if (message.length >= 8 && message.substring(4, 8) === '^~&' + result.fieldSeparator) {
    result.componentSeparator = '^';
    result.repetitionSeparator = '~';
    result.escapeCharacter = '\\';
    result.subcomponentSeparator = '&';
  }

  return result;
}

/**
 * Convert escape sequences in HL7 encoding characters string
 */
export function unescapeSegmentDelimiter(delimiter: string): string {
  return delimiter.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * Convert segment delimiter to its escaped representation
 */
export function escapeSegmentDelimiter(delimiter: string): string {
  return delimiter.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}
