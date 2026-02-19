/**
 * NCPDP Data Type Module
 *
 * Provides serialization, parsing, and metadata extraction for
 * NCPDP (National Council for Prescription Drug Programs) messages.
 *
 * Supports:
 * - NCPDP Telecommunication Standard D.0
 * - NCPDP Telecommunication Standard 5.1
 *
 * The NCPDP standard is used for pharmacy claim transactions including:
 * - Billing claims (B1, B2, B3)
 * - Eligibility verification (E1)
 * - Prior authorization (P1, P2, P3, P4)
 * - Service billing (S1, S2, S3)
 * - Controlled substance reporting (C1, C2)
 */

// Properties and configuration
export {
  NCPDPDelimiters,
  NCPDPSerializationProperties,
  NCPDPDeserializationProperties,
  NCPDPDataTypeProperties,
  NCPDPVersion,
  DEFAULT_NCPDP_DELIMITERS,
  getDefaultNCPDPSerializationProperties,
  getDefaultNCPDPDeserializationProperties,
  getDefaultNCPDPDataTypeProperties,
  unescapeNCPDPDelimiter,
  escapeNCPDPDelimiter,
  detectNCPDPVersion,
  NCPDP_SERIALIZATION_PROPERTY_DESCRIPTORS,
  NCPDP_DESERIALIZATION_PROPERTY_DESCRIPTORS,
} from './NCPDPProperties.js';

// Reference data (lookup tables)
export { NCPDPReference, getNCPDPReference } from './NCPDPReference.js';

// Reader (NCPDP -> XML)
export { NCPDPReader, parseNCPDPToXML } from './NCPDPReader.js';

// Serializer (bidirectional conversion)
export { NCPDPSerializer, convertNCPDPToXML, convertXMLToNCPDP } from './NCPDPSerializer.js';
