/**
 * SOAP Envelope Builder
 *
 * Purpose: Build SOAP envelopes for SOAP 1.1 and SOAP 1.2
 *
 * Key behaviors:
 * - Generate SOAP 1.1 and 1.2 compliant envelopes
 * - Handle SOAP headers
 * - Support namespaces
 * - Parse and extract SOAP body content
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/**
 * SOAP version enumeration
 */
export enum SoapVersion {
  SOAP_1_1 = '1.1',
  SOAP_1_2 = '1.2',
}

/**
 * SOAP namespaces
 */
export const SOAP_NAMESPACES = {
  SOAP_1_1_ENVELOPE: 'http://schemas.xmlsoap.org/soap/envelope/',
  SOAP_1_2_ENVELOPE: 'http://www.w3.org/2003/05/soap-envelope',
  SOAP_1_1_ENCODING: 'http://schemas.xmlsoap.org/soap/encoding/',
  SOAP_1_2_ENCODING: 'http://www.w3.org/2003/05/soap-encoding',
  XSI: 'http://www.w3.org/2001/XMLSchema-instance',
  XSD: 'http://www.w3.org/2001/XMLSchema',
};

/**
 * SOAP Header entry
 */
export interface SoapHeader {
  /** Namespace URI */
  namespace?: string;
  /** Namespace prefix */
  prefix?: string;
  /** Local name of the header element */
  localName: string;
  /** Header content (XML string or object) */
  content: string | Record<string, unknown>;
  /** mustUnderstand attribute */
  mustUnderstand?: boolean;
  /** actor/role attribute */
  actor?: string;
}

/**
 * Options for building SOAP envelope
 */
export interface SoapEnvelopeOptions {
  /** SOAP version to use */
  version?: SoapVersion;
  /** SOAP headers to include */
  headers?: SoapHeader[];
  /** Additional namespaces to declare */
  namespaces?: Record<string, string>;
  /** Encoding style */
  encodingStyle?: string;
}

/**
 * SOAP Fault structure
 */
export interface SoapFault {
  /** Fault code */
  faultCode: string;
  /** Fault string/reason */
  faultString: string;
  /** Fault actor (SOAP 1.1) */
  faultActor?: string;
  /** Fault detail */
  detail?: string;
}

/**
 * Build a SOAP envelope around body content
 */
export function buildSoapEnvelope(bodyContent: string, options: SoapEnvelopeOptions = {}): string {
  const version = options.version ?? SoapVersion.SOAP_1_1;
  const envelopeNs =
    version === SoapVersion.SOAP_1_1
      ? SOAP_NAMESPACES.SOAP_1_1_ENVELOPE
      : SOAP_NAMESPACES.SOAP_1_2_ENVELOPE;

  const nsPrefix = 'soap';

  // Build namespace declarations
  const namespaces: string[] = [`xmlns:${nsPrefix}="${envelopeNs}"`];

  if (options.namespaces) {
    for (const [prefix, uri] of Object.entries(options.namespaces)) {
      namespaces.push(`xmlns:${prefix}="${uri}"`);
    }
  }

  if (options.encodingStyle) {
    namespaces.push(`${nsPrefix}:encodingStyle="${options.encodingStyle}"`);
  }

  const nsDecl = namespaces.join(' ');

  // Build headers section
  let headerSection = '';
  if (options.headers && options.headers.length > 0) {
    const headerElements = options.headers
      .map((h) => buildHeaderElement(h, nsPrefix, version))
      .join('\n    ');
    headerSection = `
  <${nsPrefix}:Header>
    ${headerElements}
  </${nsPrefix}:Header>`;
  }

  // Build full envelope
  return `<?xml version="1.0" encoding="UTF-8"?>
<${nsPrefix}:Envelope ${nsDecl}>${headerSection}
  <${nsPrefix}:Body>
    ${bodyContent}
  </${nsPrefix}:Body>
</${nsPrefix}:Envelope>`;
}

/**
 * Build a SOAP header element
 */
