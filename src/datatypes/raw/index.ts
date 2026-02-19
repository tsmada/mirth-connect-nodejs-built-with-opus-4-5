/**
 * Raw DataType Module
 *
 * Provides pass-through handling for raw/binary data with no parsing.
 * Used when message format doesn't require transformation.
 */

// Properties
export {
  RawSplitType,
  RawBatchProperties,
  RawDataTypeProperties,
  getDefaultRawBatchProperties,
  getDefaultRawDataTypeProperties,
  RAW_BATCH_PROPERTY_DESCRIPTORS,
} from './RawProperties.js';

// Data Type
export { RawDataType, RawMetaData, passThrough, extractRawMetaData } from './RawDataType.js';
