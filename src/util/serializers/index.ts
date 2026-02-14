/**
 * Serializer adapters for SerializerFactory.
 *
 * Each adapter wraps a standalone datatype implementation from src/datatypes/
 * and complies with the IMessageSerializer interface. Metadata keys use the
 * mirth_ prefix (mirth_source, mirth_type, mirth_version) matching Java's
 * DefaultMetaData constants for D_MCM compatibility.
 */
export { HL7v2SerializerAdapter } from './HL7v2SerializerAdapter.js';
export { XMLSerializerAdapter } from './XMLSerializerAdapter.js';
export { JSONSerializerAdapter } from './JSONSerializerAdapter.js';
export { RawSerializerAdapter } from './RawSerializerAdapter.js';
export { DelimitedSerializerAdapter } from './DelimitedSerializerAdapter.js';
export { EDISerializerAdapter } from './EDISerializerAdapter.js';
export { HL7V3SerializerAdapter } from './HL7V3SerializerAdapter.js';
export { NCPDPSerializerAdapter } from './NCPDPSerializerAdapter.js';
export { DICOMSerializerAdapter } from './DICOMSerializerAdapter.js';
