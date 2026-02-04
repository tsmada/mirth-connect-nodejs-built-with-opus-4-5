/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/ws/WebServiceReceiverProperties.java
 *
 * Purpose: Configuration properties for WebService (SOAP) source connector
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - SOAP binding selection (SOAP 1.1, SOAP 1.2)
 * - Service class configuration
 */

/**
 * SOAP Binding types
 */
export enum SoapBinding {
  /** Default binding (determined by WSDL) */
  DEFAULT = 'DEFAULT',
  /** SOAP 1.1 over HTTP */
  SOAP11HTTP = 'SOAP11HTTP',
  /** SOAP 1.2 over HTTP */
  SOAP12HTTP = 'SOAP12HTTP',
}

/**
 * Map binding enum to SOAP binding namespace
 */
export function getSoapBindingValue(binding: SoapBinding): string | null {
  switch (binding) {
    case SoapBinding.DEFAULT:
      return null;
    case SoapBinding.SOAP11HTTP:
      return 'http://schemas.xmlsoap.org/wsdl/soap/http';
    case SoapBinding.SOAP12HTTP:
      return 'http://www.w3.org/2003/05/soap/bindings/HTTP/';
    default:
      return null;
  }
}

/**
 * Map binding enum to display name
 */
export function getSoapBindingName(binding: SoapBinding): string {
  switch (binding) {
    case SoapBinding.DEFAULT:
      return 'Default';
    case SoapBinding.SOAP11HTTP:
      return 'SOAP 1.1';
    case SoapBinding.SOAP12HTTP:
      return 'SOAP 1.2';
    default:
      return 'Default';
  }
}

/**
 * Parse binding from display name
 */
export function parseSoapBinding(displayName: string): SoapBinding {
  switch (displayName) {
    case 'SOAP 1.1':
      return SoapBinding.SOAP11HTTP;
    case 'SOAP 1.2':
      return SoapBinding.SOAP12HTTP;
    default:
      return SoapBinding.DEFAULT;
  }
}

/**
 * HTTP Authentication properties for SOAP receiver
 */
export interface HttpAuthProperties {
  /** Authentication type */
  authType: 'NONE' | 'BASIC' | 'DIGEST';
  /** Realm for authentication challenge */
  realm?: string;
  /** Credentials map (username -> password) */
  credentials?: Map<string, string>;
}

/**
 * WebService Receiver (Source) Properties
 */
export interface WebServiceReceiverProperties {
  /** Host to listen on (e.g., "0.0.0.0") */
  host: string;
  /** Port to listen on */
  port: number;
  /** Number of processing threads */
  processingThreads: number;

  /** Service class name for the SOAP endpoint */
  className: string;
  /** SOAP service name */
  serviceName: string;
  /** SOAP binding type */
  soapBinding: SoapBinding;

  /** Authentication configuration */
  authProperties?: HttpAuthProperties;
}

/**
 * Default WebService Receiver properties
 */
export function getDefaultWebServiceReceiverProperties(): WebServiceReceiverProperties {
  return {
    host: '0.0.0.0',
    port: 8081,
    processingThreads: 1,
    className: 'com.mirth.connect.connectors.ws.DefaultAcceptMessage',
    serviceName: 'Mirth',
    soapBinding: SoapBinding.DEFAULT,
  };
}

/**
 * Get the full service endpoint path
 */
export function getServicePath(properties: WebServiceReceiverProperties): string {
  return `/services/${properties.serviceName}`;
}
