/**
 * JSON DataType Module
 *
 * Provides serialization, validation, and metadata extraction for JSON messages.
 */

export {
  JSONDataType,
  JSONSerializationProperties,
  JSONMetaData,
  getDefaultJSONSerializationProperties,
  parseJSON,
  extractJSONMetaData,
  validateJSON,
  minifyJSON,
  prettifyJSON,
} from './JSONDataType.js';
