/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/ws/WebServiceDispatcherProperties.java
 *
 * Purpose: Configuration properties for WebService (SOAP) destination connector
 *
 * Key behaviors to replicate:
 * - WSDL URL and operation selection
 * - Service, port, operation configuration
 * - Custom SOAP envelope
 * - Headers and MTOM attachments
 * - Authentication (Basic)
 */

/**
 * Port information from WSDL parsing
 */
export interface PortInformation {
  /** Available operations for this port */
  operations: string[];
  /** SOAP actions for operations */
  actions?: string[];
  /** Location URI for the endpoint */
  locationURI?: string;
}

/**
 * Service definition port map (port name -> port info)
 */
export interface DefinitionPortMap {
  map: Map<string, PortInformation>;
}

/**
 * WSDL definition service map (service name -> port map)
 */
export interface DefinitionServiceMap {
  map: Map<string, DefinitionPortMap>;
}

/**
 * Create an empty DefinitionServiceMap
 */
export function createDefinitionServiceMap(): DefinitionServiceMap {
  return { map: new Map() };
}

/**
 * SOAP attachment entry
 */
export interface AttachmentEntry {
  /** Content ID for the attachment */
  name: string;
  /** Attachment content (base64 or text) */
  content: string;
  /** MIME type of the attachment */
  mimeType: string;
}

/**
 * WebService Dispatcher (Destination) Properties
 */
export interface WebServiceDispatcherProperties {
  /** WSDL URL */
  wsdlUrl: string;
  /** Selected service name from WSDL */
  service: string;
  /** Selected port name from WSDL */
  port: string;
  /** Selected operation name */
  operation: string;
  /** Override endpoint location URI */
  locationURI: string;
  /** Socket timeout in milliseconds */
  socketTimeout: number;

  /** Use authentication */
  useAuthentication: boolean;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;

  /** SOAP envelope content (XML) */
  envelope: string;
  /** One-way invocation (no response expected) */
  oneWay: boolean;

  /** HTTP headers map */
  headers: Map<string, string[]>;
  /** Use headers from variable instead of map */
  useHeadersVariable: boolean;
  /** Variable name containing headers */
  headersVariable: string;

  /** Use MTOM for attachments */
  useMtom: boolean;
  /** Attachment content IDs */
  attachmentNames: string[];
  /** Attachment contents */
  attachmentContents: string[];
  /** Attachment MIME types */
  attachmentTypes: string[];
  /** Use attachments from variable instead of lists */
  useAttachmentsVariable: boolean;
  /** Variable name containing attachments */
  attachmentsVariable: string;

  /** SOAP action header value */
  soapAction: string;

  /** Cached WSDL definition map */
  wsdlDefinitionMap: DefinitionServiceMap;
}

/** Placeholder for dropdown when operations haven't been loaded */
export const WEBSERVICE_DEFAULT_DROPDOWN = 'Press Get Operations';

/**
 * Default WebService Dispatcher properties
 */
export function getDefaultWebServiceDispatcherProperties(): WebServiceDispatcherProperties {
  return {
    wsdlUrl: '',
    service: '',
    port: '',
    operation: WEBSERVICE_DEFAULT_DROPDOWN,
    locationURI: '',
    socketTimeout: 30000,
    useAuthentication: false,
    username: '',
    password: '',
    envelope: '',
    oneWay: false,
    headers: new Map(),
    useHeadersVariable: false,
    headersVariable: '',
    useMtom: false,
    attachmentNames: [],
    attachmentContents: [],
    attachmentTypes: [],
    useAttachmentsVariable: false,
    attachmentsVariable: '',
    soapAction: '',
    wsdlDefinitionMap: createDefinitionServiceMap(),
  };
}

/**
 * Format dispatcher properties as a human-readable string
 */
export function formatWebServiceDispatcherProperties(
  props: WebServiceDispatcherProperties
): string {
  const lines: string[] = [];

  lines.push(`WSDL URL: ${props.wsdlUrl}`);

  if (props.username) {
    lines.push(`USERNAME: ${props.username}`);
  }

  if (props.service) {
    lines.push(`SERVICE: ${props.service}`);
  }

  if (props.port) {
    lines.push(`PORT / ENDPOINT: ${props.port}`);
  }

  if (props.locationURI) {
    lines.push(`LOCATION URI: ${props.locationURI}`);
  }

  if (props.soapAction) {
    lines.push(`SOAP ACTION: ${props.soapAction}`);
  }

  // Headers
  if (props.useHeadersVariable) {
    lines.push('');
    lines.push('[HEADERS]');
    lines.push(`Using variable '${props.headersVariable}'`);
  } else if (props.headers.size > 0) {
    lines.push('');
    lines.push('[HEADERS]');
    for (const [key, values] of props.headers) {
      for (const value of values) {
        lines.push(`${key}: ${value}`);
      }
    }
  }

  // Attachments
  lines.push('');
  lines.push('[ATTACHMENTS]');
  if (props.useAttachmentsVariable) {
    lines.push(`Using variable '${props.attachmentsVariable}'`);
  } else {
    for (let i = 0; i < props.attachmentNames.length; i++) {
      lines.push(`${props.attachmentNames[i]} (${props.attachmentTypes[i]})`);
    }
  }

  // Content
  lines.push('');
  lines.push('[CONTENT]');
  lines.push(props.envelope);

  return lines.join('\n');
}

/**
 * Get attachments from properties
 */
export function getAttachmentEntries(props: WebServiceDispatcherProperties): AttachmentEntry[] {
  const entries: AttachmentEntry[] = [];

  for (let i = 0; i < props.attachmentNames.length; i++) {
    entries.push({
      name: props.attachmentNames[i] || '',
      content: props.attachmentContents[i] || '',
      mimeType: props.attachmentTypes[i] || 'application/octet-stream',
    });
  }

  return entries;
}
