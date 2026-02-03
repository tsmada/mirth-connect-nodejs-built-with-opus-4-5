/**
 * EDI/X12 DataType Module
 *
 * Provides parsing and serialization for EDI/X12 healthcare transactions.
 */

// Properties
export {
  EDISerializationProperties,
  EDIDataTypeProperties,
  EDIDelimiters,
  getDefaultEDISerializationProperties,
  getDefaultEDIDataTypeProperties,
  unescapeEDIDelimiter,
  detectX12Delimiters,
  EDI_SERIALIZATION_PROPERTY_DESCRIPTORS,
} from './EDIProperties.js';

// Parser (EDI -> XML)
export { EDIParser, parseEDIToXML } from './EDIParser.js';

// Serializer (XML -> EDI)
export { EDISerializer, serializeXMLToEDI } from './EDISerializer.js';

// Data Type
export {
  EDIDataType,
  EDIDataTypeInput,
  EDIMetaData,
  extractEDIMetaData,
} from './EDIDataType.js';
