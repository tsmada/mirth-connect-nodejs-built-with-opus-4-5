/**
 * WebService (SOAP) Connector Module
 *
 * Provides SOAP/WSDL web service connectivity for Mirth Connect Node.js runtime.
 */

// Properties
export {
  WebServiceReceiverProperties,
  SoapBinding,
  HttpAuthProperties,
  getDefaultWebServiceReceiverProperties,
  getServicePath,
  getSoapBindingValue,
  getSoapBindingName,
  parseSoapBinding,
} from './WebServiceReceiverProperties.js';

export {
  WebServiceDispatcherProperties,
  PortInformation,
  DefinitionPortMap,
  DefinitionServiceMap,
  AttachmentEntry,
  WEBSERVICE_DEFAULT_DROPDOWN,
  getDefaultWebServiceDispatcherProperties,
  createDefinitionServiceMap,
  formatWebServiceDispatcherProperties,
  getAttachmentEntries,
} from './WebServiceDispatcherProperties.js';

// SOAP utilities
export {
  SoapVersion,
  SOAP_NAMESPACES,
  SoapHeader,
  SoapEnvelopeOptions,
  SoapFault,
  buildSoapEnvelope,
  buildSoapFaultEnvelope,
  parseSoapEnvelope,
  extractSoapBodyContent,
  detectSoapVersion,
  getSoapContentType,
} from './SoapBuilder.js';

// WSDL parsing
export {
  WsdlOperation,
  WsdlPort,
  WsdlBinding,
  WsdlService,
  ParsedWsdl,
  WsdlFetchOptions,
  parseWsdlFromUrl,
  parseWsdlContent,
  getOperations,
  getSoapAction,
  getEndpointLocation,
  getServiceNames,
  getPortNames,
} from './WsdlParser.js';

// Connectors
export {
  WebServiceDispatcher,
  WebServiceDispatcherConfig,
  SoapFaultError,
} from './WebServiceDispatcher.js';

export { WebServiceReceiver, WebServiceReceiverConfig } from './WebServiceReceiver.js';
