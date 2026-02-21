/**
 * Utility module exports for Mirth Connect Node.js runtime.
 *
 * This module provides core utilities ported from Java Mirth Connect:
 * - ValueReplacer: Template variable substitution
 * - ErrorMessageBuilder: Formatted error message construction
 * - JsonXmlUtil: JSON <-> XML conversion
 * - ACKGenerator: HL7 v2.x ACK message generation
 * - SerializerFactory: Data type serializers
 */

// ValueReplacer - Template variable substitution
export {
  ValueReplacer,
  valueReplacer,
  type ConnectorMessage,
  type Message,
  type ReplacementContext,
} from './ValueReplacer.js';

// ErrorMessageBuilder - Formatted error messages
export {
  ErrorMessageBuilder,
  buildErrorMessage,
  buildErrorResponse,
  createJavaScriptError,
  type JavaScriptError,
} from './ErrorMessageBuilder.js';

// JsonXmlUtil - JSON <-> XML conversion
export {
  JsonXmlUtil,
  xmlToJson,
  jsonToXml,
  isValidJson,
  isValidXml,
  type XmlToJsonOptions,
  type JsonToXmlOptions,
} from './JsonXmlUtil.js';

// ACKGenerator - HL7 v2.x ACK generation
export {
  ACKGenerator,
  generateAckResponse,
  generateAckResponseFull,
  type ACKCode,
  type ACKOptions,
} from './ACKGenerator.js';

// MessageEncryptionUtil - Bulk message encryption/decryption
export { MessageEncryptionUtil } from './MessageEncryptionUtil.js';

// SerializerFactory - Data type serializers
export {
  SerializerFactory,
  getSerializer,
  getDefaultSerializationProperties,
  getDefaultDeserializationProperties,
  type IMessageSerializer,
  type SerializationProperties,
  type DeserializationProperties,
  type HL7v2SerializationProperties,
  type HL7v2DeserializationProperties,
  type EDISerializationProperties,
} from './SerializerFactory.js';
