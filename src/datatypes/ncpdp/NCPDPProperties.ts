/**
 * Ported from:
 * - ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPSerializationProperties.java
 * - ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPDeserializationProperties.java
 * - ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPDataTypeProperties.java
 *
 * Purpose: Properties for NCPDP data type parsing and serialization
 *
 * Key behaviors to replicate:
 * - Segment, group, and field delimiters (0x1E, 0x1D, 0x1C)
 * - Strict validation option for deserialization
 */

/**
 * NCPDP delimiters
 */
export interface NCPDPDelimiters {
  /** Segment delimiter (default: 0x1E, Record Separator) */
  segmentDelimiter: string;
  /** Group delimiter (default: 0x1D, Group Separator) */
  groupDelimiter: string;
  /** Field delimiter (default: 0x1C, File Separator) */
  fieldDelimiter: string;
}

/**
 * Serialization properties for NCPDP data type (NCPDP -> XML direction)
 */
export interface NCPDPSerializationProperties extends NCPDPDelimiters {
  // No additional properties, just delimiters
}

/**
 * Deserialization properties for NCPDP data type (XML -> NCPDP direction)
 */
export interface NCPDPDeserializationProperties extends NCPDPDelimiters {
  /** Whether to use strict validation against XSD schema */
  useStrictValidation: boolean;
}

/**
 * Combined data type properties for NCPDP
 */
export interface NCPDPDataTypeProperties {
  serializationProperties: NCPDPSerializationProperties;
  deserializationProperties: NCPDPDeserializationProperties;
}

/**
 * Unescape hex delimiter notation (e.g., "0x1E" -> actual character)
 */
export function unescapeNCPDPDelimiter(str: string): string {
  // Handle hex notation (0xNN)
  if (str.toLowerCase().startsWith('0x') && str.length >= 4) {
    const hexValue = parseInt(str.substring(2), 16);
    if (!isNaN(hexValue)) {
      return String.fromCharCode(hexValue);
    }
  }
  // Handle escape sequences
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Escape delimiter to hex notation for display
 */
export function escapeNCPDPDelimiter(char: string): string {
  if (char.length === 1) {
    const code = char.charCodeAt(0);
    // Only escape non-printable characters
    if (code < 32 || code > 126) {
      return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return char;
}

/**
 * Default NCPDP delimiters
 * NCPDP uses ASCII control characters:
 * - 0x1E (Record Separator) for segments
 * - 0x1D (Group Separator) for groups/transactions
 * - 0x1C (File Separator) for fields
 */
export const DEFAULT_NCPDP_DELIMITERS: NCPDPDelimiters = {
  segmentDelimiter: '0x1E',
  groupDelimiter: '0x1D',
  fieldDelimiter: '0x1C',
};

/**
 * Get default NCPDP serialization properties
 */
export function getDefaultNCPDPSerializationProperties(): NCPDPSerializationProperties {
  return {
    ...DEFAULT_NCPDP_DELIMITERS,
  };
}

/**
 * Get default NCPDP deserialization properties
 */
export function getDefaultNCPDPDeserializationProperties(): NCPDPDeserializationProperties {
  return {
    ...DEFAULT_NCPDP_DELIMITERS,
    useStrictValidation: false,
  };
}

/**
 * Get default NCPDP data type properties
 */
export function getDefaultNCPDPDataTypeProperties(): NCPDPDataTypeProperties {
  return {
    serializationProperties: getDefaultNCPDPSerializationProperties(),
    deserializationProperties: getDefaultNCPDPDeserializationProperties(),
  };
}

/**
 * Property descriptors for NCPDP serialization properties
 */
export const NCPDP_SERIALIZATION_PROPERTY_DESCRIPTORS = {
  fieldDelimiter: {
    name: 'Field Delimiter',
    description: 'Characters that delimit the fields in the message.',
    type: 'string' as const,
  },
  groupDelimiter: {
    name: 'Group Delimiter',
    description: 'Characters that delimit the groups in the message.',
    type: 'string' as const,
  },
  segmentDelimiter: {
    name: 'Segment Delimiter',
    description: 'Characters that delimit the segments in the message.',
    type: 'string' as const,
  },
};

/**
 * Property descriptors for NCPDP deserialization properties
 */
export const NCPDP_DESERIALIZATION_PROPERTY_DESCRIPTORS = {
  fieldDelimiter: {
    name: 'Field Delimiter',
    description: 'Characters that delimit the fields in the message.',
    type: 'string' as const,
  },
  groupDelimiter: {
    name: 'Group Delimiter',
    description: 'Characters that delimit the groups in the message.',
    type: 'string' as const,
  },
  segmentDelimiter: {
    name: 'Segment Delimiter',
    description: 'Characters that delimit the segments in the message.',
    type: 'string' as const,
  },
  useStrictValidation: {
    name: 'Use Strict Validation',
    description: 'Validates the NCPDP message against a schema.',
    type: 'boolean' as const,
  },
};

/**
 * NCPDP Version identifiers
 */
export enum NCPDPVersion {
  /** NCPDP Telecommunication Standard version D.0 */
  D0 = 'D0',
  /** NCPDP Telecommunication Standard version 5.1 */
  V51 = '51',
}

/**
 * Determine NCPDP version from message content
 */
export function detectNCPDPVersion(message: string): NCPDPVersion {
  // Look for version indicator in the message
  // D.0 messages have "D0" early in the header
  // 5.1 messages have "51" early in the header
  const d0Index = message.indexOf('D0');
  const v51Index = message.indexOf('51');

  if (d0Index === -1 && v51Index !== -1) {
    return NCPDPVersion.V51;
  }
  if (v51Index === -1 && d0Index !== -1) {
    return NCPDPVersion.D0;
  }
  if (d0Index !== -1 && v51Index !== -1) {
    // Return whichever appears first
    return d0Index < v51Index ? NCPDPVersion.D0 : NCPDPVersion.V51;
  }

  // Default to D.0 (more common modern format)
  return NCPDPVersion.D0;
}