function buildHeaderElement(
  header: SoapHeader,
  envelopePrefix: string,
  version: SoapVersion
): string {
  const prefix = header.prefix || 'h';
  const nsAttr = header.namespace ? ` xmlns:${prefix}="${header.namespace}"` : '';

  const attrs: string[] = [];

  if (header.mustUnderstand !== undefined) {
    const value =
      version === SoapVersion.SOAP_1_1
        ? header.mustUnderstand
          ? '1'
          : '0'
        : header.mustUnderstand;
    attrs.push(`${envelopePrefix}:mustUnderstand="${value}"`);
  }

  if (header.actor) {
    const actorAttr = version === SoapVersion.SOAP_1_1 ? 'actor' : 'role';
    attrs.push(`${envelopePrefix}:${actorAttr}="${header.actor}"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const tagName = header.namespace ? `${prefix}:${header.localName}` : header.localName;

  const content =
    typeof header.content === 'string' ? header.content : JSON.stringify(header.content);

  return `<${tagName}${nsAttr}${attrStr}>${content}</${tagName}>`;
}

/**
 * Build a SOAP fault envelope
 */
export function buildSoapFaultEnvelope(
  fault: SoapFault,
  options: SoapEnvelopeOptions = {}
): string {
  const version = options.version ?? SoapVersion.SOAP_1_1;

  let faultBody: string;

  if (version === SoapVersion.SOAP_1_1) {
    faultBody = `<soap:Fault>
      <faultcode>${escapeXml(fault.faultCode)}</faultcode>
      <faultstring>${escapeXml(fault.faultString)}</faultstring>
      ${fault.faultActor ? `<faultactor>${escapeXml(fault.faultActor)}</faultactor>` : ''}
      ${fault.detail ? `<detail>${fault.detail}</detail>` : ''}
    </soap:Fault>`;
  } else {
    // SOAP 1.2 fault structure
    faultBody = `<soap:Fault>
      <soap:Code>
        <soap:Value>${escapeXml(fault.faultCode)}</soap:Value>
      </soap:Code>
      <soap:Reason>
        <soap:Text xml:lang="en">${escapeXml(fault.faultString)}</soap:Text>
      </soap:Reason>
      ${fault.detail ? `<soap:Detail>${fault.detail}</soap:Detail>` : ''}
    </soap:Fault>`;
  }

  return buildSoapEnvelope(faultBody, options);
}

/**
 * Parse a SOAP envelope and extract body content
 */
export function parseSoapEnvelope(envelope: string): {
  version: SoapVersion;
  headers: Record<string, unknown>[];
  body: string;
  bodyObject: Record<string, unknown>;
  isFault: boolean;
  fault?: SoapFault;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: false,
    parseAttributeValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(envelope);

  // Find envelope (could be soap:Envelope, SOAP-ENV:Envelope, etc.)
  let envelopeObj: Record<string, unknown> | null = null;
  let version = SoapVersion.SOAP_1_1;

  for (const key of Object.keys(parsed)) {
    if (key.toLowerCase().includes('envelope')) {
      envelopeObj = parsed[key] as Record<string, unknown>;

      // Detect version from namespace
      const nsAttr = Object.keys(envelopeObj).find((k) => k.startsWith('@_xmlns'));
      if (nsAttr) {
        const nsValue = envelopeObj[nsAttr] as string;
        if (nsValue?.includes('2003/05/soap-envelope')) {
          version = SoapVersion.SOAP_1_2;
        }
      }
      break;
    }
  }

  if (!envelopeObj) {
    throw new Error('Invalid SOAP envelope: Envelope element not found');
  }

  // Extract headers
  const headers: Record<string, unknown>[] = [];
  for (const key of Object.keys(envelopeObj)) {
    if (key.toLowerCase().includes('header')) {
      const headerObj = envelopeObj[key];
      if (headerObj && typeof headerObj === 'object') {
        headers.push(headerObj as Record<string, unknown>);
      }
    }
  }

  // Extract body
  let bodyKey: string | null = null;
  for (const key of Object.keys(envelopeObj)) {
    if (key.toLowerCase().includes('body')) {
      bodyKey = key;
      break;
    }
  }

  if (!bodyKey) {
    throw new Error('Invalid SOAP envelope: Body element not found');
  }

  const bodyObj = envelopeObj[bodyKey] as Record<string, unknown>;

  // Check for fault
  let isFault = false;
  let fault: SoapFault | undefined;

  for (const key of Object.keys(bodyObj || {})) {
    if (key.toLowerCase().includes('fault')) {
      isFault = true;
      fault = parseFault(bodyObj[key] as Record<string, unknown>, version);
      break;
    }
  }

  // Serialize body back to XML string
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
  });

  // Remove envelope and namespace attributes from body for clean extraction
  const cleanBody: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bodyObj || {})) {
    if (!key.startsWith('@_')) {
      cleanBody[key] = value;
    }
  }

  const bodyXml = builder.build(cleanBody);

  return {
    version,
    headers,
    body: bodyXml,
    bodyObject: bodyObj,
    isFault,
    fault,
  };
}

/**
 * Parse SOAP fault from object
 */
function parseFault(faultObj: Record<string, unknown>, version: SoapVersion): SoapFault {
  if (version === SoapVersion.SOAP_1_1) {
    return {
      faultCode: String(faultObj['faultcode'] || ''),
      faultString: String(faultObj['faultstring'] || ''),
      faultActor: faultObj['faultactor'] ? String(faultObj['faultactor']) : undefined,
      detail: faultObj['detail'] ? JSON.stringify(faultObj['detail']) : undefined,
    };
  } else {
    // SOAP 1.2
    const code = faultObj['soap:Code'] as Record<string, unknown> | undefined;
    const reason = faultObj['soap:Reason'] as Record<string, unknown> | undefined;
    const detail = faultObj['soap:Detail'];

    return {
      faultCode: code?.['soap:Value'] ? String(code['soap:Value']) : '',
      faultString: reason?.['soap:Text'] ? String(reason['soap:Text']) : '',
      detail: detail ? JSON.stringify(detail) : undefined,
    };
  }
}

/**
 * Extract the SOAP body content (without wrapper)
 */
export function extractSoapBodyContent(envelope: string): string {
  const parsed = parseSoapEnvelope(envelope);
  return parsed.body;
}

/**
 * Detect SOAP version from envelope
 */
export function detectSoapVersion(envelope: string): SoapVersion {
  if (envelope.includes('2003/05/soap-envelope')) {
    return SoapVersion.SOAP_1_2;
  }
  return SoapVersion.SOAP_1_1;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get SOAP content type for version
 */
export function getSoapContentType(version: SoapVersion, soapAction?: string): string {
  if (version === SoapVersion.SOAP_1_1) {
    // SOAP 1.1 uses text/xml
    return 'text/xml; charset=utf-8';
  } else {
    // SOAP 1.2 uses application/soap+xml with optional action
    if (soapAction) {
      return `application/soap+xml; charset=utf-8; action="${soapAction}"`;
    }
    return 'application/soap+xml; charset=utf-8';
  }
}
