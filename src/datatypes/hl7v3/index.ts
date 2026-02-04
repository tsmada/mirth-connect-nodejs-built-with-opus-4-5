/**
 * HL7v3 Data Type Module
 *
 * Provides serialization, parsing, and batch processing for HL7v3 XML messages.
 *
 * HL7v3 (Health Level Seven Version 3) is an XML-based healthcare messaging standard
 * that uses the Reference Information Model (RIM) as its foundation. Unlike HL7v2,
 * which uses pipe-delimited segments, HL7v3 messages are fully structured XML documents.
 *
 * Common HL7v3 message types include:
 * - PRPA_IN201301UV02 - Patient Registry Add
 * - PRPA_IN201305UV02 - Patient Registry Query
 * - MCCI_IN000002UV01 - Application Acknowledgment
 * - CDA documents - Clinical Document Architecture
 *
 * Key features:
 * - Pass-through serialization (HL7v3 is already XML)
 * - Optional namespace stripping
 * - Metadata extraction (version, message type)
 * - JavaScript-based batch processing
 *
 * @example
 * ```typescript
 * import { HL7V3Serializer, extractHL7V3MetaData } from './hl7v3';
 *
 * // Parse HL7v3 message with namespace stripping
 * const serializer = new HL7V3Serializer({ stripNamespaces: true });
 * const processed = serializer.toXML(hl7v3Message);
 *
 * // Extract metadata
 * const metadata = extractHL7V3MetaData(hl7v3Message);
 * console.log(metadata.type); // e.g., "PRPA_IN201301UV02"
 * ```
 */

// Properties
export {
  HL7V3SplitType,
  HL7V3BatchProperties,
  HL7V3SerializationProperties,
  HL7V3DataTypeProperties,
  getDefaultHL7V3BatchProperties,
  getDefaultHL7V3SerializationProperties,
  getDefaultHL7V3DataTypeProperties,
  HL7V3_SERIALIZATION_PROPERTY_DESCRIPTORS,
  HL7V3_BATCH_PROPERTY_DESCRIPTORS,
} from './HL7V3Properties.js';

// Serializer
export {
  HL7V3Serializer,
  HL7V3MetaData,
  VERSION_VARIABLE_MAPPING,
  TYPE_VARIABLE_MAPPING,
  parseHL7V3,
  extractHL7V3MetaData,
  stripHL7V3Namespaces,
} from './HL7V3Serializer.js';

// Batch Adaptor
export {
  HL7V3BatchAdaptor,
  BatchReader,
  BatchScriptContext,
  BatchScriptFunction,
  BatchMessageSource,
  SourceMap,
  processBatch,
  splitByDelimiter,
  splitByXMLRoot,
} from './HL7V3BatchAdaptor.js';
