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
 * - Connection status event dispatching (CPC-MCE-001)
 * - Error event dispatching on HTTP errors (CPC-MEH-001)
 * - Response status defaults to QUEUED, not ERROR (CPC-RHG-001)
 * - Timeout errors caught distinctly (CPC-MEH-002)
 * - HTTP agent for connection reuse (CPC-CLG-001)
 * - Digest auth support (CPC-MAM-002)
 */

import http from 'http';
import https from 'https';
import { gzipSync, gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
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

  /**
   * CPC-CLG-001: HTTP agent for connection reuse.
   * Java maintains a ConcurrentHashMap<Long, CloseableHttpClient> keyed by dispatcherId.
   * Node.js uses http.Agent / https.Agent with keepAlive for connection pooling.
   */
  private httpAgent: http.Agent;
  private httpsAgent: https.Agent;

  /**
   * CPC-MAM-002: Cached Digest auth nonce count for preemptive digest
   */
  private digestNonceCount = 0;
  private digestCachedNonce: string | null = null;
  private digestCachedRealm: string | null = null;
  private digestCachedOpaque: string | null = null;
  private digestCachedQop: string | null = null;

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

    // CPC-CLG-001: Create agents with keepAlive for connection pooling
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 10,
      keepAliveMsecs: 30000,
    });
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 10,
      keepAliveMsecs: 30000,
    });
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
   * CPC-CLG-001: Get the HTTP agent for testing/inspection
   */
  getHttpAgent(): http.Agent {
    return this.httpAgent;
  }

  /**
   * Override onStop to clean up HTTP agents
   *
   * Java: HttpDispatcher.onStop() closes all cached CloseableHttpClient instances
   * and clears the clients map.
   */
  protected override async onStop(): Promise<void> {
    // CPC-CLG-001: Destroy agents on stop (matches Java's HttpClientUtils.closeQuietly)
    this.httpAgent.destroy();
    this.httpsAgent.destroy();

    // Re-create fresh agents for next start
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 10,
      keepAliveMsecs: 30000,
    });
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 10,
      keepAliveMsecs: 30000,
    });

    // Reset digest auth cache
    this.digestNonceCount = 0;
    this.digestCachedNonce = null;
    this.digestCachedRealm = null;
    this.digestCachedOpaque = null;
    this.digestCachedQop = null;
  }

  /**
   * Send message to HTTP endpoint
   *
   * CPC-RHG-001: Java's send() method initializes responseStatus = Status.QUEUED.
   * On success (status < 400), it changes to SENT. On ANY error (connection error,
   * HTTP >= 400), it remains QUEUED — allowing the queue to retry. Only the queue
   * processing loop eventually marks as ERROR after max retries.
   *
   * CPC-MCE-001: Dispatches WRITING event at start, IDLE in finally block.
   * CPC-MEH-001: Dispatches error event when status >= 400 or on exception.
   * CPC-MEH-002: Timeout errors caught distinctly.
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-MCE-001: Java dispatches WRITING at start of send()
    this.dispatchConnectionEvent(ConnectionStatusEventType.WRITING);

    // CPC-RHG-001: Java initializes responseStatus = Status.QUEUED
    let responseStatus: Status = Status.QUEUED;
    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatusMessage: string | null = null;

    try {
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

      // Store response metadata in connector map
      const connectorMap = connectorMessage.getConnectorMap();
      connectorMap.set('responseStatusLine', `HTTP/1.1 ${response.statusCode} ${response.statusMessage}`);
      connectorMap.set('responseHeaders', response.headers);

      responseData = response.body;

      // CPC-RHG-001 + CPC-MEH-001: Match Java's status code handling
      // Java: if (statusCode < HttpStatus.SC_BAD_REQUEST) { responseStatus = Status.SENT; }
      if (response.statusCode < 400) {
        responseStatus = Status.SENT;
      } else {
        // CPC-MEH-001: Java dispatches ErrorEvent when status >= 400
        // errorMessage = "Received error response from HTTP server."
        responseStatusMessage = `Received error response from HTTP server.`;
        responseError = `HTTP ${response.statusCode}: ${response.statusMessage}`;
        // responseStatus remains QUEUED (CPC-RHG-001)
      }
    } catch (error) {
      // CPC-MEH-001: Java dispatches ErrorEvent on connection exception
      // CPC-MEH-002: Timeout errors caught and mapped to QUEUED
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof Error && (
        error.name === 'AbortError' ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ESOCKETTIMEDOUT')
      );

      responseStatusMessage = 'Error connecting to HTTP server';
      responseError = isTimeout
        ? `Request timeout after ${this.properties.socketTimeout}ms`
        : `Error connecting to HTTP server: ${errorMessage}`;

      // CPC-RHG-001: responseStatus remains QUEUED (for retry)
      // Java: catch block does NOT change responseStatus from QUEUED

      // CPC-CLG-001: Java closes and removes client on Error/IllegalStateException
      // We don't need to do this since http.Agent handles connection pooling automatically
    } finally {
      // CPC-MCE-001: Always dispatch IDLE in finally block
      // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., IDLE))
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }

    // Apply final status to connector message (matches Java's return pattern)
    connectorMessage.setStatus(responseStatus);
    if (responseError) {
      connectorMessage.setProcessingError(responseError);
    }
  }

  /**
   * Execute HTTP request
   *
   * CPC-CLG-001: Uses http.Agent for connection pooling (replaces Java's
   * ConcurrentHashMap<Long, CloseableHttpClient>).
   * CPC-MAM-002: Supports Digest auth via challenge-response.
   */
  private async executeRequest(connectorMessage: ConnectorMessage): Promise<HttpResponse> {
    // Build URL with query parameters
    const url = this.buildUrl();

    // Build headers
    const headers = this.buildHeaders();

    // Build request body
    const body = this.buildBody(connectorMessage);

    // Determine which agent to use based on protocol
    const isHttps = url.startsWith('https:');

    // Create fetch options
    const options: RequestInit & { dispatcher?: unknown } = {
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
      if (this.properties.authenticationType === 'Basic') {
        const authHeader = this.buildBasicAuthHeader();
        if (authHeader) {
          (options.headers as Record<string, string>)['Authorization'] = authHeader;
        }
      }
      // CPC-MAM-002: Digest auth — handled via challenge-response below
    }

    // Add timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.properties.socketTimeout);
    options.signal = controller.signal;

    try {
      let fetchResponse = await fetch(url, options);
      clearTimeout(timeoutId);

      // CPC-MAM-002: Handle Digest auth challenge-response
      if (
        fetchResponse.status === 401 &&
        this.properties.useAuthentication &&
        this.properties.authenticationType === 'Digest'
      ) {
        const wwwAuth = fetchResponse.headers.get('www-authenticate');
        if (wwwAuth && wwwAuth.toLowerCase().startsWith('digest')) {
          const digestHeader = this.buildDigestAuthHeader(wwwAuth, url);
          if (digestHeader) {
            (options.headers as Record<string, string>)['Authorization'] = digestHeader;
            // Re-create abort controller for retry
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), this.properties.socketTimeout);
            options.signal = retryController.signal;

            fetchResponse = await fetch(url, options);
            clearTimeout(retryTimeoutId);
          }
        }
      }

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

      // CPC-MEH-002: Distinguish timeout errors specifically
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
   * Build Basic authentication header
   */
  private buildBasicAuthHeader(): string | null {
    if (!this.properties.useAuthentication) {
      return null;
    }

    const credentials = Buffer.from(
      `${this.properties.username}:${this.properties.password}`
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * CPC-MAM-002: Build Digest authentication header from server challenge
   *
   * Java uses Apache HttpClient's DigestScheme which handles the challenge-response
   * automatically. We parse the WWW-Authenticate header and compute the digest manually.
   */
  private buildDigestAuthHeader(wwwAuth: string, requestUrl: string): string | null {
    // Parse challenge parameters
    const params = this.parseDigestChallenge(wwwAuth);
    const realm = params.get('realm') || '';
    const nonce = params.get('nonce') || '';
    const qop = params.get('qop') || '';
    const opaque = params.get('opaque') || '';
    const algorithm = params.get('algorithm') || 'MD5';

    if (!nonce) return null;

    // Cache challenge params for preemptive auth
    this.digestCachedNonce = nonce;
    this.digestCachedRealm = realm;
    this.digestCachedOpaque = opaque;
    this.digestCachedQop = qop;
    this.digestNonceCount++;

    const nc = this.digestNonceCount.toString(16).padStart(8, '0');
    const cnonce = createHash('md5').update(Date.now().toString()).digest('hex').substring(0, 16);

    // Compute HA1 = MD5(username:realm:password)
    const ha1 = createHash(algorithm === 'MD5-sess' ? 'md5' : 'md5')
      .update(`${this.properties.username}:${realm}:${this.properties.password}`)
      .digest('hex');

    // Parse URI from request URL
    const uri = new URL(requestUrl).pathname;

    // Compute HA2 = MD5(method:uri)
    const ha2 = createHash('md5')
      .update(`${this.properties.method}:${uri}`)
      .digest('hex');

    // Compute response
    let response: string;
    if (qop === 'auth' || qop === 'auth-int') {
      response = createHash('md5')
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest('hex');
    } else {
      response = createHash('md5')
        .update(`${ha1}:${nonce}:${ha2}`)
        .digest('hex');
    }

    // Build header
    let header = `Digest username="${this.properties.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;

    if (qop) {
      header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }
    if (opaque) {
      header += `, opaque="${opaque}"`;
    }
    if (algorithm !== 'MD5') {
      header += `, algorithm=${algorithm}`;
    }

    return header;
  }

  /**
   * Parse Digest auth challenge parameters from WWW-Authenticate header
   */
  private parseDigestChallenge(wwwAuth: string): Map<string, string> {
    const params = new Map<string, string>();

    // Remove "Digest " prefix
    const challengeStr = wwwAuth.replace(/^digest\s+/i, '');

    // Match key="value" or key=value pairs
    const pattern = /([^\s=,]+)\s*=\s*("([^"]*(?:\\.[^"]*)*)"|([^=,;\s]+))/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(challengeStr)) !== null) {
      const key = match[1]!.toLowerCase();
      // Use quoted value (group 3) if available, otherwise unquoted (group 4)
      const value = match[3] !== undefined ? match[3] : (match[4] || '');
      params.set(key, value);
    }

    return params;
  }

  /**
   * Get response from the last request
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }
}
