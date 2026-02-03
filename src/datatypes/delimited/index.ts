/**
 * Delimited DataType Module
 *
 * Provides parsing and serialization for delimited text formats
 * including CSV, pipe-delimited, tab-delimited, and fixed-width.
 */

// Properties
export {
  DelimitedSerializationProperties,
  DelimitedDeserializationProperties,
  DelimitedDataTypeProperties,
  getDefaultDelimitedSerializationProperties,
  getDefaultDelimitedDeserializationProperties,
  getDefaultDelimitedDataTypeProperties,
  unescapeDelimiter,
  escapeDelimiter,
  isValidXMLElementName,
  parseColumnWidths,
  parseColumnNames,
  DELIMITED_SERIALIZATION_PROPERTY_DESCRIPTORS,
} from './DelimitedProperties.js';

// Parser (Text -> XML)
export { DelimitedParser, parseDelimitedToXML } from './DelimitedParser.js';

// Serializer (XML -> Text)
export {
  DelimitedSerializer,
  serializeXMLToDelimited,
} from './DelimitedSerializer.js';

// Data Type
export {
  DelimitedDataType,
  DelimitedDataTypeInput,
  DelimitedMetaData,
  extractDelimitedMetaData,
} from './DelimitedDataType.js';
