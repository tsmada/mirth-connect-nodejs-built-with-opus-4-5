/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/edi/EDISerializationProperties.java
 *
 * Purpose: Properties for EDI/X12 data type parsing
 *
 * Key behaviors to replicate:
 * - Segment, element, and subelement delimiters
 * - X12 delimiter inference from ISA segment
 */

/**
 * Serialization properties for EDI data type
 */
export interface EDISerializationProperties {
  /** Segment delimiter (default: "~") */
  segmentDelimiter: string;
  /** Element delimiter (default: "*") */
  elementDelimiter: string;
  /** Subelement delimiter (default: ":") */
  subelementDelimiter: string;
  /** Infer delimiters from X12 ISA segment (default: true) */
  inferX12Delimiters: boolean;
}

/**
 * Combined properties for EDI data type
 */
export interface EDIDataTypeProperties {
  serializationProperties: EDISerializationProperties;
}

/**
 * Get default EDI serialization properties
 */
export function getDefaultEDISerializationProperties(): EDISerializationProperties {
  return {
    segmentDelimiter: '~',
    elementDelimiter: '*',
    subelementDelimiter: ':',
    inferX12Delimiters: true,
  };
}

/**
 * Get default EDI data type properties
 */
export function getDefaultEDIDataTypeProperties(): EDIDataTypeProperties {
  return {
    serializationProperties: getDefaultEDISerializationProperties(),
  };
}

/**
 * Detected EDI delimiters
 */
export interface EDIDelimiters {
  segmentDelimiter: string;
  elementDelimiter: string;
  subelementDelimiter: string;
}

/**
 * Unescape special characters in delimiter strings
 */
export function unescapeEDIDelimiter(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Detect delimiters from X12 message
 *
 * X12 ISA segment format:
 * ISA*00*          *00*          *ZZ*...
 * Position 3: element delimiter
 * Position 104: subelement delimiter
 * Position 105: segment delimiter
 */
export function detectX12Delimiters(message: string, defaults: EDIDelimiters): EDIDelimiters {
  // Check if this looks like an X12 message
  if (!message.startsWith('ISA') || message.length <= 105) {
    return defaults;
  }

  const delimiters: EDIDelimiters = {
    elementDelimiter: message.charAt(3),
    subelementDelimiter: message.charAt(104),
    segmentDelimiter: message.charAt(105),
  };

  // Handle newline after segment delimiter
  if (message.length > 106 && message.charAt(106) === '\n') {
    delimiters.segmentDelimiter += '\n';
  }

  return delimiters;
}

/**
 * Property descriptors for EDI serialization properties
 */
export const EDI_SERIALIZATION_PROPERTY_DESCRIPTORS = {
  segmentDelimiter: {
    name: 'Segment Delimiter',
    description: 'Characters that delimit the segments in the message.',
    type: 'string' as const,
  },
  elementDelimiter: {
    name: 'Element Delimiter',
    description: 'Characters that delimit the elements in the message.',
    type: 'string' as const,
  },
  subelementDelimiter: {
    name: 'Subelement Delimiter',
    description: 'Characters that delimit the subelements in the message.',
    type: 'string' as const,
  },
  inferX12Delimiters: {
    name: 'Infer X12 Delimiters',
    description:
      'This property only applies to X12 messages. If checked, the delimiters are inferred from the incoming message and the delimiter properties will not be used.',
    type: 'boolean' as const,
  },
};
