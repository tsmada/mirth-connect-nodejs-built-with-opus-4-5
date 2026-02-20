/**
 * HL7v2 DataType Module
 *
 * Provides parsing, serialization, ACK generation, and metadata extraction
 * for HL7v2 messages in ER7 (pipe-delimited) and XML formats.
 */

// Properties and configuration
export {
  HL7V2_DEFAULTS,
  HL7v2SerializationProperties,
  HL7v2DeserializationProperties,
  HL7v2EncodingCharacters,
  getDefaultSerializationProperties,
  getDefaultDeserializationProperties,
  extractEncodingCharacters,
  unescapeSegmentDelimiter,
  escapeSegmentDelimiter,
} from './HL7v2Properties.js';

// Parser (ER7 -> XML)
export { HL7v2Parser, MESSAGE_ROOT_ID, parseER7ToXML } from './HL7v2Parser.js';

// Serializer (XML -> ER7)
export { HL7v2Serializer, serializeXMLToER7 } from './HL7v2Serializer.js';

// ACK Generator
export {
  HL7v2ACKGenerator,
  AckCode,
  AckGeneratorOptions,
  generateAck,
  generateNak,
} from './HL7v2ACKGenerator.js';

// Metadata extraction
export { HL7v2MetaData, extractMetaData, extractMetaDataFromXML } from './HL7v2MetaData.js';

// Escape sequence handling
export { HL7EscapeHandler } from './HL7EscapeHandler.js';
