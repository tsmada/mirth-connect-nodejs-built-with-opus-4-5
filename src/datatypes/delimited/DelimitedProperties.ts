/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedSerializationProperties.java
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedDeserializationProperties.java
 *
 * Purpose: Properties for Delimited (CSV, pipe, tab) data type parsing
 *
 * Key behaviors to replicate:
 * - Support for column and record delimiters
 * - Fixed-width column support
 * - Quote handling with escape options
 * - Custom column names
 */

/**
 * Serialization properties for Delimited data type (Text -> XML)
 */
export interface DelimitedSerializationProperties {
  /** Characters that separate columns (default: ",") */
  columnDelimiter: string;
  /** Characters that separate records (default: "\\n") */
  recordDelimiter: string;
  /** Fixed column widths (null for delimited mode) */
  columnWidths: number[] | null;
  /** Quote token for enclosing values (default: "\"") */
  quoteToken: string;
  /** Use double quote for escaping (default: true) */
  escapeWithDoubleQuote: boolean;
  /** Escape token when not using double quote (default: "\\") */
  quoteEscapeToken: string;
  /** Custom column names (null for default column1, column2, etc.) */
  columnNames: string[] | null;
  /** Number each row in XML output */
  numberedRows: boolean;
  /** Ignore carriage return characters */
  ignoreCR: boolean;
}

/**
 * Deserialization properties for Delimited data type (XML -> Text)
 */
export interface DelimitedDeserializationProperties {
  /** Characters that separate columns (default: ",") */
  columnDelimiter: string;
  /** Characters that separate records (default: "\\n") */
  recordDelimiter: string;
  /** Fixed column widths (null for delimited mode) */
  columnWidths: number[] | null;
  /** Quote token for enclosing values (default: "\"") */
  quoteToken: string;
  /** Use double quote for escaping (default: true) */
  escapeWithDoubleQuote: boolean;
  /** Escape token when not using double quote (default: "\\") */
  quoteEscapeToken: string;
}

/**
 * Combined properties for Delimited data type
 */
export interface DelimitedDataTypeProperties {
  serializationProperties: DelimitedSerializationProperties;
  deserializationProperties: DelimitedDeserializationProperties;
}

/**
 * Get default serialization properties
 */
export function getDefaultDelimitedSerializationProperties(): DelimitedSerializationProperties {
  return {
    columnDelimiter: ',',
    recordDelimiter: '\\n',
    columnWidths: null,
    quoteToken: '"',
    escapeWithDoubleQuote: true,
    quoteEscapeToken: '\\',
    columnNames: null,
    numberedRows: false,
    ignoreCR: true,
  };
}

/**
 * Get default deserialization properties
 */
export function getDefaultDelimitedDeserializationProperties(): DelimitedDeserializationProperties {
  return {
    columnDelimiter: ',',
    recordDelimiter: '\\n',
    columnWidths: null,
    quoteToken: '"',
    escapeWithDoubleQuote: true,
    quoteEscapeToken: '\\',
  };
}

/**
 * Get default delimited data type properties
 */
export function getDefaultDelimitedDataTypeProperties(): DelimitedDataTypeProperties {
  return {
    serializationProperties: getDefaultDelimitedSerializationProperties(),
    deserializationProperties: getDefaultDelimitedDeserializationProperties(),
  };
}

/**
 * Unescape special characters in delimiter strings
 * Converts escape sequences like \\n, \\t, \\r to actual characters
 */
export function unescapeDelimiter(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Escape special characters in delimiter strings for storage/display
 */
export function escapeDelimiter(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Validate XML element name
 * Must start with letter, underscore, or colon
 * Remaining characters must be letter, digit, period, dash, underscore, or colon
 */
export function isValidXMLElementName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  const firstChar = name.charAt(0);
  if (!/[a-zA-Z_:]/.test(firstChar)) {
    return false;
  }

  for (let i = 1; i < name.length; i++) {
    const ch = name.charAt(i);
    if (!/[a-zA-Z0-9._:\-]/.test(ch)) {
      return false;
    }
  }

  return true;
}

/**
 * Parse column widths from comma-separated string
 */
export function parseColumnWidths(widths: string): number[] | null {
  if (!widths || widths.trim() === '') {
    return null;
  }

  const parts = widths.split(',');
  const result: number[] = [];

  for (const part of parts) {
    const width = parseInt(part.trim(), 10);
    if (isNaN(width) || width <= 0) {
      throw new Error(`Invalid column width: ${part}`);
    }
    result.push(width);
  }

  return result;
}

/**
 * Parse column names from comma-separated string
 */
export function parseColumnNames(names: string): string[] | null {
  if (!names || names.trim() === '') {
    return null;
  }

  const parts = names.split(',');
  const result: string[] = [];

  for (const part of parts) {
    const name = part.trim();
    if (!isValidXMLElementName(name)) {
      throw new Error(
        `Invalid column name: ${name} (must be a combination of letters, digits, periods, dashes, underscores and colons that begins with a letter, underscore or colon)`
      );
    }
    result.push(name);
  }

  return result;
}

/**
 * Property descriptors for serialization properties
 */
export const DELIMITED_SERIALIZATION_PROPERTY_DESCRIPTORS = {
  columnDelimiter: {
    name: 'Column Delimiter',
    description:
      'If column values are delimited, enter the characters that separate columns. For example, this is a comma in a CSV file.',
    type: 'string' as const,
  },
  recordDelimiter: {
    name: 'Record Delimiter',
    description:
      'Enter the characters that separate each record (a message may contain multiple records). For example, this is a newline (\\n) in a CSV file.',
    type: 'string' as const,
  },
  columnWidths: {
    name: 'Column Widths',
    description:
      'If the column values are fixed width, enter a comma separated list of fixed column widths. By default, column values are assumed to be delimited.',
    type: 'string' as const,
  },
  quoteToken: {
    name: 'Quote Token',
    description:
      'Enter the quote characters that are used to bracket delimit column values containing embedded special characters like column delimiters, record delimiters, quote characters and/or message delimiters. For example, this is a double quote (") in a CSV file.',
    type: 'string' as const,
  },
  escapeWithDoubleQuote: {
    name: 'Double Quote Escaping',
    description:
      'By default, two consecutive quote tokens within a quoted value are treated as an embedded quote token. Uncheck to enable escaped quote token processing (and specify the Escape Tokens).',
    type: 'boolean' as const,
  },
  quoteEscapeToken: {
    name: 'Escape Token',
    description:
      'Enter the characters used to escape embedded quote tokens. By default, this is a back slash. This option has no effect unless Double Quote Escaping is unchecked.',
    type: 'string' as const,
  },
  columnNames: {
    name: 'Column Names',
    description:
      'To override the default column names (column1, ..., columnN), enter a comma separated list of column names.',
    type: 'string' as const,
  },
  numberedRows: {
    name: 'Numbered Rows',
    description: 'Check to number each row in the XML representation of the message.',
    type: 'boolean' as const,
  },
  ignoreCR: {
    name: 'Ignore Carriage Returns',
    description:
      'Ignores carriage return (\\r) characters. These are read over and skipped without processing them.',
    type: 'boolean' as const,
  },
};
