/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/http/HttpReceiver.java
 *
 * Purpose: HTTP source connector that listens for incoming HTTP requests
 *
 * Key behaviors to replicate:
 * - Listen on configurable host:port
 * - Handle context paths
 * - Populate sourceMap with request metadata
 * - Support binary content detection
 * - Handle responses based on message processing result
 * - GZIP compression support
 * - Connection status event dispatching (CPC-MCE-001)
 * - Basic auth support (CPC-MAM-001)
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { gunzipSync, gzipSync } from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { Message } from '../../model/Message.js';
import { Status } from '../../model/Status.js';
import { ListenerInfo } from '../../api/models/DashboardStatus.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  HttpReceiverProperties,
  HttpStaticResource,
  getDefaultHttpReceiverProperties,
  isBinaryMimeType,
} from './HttpConnectorProperties.js';

export interface HttpReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<HttpReceiverProperties>;
}

/**
 * HTTP Source Connector that listens for incoming HTTP requests
 */
export class HttpReceiver extends SourceConnector {
  private properties: HttpReceiverProperties;
  private app: Express | null = null;
  private server: Server | null = null;

  constructor(config: HttpReceiverConfig) {
    super({
      name: config.name ?? 'HTTP Listener',
      transportName: 'HTTP',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultHttpReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector properties
   */
  getProperties(): HttpReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<HttpReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the HTTP server
   *
   * Java: HttpReceiver.onStart() dispatches IDLE on success, FAILURE on error
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('HTTP Receiver is already running');
    }

    this.app = express();

    // Configure middleware
    this.configureMiddleware();

    // Configure authentication middleware (CPC-MAM-001)
    if (this.properties.useAuthentication) {
      this.configureAuthentication();
    }

    // Configure routes
    this.configureRoutes();

    // Start server
    await new Promise<void>((resolve, reject) => {
      try {
        this.server = this.app!.listen(this.properties.port, this.properties.host, () => {
          this.running = true;
          // CPC-MCE-001: Dispatch IDLE event after successful start
          // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., IDLE))
          this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
          resolve();
        });

        this.server.on('error', (err) => {
          // CPC-MCE-001: Java dispatches FAILURE on start error
          // We use DISCONNECTED as the closest equivalent
          this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED, err.message);
          reject(err);
        });

        // Set timeout
        if (this.properties.timeout > 0) {
          this.server.setTimeout(this.properties.timeout);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the HTTP server
   *
   * Java: HttpReceiver.onStop() stops the Jetty server
   * Note: Java does NOT dispatch a DISCONNECTED event in onStop() — the IDLE event
   * from the finally block in RequestHandler covers it. But we dispatch DISCONNECTED
   * for dashboard accuracy since there's no active request handler at shutdown.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.running = false;
          this.server = null;
          this.app = null;
          // CPC-MCE-001: Dispatch DISCONNECTED on stop
          this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED);
          resolve();
        }
      });
    });
  }

  /**
   * Configure Express middleware
   */
  private configureMiddleware(): void {
    if (!this.app) return;

    // Raw body parser for all content types
    this.app.use(
      express.raw({
        type: '*/*',
        limit: '50mb',
      })
    );

    // GZIP decompression middleware
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      const contentEncoding = req.headers['content-encoding'];
      if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          try {
            req.body = gunzipSync(req.body);
          } catch {
            // If decompression fails, keep original body
          }
        }
      }
      next();
    });
  }

  /**
   * Configure Basic auth middleware (CPC-MAM-001)
   *
   * Java uses Jetty's ConstraintSecurityHandler with a custom Authenticator
   * that delegates to AuthenticatorProvider. We implement Basic auth inline
   * since the Java plugin architecture is not needed.
   */
  private configureAuthentication(): void {
    if (!this.app) return;

    const username = this.properties.username ?? '';
    const password = this.properties.password ?? '';
    const authType = this.properties.authenticationType ?? 'Basic';

    if (authType === 'Basic') {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Mirth Connect"');
          res.status(401).send('Authentication required');
          return;
        }

        const base64Credentials = authHeader.slice(6); // Remove 'Basic '
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        const [reqUsername, reqPassword] = credentials.split(':');

        if (reqUsername === username && reqPassword === password) {
          next();
        } else {
          res.setHeader('WWW-Authenticate', 'Basic realm="Mirth Connect"');
          res.status(401).send('Invalid credentials');
        }
      });
    }
    // Digest auth on receiver side is handled by Java's plugin system
    // and rarely used in practice — Basic is the common case
  }

  /**
   * Normalize a context path: ensure leading slash, strip trailing slash.
   *
   * Java: HttpReceiver.onStart() lines 204-216
   */
  private normalizeContextPath(raw: string): string {
    let cp = raw.trim();
    if (!cp.startsWith('/')) {
      cp = '/' + cp;
    }
    if (cp.endsWith('/') && cp.length > 1) {
      cp = cp.slice(0, -1);
    }
    return cp;
  }

  /**
   * Configure Express routes.
   *
   * Java: HttpReceiver.onStart() registers static resource handlers in a
   * HandlerCollection BEFORE the main RequestHandler. We replicate this by
   * registering Express routes for static resources first, then the catch-all
   * message handler. Static resources only respond to GET; other methods
   * fall through to the message handler.
   */
  private configureRoutes(): void {
    if (!this.app) return;

    const contextPath = this.normalizeContextPath(this.properties.contextPath);

    // Register static resource routes BEFORE the catch-all message handler
    // Java: iterates staticResourcesMap.descendingMap() (most specific paths first)
    this.registerStaticResources(contextPath);

    // Handle all HTTP methods at the context path (message handler)
    const routePath = contextPath === '/' ? '*' : `${contextPath}*`;

    this.app.all(routePath, async (req: Request, res: Response) => {
      await this.handleRequest(req, res);
    });
  }

  /**
   * Register static resource routes.
   *
   * Java: HttpReceiver.onStart() lines 226-281 — builds a TreeMap of
   * static resources keyed by resolved context path, iterates in reverse
   * order (most specific first), and adds a ContextHandler + StaticResourceHandler
   * for each.
   *
   * Java: StaticResourceHandler.handle() (lines 646-779) — only handles GET,
   * serves FILE (stream file), DIRECTORY (one level deep), or CUSTOM (inline string).
   */
  private registerStaticResources(baseContextPath: string): void {
    if (!this.app) return;
    const staticResources = this.properties.staticResources;
    if (!staticResources || staticResources.length === 0) return;

    // Build a sorted map of context path -> resources (Java uses TreeMap)
    const resourceMap = new Map<string, HttpStaticResource[]>();

    for (const resource of staticResources) {
      let resourcePath = this.normalizeContextPath(resource.contextPath);

      // Strip query parameters from the resource path (Java lines 236-250)
      const queryIndex = resourcePath.indexOf('?');
      if (queryIndex >= 0) {
        resourcePath = resourcePath.substring(0, queryIndex);
      }

      // Prepend base context path (Java line 259)
      const fullPath = baseContextPath === '/' ? resourcePath : baseContextPath + resourcePath;

      const existing = resourceMap.get(fullPath) || [];
      existing.push({ ...resource, contextPath: fullPath });
      resourceMap.set(fullPath, existing);
    }

    // Sort keys in reverse order so more specific paths are registered first
    // Java: staticResourcesMap.descendingMap()
    const sortedPaths = [...resourceMap.keys()].sort().reverse();

    for (const resourcePath of sortedPaths) {
      const resources = resourceMap.get(resourcePath)!;
      for (const resource of resources) {
        this.registerSingleStaticResource(resource);
      }
    }
  }

  /**
   * Register a single static resource route.
   *
   * Java: StaticResourceHandler inner class — only handles GET requests.
   * Non-GET requests "return" without calling baseRequest.setHandled(true),
   * which causes Jetty to pass the request to the next handler (our message handler).
   */
  private registerSingleStaticResource(resource: HttpStaticResource): void {
    if (!this.app) return;

    const resourceContextPath = resource.contextPath;

    if (resource.resourceType === 'DIRECTORY') {
      // DIRECTORY: serve files one level deep from the directory
      // Java lines 721-755: resolves childPath from request, rejects subdirectories
      const dirRoutePath = `${resourceContextPath}/:fileName`;

      this.app.get(dirRoutePath, (req: Request, res: Response, next: NextFunction) => {
        const fileName = req.params.fileName;
        if (!fileName || fileName.includes('/')) {
          // Java: if childPath contains "/", pass to next handler
          return next();
        }

        const dirPath = resource.value;
        try {
          const stat = fs.statSync(dirPath);
          if (!stat.isDirectory()) {
            return next();
          }
        } catch {
          return next();
        }

        const filePath = path.join(dirPath, fileName);
        try {
          const fileStat = fs.statSync(filePath);
          if (fileStat.isDirectory()) {
            // Java: directory itself was requested, pass to next handler
            return next();
          }
          // Stream file to client
          res.setHeader('Content-Type', resource.contentType || 'application/octet-stream');
          res.status(200);
          const stream = fs.createReadStream(filePath);
          stream.pipe(res);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.status(500).send('Error reading file');
            }
          });
        } catch {
          // File does not exist, pass to next handler
          return next();
        }
      });
    } else if (resource.resourceType === 'FILE') {
      // FILE: serve a single file at the exact context path
      // Java lines 718-720: IOUtils.copy(new FileInputStream(value), responseOutputStream)
      this.app.get(resourceContextPath, (_req: Request, res: Response) => {
        const filePath = resource.value;
        try {
          fs.accessSync(filePath, fs.constants.R_OK);
        } catch {
          res.status(404).send('File not found');
          return;
        }

        res.setHeader('Content-Type', resource.contentType || 'application/octet-stream');
        res.status(200);
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).send('Error reading file');
          }
        });
      });
    } else {
      // CUSTOM: return inline string content
      // Java lines 757-758: IOUtils.write(value, responseOutputStream, charset)
      this.app.get(resourceContextPath, (_req: Request, res: Response) => {
        res.setHeader('Content-Type', resource.contentType || 'text/plain');
        res.status(200).send(resource.value);
      });
    }
  }

  /**
   * Handle incoming HTTP request
   *
   * Java: RequestHandler.handle() dispatches:
   * 1. CONNECTED when request arrives
   * 2. RECEIVING after parsing request body (in getMessage())
   * 3. IDLE in finally block after dispatch completes
   *
   * CPC-W20-001: Captures dispatchRawMessage() result and passes to sendResponse()
   * so that the channel's processed response is returned as the HTTP response body.
   */
  private async handleRequest(req: Request, res: Response): Promise<void> {
    // CPC-MCE-001: Dispatch CONNECTED when request arrives
    // Java: eventController.dispatchEvent(new ConnectionStatusEvent(..., CONNECTED))
    this.dispatchConnectionEvent(ConnectionStatusEventType.CONNECTED);

    try {
      // Build source map with request metadata
      const sourceMap = this.buildSourceMap(req);

      // Get message content
      const messageContent = this.getMessageContent(req);

      // CPC-MCE-001: Dispatch RECEIVING after parsing request
      // Java: in getMessage(), after parsing body
      this.dispatchConnectionEvent(ConnectionStatusEventType.RECEIVING);

      // CPC-W20-001: Dispatch the message and capture result for response generation
      const dispatchResult = await this.dispatchRawMessageWithResult(messageContent, sourceMap);

      // Send response using channel pipeline result
      await this.sendResponse(req, res, dispatchResult);
    } catch (error) {
      await this.sendErrorResponse(res, error);
    } finally {
      // CPC-MCE-001: Always return to IDLE after handling request
      // Java: in finally block of RequestHandler.handle()
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Dispatch raw message and return the Message result.
   * Wraps SourceConnector.dispatchRawMessage() to capture the channel pipeline result.
   *
   * CPC-W20-001: Same pattern as TcpReceiver.dispatchRawMessageWithResult()
   */
  private async dispatchRawMessageWithResult(
    rawData: string,
    sourceMap?: Map<string, unknown>
  ): Promise<Message | null> {
    if (!this.channel) {
      throw new Error('Source connector is not attached to a channel');
    }
    return this.channel.dispatchRawMessage(rawData, sourceMap);
  }

  /**
   * Build source map from request
   */
  private buildSourceMap(req: Request): Map<string, unknown> {
    const sourceMap = new Map<string, unknown>();

    // Connection info
    sourceMap.set('remoteAddress', req.ip || req.socket.remoteAddress || '');
    sourceMap.set('remotePort', req.socket.remotePort || 0);
    sourceMap.set('localAddress', req.socket.localAddress || '');
    sourceMap.set('localPort', req.socket.localPort || 0);

    // Request info
    sourceMap.set('method', req.method);
    sourceMap.set('url', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
    sourceMap.set('uri', req.originalUrl);
    sourceMap.set('protocol', `HTTP/${req.httpVersion}`);
    sourceMap.set('query', req.url.includes('?') ? req.url.split('?')[1] : '');
    sourceMap.set('contextPath', req.path);

    // Headers (case-insensitive)
    const headers = new Map<string, string[]>();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key.toLowerCase(), Array.isArray(value) ? value : [value]);
      }
    }
    sourceMap.set('headers', headers);

    // Query parameters
    const parameters = new Map<string, string[]>();
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined) {
        parameters.set(key, Array.isArray(value) ? (value as string[]) : [String(value)]);
      }
    }
    sourceMap.set('parameters', parameters);

    return sourceMap;
  }

  /**
   * Get message content from request
   */
  private getMessageContent(req: Request): string {
    // Determine if content is binary
    const contentTypeHeader = req.headers['content-type'] || 'text/plain';
    const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : contentTypeHeader[0] || 'text/plain';
    const mimeType = (contentType.split(';')[0] || '').trim();
    const isBinary = isBinaryMimeType(
      mimeType,
      this.properties.binaryMimeTypes,
      this.properties.binaryMimeTypesRegex
    );

    if (Buffer.isBuffer(req.body)) {
      if (isBinary) {
        // Return base64 encoded for binary content
        return req.body.toString('base64');
      } else {
        // Return as string with proper encoding
        return req.body.toString(this.properties.charset as BufferEncoding);
      }
    }

    return typeof req.body === 'string' ? req.body : String(req.body || '');
  }

  /**
   * CPC-W20-002: Apply response headers from a map variable.
   *
   * Java HttpReceiver looks up responseHeadersVariable from the connector message's
   * maps (channelMap, responseMap, connectorMap, sourceMap) and applies key-value
   * pairs as HTTP response headers.
   *
   * Java: HttpReceiver.java applyResponseHeaders() — when useResponseHeadersVariable=true,
   * retrieves the variable from the source connector message's merged map.
   */
  private applyVariableResponseHeaders(res: Response, dispatchResult: Message | null): void {
    if (!this.properties.useResponseHeadersVariable || !this.properties.responseHeadersVariable) {
      return;
    }

    if (!dispatchResult) return;

    // Look up the variable from the source connector message's maps
    const sourceMsg = dispatchResult.getConnectorMessage(0);
    if (!sourceMsg) return;

    const varName = this.properties.responseHeadersVariable;

    // Search maps in order: channelMap → responseMap → connectorMap → sourceMap
    // (matching Java's map lookup priority)
    let headerValue: unknown =
      sourceMsg.getChannelMap().get(varName) ??
      sourceMsg.getResponseMap().get(varName) ??
      sourceMsg.getConnectorMap().get(varName) ??
      sourceMsg.getSourceMap().get(varName);

    if (!headerValue) return;

    // Apply headers — supports Map, plain object, or JSON string
    if (typeof headerValue === 'string') {
      try {
        headerValue = JSON.parse(headerValue);
      } catch {
        return; // Not valid JSON, skip
      }
    }

    if (headerValue instanceof Map) {
      for (const [key, value] of headerValue) {
        if (typeof key === 'string' && value != null) {
          res.setHeader(key, String(value));
        }
      }
    } else if (typeof headerValue === 'object' && headerValue !== null) {
      for (const [key, value] of Object.entries(headerValue)) {
        if (value != null) {
          res.setHeader(key, String(value));
        }
      }
    }
  }

  /**
   * Send successful response
   *
   * CPC-W20-001: Now receives the Message result from channel dispatch and extracts
   * the selected response body. Java HttpReceiver.sendResponse() reads the response
   * content from the source connector's selected response.
   *
   * CPC-MCE-001: Dispatches SENDING event during response write.
   */
  private async sendResponse(req: Request, res: Response, dispatchResult: Message | null): Promise<void> {
    // CPC-MCE-001: Dispatch SENDING event when writing response
    this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING);

    // Set content type
    res.setHeader('Content-Type', this.properties.responseContentType);

    // Set custom headers
    for (const [key, values] of this.properties.responseHeaders) {
      for (const value of values) {
        res.append(key, value);
      }
    }

    // CPC-W20-002: Apply headers from variable if configured
    this.applyVariableResponseHeaders(res, dispatchResult);

    // Determine status code — use configured code, or derive from processing result
    let statusCode = 200;
    if (this.properties.responseStatusCode) {
      const parsed = parseInt(this.properties.responseStatusCode, 10);
      if (!isNaN(parsed)) {
        statusCode = parsed;
      }
    } else if (dispatchResult) {
      // If no explicit status code configured, derive from message processing result
      statusCode = this.deriveStatusCode(dispatchResult);
    }

    res.status(statusCode);

    // CPC-W20-001: Extract response body from channel pipeline result
    const responseBody = this.getResponseBody(dispatchResult);

    // Check if client accepts GZIP
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const acceptsGzip =
      acceptEncoding.includes('gzip') || acceptEncoding.includes('x-gzip');

    // Compress if accepted
    if (acceptsGzip && responseBody.length > 0) {
      res.setHeader('Content-Encoding', 'gzip');
      const compressed = gzipSync(Buffer.from(responseBody, this.properties.charset as BufferEncoding));
      res.send(compressed);
    } else {
      res.send(responseBody);
    }
  }

  /**
   * CPC-W20-001: Extract the response body from the channel's dispatch result.
   *
   * Java HttpReceiver.sendResponse() reads the selected response from the source
   * connector message. The response comes from:
   * 1. The response transformer output (if configured)
   * 2. The selected destination's response
   * 3. An auto-generated response based on message status
   *
   * The source connector message (metaDataId=0) holds the "selected" response
   * after the response selector and response transformer have run.
   */
  private getResponseBody(dispatchResult: Message | null): string {
    if (!dispatchResult) return '';

    // Check source connector message for the selected response
    const sourceMsg = dispatchResult.getConnectorMessage(0);
    if (!sourceMsg) return '';

    // Try response-transformed content first (output of response transformer)
    const responseTransformed = sourceMsg.getResponseTransformedData();
    if (responseTransformed) return responseTransformed;

    // Try the response content (selected response from destination)
    const responseContent = sourceMsg.getResponseContent();
    if (responseContent) return responseContent.content;

    // Fall back to first destination's response
    const connectorMessages = dispatchResult.getConnectorMessages();
    for (const [metaDataId, connMsg] of connectorMessages) {
      if (metaDataId === 0) continue; // Skip source
      const destResponse = connMsg.getResponseContent();
      if (destResponse) return destResponse.content;
    }

    return '';
  }

  /**
   * Derive HTTP status code from message processing result when no explicit
   * responseStatusCode is configured.
   *
   * Java maps message status to HTTP status codes:
   * - FILTERED → 200 (message was intentionally filtered)
   * - ERROR → 500
   * - SENT/TRANSFORMED → 200
   */
  private deriveStatusCode(dispatchResult: Message): number {
    const sourceMsg = dispatchResult.getConnectorMessage(0);
    if (!sourceMsg) return 200;

    if (sourceMsg.getStatus() === Status.ERROR) return 500;

    // Check destination statuses for errors
    const connectorMessages = dispatchResult.getConnectorMessages();
    for (const [metaDataId, connMsg] of connectorMessages) {
      if (metaDataId === 0) continue;
      if (connMsg.getStatus() === Status.ERROR) return 500;
    }

    return 200;
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(res: Response, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    res.status(500);
    res.setHeader('Content-Type', 'text/plain');
    res.send(`Error processing request: ${errorMessage}`);
  }

  /**
   * Get the server instance (for testing)
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Get the Express app instance (for testing)
   */
  getApp(): Express | null {
    return this.app;
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.properties.port;
  }

  /**
   * Get the host the server is listening on
   */
  getHost(): string {
    return this.properties.host;
  }

  /**
   * Get listener information for dashboard display.
   * Returns null if the connector is not running.
   */
  getListenerInfo(): ListenerInfo | null {
    if (!this.running || !this.server) {
      return null;
    }

    return {
      port: this.properties.port,
      host: this.properties.host || '0.0.0.0',
      connectionCount: 0, // Express doesn't track connections the same way
      maxConnections: 0,  // No limit by default
      transportType: 'HTTP',
      listening: this.server.listening,
    };
  }
}
