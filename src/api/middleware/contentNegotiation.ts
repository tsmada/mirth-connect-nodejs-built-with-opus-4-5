/**
 * Content Negotiation Middleware
 *
 * Handles XML/JSON content negotiation matching Mirth Connect API behavior.
 * Supports both application/xml and application/json for request and response.
 */

import { Request, Response, NextFunction } from 'express';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
});

/**
 * Determine if request wants XML response
 */
export function wantsXml(req: Request): boolean {
  const accept = req.get('Accept') || '';
  const contentType = req.get('Content-Type') || '';

  // Check Accept header first
  if (accept.includes('application/xml') || accept.includes('text/xml')) {
    return true;
  }

  // If no Accept, check Content-Type
  if (accept === '*/*' || !accept) {
    if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      return true;
    }
  }

  return false;
}

/**
 * Parse request body - handles both XML and JSON
 */
export function parseBody(req: Request): unknown {
  const contentType = req.get('Content-Type') || '';

  if (!req.body) {
    return null;
  }

  // If body is already parsed (by express.json or express.urlencoded)
  if (typeof req.body !== 'string') {
    return req.body;
  }

  // Parse XML body
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    try {
      return xmlParser.parse(req.body);
    } catch {
      return req.body;
    }
  }

  // Parse JSON body
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(req.body);
    } catch {
      return req.body;
    }
  }

  return req.body;
}

/**
 * Detect root element name for XML serialization based on data structure
 */
function detectRootName(data: unknown): string {
  if (data === null || data === undefined || typeof data !== 'object') {
    return 'response';
  }

  const obj = data as Record<string, unknown>;

  // Detect channel object
  if (
    'sourceConnector' in obj ||
    ('id' in obj && 'name' in obj && ('revision' in obj || 'destinationConnectors' in obj))
  ) {
    return 'channel';
  }

  // Detect user object
  if ('username' in obj && ('firstName' in obj || 'lastName' in obj)) {
    return 'user';
  }

  // Detect dashboard status
  if ('channelId' in obj && 'state' in obj) {
    return 'dashboardStatus';
  }

  return 'response';
}

/**
 * Send response in appropriate format (XML or JSON)
 */
export function sendResponse(res: Response, data: unknown, statusCode: number = 200): void {
  const req = res.req;

  if (wantsXml(req)) {
    const rootName = detectRootName(data);
    res.status(statusCode).type('application/xml').send(toXml(data, rootName));
  } else {
    res.status(statusCode).json(data);
  }
}

/**
 * Convert data to XML string
 */
export function toXml(data: unknown, rootName: string = 'response'): string {
  if (data === null || data === undefined) {
    return `<?xml version="1.0" encoding="UTF-8"?><${rootName}/>`;
  }

  // Handle primitives
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return `<?xml version="1.0" encoding="UTF-8"?><${rootName}>${data}</${rootName}>`;
  }

  // Handle arrays - wrap in list element
  if (Array.isArray(data)) {
    const itemName = rootName.endsWith('s') ? rootName.slice(0, -1) : 'item';
    const items = data.map((item) => toXmlElement(item, itemName)).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><list>${items}</list>`;
  }

  // Handle objects
  return `<?xml version="1.0" encoding="UTF-8"?>${xmlBuilder.build({ [rootName]: data })}`;
}

/**
 * Convert element to XML string (without declaration)
 */
function toXmlElement(data: unknown, name: string): string {
  if (data === null || data === undefined) {
    return `<${name}/>`;
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return `<${name}>${escapeXml(String(data))}</${name}>`;
  }

  if (typeof data === 'object') {
    return xmlBuilder.build({ [name]: data });
  }

  return `<${name}>${escapeXml(String(data))}</${name}>`;
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
 * Content negotiation middleware
 */
export function contentNegotiationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Attach helper methods to response
    res.sendData = (data: unknown, statusCode?: number) => {
      sendResponse(res, data, statusCode);
    };

    // Parse XML body and replace req.body
    if (typeof req.body === 'string' && req.body.length > 0) {
      const contentType = req.get('Content-Type') || '';
      if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
        try {
          const parsed = xmlParser.parse(req.body);
          // Store original body for reference
          (req as Request & { rawBody: string }).rawBody = req.body;
          // Replace body with parsed version, extract the root element
          // For channel XML, the root is <channel>, so we get parsed.channel
          if (parsed.channel) {
            req.body = parsed.channel;
          } else {
            req.body = parsed;
          }
        } catch {
          // Keep original body if parsing fails
        }
      }
    }

    next();
  };
}

// Extend Express Response type
declare global {
  namespace Express {
    interface Response {
      sendData: (data: unknown, statusCode?: number) => void;
    }
  }
}
