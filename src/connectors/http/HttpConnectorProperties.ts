/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/http/HttpReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/http/HttpDispatcherProperties.java
 *
 * Purpose: Configuration properties for HTTP source and destination connectors
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - Support for headers, parameters, authentication
 */

/**
 * HTTP Receiver (Source) Properties
 */
export interface HttpReceiverProperties {
  /** Host to listen on (e.g., "0.0.0.0") */
  host: string;
  /** Port to listen on */
  port: number;
  /** Context path for requests (e.g., "/api") */
  contextPath: string;
  /** Connection timeout in milliseconds */
  timeout: number;
  /** Character encoding for request/response */
  charset: string;

  /** Parse request as XML body */
  xmlBody: boolean;
  /** Parse multipart requests */
  parseMultipart: boolean;
  /** Include metadata in parsed output */
  includeMetadata: boolean;

  /** Binary MIME types pattern */
  binaryMimeTypes: string;
  /** Whether binaryMimeTypes is a regex */
  binaryMimeTypesRegex: boolean;

  /** Response content type */
  responseContentType: string;
  /** Response is binary data */
  responseDataTypeBinary: boolean;
  /** Custom response status code */
  responseStatusCode: string;
  /** Response headers map */
  responseHeaders: Map<string, string[]>;

  /** Static resources to serve */
  staticResources?: HttpStaticResource[];

  /** Use authentication for incoming requests (CPC-MAM-001) */
  useAuthentication?: boolean;
  /** Authentication type for incoming requests */
  authenticationType?: 'Basic' | 'Digest';
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
}

/**
 * Static resource configuration
 */
export interface HttpStaticResource {
  contextPath: string;
  resourceType: 'FILE' | 'DIRECTORY' | 'CUSTOM';
  value: string;
  contentType: string;
}

/**
 * HTTP Dispatcher (Destination) Properties
 */
export interface HttpDispatcherProperties {
  /** Target URL */
  host: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Request headers */
  headers: Map<string, string[]>;
  /** Query parameters */
  parameters: Map<string, string[]>;

  /** Request body content */
  content: string;
  /** Content type header */
  contentType: string;
  /** Content is binary (base64 encoded) */
  dataTypeBinary: boolean;
  /** Character encoding */
  charset: string;

  /** Send as multipart form */
  multipart: boolean;

  /** Socket timeout in milliseconds */
  socketTimeout: number;

  /** Use proxy server */
  useProxyServer: boolean;
  /** Proxy address */
  proxyAddress: string;
  /** Proxy port */
  proxyPort: number;

  /** Use authentication */
  useAuthentication: boolean;
  /** Authentication type */
  authenticationType: 'Basic' | 'Digest';
  /** Use preemptive authentication */
  usePreemptiveAuthentication: boolean;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;

  /** Parse response as XML body */
  responseXmlBody: boolean;
  /** Parse multipart responses */
  responseParseMultipart: boolean;
  /** Include metadata in response */
  responseIncludeMetadata: boolean;
  /** Binary MIME types for response */
  responseBinaryMimeTypes: string;
  /** Whether responseBinaryMimeTypes is a regex */
  responseBinaryMimeTypesRegex: boolean;
}

/**
 * Default HTTP Receiver properties
 */
export function getDefaultHttpReceiverProperties(): HttpReceiverProperties {
  return {
    host: '0.0.0.0',
    port: 80,
    contextPath: '',
    timeout: 30000,
    charset: 'UTF-8',
    xmlBody: false,
    parseMultipart: true,
    includeMetadata: false,
    binaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*',
    binaryMimeTypesRegex: true,
    responseContentType: 'text/plain',
    responseDataTypeBinary: false,
    responseStatusCode: '',
    responseHeaders: new Map(),
    staticResources: [],
  };
}

/**
 * Default HTTP Dispatcher properties
 */
export function getDefaultHttpDispatcherProperties(): HttpDispatcherProperties {
  return {
    host: '',
    method: 'POST',
    headers: new Map(),
    parameters: new Map(),
    content: '',
    contentType: 'text/plain',
    dataTypeBinary: false,
    charset: 'UTF-8',
    multipart: false,
    socketTimeout: 30000,
    useProxyServer: false,
    proxyAddress: '',
    proxyPort: 0,
    useAuthentication: false,
    authenticationType: 'Basic',
    usePreemptiveAuthentication: false,
    username: '',
    password: '',
    responseXmlBody: false,
    responseParseMultipart: true,
    responseIncludeMetadata: false,
    responseBinaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*',
    responseBinaryMimeTypesRegex: true,
  };
}

/**
 * Check if a MIME type is binary based on pattern
 */
export function isBinaryMimeType(
  mimeType: string,
  pattern: string,
  isRegex: boolean
): boolean {
  if (isRegex) {
    try {
      const regex = new RegExp(pattern);
      return regex.test(mimeType);
    } catch {
      return false;
    }
  } else {
    const patterns = pattern.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    return patterns.some((p) => mimeType.startsWith(p));
  }
}
