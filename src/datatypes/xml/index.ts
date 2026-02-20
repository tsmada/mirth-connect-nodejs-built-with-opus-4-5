/**
 * XML DataType Module
 *
 * Provides serialization and metadata extraction for XML messages.
 */

export {
  XMLDataType,
  XMLSerializationProperties,
  XMLMetaData,
  getDefaultXMLSerializationProperties,
  parseXML,
  extractXMLMetaData,
  stripNamespaces,
} from './XMLDataType.js';

export {
  XMLBatchAdaptor,
  XMLBatchAdaptorFactory,
  XMLSplitType,
  type XMLBatchProperties,
} from './XMLBatchAdaptor.js';
