/**
 * DICOM DataType Module
 *
 * Provides DICOM data type handling including:
 * - DICOM to XML serialization
 * - XML to DICOM deserialization
 * - Metadata extraction
 * - Tag definitions
 */

// Properties
export {
  DICOMDataTypeProperties,
  DICOMMetaData,
  DicomTag,
  getDefaultDICOMDataTypeProperties,
  formatTag,
  parseTag,
} from './DICOMDataTypeProperties.js';

// Serializer
export { DICOMSerializer } from './DICOMSerializer.js';
