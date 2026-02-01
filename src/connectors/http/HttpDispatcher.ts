/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/http/HttpDispatcher.java
 *
 * Purpose: HTTP destination connector that sends outgoing HTTP requests
 *
 * Key behaviors to replicate:
 * - Support GET, POST, PUT, DELETE, PATCH methods
 * - Headers and query parameters
 * - Authentication (Basic, Digest)
 * - Binary and multipart content
 * - Proxy support
 * - Response handling
 */

import { gzipSync, gunzipSync } from 'zlib';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import {
  HttpDispatcherProperties,
  getDefaultHttpDispatcherProperties,
  isBinaryMimeType,
} from './HttpConnectorProperties.js';

export interface HttpDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<HttpDispatcherProperties>;
}

export interface HttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: Map<string, string[]>;
  body: string;
}

/**
 * HTTP Destination Connector that sends outgoing HTTP requests
 */
export class HttpDispatcher extends DestinationConnector {
  private properties: HttpDispatcherProperties;

  constructor(config: HttpDispatcherConfig) {
    super({
      name: config.name ?? 'HTTP Sender',
      metaDataId: config.metaDataId,
      transportName: 'HTTP',
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultHttpDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): HttpDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<HttpDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Send message to HTTP endpoint
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    const response = await this.executeRequest(connectorMessage);

    // Store response in connector message
    connectorMessage.setContent({
      contentType: ContentType.RESPONSE,
      content: response.body,
      dataType: 'RAW',
      encrypted: false,
    });

    // Set send date
    connectorMessage.setSendDate(new Date());

    // Update status based on response code
    if (response.statusCode >= 200 && response.statusCode < 400) {
      connectorMessage.setStatus(Status.SENT);
    } else {
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(`HTTP ${response.statusCode}: ${response.statusMessage}`);
    }

    // Store response metadata in connector map
    const connectorMap = connectorMessage.getConnectorMap();
    connectorMap.set('responseStatusLine', `HTTP/1.1 ${response.statusCode} ${response.statusMessage}`);
    connectorMap.set('responseHeaders', response.headers);
  }

  /**
   * Execute HTTP request
   */
  private async executeRequest(connectorMessage: ConnectorMessage): Promise<HttpResponse> {
    // Build URL with query parameters
    const url = this.buildUrl();

    // Build headers
    const headers = this.buildHeaders();

    // Build request body
    const body = this.buildBody(connectorMessage);

    // Create fetch options
    const options: RequestInit = {
      method: this.properties.method,
      headers: Object.fromEntries(
        Array.from(headers.entries()).map(([k, v]) => [k, v.join(', ')])
      ),
    };

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(this.properties.method)) {
      if (body !== null) {
        // Check if we need to GZIP compress the body
        const contentEncoding = headers.get('content-encoding');
        if (contentEncoding?.includes('gzip') || contentEncoding?.includes('x-gzip')) {
          options.body = gzipSync(Buffer.from(body, this.properties.charset as BufferEncoding));
        } else {
          options.body = body;
        }
      }
    }

    // Add authentication
    if (this.properties.useAuthentication) {
      const authHeader = this.buildAuthHeader();
      if (authHeader) {
        (options.headers as Record<string, string>)['Authorization'] = authHeader;
      }
    }

    // Add timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.properties.socketTimeout);
    options.signal = controller.signal;

    try {
      const fetchResponse = await fetch(url, options);
      clearTimeout(timeoutId);

      // Parse response headers
      const responseHeaders = new Map<string, string[]>();
      fetchResponse.headers.forEach((value, key) => {
        const existing = responseHeaders.get(key) || [];
        existing.push(value);
        responseHeaders.set(key, existing);
      });

      // Get response body
      let responseBody: string;
      const responseContentType = fetchResponse.headers.get('content-type') || 'text/plain';
      const responseMimeType = (responseContentType.split(';')[0] || '').trim();

      // Check if response is binary
      const isBinary = isBinaryMimeType(
        responseMimeType,
        this.properties.responseBinaryMimeTypes,
        this.properties.responseBinaryMimeTypesRegex
      );

      // Check for GZIP encoding
      const responseEncoding = fetchResponse.headers.get('content-encoding');
      let bodyBuffer = Buffer.from(await fetchResponse.arrayBuffer());

      if (responseEncoding === 'gzip' || responseEncoding === 'x-gzip') {
        try {
          bodyBuffer = gunzipSync(bodyBuffer);
        } catch {
          // If decompression fails, use original
        }
      }

      if (isBinary) {
        responseBody = bodyBuffer.toString('base64');
      } else {
        responseBody = bodyBuffer.toString(this.properties.charset as BufferEncoding);
      }

      return {
        statusCode: fetchResponse.status,
        statusMessage: fetchResponse.statusText,
        headers: responseHeaders,
        body: responseBody,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.properties.socketTimeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(): string {
    const url = new URL(this.properties.host);

    // Add query parameters (for GET and non-form-encoded requests)
    if (
      this.properties.method === 'GET' ||
      this.properties.method === 'DELETE' ||
      !this.properties.contentType
        .toLowerCase()
        .includes('application/x-www-form-urlencoded')
    ) {
      for (const [key, values] of this.properties.parameters) {
        for (const value of values) {
          url.searchParams.append(key, value);
        }
      }
    }

    return url.toString();
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Map<string, string[]> {
    const headers = new Map<string, string[]>(this.properties.headers);

    // Set content type if not already set
    if (!headers.has('content-type') && !headers.has('Content-Type')) {
      let contentType = this.properties.contentType;

      // Add charset for text content types
      if (!this.properties.dataTypeBinary && !contentType.includes('charset')) {
        contentType = `${contentType}; charset=${this.properties.charset}`;
      }

      headers.set('Content-Type', [contentType]);
    }

    return headers;
  }

  /**
   * Build request body
   */
  private buildBody(connectorMessage: ConnectorMessage): string | null {
    // Get content from properties or connector message
    let content = this.properties.content;

    // If content is empty, try to get from encoded content
    if (!content) {
      const encodedContent = connectorMessage.getEncodedContent();
      content = encodedContent?.content || '';
    }

    // Check if this is a form-encoded POST/PUT/PATCH
    if (
      this.properties.contentType
        .toLowerCase()
        .includes('application/x-www-form-urlencoded')
    ) {
      // Build form data from parameters
      const params = new URLSearchParams();
      for (const [key, values] of this.properties.parameters) {
        for (const value of values) {
          params.append(key, value);
        }
      }
      return params.toString();
    }

    // Handle binary content
    if (this.properties.dataTypeBinary && content) {
      // Content is base64 encoded, decode it
      return Buffer.from(content, 'base64').toString('binary');
    }

    return content || null;
  }

  /**
   * Build authentication header
   */
  private buildAuthHeader(): string | null {
    if (!this.properties.useAuthentication) {
      return null;
    }

    if (this.properties.authenticationType === 'Basic') {
      const credentials = Buffer.from(
        `${this.properties.username}:${this.properties.password}`
      ).toString('base64');
      return `Basic ${credentials}`;
    }

    // Digest authentication requires challenge-response
    // For preemptive digest, we'd need the initial challenge cached
    // For now, return null and let the server challenge us
    if (this.properties.authenticationType === 'Digest') {
      if (this.properties.usePreemptiveAuthentication) {
        // Preemptive digest not supported yet without cached challenge
        // Fall back to non-preemptive
      }
      return null;
    }

    return null;
  }

  /**
   * Get response from the last request
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }
}
